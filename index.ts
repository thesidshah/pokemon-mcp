import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequest,
  CallToolRequestSchema,
  ListToolsRequestSchema,
Tool,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import express, { Request, Response } from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";

/**
 * Pokemon MCP Server
 *
 * An MCP-protocol server that exposes Pokemon battle mechanics as tools.
 * Designed as an interview exercise — candidates integrate this server with
 * an AI client and implement battle strategies.
 *
 * Architecture:
 *   - POKEMON_DB / MOVES_DB: Static data for species and moves
 *   - TYPE_EFFECTIVENESS: Type chart (attacking → defending → multiplier)
 *   - BattleState: Singleton state for the active battle (shared across transports)
 *   - createServer(): Factory that produces a configured MCP Server instance
 *   - Tool handlers: MCP tool implementations (list, get, battle, attack, etc.)
 *
 * Transports (run simultaneously):
 *   - Stdio: For local MCP clients (Claude Desktop). One Server instance.
 *   - Streamable HTTP: For remote/web clients. One Server instance per session,
 *     served via Express on PORT (default 3000). Uses the MCP Streamable HTTP
 *     protocol (POST/GET/DELETE on /mcp) with session IDs in headers.
 *
 * Key mechanics:
 *   - Damage = ((2*Level+10)/250) * (Atk/Def) * Power + 2, × STAB × Type × Random
 *   - STAB: 1.5× if move type matches attacker's type
 *   - Speed determines first turn; turns alternate after that
 *   - Accuracy is checked before damage (move can miss)
 *   - Only one battle can be active at a time (singleton state)
 */

// ═══════════════════════════════════════════════════════════════════════════
// Type Effectiveness Chart
// ═══════════════════════════════════════════════════════════════════════════

// Read as: attacking_type → { defending_type: multiplier }
// Omitted entries default to 1× (normal effectiveness)
const TYPE_EFFECTIVENESS = {
  normal:    { rock: 0.5, ghost: 0,   steel: 0.5 },
  fire:      { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water:     { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric:  { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass:     { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice:       { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting:  { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
  poison:    { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
  ground:    { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying:    { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic:   { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug:       { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
  rock:      { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost:     { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon:    { dragon: 2, steel: 0.5, fairy: 0 },
  dark:      { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel:     { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
  fairy:     { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
} as const;

type PokemonType = keyof typeof TYPE_EFFECTIVENESS;

interface PokemonStats {
  level: number;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  currentHp: number;
}

type Category = "physical" | "special";

interface Move {
  name: string;
  type: PokemonType;
  power: number;
  accuracy: number;
  category: Category;
}

interface Pokemon {
  id: number;
  name: string;
  types: PokemonType[];
  baseStats: {
    hp: number;
    attack: number;
    defense: number;
    speed: number;
  };
  movePool: string[];
  // The following only exist once instantiated for battle:
  stats?: PokemonStats;
  moves?: Move[];
  status?: string | null;
}

// A fully‐fledged Pokémon ready for battle
interface BattlePokemon extends Pokemon {
  stats: PokemonStats;
  moves: Move[];
  status: null;
}

/** Tracks the state of an ongoing battle between two Pokemon. */
interface BattleState {
  active: boolean;
  pokemon1: BattlePokemon;
  pokemon2: BattlePokemon;
  turn: number;
  currentTurn: "pokemon1" | "pokemon2";
}

/**
 * Singleton battle state, shared across all transports (stdio + HTTP sessions).
 * Only one battle can be active at a time regardless of which client started it.
 */
let currentBattle: BattleState | null = null;

// ═══════════════════════════════════════════════════════════════════════════
// Pokemon & Move Data
// ═══════════════════════════════════════════════════════════════════════════

const POKEMON_DB: ReadonlyArray<Omit<Pokemon, "stats" | "moves" | "status">> = [
  { id: 1, name: "Bulbasaur", types: ["grass", "poison"], baseStats: { hp: 45, attack: 49, defense: 49, speed: 45 }, movePool: ["Vine Whip", "Tackle", "Sludge Bomb", "Ice Beam"] },
  { id: 4, name: "Charmander", types: ["fire"], baseStats: { hp: 39, attack: 52, defense: 43, speed: 65 }, movePool: ["Ember", "Flamethrower", "Tackle", "Dragon Claw"] },
  { id: 7, name: "Squirtle", types: ["water"], baseStats: { hp: 44, attack: 48, defense: 65, speed: 43 }, movePool: ["Water Gun", "Surf", "Tackle", "Ice Beam"] },
  { id: 25, name: "Pikachu", types: ["electric"], baseStats: { hp: 35, attack: 55, defense: 40, speed: 90 }, movePool: ["Thunder Shock", "Thunderbolt", "Tackle", "Surf"] },
  { id: 143, name: "Snorlax", types: ["normal"], baseStats: { hp: 160, attack: 110, defense: 65, speed: 30 }, movePool: ["Tackle", "Earthquake", "Ice Beam", "Shadow Ball"] },
  { id: 150, name: "Mewtwo", types: ["psychic"], baseStats: { hp: 106, attack: 110, defense: 90, speed: 130 }, movePool: ["Psychic", "Shadow Ball", "Ice Beam", "Flamethrower"] },
  { id: 94, name: "Gengar", types: ["ghost", "poison"], baseStats: { hp: 60, attack: 65, defense: 60, speed: 110 }, movePool: ["Shadow Ball", "Sludge Bomb", "Psychic", "Thunderbolt"] },
  { id: 149, name: "Dragonite", types: ["dragon", "flying"], baseStats: { hp: 91, attack: 134, defense: 95, speed: 80 }, movePool: ["Dragon Claw", "Flamethrower", "Ice Beam", "Earthquake"] },
  { id: 448, name: "Lucario", types: ["fighting", "steel"], baseStats: { hp: 70, attack: 110, defense: 70, speed: 90 }, movePool: ["Close Combat", "Earthquake", "Shadow Ball", "Ice Beam"] },
  { id: 445, name: "Garchomp", types: ["dragon", "ground"], baseStats: { hp: 108, attack: 130, defense: 95, speed: 102 }, movePool: ["Dragon Claw", "Earthquake", "Flamethrower", "Shadow Ball"] },
];

const MOVES_DB: Move[] = [
  { name: "Tackle", type: "normal", power: 40, accuracy: 100, category: "physical" },
  { name: "Ember", type: "fire", power: 40, accuracy: 100, category: "special" },
  { name: "Water Gun", type: "water", power: 40, accuracy: 100, category: "special" },
  { name: "Thunder Shock", type: "electric", power: 40, accuracy: 100, category: "special" },
  { name: "Vine Whip", type: "grass", power: 45, accuracy: 100, category: "physical" },
  { name: "Ice Beam", type: "ice", power: 90, accuracy: 100, category: "special" },
  { name: "Earthquake", type: "ground", power: 100, accuracy: 90, category: "physical" },
  { name: "Psychic", type: "psychic", power: 90, accuracy: 100, category: "special" },
  { name: "Shadow Ball", type: "ghost", power: 80, accuracy: 100, category: "special" },
  { name: "Dragon Claw", type: "dragon", power: 80, accuracy: 100, category: "physical" },
  { name: "Flamethrower", type: "fire", power: 90, accuracy: 100, category: "special" },
  { name: "Surf", type: "water", power: 90, accuracy: 100, category: "special" },
  { name: "Thunderbolt", type: "electric", power: 90, accuracy: 100, category: "special" },
  { name: "Sludge Bomb", type: "poison", power: 90, accuracy: 100, category: "special" },
  { name: "Close Combat", type: "fighting", power: 120, accuracy: 85, category: "physical" },
];

// ═══════════════════════════════════════════════════════════════════════════
// Battle Utilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate a Pokemon's battle stat from its base stat and level.
 * Uses a simplified formula: floor((2 * base * level) / 100 + offset).
 * HP offset = level + 10; other stats offset = 5.
 */
function calcStat(
  base: number,
  level: number,
  isHP: boolean = false
): number {
  if (isHP) {
    return Math.floor((2 * base * level) / 100 + level + 10);
  }
  return Math.floor((2 * base * level) / 100 + 5);
}

/**
 * Instantiate a battle-ready Pokemon from a species template.
 * Calculates level-scaled stats and assigns `moveCount` moves
 * randomly drawn from the species' movePool.
 */
function createBattlePokemon(
  species: Omit<Pokemon, "stats" | "moves" | "status">,
  level: number,
  moveCount: number
): BattlePokemon {
  const stats: PokemonStats = {
    level,
    hp:    calcStat(species.baseStats.hp, level, true),
    attack: calcStat(species.baseStats.attack, level),
    defense: calcStat(species.baseStats.defense, level),
    speed:  calcStat(species.baseStats.speed, level),
    currentHp: 0, // set below
  };
  stats.currentHp = stats.hp;

  // Draw moves from the species' movePool
  const available = MOVES_DB.filter(m => species.movePool.includes(m.name));
  const shuffled = [...available].sort(() => Math.random() - 0.5);
  const moves = shuffled.slice(0, Math.min(moveCount, shuffled.length));

  return {
    ...species,
    stats,
    moves,
    status: null,
  };
}

/**
 * Calculate damage dealt by one Pokemon to another using a specific move.
 *
 * Formula: ((2L+10)/250 × Atk/Def × Power + 2) × STAB × TypeEffectiveness × Random
 *   - STAB = 1.5 if attacker shares a type with the move
 *   - TypeEffectiveness = product of chart lookups for each defender type
 *   - Random = uniform [0.85, 1.0]
 *
 * Returns floored integer damage (minimum 0 after effectiveness).
 */
function calculateDamage(
  attacker: BattlePokemon,
  defender: BattlePokemon,
  move: Move
): number {
  const level = attacker.stats.level;
  const attackStat = attacker.stats.attack;
  const defenseStat = defender.stats.defense;

  // Type effectiveness multiplier (capped at 2x to prevent OHKOs)
  let effectiveness = 1;
  for (const defType of defender.types) {
    const chart = TYPE_EFFECTIVENESS[move.type] as Record<PokemonType, number> | undefined;
    if (chart && chart[defType] !== undefined) {
      effectiveness *= chart[defType];
    }
  }
  effectiveness = Math.min(effectiveness, 2); // Cap at 2x max

  // STAB bonus
  const stab = attacker.types.includes(move.type) ? 1.5 : 1;

  // Random factor between 0.85 and 1.0
  const randomFactor = (Math.random() * 0.15) + 0.85;

  const baseDamage =
    (((2 * level + 10) / 250) * (attackStat / defenseStat) * move.power) + 2;

  // Halve damage to make battles last longer
  return Math.floor((baseDamage * stab * effectiveness * randomFactor) / 2);
}

// ═══════════════════════════════════════════════════════════════════════════
// MCP Server & Tool Handlers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * MCP tool definitions exposed to clients via tools/list.
 * Each tool has a name, description, and JSON Schema for its input.
 * The actual implementations live in the CallToolRequestSchema handler
 * inside createServer().
 */
const TOOLS: Tool[] = [
  {
    name: "get_random_pokemon",
    description: "Generate a random Pokémon with stats, moves, and types",
    inputSchema: {
      type: "object",
      properties: {
        level: { type: "number", minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: "get_pokemon_by_name",
    description: "Get a specific Pokémon by name with customizable level",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        level: { type: "number", minimum: 1, maximum: 100 },
      },
      required: ["name"],
    },
  },
  {
    name: "list_all_pokemon",
    description: "List all available Pokémon in the database",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "start_battle",
    description: "Start a new Pokemon battle. Only one battle can be active at a time — starting a new one replaces any existing battle. Each Pokemon gets 4 moves drawn from their move pool. The faster Pokemon acts first.",
    inputSchema: {
      type: "object",
      properties: {
        pokemon1_name: { type: "string" },
        pokemon1_level: { type: "number", minimum: 1, maximum: 100 },
        pokemon2_name: { type: "string" },
        pokemon2_level: { type: "number", minimum: 1, maximum: 100 },
      },
      required: ["pokemon1_name", "pokemon2_name"],
    },
  },
  {
    name: "attack",
    description: "Execute an attack in the current battle. The attacker must be the Pokemon whose turn it is (determined by speed on turn 1, then alternating). Returns damage dealt, effectiveness, and updated HP for both Pokemon. If the defender faints, the battle ends.",
    inputSchema: {
      type: "object",
      properties: {
        attacker_name: { type: "string" },
        move_name:     { type: "string" },
      },
      required: ["attacker_name", "move_name"],
    },
  },
  {
    name: "get_battle_status",
    description: "Get the current status of the active battle",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_type_effectiveness",
    description: "Get type effectiveness information",
    inputSchema: {
      type: "object",
      properties: {
        attacking_type: { type: "string", enum: Object.keys(TYPE_EFFECTIVENESS) },
        defending_type: { type: "string", enum: Object.keys(TYPE_EFFECTIVENESS) },
      },
      required: ["attacking_type"],
    },
  },
];

/**
 * Factory: creates a fully configured MCP Server with all tool handlers.
 *
 * Why a factory? A single MCP Server can only bind to one transport at a time.
 * We need separate instances for:
 *   - The stdio transport (one long-lived instance)
 *   - Each HTTP session (one instance per connecting client)
 *
 * All instances share the same module-level `currentBattle` state, so a battle
 * started over stdio is visible to HTTP clients and vice versa.
 */
export function createServer(): Server {
  const server = new Server({
    name: "pokemon-server",
    version: "1.0.0",
  }, {
    capabilities: { tools: {} },
  });

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // Handle tool invocations — dispatches by tool name to the appropriate handler
  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    // Pick a random species, scale to given (or random) level, assign random moves
    case "get_random_pokemon": {
      const levelArg = typeof args?.level === "number" ? args.level : undefined;
      const species = POKEMON_DB[Math.floor(Math.random() * POKEMON_DB.length)];
      const level   = levelArg ?? Math.floor(Math.random() * 50) + 20;
      const pokemon = createBattlePokemon(species, level, Math.floor(Math.random() * 3) + 2);

      return {
        content: [{
          type: "text",
          text: [
            `Generated ${pokemon.name} (Lv. ${pokemon.stats.level})!`,
            `Types: ${pokemon.types.join(", ")}`,
            `HP: ${pokemon.stats.currentHp}/${pokemon.stats.hp}`,
            `ATK:${pokemon.stats.attack} DEF:${pokemon.stats.defense} SPD:${pokemon.stats.speed}`,
            `Moves: ${pokemon.moves.map(m => `${m.name} (${m.type})`).join(", ")}`,
          ].join("\n")
        }],
      };
    }

    // Look up a specific species by name (case-insensitive), scale to level
    case "get_pokemon_by_name": {
      if (!args || typeof args.name !== "string") {
        throw new Error("`name` must be provided and be a string");
      }
      const species = POKEMON_DB.find(
        p => p.name.toLowerCase() === (args.name as string).toLowerCase()
      );
      if (!species) {
        throw new Error(`Pokémon "${args.name}" not found`);
      }
      const level = typeof args.level === "number"
        ? args.level
        : Math.floor(Math.random() * 50) + 20;

      const pokemon = createBattlePokemon(species, level, Math.floor(Math.random() * 3) + 2);

      return {
        content: [{
          type: "text",
          text: [
            `Found ${pokemon.name} (Lv. ${pokemon.stats.level})!`,
            `Types: ${pokemon.types.join(", ")}`,
            `HP: ${pokemon.stats.currentHp}/${pokemon.stats.hp}`,
            `ATK:${pokemon.stats.attack} DEF:${pokemon.stats.defense} SPD:${pokemon.stats.speed}`,
            `Moves: ${pokemon.moves.map(m => `${m.name} (${m.type})`).join(", ")}`,
          ].join("\n")
        }],
      };
    }

    // Return a summary of every species in POKEMON_DB
    case "list_all_pokemon": {
      const lines = POKEMON_DB.map(p =>
        `${p.name} [${p.types.join("/")}] — HP${p.baseStats.hp} ATK${p.baseStats.attack} DEF${p.baseStats.defense} SPD${p.baseStats.speed}`
      );
      return {
        content: [{ type: "text", text: "Available Pokémon:\n" + lines.join("\n") }],
      };
    }

    // Initialize a new battle between two named Pokemon (replaces any active battle)
    case "start_battle": {
      const { pokemon1_name, pokemon1_level, pokemon2_name, pokemon2_level } = args ?? {};
      if (typeof pokemon1_name !== "string" || typeof pokemon2_name !== "string") {
        throw new Error("Both `pokemon1_name` and `pokemon2_name` are required");
      }
      const base1 = POKEMON_DB.find(p => p.name.toLowerCase() === pokemon1_name.toLowerCase());
      const base2 = POKEMON_DB.find(p => p.name.toLowerCase() === pokemon2_name.toLowerCase());
      if (!base1 || !base2) {
        throw new Error("One or both Pokémon not found");
      }

      const battler1 = createBattlePokemon(
        base1,
        typeof pokemon1_level === "number" ? pokemon1_level : Math.floor(Math.random() * 50) + 20,
        4
      );
      const battler2 = createBattlePokemon(
        base2,
        typeof pokemon2_level === "number" ? pokemon2_level : Math.floor(Math.random() * 50) + 20,
        4
      );

      currentBattle = {
        active: true,
        pokemon1: battler1,
        pokemon2: battler2,
        turn: 1,
        // On speed tie, pokemon1 (the challenger) goes first
        currentTurn: battler1.stats.speed >= battler2.stats.speed ? "pokemon1" : "pokemon2",
      };

      const first = battler1.stats.speed >= battler2.stats.speed ? battler1.name : battler2.name;
      return {
        content: [{
          type: "text",
          text: [
            `Battle Started!`,
            `${battler1.name} (Lv. ${battler1.stats.level}) vs ${battler2.name} (Lv. ${battler2.stats.level})`,
            `${battler1.name}: HP ${battler1.stats.currentHp}/${battler1.stats.hp} | Moves: ${battler1.moves.map(m => m.name).join(", ")}`,
            `${battler2.name}: HP ${battler2.stats.currentHp}/${battler2.stats.hp} | Moves: ${battler2.moves.map(m => m.name).join(", ")}`,
            `${first} will go first!`,
          ].join("\n\n")
        }],
      };
    }

    // Execute one attack: validate turn order, check accuracy, calculate damage, update HP
    case "attack": {
      if (!currentBattle?.active) {
        throw new Error("No active battle. Use `start_battle` first.");
      }
      const { attacker_name, move_name } = args ?? {};
      if (typeof attacker_name !== "string" || typeof move_name !== "string") {
        throw new Error("Both `attacker_name` and `move_name` are required");
      }

      const attacker = [currentBattle.pokemon1, currentBattle.pokemon2]
        .find(p => p.name.toLowerCase() === attacker_name.toLowerCase());
      if (!attacker) {
        throw new Error(`"${attacker_name}" is not in the current battle`);
      }
      const defender = attacker === currentBattle.pokemon1
        ? currentBattle.pokemon2
        : currentBattle.pokemon1;

      // Enforce turn order
      const expectedAttacker = currentBattle[currentBattle.currentTurn];
      if (attacker !== expectedAttacker) {
        throw new Error(`It's ${expectedAttacker.name}'s turn, not ${attacker.name}'s.`);
      }

      const move = attacker.moves.find(m => m.name.toLowerCase() === move_name.toLowerCase());
      if (!move) {
        throw new Error(`${attacker.name} doesn't know "${move_name}"`);
      }

      // Check accuracy
      const accuracyRoll = Math.random() * 100;
      if (accuracyRoll >= move.accuracy) {
        // Attack missed
        currentBattle.turn++;
        currentBattle.currentTurn = currentBattle.currentTurn === "pokemon1" ? "pokemon2" : "pokemon1";
        return {
          content: [{
            type: "text",
            text: `Turn ${currentBattle.turn - 1}: ${attacker.name} used ${move.name}... but it missed!`
          }]
        };
      }

      // Calculate type effectiveness multiplier
      // multi > 1 → super effective; multi < 1 → not very effective; multi === 0 → immune
      let effectiveness = 1;
      for (const t of defender.types) {
        const chart = TYPE_EFFECTIVENESS[move.type] as Record<PokemonType, number> | undefined;
        effectiveness *= chart?.[t] ?? 1;
      }

      // Check if STAB applies
      const hasStab = attacker.types.includes(move.type);

      // Calculate damage
      const damage = calculateDamage(attacker, defender, move);
      defender.stats.currentHp = Math.max(0, defender.stats.currentHp - damage);

      // Build detailed combat breakdown
      let text = `Turn ${currentBattle.turn}: ${attacker.name} used ${move.name}!\n\n`;

      // Combat details
      text += `Combat Details:\n`;
      text += `- Move Type: ${move.type.charAt(0).toUpperCase() + move.type.slice(1)} (${move.power} power, ${move.accuracy}% accuracy)\n`;
      text += `- Category: ${move.category.charAt(0).toUpperCase() + move.category.slice(1)}\n`;
      text += `- Defender Types: ${defender.types.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(", ")}\n`;
      text += `- Type Effectiveness: ${effectiveness}x`;
      if (effectiveness > 1) text += " (Super effective!)";
      else if (effectiveness === 0) text += " (No effect!)";
      else if (effectiveness < 1) text += " (Not very effective...)";
      text += `\n`;
      text += `- STAB Bonus: ${hasStab ? "Yes (1.5x)" : "No"}\n`;
      text += `- Damage Dealt: ${damage}\n\n`;

      text += `${defender.name} took ${damage} damage.\n\n`;
      text += `${currentBattle.pokemon1.name}: ${currentBattle.pokemon1.stats.currentHp}/${currentBattle.pokemon1.stats.hp} HP\n`;
      text += `${currentBattle.pokemon2.name}: ${currentBattle.pokemon2.stats.currentHp}/${currentBattle.pokemon2.stats.hp} HP\n`;

      if (defender.stats.currentHp === 0) {
        text += `\n${defender.name} fainted! ${attacker.name} wins!`;
        currentBattle.active = false;
      } else {
        currentBattle.turn++;
        // Flip turn
        currentBattle.currentTurn = currentBattle.currentTurn === "pokemon1" ? "pokemon2" : "pokemon1";
      }

      return { content: [{ type: "text", text }] };
    }

    // Return current HP and turn info for the active battle
    case "get_battle_status": {
      if (!currentBattle) {
        return { content: [{ type: "text", text: "No active battle." }] };
      }
      const { pokemon1, pokemon2, turn, active } = currentBattle;
      const header = active ? "Battle Active" : "Battle Over";
      const lines = [
        `${header} — Turn ${turn}`,
        `${pokemon1.name}: ${pokemon1.stats.currentHp}/${pokemon1.stats.hp} HP`,
        `${pokemon2.name}: ${pokemon2.stats.currentHp}/${pokemon2.stats.hp} HP`,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    // Query the type chart: one matchup (atk vs def) or full chart for an attacking type
    case "get_type_effectiveness": {
      if (typeof args?.attacking_type !== "string") {
        throw new Error("`attacking_type` is required");
      }
      const atk = args.attacking_type.toLowerCase() as PokemonType;
      if (!TYPE_EFFECTIVENESS[atk]) {
        throw new Error(`Unknown type "${atk}"`);
      }

      if (typeof args.defending_type === "string") {
        const def = args.defending_type.toLowerCase() as PokemonType;
        const chart = TYPE_EFFECTIVENESS[atk] as Record<PokemonType, number> | undefined;
        const mult = chart?.[def] ?? 1;
        const msg = mult > 1
          ? "Super effective!"
          : mult === 0
          ? "No effect!"
          : mult < 1
          ? "Not very effective..."
          : "";
        return {
          content: [{
            type: "text",
            text: `${atk} → ${def}: ${mult}× damage. ${msg}`
          }],
        };
      }

      // Show full chart for that attacking type
      const chart = TYPE_EFFECTIVENESS[atk];
      const supers = Object.entries(chart).filter(([, m]) => m! > 1).map(([t]) => t);
      const nots   = Object.entries(chart).filter(([, m]) => m! < 1 && m! > 0).map(([t]) => t);
      const zeros  = Object.entries(chart).filter(([, m]) => m === 0).map(([t]) => t);

      const parts: string[] = [`Effectiveness for ${atk}:`];
      if (supers.length) parts.push(`• Super (×2): ${supers.join(", ")}`);
      if (nots.length)   parts.push(`• Not very (×0.5): ${nots.join(", ")}`);
      if (zeros.length)  parts.push(`• No effect (×0): ${zeros.join(", ")}`);

      return {
        content: [{ type: "text", text: parts.join("\n") }],
      };
    }

    default:
      throw new Error(`Tool "${name}" not recognized`);
  }
  });

  return server;
}

// ═══════════════════════════════════════════════════════════════════════════
// Server Bootstrap
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Start both transports simultaneously:
 *
 *  1. **Stdio** — for local MCP clients like Claude Desktop that launch this
 *     process and communicate over stdin/stdout. Single long-lived Server.
 *
 *  2. **Streamable HTTP** — for remote/web MCP clients that connect over the
 *     network. Each client session gets its own Server + Transport pair.
 *     The MCP Streamable HTTP protocol uses a single `/mcp` endpoint with
 *     three HTTP methods:
 *       - POST: client → server JSON-RPC messages
 *       - GET:  server → client SSE notification stream
 *       - DELETE: session termination
 *     Sessions are identified by the `Mcp-Session-Id` header.
 */
async function main() {
  // ── Stdio Transport ────────────────────────────────────────────────────
  // Used by Claude Desktop and other local MCP clients that spawn this process.
  const stdioServer = createServer();
  const stdioTransport = new StdioServerTransport();
  await stdioServer.connect(stdioTransport);

  // ── Streamable HTTP Transport (optional) ─────────────────────────────
  // Exposes the same MCP tools over HTTP for remote clients.
  // Disabled when MCP_HTTP=0 or MCP_HTTP=false; enabled otherwise.
  const httpEnabled = !["0", "false"].includes(
    (process.env.MCP_HTTP ?? "").toLowerCase(),
  );

  if (httpEnabled) {
    const app = express();
    const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

    // Active HTTP sessions keyed by session ID (assigned on initialize)
    const httpTransports = new Map<string, StreamableHTTPServerTransport>();

    app.use(cors());
    app.use(express.json());

    // Health-check / discovery endpoint
    app.get("/", (_req: Request, res: Response) => {
      res.json({
        status: "Pokemon MCP Server is running!",
        version: "1.0.0",
        endpoints: {
          health: "GET /",
          mcp: "POST,GET,DELETE /mcp",
        },
      });
    });

    // POST /mcp — handles all client-to-server JSON-RPC messages.
    // On the first request (an "initialize" message with no session ID), a new
    // session is created. Subsequent requests must include the Mcp-Session-Id header.
    app.post("/mcp", async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId && httpTransports.has(sessionId)) {
        // Route to existing session
        await httpTransports.get(sessionId)!.handleRequest(req, res, req.body);
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // First contact — create a new session with its own Server + Transport
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            httpTransports.set(id, transport);
          },
          onsessionclosed: (id) => {
            httpTransports.delete(id);
          },
        });
        const httpServer = createServer();
        await httpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } else {
        res.status(400).json({ error: "Invalid or missing session ID" });
      }
    });

    // GET /mcp — opens an SSE stream for server-initiated notifications.
    // DELETE /mcp — tears down the session and cleans up resources.
    // Both require a valid Mcp-Session-Id header.
    const handleSessionRequest = async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !httpTransports.has(sessionId)) {
        res.status(400).json({ error: "Invalid or missing session ID" });
        return;
      }
      await httpTransports.get(sessionId)!.handleRequest(req, res);
    };

    app.get("/mcp", handleSessionRequest);
    app.delete("/mcp", handleSessionRequest);

    const httpListener = app.listen(PORT, "0.0.0.0", () => {
      console.error(`Pokemon MCP Server HTTP endpoint: http://0.0.0.0:${PORT}/mcp`);
    });
    httpListener.on("error", (err: NodeJS.ErrnoException) => {
      console.error(
        `HTTP transport failed to start (${err.code ?? err.message}), continuing with stdio only.`,
      );
    });
  }
}

// Only auto-start when run directly (not when imported by tests)
const isDirectRun =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""));
if (isDirectRun) {
  main().catch(err => {
    console.error("Server error:", err);
    process.exit(1);
  });
}
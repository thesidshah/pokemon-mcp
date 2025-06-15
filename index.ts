#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Pokemon type effectiveness chart
const TYPE_EFFECTIVENESS: Record<string, Record<string, number>> = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
  poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
  ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
  rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon: { dragon: 2, steel: 0.5, fairy: 0 },
  dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
  fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 }
};

// Pokemon database
const POKEMON_DB = [
  { id: 1, name: "Bulbasaur", types: ["grass", "poison"], baseStats: { hp: 45, attack: 49, defense: 49, speed: 45 } },
  { id: 4, name: "Charmander", types: ["fire"], baseStats: { hp: 39, attack: 52, defense: 43, speed: 65 } },
  { id: 7, name: "Squirtle", types: ["water"], baseStats: { hp: 44, attack: 48, defense: 65, speed: 43 } },
  { id: 25, name: "Pikachu", types: ["electric"], baseStats: { hp: 35, attack: 55, defense: 40, speed: 90 } },
  { id: 143, name: "Snorlax", types: ["normal"], baseStats: { hp: 160, attack: 110, defense: 65, speed: 30 } },
  { id: 150, name: "Mewtwo", types: ["psychic"], baseStats: { hp: 106, attack: 110, defense: 90, speed: 130 } },
  { id: 94, name: "Gengar", types: ["ghost", "poison"], baseStats: { hp: 60, attack: 65, defense: 60, speed: 110 } },
  { id: 149, name: "Dragonite", types: ["dragon", "flying"], baseStats: { hp: 91, attack: 134, defense: 95, speed: 80 } },
  { id: 448, name: "Lucario", types: ["fighting", "steel"], baseStats: { hp: 70, attack: 110, defense: 70, speed: 90 } },
  { id: 445, name: "Garchomp", types: ["dragon", "ground"], baseStats: { hp: 108, attack: 130, defense: 95, speed: 102 } }
];

// Move database
const MOVES_DB = [
  { name: "Tackle", type: "normal", power: 40, accuracy: 100, category: "physical" },
  { name: "Ember", type: "fire", power: 40, accuracy: 100, category: "special" },
  { name: "Water Gun", type: "water", power: 40, accuracy: 100, category: "special" },
  { name: "Thunder Shock", type: "electric", power: 40, accuracy: 100, category: "special" },
  { name: "Vine Whip", type: "grass", power: 45, accuracy: 100, category: "physical" },
  { name: "Ice Beam", type: "ice", power: 90, accuracy: 100, category: "special" },
  { name: "Earthquake", type: "ground", power: 100, accuracy: 100, category: "physical" },
  { name: "Psychic", type: "psychic", power: 90, accuracy: 100, category: "special" },
  { name: "Shadow Ball", type: "ghost", power: 80, accuracy: 100, category: "special" },
  { name: "Dragon Claw", type: "dragon", power: 80, accuracy: 100, category: "physical" },
  { name: "Flamethrower", type: "fire", power: 90, accuracy: 100, category: "special" },
  { name: "Surf", type: "water", power: 90, accuracy: 100, category: "special" },
  { name: "Thunderbolt", type: "electric", power: 90, accuracy: 100, category: "special" }
];

// Battle state management
interface BattleState {
  active: boolean;
  pokemon1: any;
  pokemon2: any;
  turn: number;
}

let currentBattle: BattleState | null = null;

// Helper functions
function getRandomPokemon() {
  const pokemon = POKEMON_DB[Math.floor(Math.random() * POKEMON_DB.length)];
  const level = Math.floor(Math.random() * 50) + 20; // Level 20-70
  
  // Calculate stats based on level
  const stats = {
    level,
    hp: Math.floor((2 * pokemon.baseStats.hp * level) / 100 + level + 10),
    attack: Math.floor((2 * pokemon.baseStats.attack * level) / 100 + 5),
    defense: Math.floor((2 * pokemon.baseStats.defense * level) / 100 + 5),
    speed: Math.floor((2 * pokemon.baseStats.speed * level) / 100 + 5),
    currentHp: 0, // Will be set to max HP
  };
  stats.currentHp = stats.hp;
  
  // Assign random moves (2-4 moves)
  const moveCount = Math.floor(Math.random() * 3) + 2;
  const moves = [];
  const availableMoves = [...MOVES_DB];
  
  for (let i = 0; i < moveCount && availableMoves.length > 0; i++) {
    const moveIndex = Math.floor(Math.random() * availableMoves.length);
    moves.push(availableMoves[moveIndex]);
    availableMoves.splice(moveIndex, 1);
  }
  
  return {
    ...pokemon,
    stats,
    moves,
    status: null,
  };
}

function calculateDamage(attacker: any, defender: any, move: any): number {
  // Pokemon damage formula
  const level = attacker.stats.level;
  const attackStat = move.category === "physical" ? attacker.stats.attack : attacker.stats.attack;
  const defenseStat = move.category === "physical" ? defender.stats.defense : defender.stats.defense;
  
  // Type effectiveness
  let effectiveness = 1;
  for (const defenderType of defender.types) {
    if (TYPE_EFFECTIVENESS[move.type] && TYPE_EFFECTIVENESS[move.type][defenderType] !== undefined) {
      effectiveness *= TYPE_EFFECTIVENESS[move.type][defenderType];
    }
  }
  
  // STAB (Same Type Attack Bonus)
  const stab = attacker.types.includes(move.type) ? 1.5 : 1;
  
  // Random factor (85-100%)
  const random = (Math.floor(Math.random() * 16) + 85) / 100;
  
  // Calculate damage
  const damage = Math.floor(
    ((((2 * level + 10) / 250) * (attackStat / defenseStat) * move.power + 2) * 
    stab * effectiveness * random)
  );
  
  return damage;
}

// Create server instance
const server = new Server({
  name: "pokemon-server",
  version: "1.0.0",
});

// Define available tools
const TOOLS: Tool[] = [
  {
    name: "get_random_pokemon",
    description: "Generate a random Pokemon with stats, moves, and types",
    inputSchema: {
      type: "object",
      properties: {
        level: {
          type: "number",
          description: "Desired level for the Pokemon (optional, 1-100)",
          minimum: 1,
          maximum: 100,
        },
      },
    },
  },
  {
    name: "get_pokemon_by_name",
    description: "Get a specific Pokemon by name with customizable level",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name of the Pokemon",
        },
        level: {
          type: "number",
          description: "Desired level for the Pokemon (optional, 1-100)",
          minimum: 1,
          maximum: 100,
        },
      },
      required: ["name"],
    },
  },
  {
    name: "list_all_pokemon",
    description: "List all available Pokemon in the database",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "start_battle",
    description: "Start a Pokemon battle between two Pokemon",
    inputSchema: {
      type: "object",
      properties: {
        pokemon1_name: {
          type: "string",
          description: "Name of the first Pokemon",
        },
        pokemon1_level: {
          type: "number",
          description: "Level of the first Pokemon (optional)",
          minimum: 1,
          maximum: 100,
        },
        pokemon2_name: {
          type: "string",
          description: "Name of the second Pokemon",
        },
        pokemon2_level: {
          type: "number",
          description: "Level of the second Pokemon (optional)",
          minimum: 1,
          maximum: 100,
        },
      },
      required: ["pokemon1_name", "pokemon2_name"],
    },
  },
  {
    name: "attack",
    description: "Perform an attack in the current battle",
    inputSchema: {
      type: "object",
      properties: {
        attacker_name: {
          type: "string",
          description: "Name of the attacking Pokemon",
        },
        move_name: {
          type: "string",
          description: "Name of the move to use",
        },
      },
      required: ["attacker_name", "move_name"],
    },
  },
  {
    name: "get_battle_status",
    description: "Get the current status of the active battle",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_type_effectiveness",
    description: "Get type effectiveness information",
    inputSchema: {
      type: "object",
      properties: {
        attacking_type: {
          type: "string",
          description: "The attacking type",
          enum: Object.keys(TYPE_EFFECTIVENESS),
        },
        defending_type: {
          type: "string",
          description: "The defending type (optional)",
          enum: Object.keys(TYPE_EFFECTIVENESS),
        },
      },
      required: ["attacking_type"],
    },
  },
];

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "get_random_pokemon": {
      const pokemon = getRandomPokemon();
      if (args?.level) {
        pokemon.stats.level = args.level;
        // Recalculate stats for new level
        const basePokemon = POKEMON_DB.find(p => p.id === pokemon.id)!;
        pokemon.stats.hp = Math.floor((2 * basePokemon.baseStats.hp * args.level) / 100 + args.level + 10);
        pokemon.stats.attack = Math.floor((2 * basePokemon.baseStats.attack * args.level) / 100 + 5);
        pokemon.stats.defense = Math.floor((2 * basePokemon.baseStats.defense * args.level) / 100 + 5);
        pokemon.stats.speed = Math.floor((2 * basePokemon.baseStats.speed * args.level) / 100 + 5);
        pokemon.stats.currentHp = pokemon.stats.hp;
      }
      
      return {
        content: [{
          type: "text",
          text: `Generated ${pokemon.name} (Level ${pokemon.stats.level})!\n` +
                `Types: ${pokemon.types.join(", ")}\n` +
                `HP: ${pokemon.stats.currentHp}/${pokemon.stats.hp}\n` +
                `Attack: ${pokemon.stats.attack}, Defense: ${pokemon.stats.defense}, Speed: ${pokemon.stats.speed}\n` +
                `Moves: ${pokemon.moves.map((m: any) => `${m.name} (${m.type})`).join(", ")}`
        }],
      };
    }

    case "get_pokemon_by_name": {
      if (!args?.name) {
        throw new Error("Pokemon name is required");
      }
      
      const basePokemon = POKEMON_DB.find(p => 
        p.name.toLowerCase() === args.name.toLowerCase()
      );
      
      if (!basePokemon) {
        throw new Error(`Pokemon "${args.name}" not found in database`);
      }
      
      const level = args.level || Math.floor(Math.random() * 50) + 20;
      const pokemon = {
        ...basePokemon,
        stats: {
          level,
          hp: Math.floor((2 * basePokemon.baseStats.hp * level) / 100 + level + 10),
          attack: Math.floor((2 * basePokemon.baseStats.attack * level) / 100 + 5),
          defense: Math.floor((2 * basePokemon.baseStats.defense * level) / 100 + 5),
          speed: Math.floor((2 * basePokemon.baseStats.speed * level) / 100 + 5),
          currentHp: 0,
        },
        moves: [],
        status: null,
      };
      pokemon.stats.currentHp = pokemon.stats.hp;
      
      // Assign moves
      const moveCount = Math.floor(Math.random() * 3) + 2;
      const availableMoves = [...MOVES_DB];
      for (let i = 0; i < moveCount && availableMoves.length > 0; i++) {
        const moveIndex = Math.floor(Math.random() * availableMoves.length);
        pokemon.moves.push(availableMoves[moveIndex]);
        availableMoves.splice(moveIndex, 1);
      }
      
      return {
        content: [{
          type: "text",
          text: `Found ${pokemon.name} (Level ${pokemon.stats.level})!\n` +
                `Types: ${pokemon.types.join(", ")}\n` +
                `HP: ${pokemon.stats.currentHp}/${pokemon.stats.hp}\n` +
                `Attack: ${pokemon.stats.attack}, Defense: ${pokemon.stats.defense}, Speed: ${pokemon.stats.speed}\n` +
                `Moves: ${pokemon.moves.map((m: any) => `${m.name} (${m.type})`).join(", ")}`
        }],
      };
    }

    case "list_all_pokemon": {
      const pokemonList = POKEMON_DB.map(p => 
        `${p.name} (${p.types.join("/")}) - Base Stats: HP:${p.baseStats.hp} ATK:${p.baseStats.attack} DEF:${p.baseStats.defense} SPD:${p.baseStats.speed}`
      ).join("\n");
      
      return {
        content: [{
          type: "text",
          text: `Available Pokemon:\n${pokemonList}`
        }],
      };
    }

    case "start_battle": {
      if (!args?.pokemon1_name || !args?.pokemon2_name) {
        throw new Error("Both Pokemon names are required");
      }
      
      const poke1Base = POKEMON_DB.find(p => 
        p.name.toLowerCase() === args.pokemon1_name.toLowerCase()
      );
      const poke2Base = POKEMON_DB.find(p => 
        p.name.toLowerCase() === args.pokemon2_name.toLowerCase()
      );
      
      if (!poke1Base || !poke2Base) {
        throw new Error("One or both Pokemon not found");
      }
      
      // Create battle Pokemon
      const level1 = args.pokemon1_level || Math.floor(Math.random() * 50) + 20;
      const level2 = args.pokemon2_level || Math.floor(Math.random() * 50) + 20;
      
      const pokemon1 = {
        ...poke1Base,
        stats: {
          level: level1,
          hp: Math.floor((2 * poke1Base.baseStats.hp * level1) / 100 + level1 + 10),
          attack: Math.floor((2 * poke1Base.baseStats.attack * level1) / 100 + 5),
          defense: Math.floor((2 * poke1Base.baseStats.defense * level1) / 100 + 5),
          speed: Math.floor((2 * poke1Base.baseStats.speed * level1) / 100 + 5),
          currentHp: 0,
        },
        moves: [],
        status: null,
      };
      pokemon1.stats.currentHp = pokemon1.stats.hp;
      
      const pokemon2 = {
        ...poke2Base,
        stats: {
          level: level2,
          hp: Math.floor((2 * poke2Base.baseStats.hp * level2) / 100 + level2 + 10),
          attack: Math.floor((2 * poke2Base.baseStats.attack * level2) / 100 + 5),
          defense: Math.floor((2 * poke2Base.baseStats.defense * level2) / 100 + 5),
          speed: Math.floor((2 * poke2Base.baseStats.speed * level2) / 100 + 5),
          currentHp: 0,
        },
        moves: [],
        status: null,
      };
      pokemon2.stats.currentHp = pokemon2.stats.hp;
      
      // Assign moves
      const availableMoves1 = [...MOVES_DB];
      const availableMoves2 = [...MOVES_DB];
      
      for (let i = 0; i < 4 && availableMoves1.length > 0; i++) {
        const moveIndex = Math.floor(Math.random() * availableMoves1.length);
        pokemon1.moves.push(availableMoves1[moveIndex]);
        availableMoves1.splice(moveIndex, 1);
      }
      
      for (let i = 0; i < 4 && availableMoves2.length > 0; i++) {
        const moveIndex = Math.floor(Math.random() * availableMoves2.length);
        pokemon2.moves.push(availableMoves2[moveIndex]);
        availableMoves2.splice(moveIndex, 1);
      }
      
      currentBattle = {
        active: true,
        pokemon1,
        pokemon2,
        turn: 1,
      };
      
      return {
        content: [{
          type: "text",
          text: `Battle Started!\n\n` +
                `${pokemon1.name} (Lv.${pokemon1.stats.level}) vs ${pokemon2.name} (Lv.${pokemon2.stats.level})\n\n` +
                `${pokemon1.name}: HP ${pokemon1.stats.currentHp}/${pokemon1.stats.hp}\n` +
                `Moves: ${pokemon1.moves.map((m: any) => m.name).join(", ")}\n\n` +
                `${pokemon2.name}: HP ${pokemon2.stats.currentHp}/${pokemon2.stats.hp}\n` +
                `Moves: ${pokemon2.moves.map((m: any) => m.name).join(", ")}\n\n` +
                `${pokemon1.stats.speed >= pokemon2.stats.speed ? pokemon1.name : pokemon2.name} will go first!`
        }],
      };
    }

    case "attack": {
      if (!currentBattle || !currentBattle.active) {
        throw new Error("No active battle. Start a battle first!");
      }
      
      if (!args?.attacker_name || !args?.move_name) {
        throw new Error("Attacker name and move name are required");
      }
      
      const attacker = args.attacker_name.toLowerCase() === currentBattle.pokemon1.name.toLowerCase() 
        ? currentBattle.pokemon1 
        : args.attacker_name.toLowerCase() === currentBattle.pokemon2.name.toLowerCase() 
        ? currentBattle.pokemon2 
        : null;
        
      const defender = attacker === currentBattle.pokemon1 
        ? currentBattle.pokemon2 
        : currentBattle.pokemon1;
      
      if (!attacker) {
        throw new Error(`Pokemon "${args.attacker_name}" not found in current battle`);
      }
      
      const move = attacker.moves.find((m: any) => 
        m.name.toLowerCase() === args.move_name.toLowerCase()
      );
      
      if (!move) {
        throw new Error(`${attacker.name} doesn't know the move "${args.move_name}"`);
      }
      
      // Calculate damage
      const damage = calculateDamage(attacker, defender, move);
      defender.stats.currentHp = Math.max(0, defender.stats.currentHp - damage);
      
      // Type effectiveness message
      let effectivenessMsg = "";
      let effectiveness = 1;
      for (const defenderType of defender.types) {
        if (TYPE_EFFECTIVENESS[move.type] && TYPE_EFFECTIVENESS[move.type][defenderType] !== undefined) {
          effectiveness *= TYPE_EFFECTIVENESS[move.type][defenderType];
        }
      }
      
      if (effectiveness > 1) effectivenessMsg = " It's super effective!";
      else if (effectiveness < 1 && effectiveness > 0) effectivenessMsg = " It's not very effective...";
      else if (effectiveness === 0) effectivenessMsg = " It had no effect!";
      
      let battleResult = `Turn ${currentBattle.turn}:\n`;
      battleResult += `${attacker.name} used ${move.name}!${effectivenessMsg}\n`;
      battleResult += `${defender.name} took ${damage} damage!\n\n`;
      battleResult += `${currentBattle.pokemon1.name}: ${currentBattle.pokemon1.stats.currentHp}/${currentBattle.pokemon1.stats.hp} HP\n`;
      battleResult += `${currentBattle.pokemon2.name}: ${currentBattle.pokemon2.stats.currentHp}/${currentBattle.pokemon2.stats.hp} HP\n`;
      
      // Check for winner
      if (defender.stats.currentHp === 0) {
        battleResult += `\n${defender.name} fainted! ${attacker.name} wins!`;
        currentBattle.active = false;
      } else {
        currentBattle.turn++;
      }
      
      return {
        content: [{
          type: "text",
          text: battleResult
        }],
      };
    }

    case "get_battle_status": {
      if (!currentBattle) {
        return {
          content: [{
            type: "text",
            text: "No active battle."
          }],
        };
      }
      
      let status = currentBattle.active ? "Active Battle" : "Battle Ended";
      status += `\nTurn: ${currentBattle.turn}\n\n`;
      status += `${currentBattle.pokemon1.name} (Lv.${currentBattle.pokemon1.stats.level})\n`;
      status += `HP: ${currentBattle.pokemon1.stats.currentHp}/${currentBattle.pokemon1.stats.hp}\n`;
      status += `Status: ${currentBattle.pokemon1.stats.currentHp > 0 ? "Fighting" : "Fainted"}\n\n`;
      status += `${currentBattle.pokemon2.name} (Lv.${currentBattle.pokemon2.stats.level})\n`;
      status += `HP: ${currentBattle.pokemon2.stats.currentHp}/${currentBattle.pokemon2.stats.hp}\n`;
      status += `Status: ${currentBattle.pokemon2.stats.currentHp > 0 ? "Fighting" : "Fainted"}`;
      
      return {
        content: [{
          type: "text",
          text: status
        }],
      };
    }

    case "get_type_effectiveness": {
      if (!args?.attacking_type) {
        throw new Error("Attacking type is required");
      }
      
      const attackType = args.attacking_type.toLowerCase();
      if (!TYPE_EFFECTIVENESS[attackType]) {
        throw new Error(`Invalid type: ${args.attacking_type}`);
      }
      
      if (args.defending_type) {
        const defendType = args.defending_type.toLowerCase();
        const effectiveness = TYPE_EFFECTIVENESS[attackType][defendType] || 1;
        let message = `${attackType} → ${defendType}: ${effectiveness}x damage`;
        
        if (effectiveness > 1) message += " (Super effective!)";
        else if (effectiveness < 1 && effectiveness > 0) message += " (Not very effective)";
        else if (effectiveness === 0) message += " (No effect)";
        
        return {
          content: [{
            type: "text",
            text: message
          }],
        };
      } else {
        // Show all effectiveness for the attacking type
        const effects = TYPE_EFFECTIVENESS[attackType];
        let message = `Type effectiveness for ${attackType} attacks:\n\n`;
        
        const superEffective = [];
        const notVeryEffective = [];
        const noEffect = [];
        
        for (const [type, mult] of Object.entries(effects)) {
          if (mult > 1) superEffective.push(type);
          else if (mult < 1 && mult > 0) notVeryEffective.push(type);
          else if (mult === 0) noEffect.push(type);
        }
        
        if (superEffective.length > 0) {
          message += `Super effective (2x): ${superEffective.join(", ")}\n`;
        }
        if (notVeryEffective.length > 0) {
          message += `Not very effective (0.5x): ${notVeryEffective.join(", ")}\n`;
        }
        if (noEffect.length > 0) {
          message += `No effect (0x): ${noEffect.join(", ")}\n`;
        }
        
        return {
          content: [{
            type: "text",
            text: message
          }],
        };
      }
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Pokemon MCP Server v1.0.0 running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
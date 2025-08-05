# Pokemon MCP Server - Interview Demo

## Overview

This is a Model Context Protocol (MCP) server that simulates a Pokemon battle system. Your task is to integrate this server with Claude or a ChatGPT-compatible client to enable AI-powered Pokemon battles.

The server provides tools for:
- Generating and retrieving Pokemon
- Starting battles between Pokemon
- Executing attacks with type effectiveness
- Checking battle status and type matchups

## Technical Requirements

- Node.js 18+ 
- npm or yarn
- Claude Desktop app OR a ChatGPT-compatible MCP client
- Basic understanding of TypeScript and MCP

## Installation

1. Clone this repository:
```bash
git clone [repository-url]
cd pokemon-mcp-server
```

2. Install dependencies:
```bash
npm install
```

3. Build the TypeScript code:
```bash
npm run build
```

## Server Architecture

The server implements the MCP protocol with the following tools:

### Available Tools

1. **`get_random_pokemon`** - Generate a random Pokemon with stats and moves
   - Optional: `level` (1-100)

2. **`get_pokemon_by_name`** - Retrieve a specific Pokemon
   - Required: `name` (string)
   - Optional: `level` (1-100)

3. **`list_all_pokemon`** - List all available Pokemon in the database

4. **`start_battle`** - Initialize a battle between two Pokemon
   - Required: `pokemon1_name`, `pokemon2_name` (strings)
   - Optional: `pokemon1_level`, `pokemon2_level` (1-100)

5. **`attack`** - Execute an attack in the current battle
   - Required: `attacker_name`, `move_name` (strings)

6. **`get_battle_status`** - Check the current battle state

7. **`get_type_effectiveness`** - Query type effectiveness chart
   - Required: `attacking_type` (string)
   - Optional: `defending_type` (string)

## Interview Task

### Part 1: Basic Integration (30 minutes)

1. Configure the MCP server in your chosen client (Claude Desktop or ChatGPT-compatible)
2. Test basic functionality:
   - List all available Pokemon
   - Generate a random Pokemon
   - Get a specific Pokemon by name

### Part 2: Battle Implementation (45 minutes)

1. Start a battle between two Pokemon
2. Implement a full battle sequence:
   - Check initial battle status
   - Execute attacks from both Pokemon
   - Handle type effectiveness
   - Determine the winner

3. Document any issues or limitations you encounter

### Part 3: Advanced Features (45 minutes)

Choose ONE of the following tasks:

**Option A: Battle Strategy Assistant**
- Create prompts that make the AI analyze type matchups
- Have the AI suggest optimal moves based on type effectiveness
- Implement a "battle advisor" that predicts battle outcomes

**Option B: Pokemon Team Builder**
- Design a system to create balanced teams
- Consider type coverage and stat distributions
- Generate team recommendations based on user preferences

**Option C: Tournament System**
- Implement a bracket-style tournament
- Track wins/losses across multiple battles
- Generate tournament summaries and statistics

## Integration Guide

### For Claude Desktop

1. Locate your Claude Desktop configuration:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the server configuration:
```json
{
  "mcpServers": {
    "pokemon-server": {
      "command": "node",
      "args": ["path/to/built/index.js"],
      "cwd": "path/to/pokemon-mcp-server"
    }
  }
}
```

3. Restart Claude Desktop

### For ChatGPT/Other Clients

Consult your client's documentation for MCP server integration. The server uses stdio transport on standard input/output.

## Evaluation Criteria

Your submission will be evaluated on:

1. **Successful Integration** (25%)
   - Server properly configured and running
   - All tools accessible from the AI client

2. **Feature Implementation** (35%)
   - Core battle mechanics working correctly
   - Proper error handling
   - Creative use of available tools

3. **Code Quality** (20%)
   - Clear, well-documented prompts
   - Logical conversation flow
   - Effective use of AI capabilities

4. **Problem Solving** (20%)
   - How you handle limitations or issues
   - Creative solutions to challenges
   - Understanding of the MCP protocol

## Submission Requirements

Please provide:

1. **Configuration files** - Your client configuration
2. **Conversation logs** - Export of your AI conversations demonstrating functionality
3. **Documentation** - A brief write-up (300-500 words) covering:
   - Integration process and any challenges
   - Your approach to the advanced feature
   - Suggestions for server improvements
   - Any bugs or limitations discovered

4. **Optional bonus**: Any code modifications or extensions to the server

## Tips and Hints

- The server maintains a single battle state - only one battle can be active at a time
- Type effectiveness follows standard Pokemon rules (2x, 0.5x, 0x damage)
- STAB (Same Type Attack Bonus) is implemented (1.5x damage)
- Speed determines turn order
- The AI should handle move selection intelligently based on type matchups

## Troubleshooting

Common issues:

1. **Server not connecting**: Check file paths in configuration
2. **Tools not appearing**: Ensure server is built and path points to compiled JS
3. **Battle state issues**: Remember only one battle can be active
4. **Type effectiveness**: Reference the built-in type chart with `get_type_effectiveness`

## Time Limit

Total time: 2 hours
- Setup and basic integration: 30 minutes
- Battle implementation: 45 minutes
- Advanced feature: 45 minutes

Good luck, and may the best trainer win!

## Appendix: Pokemon Database

Available Pokemon:
- Bulbasaur (Grass/Poison)
- Charmander (Fire)
- Squirtle (Water)
- Pikachu (Electric)
- Snorlax (Normal)
- Mewtwo (Psychic)
- Gengar (Ghost/Poison)
- Dragonite (Dragon/Flying)
- Lucario (Fighting/Steel)
- Garchomp (Dragon/Ground)

Move types available: Normal, Fire, Water, Electric, Grass, Ice, Ground, Psychic, Ghost, Dragon

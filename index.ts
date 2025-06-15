#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Create server instance
const server = new Server(
  {
    name: "pokemon-server",
    version: "0.0.1",
  }
);

// Define available tools
const TOOLS: Tool[] = [
  {
    name: "echo",
    description: "Echo back the input text",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to echo back",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "get_random_pokemon",
    description: "Generate a json with a random pokemon",
    inputSchema: {
      type: "object",

    },
  },
  {
    name: "attack_pokemon",
    description: "Attack a pokemon with a random move",
    inputSchema: {
      type: "object",
      properties: {
        attack: {
          type: "string",
          enum: ["tackle", "growl", "ember", "water-gun"],
          description: "The attack move to perform on the pokemon",
        },
        a: {
          type: "string",
          description: "Name of the pokemon to attack",
        },
        b: {
          type: "string",
          description: "Name of the pokemon to attack with",
        },
      },
      required: ["attack", "a", "b"],
    },
  },
];

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS,
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args) {
    throw new Error("Arguments are required");
  }

  switch (name) {
    case "echo":
      if (typeof args.text !== "string") {
        throw new Error("Text argument is required and must be a string");
      }
      return {
        content: [
          {
            type: "text",
            text: `Echo: ${args.text}`,
          },
        ],
      };

    case "get_random_pokemon":
      // Simulate a random pokemon response
      const randomPokemon = {
        name: "Pikachu",
        type: "Electric",
        level: Math.floor(Math.random() * 100) + 1,
      };
      return {
        content: [
          {
            type: "json",
            json: randomPokemon,
          },
        ],
      };

    case "attack_pokemon":
      if (
        typeof args.attack !== "string" ||
        typeof args.a !== "string" ||
        typeof args.b !== "string"
      ) {
        throw new Error("Invalid arguments for attack_pokemon");
      }
      // Simulate an attack response
      return {
        content: [
          {
            type: "text",
            text: `${args.b} attacks ${args.a} with ${args.attack}!`,
          },
        ],
      };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
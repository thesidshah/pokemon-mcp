#!/bin/bash

# Get the directory of this script
DIR="$(cd "$(dirname "$0")" && pwd)"

# Change to the script directory
cd "$DIR"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..." >&2
    npm install --silent >&2
fi

# Run the MCP server directly with tsx
# Use exec to replace the shell process with tsx
exec npx tsx index.ts
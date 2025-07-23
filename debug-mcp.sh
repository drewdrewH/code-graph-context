#!/bin/bash

# Log everything to a debug file
exec 2>> /tmp/mcp-debug.log

echo "=== MCP Debug Start $(date) ===" >&2
echo "PWD: $(pwd)" >&2
echo "PATH: $PATH" >&2
echo "Args: $@" >&2
echo "Environment:" >&2
env >&2
echo "===================" >&2

# Set proper environment
export PATH="/Users/andrew.hernandez/.nvm/versions/node/v20.18.3/bin:$PATH"
export NODE_PATH="/Users/andrew.hernandez/.nvm/versions/node/v20.18.3/lib/node_modules"

# Change to project directory
cd /Users/andrew.hernandez/code/code-graph-context

# Log what we're about to execute
echo "Executing: node dist/mcp/mcp.server.js" >&2

# Execute the MCP server
exec /Users/andrew.hernandez/.nvm/versions/node/v20.18.3/bin/node dist/mcp/mcp.server.js "$@"

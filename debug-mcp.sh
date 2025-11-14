#!/bin/bash

# Generic MCP debug wrapper for code-graph-context
# Logs debug output to /tmp for troubleshooting

# Log everything to a debug file
exec 2>>/tmp/mcp-code-graph-debug.log

echo "=== MCP Server Start $(date) ===" >&2
echo "PWD: $(pwd)" >&2
echo "Args: $@" >&2

# Find the script directory and change to it
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Script directory: $SCRIPT_DIR" >&2
echo "Node version: $(node --version)" >&2
echo "===================" >&2

# Execute the MCP server
exec node dist/mcp/mcp.server.js "$@"

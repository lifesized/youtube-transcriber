#!/usr/bin/env bash
# Prints the MCP client config with the correct absolute path.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="$REPO_ROOT/mcp-server/dist/index.js"

if [ ! -f "$SERVER" ]; then
  echo "MCP server not built yet. Run: npm run mcp:build"
  exit 1
fi

echo "Add this to your MCP client config:"
echo ""
echo "  Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json"
echo "  Claude Code:    .claude/mcp.json or claude mcp add"
echo "  Cursor:         .cursor/mcp.json"
echo ""
cat <<EOF
{
  "mcpServers": {
    "youtube-transcriber": {
      "command": "node",
      "args": ["$SERVER"]
    }
  }
}
EOF

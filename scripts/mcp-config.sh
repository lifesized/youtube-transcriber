#!/usr/bin/env bash
# Prints the MCP client config with the correct absolute path.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="$REPO_ROOT/mcp-server/dist/index.js"

if [ ! -f "$SERVER" ]; then
  echo "MCP server not built yet. Run: npm run mcp:build"
  exit 1
fi

TOKEN_PATH="$(node -e "process.stdout.write(require('$REPO_ROOT/lib/local-api-token.js').tokenFilePath())")"

echo "Add this to your MCP client config:"
echo ""
echo "  Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json"
echo "  Claude Code:    .claude/mcp.json or claude mcp add"
echo "  Cursor:         .cursor/mcp.json"
echo ""
echo "Local API token file (mode 0600, created on first run, never printed here):"
echo "  $TOKEN_PATH"
echo "The MCP server reads that file and sends Authorization: Bearer."
echo "Set TRANSCRIBER_LOCAL_TOKEN on the app to override; the file is updated to match."
echo "Do not put the token in this config."
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

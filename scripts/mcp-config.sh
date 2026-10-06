#!/usr/bin/env bash
# Prints the MCP client config with the correct absolute path and local auth env.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="$REPO_ROOT/mcp-server/dist/index.js"

if [ ! -f "$SERVER" ]; then
  echo "MCP server not built yet. Run: npm run mcp:build"
  exit 1
fi

# Resolve token file path (same helper as the server / native host). Do not print the token.
TOKEN_PATH="$(node -e "const { getLocalApiTokenPath, ensureLocalApiToken } = require('$REPO_ROOT/lib/local-api-token.js'); ensureLocalApiToken(); process.stdout.write(getLocalApiTokenPath());")"

echo "Add this to your MCP client config:"
echo ""
echo "  Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json"
echo "  Claude Code:    .claude/mcp.json or claude mcp add"
echo "  Cursor:         .cursor/mcp.json"
echo ""
echo "Local API token file (YTT-435):"
echo "  $TOKEN_PATH"
echo "  The MCP server reads this file automatically (or TRANSCRIBER_LOCAL_TOKEN)."
echo "  Requests are not sent when that token cannot be resolved."
echo "  Do not commit the token. Do not use a raw SQLite/dev.db read as a recall workaround."
echo "  delete_transcript requires confirm: true. summarize_transcript does not take an API key."
echo ""
cat <<EOF
{
  "mcpServers": {
    "youtube-transcriber": {
      "command": "node",
      "args": ["$SERVER"],
      "env": {
        "YTT_API_URL": "http://127.0.0.1:19720"
      }
    }
  }
}
EOF
echo ""
echo "Optional: set TRANSCRIBER_LOCAL_TOKEN in the env block to override the token file."

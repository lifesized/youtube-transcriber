# MCP Server

The YouTube Transcriber includes an MCP (Model Context Protocol) server that lets AI clients — Claude Desktop, Claude Code, Cursor, and others — interact with your transcript library directly.

## Prerequisites

The Next.js app must be running:

```bash
npm run dev
```

The MCP server makes HTTP calls to `http://127.0.0.1:19720`. If you changed the port, set `YTT_API_URL` in your MCP client config's `env` block.

## Setup

The MCP server is built automatically when you run `npm run setup` or `npm install`. To get your config snippet:

```bash
npm run mcp:config
```

This prints the JSON block with the correct absolute path to `mcp-server/dist/index.js`.

## Client Configuration

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "youtube-transcriber": {
      "command": "node",
      "args": ["/absolute/path/to/youtube-transcriber/mcp-server/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop after saving.

### Claude Code

```bash
claude mcp add youtube-transcriber node /absolute/path/to/youtube-transcriber/mcp-server/dist/index.js
```

Or add to `.claude/mcp.json`:

```json
{
  "mcpServers": {
    "youtube-transcriber": {
      "command": "node",
      "args": ["/absolute/path/to/youtube-transcriber/mcp-server/dist/index.js"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "youtube-transcriber": {
      "command": "node",
      "args": ["/absolute/path/to/youtube-transcriber/mcp-server/dist/index.js"]
    }
  }
}
```

## Available Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `transcribe` | Transcribe a YouTube video (captions or Whisper) | `url` |
| `list_transcripts` | List all saved transcripts | — |
| `search_transcripts` | Search by title or author | `query` |
| `get_transcript` | Get full timestamped transcript | `id` |
| `delete_transcript` | Delete a transcript | `id` |
| `summarize_transcript` | Summarize via OpenAI or Anthropic | `id`, `provider`, `apiKey`, `model?`, `format?` |

## Resources

| URI | Description |
|-----|-------------|
| `transcript://{id}` | Read-only access to a formatted transcript |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `YTT_API_URL` | `http://127.0.0.1:19720` | Override the YouTube Transcriber API URL |

## Troubleshooting

**"YouTube Transcriber is not running"**
Start the app: `npm run dev`

**Tools don't appear in client**
1. Verify the path in your config is absolute and correct
2. Rebuild: `npm run mcp:build`
3. Restart your MCP client

**Custom port**
Add `env` to your config:
```json
{
  "mcpServers": {
    "youtube-transcriber": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/index.js"],
      "env": { "YTT_API_URL": "http://127.0.0.1:3000" }
    }
  }
}
```

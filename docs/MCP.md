# MCP Server

The YouTube Transcriber includes an MCP (Model Context Protocol) server that lets AI clients — Claude Desktop, Claude Code, Cursor, and others — interact with your transcript library directly.

## Prerequisites

The Next.js app must be running:

```bash
npm run dev
```

The MCP server makes HTTP calls to `http://127.0.0.1:19720`. If you changed the port, set `YTT_API_URL` in your MCP client config's `env` block.

## Local API authentication

Self-hosted `/api/*` requires a loopback Bearer token (YTT-435). The MCP server reads `TRANSCRIBER_LOCAL_TOKEN` or the shared token file (see `npm run mcp:config` for the path on your machine) and sends `Authorization: Bearer`. If that token cannot be resolved, MCP does not call the API. Do **not** work around auth by reading `prisma/dev.db` / SQLite directly for recall — that bypasses access control and is not supported.

`summarize_transcript` does not take an API key. Summaries use the server-held OpenRouter key. `delete_transcript` deletes only when `confirm` is `true`.


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
| `transcribe_and_summarize` | Transcribe and return full text for the LLM to summarize | `url` |
| `list_transcripts` | List all saved transcripts | — |
| `search_transcripts` | Search by title or author | `query` |
| `get_transcript` | Get full timestamped transcript | `id` |
| `delete_transcript` | Permanently delete a transcript. Refuses unless `confirm` is `true` | `id`, `confirm` |
| `summarize_transcript` | Summarize via server OpenRouter key (no client apiKey) | `id`, `promptOverride?` |

## Resources

| URI | Description |
|-----|-------------|
| `transcript://{id}` | Read-only access to a formatted transcript |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `YTT_API_URL` | `http://127.0.0.1:19720` | Override the YouTube Transcriber API URL |
| `TRANSCRIBER_LOCAL_TOKEN` | token file | Same loopback Bearer as the Next.js app. When unset, MCP reads the shared token file. Missing token → no request |

## Troubleshooting

**"YouTube Transcriber is not running"**
Start the app: `npm run dev`

**"Refusing to call the local API without a loopback token"**
Start the app once so it creates the shared token file, or set `TRANSCRIBER_LOCAL_TOKEN` in the MCP client `env` block to the same value the server uses. Restart the MCP client after changing it.

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

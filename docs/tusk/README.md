# Tusk (local Slack bot)

Tusk is a Socket Mode Slack bot that runs inside the Transcriber Electron menu-bar app. No public request URL, tunnel, or cloud worker.

What ships today: `/tusk help`, `/tusk status`, a 👀 reaction plus a threaded summary (or transcript file) on a supported YouTube URL in an allowlisted channel, `@Tusk <question>` in that thread answering only from that video, and an optional YouTube watchlist digest (public `videos.xml` only) posted to one allowlisted channel.

- **Manifest:** [slack-app-manifest.yaml](./slack-app-manifest.yaml) (same content as [slack-app-manifest.json](./slack-app-manifest.json))
- **Setup for James:** [setup.md](./setup.md)

Display copy is the old Transcriber Dev manifest, renamed to Tusk. Socket Mode is on. Request URLs, OAuth redirects, and the Cloudflare tunnel placeholders are gone.

## Scopes (minimal)

| Scope | Why |
| --- | --- |
| `app_mentions:read` | `@Tusk` in a channel (and later `@tusk <question>` in a thread). |
| `channels:history` | Required for the `message.channels` event so a pasted link in #youtube-notes works without a mention. This delivers **every message** in public channels Tusk has joined, not only messages that contain a link. Tusk ignores bot messages, edits, other workspaces, Slack Connect externals, DMs, and private channels. |
| `chat:write` | Post in channels Tusk is invited to. Slash-command replies use the Socket Mode ack payload and do not need this scope. Milestone 2 uses it for threaded summaries. |
| `commands` | The `/tusk` slash command. |
| `files:write` | Upload a transcript file into the thread when summarizing is unavailable or you asked for the transcript. |
| `reactions:write` | Milestone 1: 👀 on a supported link. Later: progress reactions. |

**Not requested:** `incoming-webhook`, OAuth redirect URLs, `chat:write.public` (Tusk must be invited), `groups:history` / `im:history` (DMs, MPIMs, and private channels are denied unless the channel ID is on the explicit allowlist), `channels:read`. An empty allowlist **denies every channel**. Missing `channel_type` is unknown (a `C…` id is not assumed public). Slash commands also use `channel_name` to deny `privategroup`, `directmessage`, and `mpdm-*` unless that channel ID is on the list. Slash commands in any other conversation get an ephemeral hint.

The **app-level token** (`xapp-…`) is created in the Slack UI after the app exists. It needs only `connections:write` so Socket Mode can open a websocket. That is not a bot OAuth scope.

## Events

| Event | Why |
| --- | --- |
| `app_mention` | `@Tusk` mentions. |
| `message.channels` | A plain paste in a public channel the bot is in, without a mention. |

No Event Subscriptions Request URL. `socket_mode_enabled: true` is the only delivery path.

## Runtime choice

Tusk does **not** add `@slack/bolt` or `@slack/socket-mode`.

- Bolt pulls Express (and an HTTP Events API path). There is no public endpoint.
- `@slack/socket-mode` plus `@slack/web-api` still pull axios, `ws`, and a retry stack. Those packages would have to be listed in `electron-builder.json` `files` (the asar allowlist is otherwise just `better-sqlite3`) and would show up in the size budget.
- Electron 44 / Node 22 already have `fetch` and `WebSocket`.
- REST calls use the first-party client in `electron/tusk/slack-api.js` (`auth.test`, `reactions.add`, `apps.connections.open`). The vendored `lib/tusk/web-api.ts` is kept for milestone 2 thread posts and file uploads; it is not on the Socket Mode path. Socket Mode is a small first-party client in `electron/tusk/runtime.js` that is mocked in unit tests.

Size delta from new npm dependencies: **0**.

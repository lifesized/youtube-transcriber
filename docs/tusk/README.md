# Tusk (local Slack bot)

Tusk is a Socket Mode Slack bot that runs inside the Transcriber Electron menu-bar app. No public request URL, tunnel, or cloud worker.

- **Manifest:** [slack-app-manifest.yaml](./slack-app-manifest.yaml) (same content as [slack-app-manifest.json](./slack-app-manifest.json))
- **Setup for James:** [setup.md](./setup.md)

Display copy is the old Transcriber Dev manifest, renamed to Tusk. Socket Mode is on. Request URLs, OAuth redirects, and the Cloudflare tunnel placeholders are gone.

## Scopes (minimal)

| Scope | Why |
| --- | --- |
| `app_mentions:read` | `@Tusk` in a channel (and later `@tusk <question>` in a thread). |
| `channels:history` | Required for the `message.channels` event so a pasted link in #youtube-notes works without a mention. |
| `chat:write` | `/tusk help`, `/tusk status`, and later threaded summaries. |
| `commands` | The `/tusk` slash command. |
| `files:write` | Later: upload a transcript file. Unused in milestone 1. Included now so the Slack app is created once. |
| `reactions:write` | Milestone 1: 👀 on a supported link. Later: progress reactions. |

**Not requested:** `incoming-webhook`, OAuth redirect URLs, `chat:write.public` (Tusk must be invited), `groups:history` / `im:history` (public channels only for v0), `channels:read` (empty allowlist = every channel Slack already delivers, i.e. channels Tusk is in).

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
- REST calls reuse the vendored `lib/tusk/web-api.ts` (from the old bot, Inngest comments stripped). Socket Mode is a small first-party client in `electron/tusk/runtime.js` that is mocked in unit tests.

Size delta from new npm dependencies: **0**.

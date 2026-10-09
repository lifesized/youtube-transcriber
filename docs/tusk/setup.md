# Tusk setup (James)

First test: your personal free Slack workspace, channel **#youtube-notes**. Launch target: 24 October.

Tusk talks to Slack over Socket Mode from Transcriber on this Mac. There is no public URL, no ngrok, and no cloud worker.

## 1. Create the Slack app from the manifest

1. Open [https://api.slack.com/apps](https://api.slack.com/apps) while signed into your **personal** workspace (not a work org).
2. Click **Create New App** → **From an app manifest**.
3. Pick that personal workspace.
4. Paste the contents of `docs/tusk/slack-app-manifest.yaml` (or the `.json` — they match).
5. Confirm. The app name must be **Tusk**.
6. Check **Socket Mode** is on, and that there is **no** Request URL under Event Subscriptions, Interactivity, or Slash Commands, and **no** OAuth Redirect URL.

## 2. App-level token (`xapp-…`)

1. In the app → **Basic Information** → **App-Level Tokens** → **Generate Token and Scopes**.
2. Name it e.g. `tusk-socket`.
3. Add the scope **`connections:write`** only.
4. Generate and copy the token. It starts with `xapp-`.
5. Store it in a password manager. Slack shows it once.

## 3. Install and copy the bot token (`xoxb-…`)

1. **OAuth & Permissions** → **Install to Workspace** → allow.
2. Copy **Bot User OAuth Token**. It starts with `xoxb-`.
3. Confirm bot scopes are exactly: `app_mentions:read`, `channels:history`, `chat:write`, `commands`, `files:write`, `reactions:write`.

## 4. Paste both into Transcriber

1. Open Transcriber from the menu bar → **Open Transcriber** → **Settings**.
2. Find **Slack (Tusk)**.
3. Paste the bot token and the app-level token.
4. Type Slack channel IDs (`C…`), comma-separated. An empty allowlist denies every channel, including public ones. A missing `channel_type` is treated as unknown. `/tusk` also uses `channel_name` (`privategroup`, `directmessage`, `mpdm-*`) to deny private, DM, and MPDM conversations unless that ID is on the list.
5. Turn **Enable Tusk** on and save.
6. After save the fields show only `saved ••••last4`. The app calls `auth.test` and should show the workspace name and bot name.
7. The menu-bar status should read **Tusk: connected to &lt;workspace&gt;** (placeholder copy for Design).

Tokens are encrypted with Electron `safeStorage` (macOS Keychain), same as the LLM and Notion keys. They are never written to SQLite in plaintext, never logged, and never sent back to the Settings page after save.

## 5. Invite @Tusk to #youtube-notes

In Slack:

```
/invite @Tusk
```

in **#youtube-notes**. Tusk only receives `message.channels` for public channels it has been invited to.

## 6. Test the connection

| Check | Expected |
| --- | --- |
| `/tusk help` in #youtube-notes | Help text (no processing). |
| `/tusk status` | Connected, workspace name, bot name. |
| Paste `https://www.youtube.com/watch?v=jNQXAC9IVRw` (no mention) | Tusk adds 👀. Milestone 1 does **not** transcribe or summarize. |
| An unsupported or non-http URL | No reaction. Tusk never fetches arbitrary URLs from Slack text. |

## Troubleshooting

**Settings says the menu-bar app must be open.** Tusk tokens are stored by the Electron app, not `npm run dev`. Open Transcriber.app, then save again.

**Tusk: error / Socket Mode will not connect.** Re-check the `xapp-` token has `connections:write`, and that Socket Mode is enabled on the app. Quit Transcriber from the tray and reopen it.

**`auth.test` fails / wrong workspace.** The `xoxb-` token must be from this personal workspace install. Tusk pins `team_id` from `auth.test` at save and again at connect, **before** it handles any event. An empty pin denies every event. If you paste a token from a different workspace, save is refused until you check **Reset workspace** in Settings. Slack Connect messages from people whose team is not the pinned team are ignored.

**No 👀 on a pasted link.** Confirm @Tusk is in that channel and the allowlist in Settings includes that channel ID (channel details → scroll to the bottom for `C…`). An empty allowlist denies every channel. The URL must be YouTube, a Spotify episode, or a LinkedIn post/event the app already accepts. LinkedIn must be `https://` on `linkedin.com` / `www.linkedin.com` with no port or userinfo. `/tusk` in a DM, MPDM, or private channel replies with an ephemeral hint unless that channel ID is allowlisted.

**`/tusk` is unknown.** Reinstall the app to the workspace after saving the manifest so the slash command is registered. Slack can take a minute.

**Duplicate reactions.** Tusk dedupes on Slack `event_id` / `client_msg_id` and rate-limits per channel, per user, and globally (including `/tusk`). Edits and bot messages are ignored.

**Need to rotate tokens.** Paste new tokens in Settings and save. Old ciphertext is overwritten. Slack’s old token stops working after you revoke it on api.slack.com.

## What leaves this Mac

| Destination | What |
| --- | --- |
| Slack Web API + Socket Mode websocket | Connection, `auth.test`, slash-command replies, 👀 reactions, threaded summaries, and transcript file uploads. Anyone in an allowlisted channel can see those posts, including Slack Connect members if that channel is on the list. |
| The LLM provider you already configured in Settings | Questions and transcripts go to that provider (Anthropic, OpenAI, or OpenRouter) so Tusk can summarize and answer in-thread. |
| Nowhere else | No Transcriber cloud, no Inngest, no Supabase, no tunnel. Video URLs from Slack are fetched only through the app’s existing validators on `127.0.0.1:19721`. |

Slack still stores the messages you type in #youtube-notes, as it does for any channel. Tusk does not send those messages to a server we run.

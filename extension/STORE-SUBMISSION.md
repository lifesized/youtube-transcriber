# Chrome Web Store Submission — Paste Sheet

One-stop reference for filling out the Chrome Web Store Developer Console form. Copy each block into the matching field. URLs to use are at the bottom.

Developer Console: <https://chrome.google.com/webstore/devconsole>

---

## Store listing

### Product name
```
Transcriber for YouTube
```
*(also set in `manifest.json` — must match)*

### Short description (132 char max)
```
Transcribe YouTube videos, then summarize with Claude or ChatGPT in one click.
```
*(78 chars)*

### Detailed description
```
A side panel for Chrome that turns any YouTube video into a full searchable transcript — then hands it off to Claude or ChatGPT for instant summaries, key takeaways, or any prompt you want.

How it works:
• Click the extension icon to open the side panel
• Open a YouTube video (or supported podcast page)
• Hit "Transcribe" — get the full transcript in seconds
• Hit "Summarize" — opens Claude or ChatGPT with the transcript pre-loaded

Two ways to use it:

Cloud mode (easiest):
• Sign in at transcribed.dev — no setup
• 30 free transcripts per month, upgrade for unlimited
• Pro plan also unlocks high-accuracy Whisper transcription for videos without captions

Local mode (free & private):
• Run the open-source server on your own machine
• All processing happens locally using Whisper
• Audio and transcripts never leave your computer
• Unlimited, completely free, fully open source

Key features:
• One-click transcription from the side panel
• One-click handoff to Claude or ChatGPT for summaries
• Side panel stays open as you browse — queue videos as you find them
• Searchable library of every transcript you've made
• Send transcripts to Notion or Obsidian with one click
• Works on YouTube and major podcast platforms (Spotify, with more coming)
• Switch between local and cloud in settings
```

### Category
```
Productivity
```

### Language
```
English (United States)
```

---

## Privacy practices

### Single purpose
```
Transcribe videos and podcasts the user is viewing, then optionally hand the transcript off to a destination (Notion, Obsidian, Claude, ChatGPT) of the user's choice.
```

### Permission justifications

#### `activeTab`
```
Reads the URL of the tab the user has clicked the extension on, so the extension knows which video or podcast to transcribe.
```

#### `tabs`
```
Required for three flows that activeTab alone cannot serve:
1. Opening obsidian:// URL-scheme links via chrome.tabs.create() to deliver finished transcripts to the user's local Obsidian app.
2. Reusing an existing transcribed.dev tab when re-opening the cloud app (chrome.tabs.query({}) to find it, chrome.tabs.update() to focus and navigate it) — avoids opening a duplicate tab every time.
3. Reading tab.url in chrome.tabs.onActivated and onUpdated listeners so the side panel updates the "currently viewing" video when the user navigates between videos.
```

#### `storage`
```
Persists user settings (mode selection, destination preferences, Obsidian vault name) and the current transcription queue/state across browser restarts.
```

#### `sidePanel`
```
The extension's primary UI is a Chrome side panel that stays open beside the video being transcribed.
```

#### `scripting`
```
Registers content scripts dynamically based on which optional host permissions the user has granted, so newly enabled platforms (Vimeo, Twitch, etc.) get their detection script without a manifest update.
```

#### `notifications` (optional)
```
Shows a desktop notification when a long-running transcription completes in the background, so the user doesn't have to keep the side panel open.
```

#### `downloads` (optional)
```
Saves transcripts as markdown or .srt subtitle files to the user's local Downloads folder.
```

#### `clipboardWrite` (optional)
```
"Copy as markdown" button — universal fallback for sending a transcript anywhere, when the user's destination isn't directly integrated.
```

#### `contextMenus` (optional)
```
Right-click shortcut on a supported video page to send the transcript directly to a connected destination.
```

### Host permission justifications

#### `http://localhost:19720/*`, `http://127.0.0.1:19720/*`
```
The extension is the front-end for an open-source, locally hosted transcription service the user runs on their own machine (https://github.com/lifesized/youtube-transcriber). When local mode is selected, the extension communicates only with this localhost service. No data leaves the user's machine.
```

#### `https://transcribed.dev/*`, `https://www.transcribed.dev/*`
```
The extension is also the front-end for the cloud transcription service at transcribed.dev. When cloud mode is selected, the extension authenticates via the user's signed-in browser session and submits transcription jobs to this host. Destination OAuth (Notion, etc.) also runs through transcribed.dev as a server-side proxy, so the extension does not need per-vendor host permissions.
```

#### `*://*.youtube.com/*`
```
Content script detects when the user navigates between YouTube videos so the side panel can update which video is "currently viewing." Read-only metadata extraction (video ID from the URL) — no DOM modification, no data collection beyond what the user explicitly chooses to transcribe.
```

#### `*://open.spotify.com/*`
```
Same role as YouTube but for Spotify podcast episodes — detects episode navigation so the side panel can transcribe the current episode.
```

#### `*://*.vimeo.com/*`, `*://podcasts.apple.com/*`, `*://*.twitch.tv/*` (optional)
```
Same role as the YouTube/Spotify content scripts: detect video or episode navigation on these additional platforms. Requested only at runtime if the user opts into multi-platform support.
```

#### `https://claude.ai/*`, `https://chatgpt.com/*` (optional)
```
Powers the one-click "Summarize" feature. When the user clicks Summarize, the extension opens claude.ai or chatgpt.com with the transcript pre-loaded as a prompt. The user can revoke this permission at any time via Chrome's extension settings; the rest of the extension continues to work without it.
```

---

## Data usage disclosures

For the "Privacy practices" data-collection form:

| Disclosure question | Answer |
|---|---|
| Does this extension collect personally identifiable information? | **No** |
| Does this extension collect health information? | **No** |
| Does this extension collect financial / payment information? | **No** |
| Does this extension collect authentication information? | **No** *(cloud mode rides the user's existing transcribed.dev session cookie; the extension stores no credentials)* |
| Does this extension collect personal communications? | **No** |
| Does this extension collect location? | **No** |
| Does this extension collect web history? | **No** *(the extension only reads the URL of the tab the user actively clicks on)* |
| Does this extension collect user activity? | **No** *(no analytics or telemetry inside the extension)* |
| Does this extension collect website content? | **Yes — limited** *(video / podcast URLs the user explicitly chooses to transcribe; sent to localhost in local mode or transcribed.dev in cloud mode; not sold or shared)* |

**Three required certifications (must check all):**
- ☑ I do not sell or transfer user data to third parties outside of the approved use cases.
- ☑ I do not use or transfer user data for purposes unrelated to my item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes.

---

## URLs to provide

| Field | URL |
|---|---|
| **Privacy policy** | `https://transcribed.dev/privacy/extension` |
| **Homepage** | `https://transcribed.dev` |
| **Support / contact** | `https://github.com/lifesized/youtube-transcriber/issues` |
| **Support email** *(if asked)* | `support@transcribed.dev` |

---

## Optional fields

### "Why does the extension need remote code execution?"
Not applicable — extension does not execute remote code. CSP enforces `script-src 'self'`; see manifest.json content_security_policy.

### "Are you using Google APIs?"
No.

### Account type
Individual *(adjust if you submit under a registered company)*

---

## Pre-flight check before clicking Submit

- [ ] `extension/dist/` contains the freshly built artifacts (run `node build.js` if unsure)
- [ ] Zip the **contents** of `extension/dist/`, not the folder. `manifest.json` must be at the zip root
- [ ] Cloud `/privacy/extension` page deployed to Vercel — open <https://transcribed.dev/privacy/extension> in incognito and verify it loads
- [ ] Screenshots in `extension/store-assets/` are 1280×800 PNG, real content, no doxxing personal email/account
- [ ] Promo tile (440×280) — optional, can add later
- [ ] Developer account registered, $5 fee paid

After upload + form fill, hit **Submit for review**. Typical wait: 1–3 business days.

---

## Post-publish (after approval)

- [ ] Add Web Store badge + link to top of `README.md`
- [ ] Add Web Store link to `contrib/clawhub/README.md`
- [ ] Close YTT-109; mark Phase 2 portion of YTT-145 complete
- [ ] Announce on transcribed.dev landing? *(YTT-197 says do NOT announce rebrand without coordinated multi-platform launch — Web Store availability alone is fine)*

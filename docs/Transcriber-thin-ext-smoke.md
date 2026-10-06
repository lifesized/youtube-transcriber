# Thin LOCAL Extension Smoke Test Checklist

Manual smoke tests for the LOCAL one-tap send extension path (YTT-442 / YTT-446 / YTT-448).

This checklist covers the unpacked LOCAL extension + native host + loopback app. Run through these before releasing to the Chrome Web Store.

> **Gaps:** Some checks require manual Chrome steps (installing unpacked extension, clicking buttons, observing UI state) — not automatable in CI. Test coverage via `npm run test:extension` noted where applicable.

---

## Prerequisites

- [ ] Transcriber app running on `http://127.0.0.1:19720`
- [ ] Native host installed (`npm run install-native-host`)
- [ ] Local API token present in expected location (macOS: `~/Library/Application Support/Transcriber/local-api.token`)
- [ ] Extension unpacked from `extension/dist/` (after `npm run build:ext`)

---

## Happy Path: One-Tap Send

- [ ] Load unpacked extension (Chrome → `chrome://extensions` → Developer mode → Load unpacked → select `extension/dist/`)
- [ ] Reload extension if already loaded
- [ ] Open any YouTube video page
- [ ] Click Transcriber icon in toolbar → side panel opens
- [ ] Page URL displays in panel (not "This page has no URL")
- [ ] Click **Send this page** button
- [ ] Button shows "Sending…" spinner/busy state
- [ ] Status updates to **"Sent."** (exact text) with `tone="ok"` (green)
- [ ] **"Open in Transcriber"** button appears below status
- [ ] Click "Open in Transcriber" → new tab opens at `http://127.0.0.1:19720/?id={transcriptId}`
- [ ] `transcriptId` in URL matches the server job ID (visible in app UI or logs)
- [ ] Deep-link loads the correct transcript in the web app

**Automated coverage:** `popup-status-messages.test.js` validates the exact status text; `background-send-result.test.js` validates result shape including `transcriptId`.

---

## Cold Start: App / Native Host Down

- [ ] Quit Transcriber app (server not running)
- [ ] Native host not installed or manifest removed
- [ ] Open YouTube page, open side panel
- [ ] Click **Send this page**
- [ ] Status shows **"Start the Transcriber app."** (exact text, `tone="error"`)
- [ ] No deep-link button appears
- [ ] No "Token missing" or other confusing message shown

**Automated coverage:** `background-send-result.test.js` validates `reason: "unreachable"` → status mapping tested in `popup-status-messages.test.js`.

---

## Missing / Stale Token

- [ ] App running but token file missing or empty
- [ ] Native host returns `{ ok: false }` (simulate by corrupting token file)
- [ ] Click **Send this page**
- [ ] Status shows **"Token missing or out of date — restart Transcriber."** (exact text, `tone="error"`)
- [ ] No deep-link button appears
- [ ] After restoring/regenerating token + restarting app → send succeeds

**Automated coverage:** `background-send-result.test.js` validates `reason: "unauthorized"` result; status text tested in `popup-status-messages.test.js`.

---

## Other Failures

- [ ] Simulate non-200 / non-401 response from loopback (e.g. 500, 503)
- [ ] Status shows **"Couldn't send this URL."** (generic fallback, `tone="error"`)
- [ ] No server error text exposed in UI (YTT-448 security requirement)
- [ ] Invalid `transcriptId` format in server response → same generic error

**Automated coverage:** `background-send-result.test.js` validates all failure reasons map to correct status.

---

## Security: No Secrets Leaked

- [ ] Open Chrome DevTools → Application → Storage
- [ ] Confirm `chrome.storage.local`, `chrome.storage.sync`, `chrome.storage.session` are all empty (no token stored)
- [ ] Inspect `POST /api/transcripts` request in Network tab
- [ ] Body is `{ "url": "<page-url>" }` only — no `apiKey`, `token`, or other secret fields
- [ ] `Authorization: Bearer <token>` present in request headers only
- [ ] Page URL in request body has userinfo + secret query params stripped (no `?token=...`, `?api_key=...`)
- [ ] No secrets appear in deep-link URL (`http://127.0.0.1:19720/?id=...` only)

**Automated coverage:**
- `local-build-policy.test.js` validates no `storage` permission in manifest
- `no-client-apikey.test.js` validates no provider API key inputs/storage
- `send-url.test.js` validates `buildLocalSendRequest` strips secrets from URLs
- `local-auth-headers.test.js` validates Bearer token format

Cross-reference: [docs/TESTING.md](./TESTING.md) Layer 1 for the full automated test suite.

---

## No Provider API Keys / No Summarize from Extension

- [ ] Extension UI has no input fields (no `<input>` or `<textarea>` in `popup.html`)
- [ ] Extension never prompts for API keys
- [ ] Extension never calls OpenAI / Anthropic / other LLM APIs
- [ ] Only endpoint is `http://127.0.0.1:19720/api/transcripts`
- [ ] Summarize happens server-side only (not in extension)

**Automated coverage:** `no-client-apikey.test.js` validates all of the above constraints.

---

## Edge Cases

- [ ] Open non-http(s) page (e.g. `chrome://extensions`) → "This page has no URL to send." status, send button disabled
- [ ] Open page with very long URL (> 4096 chars) → send button disabled or graceful error
- [ ] Open page with secret in URL (`?token=...`) → secret stripped from POST body (automated test coverage)
- [ ] Switch tabs while send is in flight → correct URL sent (not stale URL from previous tab)
- [ ] Reload extension while send is pending → no orphaned state or leaked memory

---

## Gaps: What This Doc Doesn't Cover

This checklist is for the **LOCAL extension only** (loopback + native host). Not covered:

- ENTERPRISE build (org URL + org auth, MDM force-install) — not yet implemented (see [EXTENSION-PACKAGING.md](./EXTENSION-PACKAGING.md))
- Cloud mode / remote host pointing — LOCAL build explicitly cannot be pointed at a remote host
- Chromium variants (Edge, Brave, Arc) — tested manually only, not in automated CI
- Multi-platform (macOS, Linux, Windows) — native host paths vary, tested locally only

---

## Running Automated Tests

Before manual smoke testing, verify all extension tests pass:

```bash
npm run test:extension
```

This runs the Node-testable layer (no browser launch required):

| Test File | What it covers |
|-----------|----------------|
| `local-build-policy.test.js` | No `storage` permission, no remote host |
| `no-client-apikey.test.js` | No API key inputs/storage/forwarding |
| `send-url.test.js` | URL normalization, secret stripping |
| `local-auth-headers.test.js` | Bearer token format |
| `background-send-result.test.js` | `sendPageUrl` result shape, token clearing on 401 |
| `popup-status-messages.test.js` | Exact status text for each failure reason |
| `build-output.test.js` | Build artifact structure |

See [docs/TESTING.md](./TESTING.md) for the full test strategy (setup verification, extension tests, health check API).

---

## Notes

- This checklist was created after YTT-442 / YTT-446 / YTT-448 landed (the thin LOCAL path). It should have existed before those tickets shipped — treat it as living documentation for future extension work.
- For Puppeteer / Playwright E2E automation (tracked in YTT-214), start with the Happy Path and Cold Start scenarios above.
- Manual checks take ~10-15 minutes to run end-to-end.

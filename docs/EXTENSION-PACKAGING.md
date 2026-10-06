# Extension Packaging: LOCAL vs ENTERPRISE

Two Chromium extension builds with separate IDs, artifacts, and deployment models.

**Status:** Documentation only (YTT-447). The ENTERPRISE build is not yet implemented.

---

## Design Constraint: No Runtime Mode Toggle

Each build has one hardcoded destination — **no UI toggle or settings panel** to switch between loopback and a remote host.

**Rationale:**
- Chrome Web Store policy: extensions requesting broad host permissions must justify them. A personal productivity tool that silently allows pointing at any host raises red flags.
- Enterprise IT policy: force-installed extensions with configurable remote destinations create phishing / data exfiltration risk. Admins want the destination baked and auditable.
- Attack surface: a mode toggle + host input field means one XSS or malicious settings import can retarget the extension. Separate artifacts eliminate that class of bug.

---

## LOCAL Build (Current)

**What it does:** One-tap send of the current page URL to `http://127.0.0.1:19720` via the native host.

### Characteristics

| | |
|---|---|
| **Extension ID** | Derived from Chrome Web Store submission (public listing) or dev keypair (unpacked) |
| **Name** | "Transcriber for YouTube" |
| **Destination** | `http://127.0.0.1:19720` only (hardcoded in `send-url.js`) |
| **Auth** | Native messaging → loopback Bearer token |
| **Host permissions** | `http://127.0.0.1:19720/*` |
| **Manifest permissions** | `activeTab`, `tabs`, `sidePanel`, `nativeMessaging` |
| **Settings UI** | None — destination not configurable |
| **Distribution** | Public Chrome Web Store listing (personal use) |
| **No remote host** | Cannot be pointed at `https://app.example.com` or any non-loopback URL |

### Build Command

```bash
npm run build:ext         # → extension/dist/  (Store artifact)
npm run build:ext:dev     # → extension/dist/  (renamed for toolbar visibility)
```

The `--dev` flag only changes the display name to "Transcriber for YouTube (dev)" and injects a stable key for unpacked loading. Same destination, same security model.

### Current Implementation

- Entry point: `extension/build.js`
- Copies files from `COPY_FILES` array into `dist/`
- `manifest.json` → no templating, ships as-is
- `send-url.js` → `LOCAL_SEND_ENDPOINT = "http://127.0.0.1:19720/api/transcripts"` (const)

---

## ENTERPRISE Build (Not Yet Implemented)

**What it does:** One-tap send to a configured org-hosted Transcriber instance (e.g. `https://transcriber.corp.example.com`).

### Characteristics

| | |
|---|---|
| **Extension ID** | Second Chrome Web Store listing (unlisted/private) or separate dev keypair |
| **Name** | "Transcriber (Enterprise)" or org-branded variant |
| **Destination** | Org base URL (e.g. `https://transcriber.corp.example.com`) — **configured at build time or via policy** |
| **Auth** | Org SSO / OAuth / API key managed by org IT |
| **Host permissions** | `https://transcriber.corp.example.com/*` (or `https://*/*` with MDM justification) |
| **Manifest permissions** | `activeTab`, `tabs`, `sidePanel`, `identity` (if using OAuth), no `nativeMessaging` |
| **Settings UI** | Minimal or none — destination + auth pre-configured |
| **Distribution** | MDM force-install (preferred) or unlisted/private Chrome Web Store listing |
| **No loopback fallback** | Cannot silently default to `http://127.0.0.1:19720` for corp users |

### Authentication Models (Options)

1. **OAuth via `chrome.identity`** — extension redirects to org IdP, receives token, sends in `Authorization` header.
2. **MDM-injected API key** — managed storage policy provides a pre-shared key.
3. **Cookie-based SSO** — extension sends `withCredentials: true`; server validates session cookie set by org IdP.

Choice depends on org IT requirements. No decision made yet.

### Build Target (Proposed)

```bash
npm run build:ext:enterprise -- --base-url https://transcriber.corp.example.com
```

Or:

```bash
ENTERPRISE_BASE_URL=https://transcriber.corp.example.com npm run build:ext:enterprise
```

Output: `extension/dist-enterprise/` with:
- `manifest.json` → `name: "Transcriber (Enterprise)"`, `host_permissions: ["https://transcriber.corp.example.com/*"]`
- `send-url-enterprise.js` → `ENTERPRISE_SEND_ENDPOINT` set to org URL
- No `nativeMessaging` permission
- No `local-auth-headers.js` or native host logic

---

## Packaging Matrix

| Aspect | LOCAL | ENTERPRISE |
|--------|-------|------------|
| **Chrome extension ID** | One (public CWS) | Different (unlisted CWS or MDM) |
| **Manifest name** | "Transcriber for YouTube" | "Transcriber (Enterprise)" |
| **Destination** | `http://127.0.0.1:19720` | `https://transcriber.corp.example.com` |
| **Host permissions** | `http://127.0.0.1:19720/*` | Org domain or `https://*/*` |
| **Auth** | Native host Bearer token | Org SSO / OAuth / policy-managed key |
| **`nativeMessaging` permission** | Yes | No |
| **`identity` permission** | No | Yes (if using OAuth) |
| **Settings panel** | None | None or minimal (pre-configured) |
| **Distribution** | Public CWS listing | MDM force-install or private CWS |
| **Can point at remote host?** | No | No (baked at build time) |

---

## Implementation Checklist (Out of Scope for YTT-447)

This doc is **design only**. Implementation tracked separately. When building ENTERPRISE:

- [ ] Add `build:ext:enterprise` npm script
- [ ] Create `extension/build-enterprise.js` or extend `extension/build.js` with target flag
- [ ] Template `manifest.json` → `name`, `host_permissions`, `permissions` vary by target
- [ ] Create `send-url-enterprise.js` or make `send-url.js` accept endpoint override at build time
- [ ] Remove native host logic from ENTERPRISE build
- [ ] Add OAuth or policy-based auth (implementation TBD based on org requirements)
- [ ] Update `.github/workflows/` (if CI exists) to produce both artifacts
- [ ] Document MDM policy JSON for force-install (example for IT admins)
- [ ] Register second Chrome Web Store listing or document private CWS workflow
- [ ] Update [README.md](../README.md) Chrome Extension section with LOCAL vs ENTERPRISE split

**Do not implement dual-mode in the public listing.** Keep them as separate artifacts.

---

## Release / CI Expectations

When ENTERPRISE is built:

1. **Produce two artifacts:**
   - `extension-local.zip` (or `extension-local-v1.6.28.zip`)
   - `extension-enterprise.zip` (or `extension-enterprise-v1.6.28.zip`)

2. **Tag releases clearly:**
   - GitHub release notes: "This release includes LOCAL (public CWS) and ENTERPRISE (unlisted CWS / MDM) builds."
   - Attach both `.zip` files

3. **CI verification:**
   - `npm run test:extension` must pass for both targets
   - Smoke test checklist ([Transcriber-thin-ext-smoke.md](./Transcriber-thin-ext-smoke.md)) adapted for ENTERPRISE (manual for now)

4. **Documentation:**
   - README installation steps split: "Install LOCAL (self-hosted)" vs "ENTERPRISE (ask your IT admin)"
   - Separate setup guides if auth models differ significantly

---

## Current Build System

`extension/build.js` uses a simple copy approach:

```javascript
const COPY_FILES = [
  "manifest.json",
  "local-auth-headers.js",
  "send-url.js",
  "background.js",
  "popup.html",
  "popup.js",
  "popup.css",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
];
```

No templating. To support ENTERPRISE:

**Option A: Two static manifests**
- `manifest.local.json` + `manifest.enterprise.json`
- Build script picks one, renames to `manifest.json` in `dist/`

**Option B: Template manifest at build time**
- `manifest.template.json` with placeholders
- Build script replaces `{{NAME}}`, `{{HOST_PERMISSIONS}}`, etc.

**Option C: Programmatic manifest generation**
- `build.js` constructs manifest object, serializes to JSON

Recommend **Option A** (two static manifests) for clarity and diff-ability. Templating is overkill for two targets.

**Example structure (if implementing):**

```
extension/
├── manifests/
│   ├── local.json
│   └── enterprise.json
├── build.js
├── build-enterprise.js  (or build.js --target enterprise)
├── send-url.js          (or split into send-url-local.js + send-url-enterprise.js)
└── dist/                (LOCAL output)
└── dist-enterprise/     (ENTERPRISE output)
```

---

## Security Notes

- **LOCAL:** Secrets stay in native host only. No `chrome.storage`. Token never in URLs.
- **ENTERPRISE:** Org auth token/cookie handling TBD. If using managed storage policy, validate that policy cannot be user-edited (requires ExtensionSettings force-install).
- Both builds: `content_security_policy` must enforce `connect-src` matching only the target host (no wildcards).

---

## References

- [Transcriber-thin-ext-smoke.md](./Transcriber-thin-ext-smoke.md) — smoke test checklist for LOCAL build
- [TESTING.md](./TESTING.md) — test protocol including `npm run test:extension`
- [YTT-447 Linear issue](https://linear.app/jaybee/issue/YTT-447) — original packaging requirement
- YTT-442 / YTT-446 / YTT-448 — LOCAL one-tap send implementation (shipped)

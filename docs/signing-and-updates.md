# Developer ID signing, notarization, and updates

James pastes the secrets himself. This file is the runbook, not a request to commit certificates.

Unsigned / ad-hoc CI is unchanged: the `build` job still produces an ad-hoc-signed DMG with `Install Transcriber.command` and `.payload/Transcriber.app`, artifact name `Transcriber-macOS-arm64`. It never sees Apple secrets.

Signing, notarization, and the drag-to-Applications DMG run in a **separate** `sign` job on a fresh runner. Publishing runs in a **separate** `release` job. Both jobs use the GitHub Environment named `release`.

## Why an Environment (not repo secrets)

Fork pull requests do **not** receive repository secrets. **Same-repo** pull requests **do**. A `pull_request` run executes the PR's own workflow and `scripts/macos-*.sh` after `npm ci`, so a malicious same-repo PR can read `$RUNNER_TEMP` from a package lifecycle script and can upload a Developer ID-signed artifact of unreviewed code.

That is why every Apple secret lives on the Environment `release`, **not** as repository secrets:

- The `sign` and `release` jobs set `environment: release` and `if: github.event_name != 'pull_request'`.
- The `sign` job does **not** run `npm ci` or any `package.json` lifecycle script. It downloads the unsigned app artifact and the signing scripts from the triggering ref (the Environment protection rules gate that ref).
- PR runs never receive the secrets and never produce a signed artifact.

## James: create Environment `release` (one-time)

Do this in GitHub **before** the first signed build. Add the secrets as **Environment secrets** on `release`. Do **not** add them as repository secrets. If they already exist as repo secrets, delete those copies after the Environment ones are in place.

1. Open `https://github.com/lifesized/youtube-transcriber/settings/environments`.
2. **New environment**. Name it exactly `release`.
3. **Required reviewers:** add yourself (James). Leave the reviewer count at 1.
4. **Deployment branches and tags:** restrict to:
   - Branch: `beta/electron-menubar` (needed for `workflow_dispatch` from that branch).
   - Tag pattern: `v*-beta.*` (example: `v0.2.0-beta.1`).
5. **Environment secrets** — **Add secret** for each name below. Same values you would have put on the repo.

| Secret | What it is |
|---|---|
| `MACOS_CERT_P12_BASE64` | Base64 of a Developer ID Application `.p12` |
| `MACOS_CERT_PASSWORD` | Password for that `.p12` |
| `APPLE_TEAM_ID` | 10-character Team ID |
| `APPLE_API_KEY_ID` | App Store Connect API key id (preferred notarization) |
| `APPLE_API_ISSUER_ID` | Issuer UUID for that key |
| `APPLE_API_KEY_P8_BASE64` | Base64 of `AuthKey_<KEY_ID>.p8` |
| `APPLE_ID` | Apple ID email (fallback notarization only) |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password (fallback notarization only) |

Do not add a PAT. The release job uses the built-in `GITHUB_TOKEN` with `contents: write`.

## James: tag ruleset for `v*-beta.*` (one-time)

Restrict who can create release tags so a random collaborator cannot fire the Environment:

1. Open `https://github.com/lifesized/youtube-transcriber/settings/rules`.
2. **New ruleset** → **Tag**.
3. Name it `beta release tags`.
4. Enforcement: **Active**.
5. Target tags: include pattern `v*-beta.*`.
6. Bypass: only James (or the repo admin role you want).
7. Rules: **Restrict creations**, **Restrict updates**, **Restrict deletions**. Creator: James only.

## Job graph

```
pull_request → build (unsigned only) + unsigned-path-contract
               no Environment, no Apple secrets, no signed artifact

push to beta/electron-menubar
  or tag v*-beta.*
  or workflow_dispatch on beta/electron-menubar
               → build (unsigned DMG + unsigned .app + fuses helper)
               → sign  [environment: release]  (fresh runner, no npm ci)
               → release [environment: release]  (draft GitHub prerelease, only
                  when notarized and the ref/tag gates pass)
```

## Create the Developer ID certificate

1. On the Mac that will hold the private key, open Keychain Access → **Certificate Assistant › Request a Certificate From a Certificate Authority**.
2. Enter James's Apple ID email, choose **Saved to disk**, and save the CSR.
3. In [Apple Developer › Certificates](https://developer.apple.com/account/resources/certificates/list), create a **Developer ID Application** certificate (not Apple Development, not Developer ID Installer, not Mac App Store). Upload the CSR.
4. Download the `.cer`, double-click to import it into the **login** keychain so it sits next to the private key.
5. In Keychain Access, select the **Developer ID Application: … (TEAMID)** certificate, **Export…**, choose **Personal Information Exchange (.p12)**, and set a long password. That password is `MACOS_CERT_PASSWORD`.

Base64 (no line wraps; this is the secret value):

```bash
base64 -i DeveloperID.p12 | pbcopy
```

On Linux CI-style encoding: `base64 -w0 DeveloperID.p12`.

## Create the App Store Connect API key (preferred notarization)

1. [App Store Connect › Users and Access › Integrations › Team Keys](https://appstoreconnect.apple.com/access/integrations/api).
2. Generate a key with at least the **Developer** role (enough for `notarytool`).
3. Note **Key ID** (`APPLE_API_KEY_ID`) and **Issuer ID** (`APPLE_API_ISSUER_ID`).
4. Download `AuthKey_<KEY_ID>.p8` once. Base64 it:

```bash
base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy
```

The `.p8` is shown only at download time. If it is lost, revoke and make a new key.

## Fallback notarization (Apple ID)

Only needed if the API key set is missing. Create an [app-specific password](https://appleid.apple.com) named something like `Transcriber notarytool`. Store it as `APPLE_APP_SPECIFIC_PASSWORD` with `APPLE_ID`. Still set `APPLE_TEAM_ID`.

## Version and tag scheme

Use a semver **prerelease** so a non-app GitHub Release in this repo cannot stall electron-updater:

- `package.json` `version`: `0.2.0-beta.1` (pattern `X.Y.Z-beta.N`)
- Git tag: `v0.2.0-beta.1` (always `v` + the exact `package.json` version)
- electron-updater `channel`: `beta` (`allowPrerelease` is true)

The workflow tag filter is `v*-beta.*`. The release job refuses to publish unless `v${package.json.version}` equals the tag (tag events) or the version matches `X.Y.Z-beta.N` (`workflow_dispatch`).

## Tag / release procedure

1. Bump `package.json` `version` to the next `X.Y.Z-beta.N`.
2. Push that commit to `beta/electron-menubar`.
3. Tag `v<same-version>` (example: version `0.2.0-beta.1` → `v0.2.0-beta.1`) and push the tag. Only James should be able to create that tag (ruleset above).
4. Approve the Environment `release` deployments when GitHub asks.
5. The `release` job creates a **draft** GitHub prerelease targeted at `$GITHUB_SHA`. James publishes it manually from the GitHub Releases UI when he is ready. Draft releases are not picked up by electron-updater.
6. `workflow_dispatch` is allowed only on `beta/electron-menubar`. Check **Publish a GitHub prerelease** only when you intend to open a draft. The job still requires `$GITHUB_SHA` to be an ancestor of `origin/beta/electron-menubar` and the version to be `X.Y.Z-beta.N`.

Do **not** expect a GitHub Release on every push to `beta/electron-menubar`.

## Local unsigned build (unchanged)

```bash
npm run electron:build
```

That still ad-hoc signs and runs `electron/dmg/finalize-dmg.sh` (helper + `.payload/`). It never reads Apple secrets from the environment for Developer ID signing.

## Entitlements

Signed builds use `electron/entitlements.mac.sign.plist`: `allow-jit` plus `allow-unsigned-executable-memory`. There is no `disable-library-validation`. On the first Developer ID run, try `allow-jit` alone — we could not prove the unsigned-executable-memory entitlement is required without a cert. If ELECTRON_RUN_AS_NODE (Next server + native-host wrapper) and better-sqlite3 still start, drop it.

## Runtime updater gate

The packaged app initializes `electron-updater` only when all of these hold:

- `app.isPackaged` is true (not `electron:dev`)
- `/usr/bin/codesign --verify --strict` succeeds, then Team ID is read
- The running binary is **Developer ID Application** signed
- `TeamIdentifier` matches `APPLE_TEAM_ID` written into `Contents/Resources/signing-identity.json` at signed-build time
- That JSON is absent on ad-hoc builds, so those builds never load the updater
- If `electron-updater` fails to load, the tray still starts (`reason: load-failed`)

Feed is pinned to `lifesized/youtube-transcriber` on GitHub. There is no env or Settings override. `allowDowngrade` is false. Channel is `beta`. macOS signature validation (Squirrel.Mac designated requirement) is left enabled.

When the updater is enabled it checks `releases.atom` and `latest-mac.yml` on GitHub Releases for this repo 30 seconds after launch and then every 6 hours. A found update zip downloads automatically; installing it needs a click on **Restart to Update**. Documented in `extension/privacy-policy.md`. Disabled builds make no GitHub calls.

## Native host after a signed install

Drag-to-Applications lands at `/Applications/Transcriber.app`. That is already the app host Start fallback and the helper's destination. Pairing still writes `com.transcribed.app.host` manifests. A packaged launch rewrites the wrapper only when the app is running from `/Applications` or from the already-recorded install path — never from `~/Downloads`, `/Volumes`, or App Translocation.

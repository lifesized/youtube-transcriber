# Developer ID signing, notarization, and updates

James pastes the secrets himself. This file is the runbook, not a request to commit certificates.

Unsigned / ad-hoc CI is unchanged: the `build` job still produces an ad-hoc-signed DMG with `Install Transcriber.command` and `.payload/Transcriber.app`, artifact name `Transcriber-macOS-arm64`. Signing, notarization, the drag-to-Applications DMG, and GitHub Releases publishing run only when the secrets below are present and complete.

## Where to add repo secrets

GitHub → `lifesized/youtube-transcriber` → **Settings › Secrets and variables › Actions › New repository secret**.

Use these names exactly:

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

Fork pull requests do not receive these secrets. Those runs skip signing and look like today's ad-hoc job.

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

## What each secret gates

| Gate | Secrets that must be non-empty | What runs |
|---|---|---|
| Sign | `MACOS_CERT_P12_BASE64` (plus `MACOS_CERT_PASSWORD` and `APPLE_TEAM_ID` to actually pick the identity) | Temporary keychain, inside-out Developer ID sign, hardened runtime |
| Notarize | Sign ran, **and** either the API key triple **or** `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` | `notarytool submit --wait` on the app zip, staple app, sign/notarize/staple DMG |
| Release | Notarize succeeded, **and** a `beta-v*` tag (or `workflow_dispatch` with publish checked) | GitHub prerelease: signed DMG, zip, blockmap, `latest-mac.yml`, `SHA256SUMS` |

The unsigned job steps and `Transcriber-macOS-arm64` upload do not read these secrets.

## Tag / release procedure

1. Bump `package.json` `version` to the version users should see (this becomes `CFBundleShortVersionString` and `latest-mac.yml`).
2. Push that commit to `beta/electron-menubar`.
3. Tag `beta-v<same-version>` (example: version `0.2.0` → `beta-v0.2.0`) and push the tag.
4. The macOS workflow builds the ad-hoc DMG as today, then (secrets present) signs, notarizes, and the `release` job publishes a **prerelease** with `GITHUB_TOKEN`.
5. Do **not** expect a GitHub Release on every push to `beta/electron-menubar`.

`workflow_dispatch` has a boolean input `publish_github_release` (default false). Turn it on only when the run is signed and notarized and you intend to publish.

## Local unsigned build (unchanged)

```bash
npm run electron:build
```

That still ad-hoc signs and runs `electron/dmg/finalize-dmg.sh` (helper + `.payload/`). It never reads Apple secrets from the environment for Developer ID signing.

## Runtime updater gate

The packaged app initializes `electron-updater` only when all of these hold:

- `app.isPackaged` is true (not `electron:dev`)
- The running binary is **Developer ID Application** signed
- `TeamIdentifier` matches `APPLE_TEAM_ID` written into `Contents/Resources/signing-identity.json` at signed-build time
- That JSON is absent on ad-hoc builds, so those builds never load the updater

Feed is pinned to `lifesized/youtube-transcriber` on GitHub. There is no env or Settings override. `allowDowngrade` is false. macOS signature validation (Squirrel.Mac designated requirement) is left enabled.

One network call when the updater is enabled: GitHub Releases for this repo. Documented in `extension/privacy-policy.md`. Disabled builds make none.

## Native host after a signed install

Drag-to-Applications lands at `/Applications/Transcriber.app`. That is already the app host Start fallback and the helper's destination. Pairing still writes `com.transcribed.app.host` manifests; a packaged launch with existing extension IDs rewrites the wrapper so `process.execPath` matches the installed bundle.

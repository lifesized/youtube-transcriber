# Google Drive import rejected as a non-extension caller

Tracked in [YTT-429](https://linear.app/jaybee/issue/YTT-429/configure-trusted-extension-ids-for-self-hosted-google-drive-imports), related to the broader Drive implementation [YTT-370](https://linear.app/jaybee/issue/YTT-370/allow-extension-to-transcribe-google-drive-mp4s-and-generic-video).

## Symptom

The panel and recent history load, but starting a private Drive transcription
returns:

> Drive imports must start from the local Transcriber extension.

This is separate from delayed side-panel activation. The failure occurs after
the application is running, in `POST /api/drive/import`.

## Verified cause on September 19, 2026

The route deliberately accepts JSON requests only from explicitly trusted
`chrome-extension://<id>` origins. `lib/google-drive.ts` builds that allowlist
from `GOOGLE_DRIVE_EXTENSION_IDS`.

The active unpacked build on the affected machine has stable ID:

```text
cgfccfdhafcgllaleiifkofapmgcmedo
```

The running checkout's `.env` did not define `GOOGLE_DRIVE_EXTENSION_IDS`, so
the allowlist was empty and the legitimate extension failed closed with HTTP
403. The request originated in `extension/google-drive-import.js` as intended;
the active Drive URL and Google account did not cause this rejection.

## Immediate local recovery

Open `chrome://extensions`, enable Developer mode, and copy the ID shown on the
active Transcriber card. Add that installed ID to `.env`:

```env
GOOGLE_DRIVE_EXTENSION_IDS="<installed-transcriber-extension-id>"
```

On the affected machine the value was
`cgfccfdhafcgllaleiifkofapmgcmedo`. Development builds derive a stable ID from a
machine-local keypair, so another machine can have a different value. Then
restart the local Transcriber server and retry from the same Drive file tab. If
Store and unpacked builds are intentionally supported together, provide their
IDs as a comma-separated list. Never accept a missing Origin or arbitrary
localhost caller as a workaround.

## Durable fixes

1. Make local setup and native-host installation reconcile the installed stable
   ID into `GOOGLE_DRIVE_EXTENSION_IDS`.
2. Extend `test:setup` and `/api/health` with a Drive-origin readiness check.
3. When the allowlist is empty, return setup-specific guidance rather than the
   generic untrusted-caller message.
4. Preserve exact origin matching and regression-test empty, matching,
   mismatched, and multiple-ID configurations.
5. Keep OAuth and file-access validation independent of this caller check; a
   trusted extension origin does not itself authorize a Drive file.

## Evidence boundary

- Verified: the environment variable was absent; the trusted-origin helper uses
  it; an empty list rejects every extension origin.
- Verified: the local service was otherwise healthy and exposed 1,088 stored
  transcripts during the startup investigation.
- Not yet verified: a complete private-file OAuth, download, transcription, and
  cleanup run after adding the ID. Do not mark YTT-429 complete until that flow
  passes in an existing authorized Chrome profile.

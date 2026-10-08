#!/bin/bash
# Notarize and staple the signed Transcriber.app, then the signed DMG.
# Prefers an App Store Connect API key; falls back to Apple ID.
# On failure, prints `notarytool log` (no secrets).
#
#   macos-notarize.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-app}"
TARGET="${2:-}"
STATE_DIR="${RUNNER_TEMP:?RUNNER_TEMP is required}/transcriber-signing"
P8_PATH="$STATE_DIR/AuthKey.p8"
WORK="$STATE_DIR/notary"
mkdir -p "$WORK"
chmod 700 "$STATE_DIR"

APP="${TARGET:-$ROOT/dist-electron/signed/Transcriber.app}"
DMG="${TARGET:-$ROOT/dist-electron/signed/Transcriber-signed.dmg}"

if [ "$MODE" != "app" ] && [ "$MODE" != "dmg" ]; then
  echo "usage: $0 app [Transcriber.app] | dmg [Transcriber.dmg]" >&2
  exit 2
fi

have_api_key() {
  [ -n "${APPLE_API_KEY_ID:-}" ] &&
    [ -n "${APPLE_API_ISSUER_ID:-}" ] &&
    [ -n "${APPLE_API_KEY_P8_BASE64:-}" ]
}

have_apple_id() {
  [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]
}

NOTARY_ARGS=()
prepare_notary_auth() {
  if have_api_key; then
    umask 077
    printf '%s' "$APPLE_API_KEY_P8_BASE64" | base64 --decode > "$P8_PATH"
    chmod 600 "$P8_PATH"
    NOTARY_ARGS=(--key "$P8_PATH" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER_ID")
    return
  fi
  if have_apple_id; then
    [ -n "${APPLE_TEAM_ID:-}" ] || { echo "notary: APPLE_TEAM_ID required for Apple ID auth"; exit 1; }
    NOTARY_ARGS=(--apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID")
    return
  fi
  echo "notary: neither API key nor Apple ID credentials are complete"
  exit 1
}

submit() {
  local file="$1"
  local name
  name="$(basename "$file")"
  echo "notary: submit $name"
  # Capture submission id without printing the auth flags.
  local out rc
  prepare_notary_auth
  set +e
  out="$(xcrun notarytool submit "$file" --wait --output-format json "${NOTARY_ARGS[@]}" 2>"$WORK/submit.err")"
  rc=$?
  set -e
  if [ -s "$WORK/submit.err" ]; then
    # notarytool may mention --key paths; that is not a secret.
    cat "$WORK/submit.err"
  fi
  local parsed
  parsed="$(printf '%s\n' "$out" | python3 -c '
import json, sys
raw = sys.stdin.read().strip()
if not raw:
    print("status=")
    print("id=")
    sys.exit(0)
try:
    data = json.loads(raw)
except json.JSONDecodeError:
    print(raw, file=sys.stderr)
    print("status=")
    print("id=")
    sys.exit(0)
print("id:", data.get("id", ""), file=sys.stderr)
print("status:", data.get("status", ""), file=sys.stderr)
print("message:", data.get("message", ""), file=sys.stderr)
print("status=" + str(data.get("status") or ""))
print("id=" + str(data.get("id") or ""))
')"
  local status="" sid=""
  while IFS= read -r line; do
    case "$line" in
      status=*) status="${line#status=}" ;;
      id=*) sid="${line#id=}" ;;
    esac
  done <<< "$parsed"
  if [ "$rc" -ne 0 ] || [ "$status" != "Accepted" ]; then
    echo "notary: submit failed for $name (status=${status:-unknown} rc=$rc)"
    if [ -n "$sid" ]; then
      echo "notary: log for $sid"
      prepare_notary_auth
      set +e
      xcrun notarytool log "$sid" "${NOTARY_ARGS[@]}" || true
      set -e
    fi
    exit 1
  fi
}

if [ "$MODE" = "app" ]; then
  [ -d "$APP" ] || { echo "notary: missing $APP"; exit 1; }
  echo "notary: zipping app with ditto"
  APP_ZIP="$WORK/Transcriber.zip"
  rm -f "$APP_ZIP"
  ditto -c -k --keepParent "$APP" "$APP_ZIP"
  submit "$APP_ZIP"
  echo "notary: staple app"
  xcrun stapler staple "$APP"
  xcrun stapler validate "$APP"
  echo "notary: codesign --verify after staple"
  codesign --verify --deep --strict "$APP"
  echo "notary: spctl exec"
  spctl -a -vvv -t exec "$APP"
  echo "app-notarized" > "$STATE_DIR/app-notarized"
else
  [ -f "$DMG" ] || { echo "notary: missing $DMG"; exit 1; }
  echo "notary: submit DMG"
  submit "$DMG"
  echo "notary: staple DMG"
  xcrun stapler staple "$DMG"
  xcrun stapler validate "$DMG"
  echo "notary: spctl open (primary-signature)"
  spctl -a -t open --context context:primary-signature -vv "$DMG"
  echo "notarized" > "$STATE_DIR/notarized"
fi

echo "notary: done ($MODE)"

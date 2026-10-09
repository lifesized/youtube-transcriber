#!/bin/bash
# Temporary keychain for Developer ID signing. Never echo a secret.
# Decoded .p12 / .p8 live in $RUNNER_TEMP with mode 600.
#
#   macos-signing-keychain.sh setup|unlock|lock|teardown
#
# setup is a no-op when MACOS_CERT_P12_BASE64 is empty (fork PRs, unsigned CI).
set -euo pipefail

STATE_DIR="${RUNNER_TEMP:?RUNNER_TEMP is required}/transcriber-signing"
KEYCHAIN_PATH="$STATE_DIR/signing.keychain-db"
CERT_PATH="$STATE_DIR/developer-id.p12"
P8_PATH="$STATE_DIR/AuthKey.p8"
PASSWORD_PATH="$STATE_DIR/keychain.password"
IDENTITY_PATH="$STATE_DIR/identity.txt"
STATUS_PATH="$STATE_DIR/status"

setup() {
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  echo "skipped" > "$STATUS_PATH"

  if [ -z "${MACOS_CERT_P12_BASE64:-}" ]; then
    echo "signing: certificate secret is empty; skip keychain setup"
    return 0
  fi
  if [ -z "${MACOS_CERT_PASSWORD:-}" ] || [ -z "${APPLE_TEAM_ID:-}" ]; then
    echo "signing: MACOS_CERT_P12_BASE64 is set but MACOS_CERT_PASSWORD or APPLE_TEAM_ID is empty"
    exit 1
  fi

  umask 077
  KEYCHAIN_PASSWORD="$(openssl rand -base64 32)"
  printf '%s' "$KEYCHAIN_PASSWORD" > "$PASSWORD_PATH"
  chmod 600 "$PASSWORD_PATH"

  printf '%s' "$MACOS_CERT_P12_BASE64" | base64 --decode > "$CERT_PATH"
  chmod 600 "$CERT_PATH"

  security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
  # 3600s backstop: notarytool --wait can exceed 15 minutes before DMG codesign.
  security set-keychain-settings -lut 3600 "$KEYCHAIN_PATH"
  security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

  security import "$CERT_PATH" \
    -P "$MACOS_CERT_PASSWORD" \
    -x \
    -t cert -f pkcs12 \
    -k "$KEYCHAIN_PATH" \
    -T /usr/bin/codesign
  rm -f "$CERT_PATH"

  security set-key-partition-list -S apple-tool:,apple: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

  # Keep the login keychain on the search list so system roots still resolve.
  EXISTING="$(security list-keychain -d user | tr -d '"')"
  # shellcheck disable=SC2086
  security list-keychain -d user -s "$KEYCHAIN_PATH" $EXISTING

  IDENTITIES="$(security find-identity -v -p codesigning "$KEYCHAIN_PATH")"
  echo "signing: codesigning identities in temporary keychain:"
  echo "$IDENTITIES" | grep -E 'Developer ID Application|valid identities' || true

  IDENTITY="$(printf '%s\n' "$IDENTITIES" | awk -v team="$APPLE_TEAM_ID" '
    /Developer ID Application/ && index($0, team) {
      if (match($0, /"[^"]+"/)) {
        print substr($0, RSTART + 1, RLENGTH - 2)
        exit
      }
    }
  ')"
  if [ -z "$IDENTITY" ]; then
    echo "signing: no Developer ID Application identity matching team ${APPLE_TEAM_ID}"
    exit 1
  fi
  printf '%s' "$IDENTITY" > "$IDENTITY_PATH"
  chmod 600 "$IDENTITY_PATH"
  echo "ready" > "$STATUS_PATH"
  echo "signing: using Developer ID Application identity for team ${APPLE_TEAM_ID}"
}

unlock() {
  if [ ! -f "$KEYCHAIN_PATH" ]; then
    echo "signing: no keychain to unlock"
    exit 1
  fi
  [ -f "$PASSWORD_PATH" ] || { echo "signing: keychain.password missing; run setup first"; exit 1; }
  KEYCHAIN_PASSWORD="$(cat "$PASSWORD_PATH")"
  security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
  rm -f "$PASSWORD_PATH"
  echo "signing: keychain unlocked"
}

lock() {
  if [ -f "$KEYCHAIN_PATH" ]; then
    security lock-keychain "$KEYCHAIN_PATH" || true
    echo "signing: keychain locked"
  fi
}

teardown() {
  if [ -f "$KEYCHAIN_PATH" ]; then
    security delete-keychain "$KEYCHAIN_PATH" || true
  fi
  rm -rf "$STATE_DIR"
  echo "signing: keychain and decoded files removed"
}

case "${1:-}" in
  setup) setup ;;
  unlock) unlock ;;
  lock) lock ;;
  teardown) teardown ;;
  *) echo "usage: $0 setup|unlock|lock|teardown" >&2; exit 2 ;;
esac

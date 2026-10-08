#!/bin/bash
# Install Transcriber — copies the app from this disk image to Applications,
# clears the Gatekeeper quarantine flag, and opens it. No sudo unless
# /Applications is not writable.
set -euo pipefail

DEST="${TRANSCRIBER_INSTALL_DEST:-/Applications/Transcriber.app}"
QUIT_WAIT_SECS="${TRANSCRIBER_QUIT_WAIT_SECS:-20}"
NONINTERACTIVE="${TRANSCRIBER_INSTALL_NONINTERACTIVE:-}"
SKIP_OPEN="${TRANSCRIBER_INSTALL_SKIP_OPEN:-}"
BUNDLE_ID="com.transcribed.app"

say() { printf '%s\n' "$*"; }
blank() { printf '\n'; }

resolve_script_dir() {
  local script_path="$0"
  case "$script_path" in
    /*) ;;
    *) script_path="$PWD/$script_path" ;;
  esac
  (cd "$(dirname "$script_path")" && pwd)
}

assert_transcriber_app_name() {
  local p="$1" label="$2"
  if [ "$(basename "$p")" != "Transcriber.app" ]; then
    say "Refusing: $label must be named Transcriber.app (got $(basename "$p"))."
    exit 1
  fi
}

read_bundle_id() {
  local plist="$1/Contents/Info.plist"
  if [ ! -f "$plist" ]; then
    return 1
  fi
  python3 - "$plist" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
m = re.search(r"<key>CFBundleIdentifier</key>\s*<string>([^<]+)</string>", text)
print(m.group(1) if m else "")
PY
}

assert_dest_is_ours() {
  local dest="$1"
  if [ ! -e "$dest" ]; then
    return 0
  fi
  local id
  id="$(read_bundle_id "$dest" || true)"
  if [ "$id" != "$BUNDLE_ID" ]; then
    say "Refusing to replace $dest (CFBundleIdentifier is '${id:-unknown}', expected $BUNDLE_ID)."
    exit 1
  fi
}

quit_running() {
  local exe="$DEST/Contents/MacOS/Transcriber"
  if command -v osascript >/dev/null 2>&1; then
    osascript -e 'tell application "Transcriber" to quit' >/dev/null 2>&1 || true
  fi
  local i=0
  while [ -x "$exe" ] && python3 - "$exe" <<'PY'
import os, sys
exe = sys.argv[1]
try:
    out = os.popen("ps -ax -o pid=,command=").read()
except Exception:
    sys.exit(1)
for line in out.splitlines():
    line = line.strip()
    if not line:
        continue
    pid_s, _, cmd = line.partition(" ")
    try:
        pid = int(pid_s)
    except ValueError:
        continue
    if pid == os.getpid():
        continue
    parts = cmd.replace("'", " ").replace('"', " ").split()
    if exe in parts:
        sys.exit(0)
sys.exit(1)
PY
  do
    if [ "$i" -ge "$QUIT_WAIT_SECS" ]; then
      python3 - "$exe" <<'PY' || true
import os, signal, sys
exe = sys.argv[1]
out = os.popen("ps -ax -o pid=,command=").read()
for line in out.splitlines():
    line = line.strip()
    if not line:
        continue
    pid_s, _, cmd = line.partition(" ")
    try:
        pid = int(pid_s)
    except ValueError:
        continue
    if pid == os.getpid():
        continue
    parts = cmd.replace("'", " ").replace('"', " ").split()
    if exe in parts:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
PY
      sleep 1
      break
    fi
    sleep 1
    i=$((i + 1))
  done
}

copy_app() {
  local src="$1" dest="$2"
  local parent
  assert_dest_is_ours "$dest"
  parent="$(dirname "$dest")"
  mkdir -p "$parent"
  rm -rf "$dest"
  if command -v ditto >/dev/null 2>&1; then
    ditto "$src" "$dest"
  else
    cp -R "$src" "$dest"
  fi
}

copy_app_maybe_sudo() {
  local src="$1" dest="$2"
  if copy_app "$src" "$dest"; then
    return 0
  fi
  say "Need permission to write to Applications. macOS will ask for your password."
  assert_dest_is_ours "$dest"
  if command -v ditto >/dev/null 2>&1; then
    sudo mkdir -p "$(dirname "$dest")"
    sudo rm -rf "$dest"
    sudo ditto "$src" "$dest"
  else
    sudo mkdir -p "$(dirname "$dest")"
    sudo rm -rf "$dest"
    sudo cp -R "$src" "$dest"
  fi
}

clear_quarantine() {
  local dest="$1"
  if ! command -v xattr >/dev/null 2>&1; then
    say "Skipping quarantine clear (xattr not found)."
    return 0
  fi
  if xattr -dr com.apple.quarantine "$dest" >/dev/null 2>&1; then
    return 0
  fi
  say "Need permission to clear the download flag. macOS will ask for your password."
  sudo xattr -dr com.apple.quarantine "$dest"
}

open_app() {
  local dest="$1"
  if [ -n "$SKIP_OPEN" ]; then
    return 0
  fi
  if command -v open >/dev/null 2>&1; then
    open "$dest"
  fi
}

main() {
  say "Installing Transcriber"
  blank
  say "This helper will:"
  say "  1. Quit Transcriber if it is already running"
  say "  2. Copy Transcriber.app to Applications (replacing an older copy)"
  say "  3. Clear the macOS 'downloaded from the internet' quarantine flag"
  say "  4. Open Transcriber"
  blank
  say "Only run this from the DMG James sent; it turns off macOS's download check for this app."
  say "If macOS blocked this helper, that is expected once for an unsigned"
  say "build. Open System Settings → Privacy & Security → Open Anyway. Then rerun it."
  blank

  local script_dir src
  script_dir="$(resolve_script_dir)"
  src="${TRANSCRIBER_INSTALL_SRC:-$script_dir/Transcriber.app}"
  assert_transcriber_app_name "$src" "source"
  assert_transcriber_app_name "$DEST" "destination"

  if [ ! -d "$src" ]; then
    say "Could not find Transcriber.app next to this installer."
    say "Looked in: $src"
    say "Open the Transcriber disk image and run this helper from there."
    exit 1
  fi

  say "Found Transcriber.app"
  say "Quitting any running Transcriber…"
  quit_running
  say "Copying to $DEST …"
  copy_app_maybe_sudo "$src" "$DEST"
  say "Clearing quarantine…"
  clear_quarantine "$DEST"
  say "Opening Transcriber…"
  open_app "$DEST"
  blank
  say "Done. Transcriber should appear in the menu bar (top right)."
  say "You can eject the disk image and delete the downloaded DMG."
  blank

  if [ -z "$NONINTERACTIVE" ]; then
    read -r -p "Press Return to close this window. " _ || true
  fi
}

main "$@"

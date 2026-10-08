#!/bin/bash
# Install Transcriber — copies the app from this disk image to Applications,
# clears the Gatekeeper quarantine flag, and opens it. No sudo unless
# /Applications is not writable.
set -euo pipefail

DEST="${TRANSCRIBER_INSTALL_DEST:-/Applications/Transcriber.app}"
QUIT_WAIT_SECS="${TRANSCRIBER_QUIT_WAIT_SECS:-20}"
NONINTERACTIVE="${TRANSCRIBER_INSTALL_NONINTERACTIVE:-}"
SKIP_OPEN="${TRANSCRIBER_INSTALL_SKIP_OPEN:-}"

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

quit_running() {
  if command -v osascript >/dev/null 2>&1; then
    osascript -e 'tell application "Transcriber" to quit' >/dev/null 2>&1 || true
  fi
  local i=0
  while command -v pgrep >/dev/null 2>&1 && pgrep -x Transcriber >/dev/null 2>&1; do
    if [ "$i" -ge "$QUIT_WAIT_SECS" ]; then
      if command -v killall >/dev/null 2>&1; then
        killall Transcriber >/dev/null 2>&1 || true
      fi
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
  say "If macOS blocked this helper, that is expected once for an unsigned"
  say "build. Right-click Install Transcriber.command and choose Open, or"
  say "use System Settings → Privacy & Security → Open Anyway. Then rerun it."
  blank

  local script_dir src
  script_dir="$(resolve_script_dir)"
  src="${TRANSCRIBER_INSTALL_SRC:-$script_dir/Transcriber.app}"

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

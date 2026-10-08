#!/bin/bash
# Best-effort screenshot of the real tray menu on a CI Mac, for Design review.
# Never fails the job.
#
#   scripts/screenshot-tray-menu.sh <Transcriber.app> <out.png> [port]
#
# A manual launch pops the tray menu once the server is up. The app skips
# that pop while GITHUB_ACTIONS is set, so launch without it, capture, then
# SIGKILL (SIGTERM is ignored while the menu is open).

set -u
app="$1"
out="$2"
exe="$app/Contents/MacOS/Transcriber"
port="${3:-19721}"
home="$(mktemp -d /tmp/transcriber-tray-XXXXXX)"
log="$home/main.log"
mkdir -p "$(dirname "$out")"

free_port() {
  local pids
  for _ in 1 2 3 4 5; do
    pids=$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)
    [ -z "$pids" ] && return 0
    kill -9 $pids 2>/dev/null || true
    sleep 1
  done
}

free_port
HOME="$home" TRANSCRIBER_LOCAL_TOKEN="$(openssl rand -hex 32)" \
  env -u GITHUB_ACTIONS "$exe" >"$log" 2>&1 &
pid=$!

bounds=""
for _ in $(seq 1 90); do
  bounds=$(sed -n 's/.*tray reveal bounds: \(-*[0-9]*,-*[0-9]*,[0-9]*,[0-9]*\).*/\1/p' "$log" | tail -n 1)
  [ -n "$bounds" ] && break
  kill -0 "$pid" 2>/dev/null || break
  sleep 1
done

if [ -n "$bounds" ]; then
  echo "tray icon bounds: $bounds"
  sleep 2
  screencapture -x "${out%.png}-screen.png" || true
  IFS=, read -r x _y _w _h <<<"$bounds"
  # The menu drops from the icon's left edge, or shifts left near the screen edge.
  left=$((x - 320))
  [ "$left" -lt 0 ] && left=0
  screencapture -x -R"${left},0,680,460" "$out" || true
else
  echo "tray menu did not pop (no 'tray reveal bounds' in the log)"
  tail -n 40 "$log" || true
fi

pkill -9 -P "$pid" 2>/dev/null || true
kill -9 "$pid" 2>/dev/null || true
wait "$pid" 2>/dev/null || true
free_port
ls -la "$(dirname "$out")"/tray-menu*.png 2>/dev/null || true
exit 0

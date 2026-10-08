#!/bin/bash
# Lint .github/workflows with actionlint when a binary is available.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Ignore pre-existing shellcheck nits in the unsigned job (ls, unquoted
# expansions). Do not "fix" those steps — they must stay byte-identical.
IGNORE=(
  -ignore 'SC2012:'
  -ignore 'SC2097:'
  -ignore 'SC2098:'
  -ignore 'SC2086:'
)

if command -v actionlint >/dev/null 2>&1; then
  actionlint "${IGNORE[@]}"
  echo "actionlint: ok"
  exit 0
fi

VERSION="1.7.7"
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS-$ARCH" in
  Linux-x86_64) ASSET="actionlint_${VERSION}_linux_amd64.tar.gz" ;;
  Linux-aarch64) ASSET="actionlint_${VERSION}_linux_arm64.tar.gz" ;;
  Darwin-arm64) ASSET="actionlint_${VERSION}_darwin_arm64.tar.gz" ;;
  Darwin-x86_64) ASSET="actionlint_${VERSION}_darwin_amd64.tar.gz" ;;
  *)
    echo "actionlint: no binary for $OS $ARCH; skip"
    exit 0
    ;;
esac

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
URL="https://github.com/rhysd/actionlint/releases/download/v${VERSION}/${ASSET}"
if ! curl -fsSL "$URL" -o "$WORK/actionlint.tgz"; then
  echo "actionlint: download failed; skip"
  exit 0
fi
tar -xzf "$WORK/actionlint.tgz" -C "$WORK" actionlint
"$WORK/actionlint" "${IGNORE[@]}"
echo "actionlint: ok"

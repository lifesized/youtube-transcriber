#!/bin/bash
# Lint .github/workflows with actionlint when a binary is available.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# SC2012/SC2086 in the unsigned job were fixed (find instead of ls;
# quoted PID lists). Do not ignore those codes globally.
if command -v actionlint >/dev/null 2>&1; then
  actionlint
  echo "actionlint: ok"
  exit 0
fi

VERSION="1.7.7"
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS-$ARCH" in
  Linux-x86_64)
    ASSET="actionlint_${VERSION}_linux_amd64.tar.gz"
    EXPECTED_SHA256="023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757"
    ;;
  Linux-aarch64)
    ASSET="actionlint_${VERSION}_linux_arm64.tar.gz"
    EXPECTED_SHA256="401942f9c24ed71e4fe71b76c7d638f66d8633575c4016efd2977ce7c28317d0"
    ;;
  Darwin-arm64)
    ASSET="actionlint_${VERSION}_darwin_arm64.tar.gz"
    EXPECTED_SHA256="2693315b9093aeacb4ebd91a993fea54fc215057bf0da2659056b4bc033873db"
    ;;
  Darwin-x86_64)
    ASSET="actionlint_${VERSION}_darwin_amd64.tar.gz"
    EXPECTED_SHA256="28e5de5a05fc558474f638323d736d822fff183d2d492f0aecb2b73cc44584f5"
    ;;
  *)
    echo "actionlint: no binary for $OS $ARCH" >&2
    exit 1
    ;;
esac

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
URL="https://github.com/rhysd/actionlint/releases/download/v${VERSION}/${ASSET}"
if ! curl -fsSL "$URL" -o "$WORK/actionlint.tgz"; then
  echo "actionlint: download failed" >&2
  exit 1
fi
ACTUAL_SHA256="$(shasum -a 256 "$WORK/actionlint.tgz" | awk '{print $1}')"
if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
  echo "actionlint: sha256 mismatch" >&2
  echo "expected $EXPECTED_SHA256" >&2
  echo "got      $ACTUAL_SHA256" >&2
  exit 1
fi
tar -xzf "$WORK/actionlint.tgz" -C "$WORK" actionlint
"$WORK/actionlint"
echo "actionlint: ok"

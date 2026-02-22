#!/usr/bin/env bash
# Called by Claude Code "Stop" hook.
# Warns if work was done this session but HANDOVER.md wasn't updated.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT" || exit 0

# Check if there are any changes (staged, unstaged, or untracked) besides HANDOVER.md
CHANGES=$(git status --porcelain 2>/dev/null | grep -v '?? HANDOVER.md' | grep -v ' M HANDOVER.md' | grep -v 'M  HANDOVER.md' | grep -v 'A  HANDOVER.md')

# Also check for commits not yet reflected in handover — any commits in the last hour
RECENT_COMMITS=$(git log --since="1 hour ago" --oneline 2>/dev/null | head -1)

# No work done → nothing to warn about
if [ -z "$CHANGES" ] && [ -z "$RECENT_COMMITS" ]; then
  exit 0
fi

# Work was done — check if HANDOVER.md was also touched
HANDOVER_CHANGED=$(git status --porcelain 2>/dev/null | grep 'HANDOVER.md')

if [ -z "$HANDOVER_CHANGED" ]; then
  echo "⚠  Changes were made but HANDOVER.md wasn't updated. Ask Claude to refresh it before starting a new session."
fi

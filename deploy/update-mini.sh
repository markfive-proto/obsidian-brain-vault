#!/bin/bash
# Update the Mac mini deployment to the latest pushed code.
# Run ON the mini (or via: ssh <mini> 'bash -s' < deploy/update-mini.sh
# after the repo exists there).
#
# Flow: pull → build → reinstall global package → kick the gateway agent
# (which respawns fresh obs-mcp children on the next session).
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

REPO_DIR="${OBS_REPO_DIR:-$HOME/obsidian-brain-vault}"
GATEWAY_LABEL="${OBS_GATEWAY_LABEL:-com.marcuschia.obsmcp-gateway}"

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "Repo not found at $REPO_DIR — clone it first:"
  echo "  git clone https://github.com/markfive-proto/obsidian-brain-vault \"$REPO_DIR\""
  exit 1
fi

cd "$REPO_DIR"
echo "==> git pull"
git pull --ff-only

echo "==> install deps + build"
if command -v pnpm >/dev/null 2>&1; then pnpm install --frozen-lockfile; else npm install; fi
npm run build

echo "==> reinstall global package"
npm install -g .

echo "==> restart gateway launchd agent ($GATEWAY_LABEL)"
launchctl kickstart -k "gui/$(id -u)/$GATEWAY_LABEL" || {
  echo "kickstart failed — is the agent loaded? Try:"
  echo "  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/$GATEWAY_LABEL.plist"
  exit 1
}

sleep 2
echo "==> gateway status"
launchctl print "gui/$(id -u)/$GATEWAY_LABEL" | grep -E "state|pid" | head -5
echo
echo "Done. Installed version: $(obs --version 2>/dev/null || echo unknown)"

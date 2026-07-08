#!/usr/bin/env bash
# dream.sh — nightly knowledge base cycle (compile → lint → reindex → graph → log)
#
# Designed to run unattended via cron or launchd. All the logic lives in
# `obs kb dream`; this wrapper only pins the vault path and forwards flags.
#
# Usage:
#   ./dream.sh                    # run normally
#   ./dream.sh --dry-run          # show what would happen, don't write
#
# Writes a log to: outputs/dream/dream-YYYY-MM-DD.md

set -euo pipefail

VAULT="${VAULT:-$HOME/Documents/Obsidian/knowledgebase}"

exec obs kb dream --vault "$VAULT" "$@"

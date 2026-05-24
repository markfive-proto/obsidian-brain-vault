#!/usr/bin/env bash
# dream.sh — nightly knowledge base compilation and health check
#
# Designed to run unattended via cron or launchd.
# Set VAULT to your vault path, or export it before calling this script.
#
# Usage:
#   ./dream.sh                    # run normally
#   ./dream.sh --dry-run          # show what would happen, don't write
#
# Outputs a log to: outputs/dream/dream-YYYY-MM-DD.md

set -euo pipefail

VAULT="${VAULT:-$HOME/Documents/Obsidian/knowledgebase}"
DRY_RUN=false
LOG_DATE=$(date +%Y-%m-%d)
LOG_FILE="$VAULT/outputs/dream/dream-$LOG_DATE.md"

for arg in "$@"; do
  [[ "$arg" == "--dry-run" ]] && DRY_RUN=true
done

log() {
  echo "$1"
  echo "$1" >> "$TMP_LOG"
}

TMP_LOG=$(mktemp)
trap 'rm -f "$TMP_LOG"' EXIT

log "# Dream Cycle — $LOG_DATE"
log ""
log "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log ""

# ── Step 1: Compile new raw sources ──────────────────────────────────────────
log "## Compile"
log ""
if $DRY_RUN; then
  log "DRY RUN — would run: obs kb compile --vault \"$VAULT\""
else
  if obs kb compile --vault "$VAULT" 2>&1 | tee -a "$TMP_LOG"; then
    log ""
    log "Compile complete."
  else
    log ""
    log "⚠️ Compile finished with errors — check output above."
  fi
fi
log ""

# ── Step 2: KB health check ───────────────────────────────────────────────────
log "## Health check"
log ""
if $DRY_RUN; then
  log "DRY RUN — would run: obs kb lint --vault \"$VAULT\""
else
  if obs kb lint --vault "$VAULT" 2>&1 | tee -a "$TMP_LOG"; then
    log ""
    log "Health check complete."
  else
    log ""
    log "⚠️ Health check flagged issues — see above."
  fi
fi
log ""

# ── Step 3: Stats snapshot ────────────────────────────────────────────────────
log "## Stats"
log ""
if ! $DRY_RUN; then
  obs kb stats --vault "$VAULT" 2>&1 | tee -a "$TMP_LOG"
fi
log ""
log "---"
log ""
log "Finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── Write log to vault ──────────────────────────────────────────���─────────────
if ! $DRY_RUN; then
  mkdir -p "$VAULT/outputs/dream"
  cp "$TMP_LOG" "$LOG_FILE"
  echo ""
  echo "Dream log written to: $LOG_FILE"
fi

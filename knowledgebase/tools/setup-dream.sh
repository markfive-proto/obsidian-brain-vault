#!/usr/bin/env bash
# setup-dream.sh — install the dream cycle as a scheduled background job
#
# Supports macOS (launchd) and Linux/WSL (cron).
# Runs dream.sh every night at 2am.
#
# Usage:
#   ./setup-dream.sh --vault /path/to/your/vault
#   ./setup-dream.sh --vault /path/to/your/vault --hour 3   # 3am instead

set -euo pipefail

VAULT=""
HOUR=2
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DREAM_SCRIPT="$SCRIPT_DIR/dream.sh"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --vault) VAULT="$2"; shift 2 ;;
    --hour)  HOUR="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$VAULT" ]]; then
  echo "Usage: $0 --vault /path/to/your/vault"
  exit 1
fi

if [[ ! -f "$DREAM_SCRIPT" ]]; then
  echo "Error: dream.sh not found at $DREAM_SCRIPT"
  exit 1
fi

chmod +x "$DREAM_SCRIPT"

# ── macOS: launchd ────────────────────────────────────────────────────────────
if [[ "$(uname)" == "Darwin" ]]; then
  LABEL="ai.brainvault.dream"
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  LOG_OUT="/tmp/brainvault-dream.log"

  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$DREAM_SCRIPT</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>VAULT</key>
        <string>$VAULT</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>

    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>$HOUR</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>

    <key>RunAtLoad</key>
    <false/>

    <key>StandardOutPath</key>
    <string>$LOG_OUT</string>

    <key>StandardErrorPath</key>
    <string>$LOG_OUT</string>
</dict>
</plist>
EOF

  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"

  echo "✅ Dream cycle installed as launchd agent: $LABEL"
  echo "   Runs nightly at ${HOUR}:00"
  echo "   Vault: $VAULT"
  echo "   Live log: $LOG_OUT"
  echo ""
  echo "To run manually:  VAULT=\"$VAULT\" bash \"$DREAM_SCRIPT\""
  echo "To uninstall:     launchctl unload \"$PLIST\" && rm \"$PLIST\""

# ── Linux / WSL: cron ────────────────────────────────────────────────────────
else
  CRON_LINE="0 $HOUR * * * VAULT=\"$VAULT\" bash \"$DREAM_SCRIPT\" >> /tmp/brainvault-dream.log 2>&1"
  EXISTING=$(crontab -l 2>/dev/null || true)

  if echo "$EXISTING" | grep -qF "$DREAM_SCRIPT"; then
    echo "⚠️  Cron entry for dream.sh already exists — skipping."
    echo "   Current crontab:"
    crontab -l | grep "$DREAM_SCRIPT"
  else
    (echo "$EXISTING"; echo "$CRON_LINE") | crontab -
    echo "✅ Dream cycle installed in crontab."
    echo "   Runs nightly at ${HOUR}:00"
    echo "   Vault: $VAULT"
    echo "   Live log: /tmp/brainvault-dream.log"
    echo ""
    echo "To run manually:  VAULT=\"$VAULT\" bash \"$DREAM_SCRIPT\""
    echo "To uninstall:     crontab -e  # remove the brain-vault line"
  fi
fi

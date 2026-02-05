#!/bin/bash
# c3po-watchdog.sh — Health check for OpenClaw Gateway.
# Runs every 5 minutes via systemd timer.
# Only sends alert when the Gateway is DOWN (no spam when it's up).
#
# State file prevents repeated alerts for the same outage.

set -euo pipefail

GATEWAY_PORT="${GATEWAY_PORT:-18789}"
GATEWAY_URL="http://127.0.0.1:${GATEWAY_PORT}/"
STATE_FILE="/tmp/c3po-watchdog-alerted"
JONY_NUMBER="+5512982476359"

# Check if Gateway is responding
check_gateway() {
    curl -sf --max-time 5 "$GATEWAY_URL" >/dev/null 2>&1
}

# Send alert via openclaw CLI (if available) or log
send_alert() {
    local msg="C3PO ALERT: Gateway offline at $(date '+%Y-%m-%d %H:%M %Z'). Check the VM."

    # Try openclaw send first (may not work if gateway is down)
    if command -v openclaw >/dev/null 2>&1; then
        openclaw send --channel whatsapp --to "$JONY_NUMBER" --message "$msg" 2>/dev/null || true
    fi

    # Always log
    echo "[$(date -Iseconds)] ALERT: Gateway is DOWN" >&2
}

# Main logic
if check_gateway; then
    # Gateway is up — clear alert state if it was set
    if [ -f "$STATE_FILE" ]; then
        rm -f "$STATE_FILE"
        echo "[$(date -Iseconds)] RECOVERED: Gateway is back online" >&2
    fi
    exit 0
else
    # Gateway is down
    if [ -f "$STATE_FILE" ]; then
        # Already alerted for this outage, don't spam
        echo "[$(date -Iseconds)] STILL DOWN (already alerted)" >&2
        exit 0
    fi

    # First detection of outage — alert and mark
    send_alert
    touch "$STATE_FILE"
    exit 1
fi

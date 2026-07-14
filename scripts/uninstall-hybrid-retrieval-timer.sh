#!/usr/bin/env bash
set -euo pipefail

SERVICE_FILE=/etc/systemd/system/hermes-hybrid-retrieval-sync.service
TIMER_FILE=/etc/systemd/system/hermes-hybrid-retrieval-sync.timer

systemctl disable --now hermes-hybrid-retrieval-sync.timer 2>/dev/null || true
systemctl stop hermes-hybrid-retrieval-sync.service 2>/dev/null || true
rm -f "$SERVICE_FILE" "$TIMER_FILE"
systemctl daemon-reload
systemctl reset-failed hermes-hybrid-retrieval-sync.service 2>/dev/null || true

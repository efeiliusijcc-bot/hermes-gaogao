#!/usr/bin/env bash
set -euo pipefail

SERVICE_FILE=/etc/systemd/system/hermes-hybrid-retrieval-sync.service
TIMER_FILE=/etc/systemd/system/hermes-hybrid-retrieval-sync.timer

install -m 0644 /dev/stdin "$SERVICE_FILE" <<'UNIT'
[Unit]
Description=Backfill Hermes hybrid retrieval text and entity indexes
Wants=docker.service
After=docker.service network-online.target gaogao-vector-sync.service

[Service]
Type=oneshot
ExecStart=/usr/bin/docker exec hermes-api node /app/dist-server/scripts/backfill-hybrid-retrieval.js --max-rows=60000
Nice=5
IOSchedulingClass=best-effort
IOSchedulingPriority=6
UNIT

install -m 0644 /dev/stdin "$TIMER_FILE" <<'UNIT'
[Unit]
Description=Run Hermes hybrid retrieval backfill after daily vector sync

[Timer]
OnCalendar=*-*-* 08:20:00
Persistent=true
RandomizedDelaySec=5m
Unit=hermes-hybrid-retrieval-sync.service

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now hermes-hybrid-retrieval-sync.timer

#!/usr/bin/env bash
set -euo pipefail

: "${REMOTE_HOST:?Missing REMOTE_HOST}"
: "${REMOTE_USER:=root}"
: "${SSH_KEY:=~/.ssh/id_ed25519}"
: "${HERMES_CONTAINER:=hermes}"

ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" bash -s <<REMOTE_SCRIPT
set -euo pipefail

docker exec "$HERMES_CONTAINER" sh -lc '
  set -e
  if ! python3 -m pip --version >/dev/null 2>&1; then
    apt-get update
    apt-get install -y --no-install-recommends python3-pip
  fi
  python3 -m pip install --break-system-packages firecrawl-py
  if [ -x /opt/hermes/.venv/bin/python ]; then
    /opt/hermes/.venv/bin/python -m pip --version >/dev/null 2>&1 || /opt/hermes/.venv/bin/python -m ensurepip --upgrade
    /opt/hermes/.venv/bin/python -m pip install firecrawl-py
  fi
  python3 - <<PY
import sys
sys.path.insert(0, "/opt/data/workspace/report-agent/skills/web-research-firecrawl/scripts")
import firecrawl
import firecrawl_client
print("firecrawl import ok:", getattr(firecrawl, "__file__", ""))
print("firecrawl_client import ok:", getattr(firecrawl_client, "__file__", ""))
PY
  if [ -x /opt/hermes/.venv/bin/python ]; then
    /opt/hermes/.venv/bin/python - <<PY
import firecrawl
print("venv firecrawl import ok:", getattr(firecrawl, "__file__", ""))
PY
  fi
  python3 /opt/data/workspace/report-agent/skills/web-research-firecrawl/scripts/harness_cli.py --help >/dev/null
'
REMOTE_SCRIPT

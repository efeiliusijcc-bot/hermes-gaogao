# hermes-gaogao

Hermes version of the AI report generation project.

The active frontend lives in:

```text
b_k3ewYvsOEc1/
```

The backend is a NestJS API that can run Hermes through the cloud container CLI.
The report workflow, frontend/backend layout, and pgvector database integration are kept from the original project.

## Backend Hermes Connection

The production report path uses the Hermes API Server `/v1/runs` endpoint through the Docker network:

```env
HERMES_RUN_MODE=runs
HERMES_BASE_URL=http://hermes:8642/v1
HERMES_HEALTH_URL=http://hermes:8642/health
HERMES_RUNS_URL=http://hermes:8642/v1/runs
HERMES_MODEL=hermes-agent
HERMES_REMOTE_REPORT_DIR=/opt/hermes/workspace/report-agent/reports
HERMES_REMOTE_CONTAINER_REPORT_DIR=/opt/data/workspace/report-agent/reports
HERMES_CONTAINER_REPORT_DIR=/opt/data/workspace/report-agent/reports
```

Keep using the existing pgvector database by setting `PGVECTOR_DATABASE_URL` in `.env`.
Do not commit real tokens, database passwords, or `.env` files.

Important: `http://74.121.148.204:1888/v1` is the legacy OpenClaw-compatible HTTP endpoint, not the Hermes container. Use it only for explicit legacy fallback testing:

```env
HERMES_RUN_MODE=http
HERMES_BASE_URL=http://74.121.148.204:1888/v1
HERMES_MODEL=openclaw/report-agent
```

## Docker deployment notes

The cloud deployment keeps the old `gaogao-api` container untouched. This project deploys as `hermes-api` on host port `1556`, while the container still listens on `1555`.

`deploy.sh` enforces the runtime assumptions needed by the report workflow:

```bash
docker network create hermes-net
docker network connect --alias hermes hermes-net hermes
docker network connect --alias todo_postgres hermes-net todo_postgres
```

Both `hermes` and `hermes-api` are expected to run as root and share `/opt/hermes:/opt/data`. The shared workspace is owned by `root:root`, so report artifacts and PG source files can be written consistently from either container.

After deployment, these checks should pass:

```bash
docker exec hermes-api getent hosts todo_postgres
curl http://127.0.0.1:1556/api/hermes/health
curl http://127.0.0.1:1556/api/vector-sources/status
```

## Hermes harness dependencies

The `write-hb` skill must run `web-research-firecrawl/scripts/harness_cli.py`.
The Hermes container therefore needs the Firecrawl Python SDK installed even
when `FIRECRAWL_API_KEY` is not configured. Without the SDK, the harness cannot
start and Hermes may fall back to native `web_search` / `web_extract`, which is
not the expected workflow.

Install or repair the dependency on the cloud node:

```bash
REMOTE_HOST=74.121.148.204 \
REMOTE_USER=root \
SSH_KEY=~/.ssh/id_ed25519 \
HERMES_CONTAINER=hermes \
bash scripts/install-hermes-harness-deps.sh
```

If no Firecrawl key is available, leave `FIRECRAWL_API_KEY` empty. The harness
will record that condition and use its own fallback chain; it should not be
bypassed entirely.

## Commands

```bash
pnpm install
pnpm run build
pnpm run dev
```

Frontend:

```bash
cd b_k3ewYvsOEc1
pnpm install
pnpm run build
```

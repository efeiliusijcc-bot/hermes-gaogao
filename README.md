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
SSH_KEY=~/.ssh/hermes_bwg_us_204_ed25519 \
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

## Daily Awareness V2 event contract

Daily Awareness is a globally shared, event-driven brief service. The data writer is not implemented in this repository. After the writer finishes one business-date batch, it calls:

```text
POST /internal/events/daily-data-finished
Content-Type: application/json
X-Hermes-Internal-Key: <DAILY_AWARENESS_INTERNAL_EVENT_KEY>
```

The internal key is independent from normal user JWT authentication. Configure the same strong random value in Hermes and in the external data writer. Do not expose it to the browser.

```bash
curl -i -X POST http://127.0.0.1:1556/internal/events/daily-data-finished \
  -H 'Content-Type: application/json' \
  -H "X-Hermes-Internal-Key: $DAILY_AWARENESS_INTERNAL_EVENT_KEY" \
  -d '{
    "eventId": "daily-data-finished:2026-07-16:batch-001",
    "eventType": "DAILY_DATA_FINISHED",
    "businessDate": "2026-07-16",
    "batchId": "batch-001",
    "completedAt": "2026-07-17T00:05:00+08:00",
    "totalCount": 2864
  }'
```

A valid request is persisted to `daily_awareness_event_inbox` before the server responds with HTTP 202. A repeated `eventId` also returns HTTP 202 as an idempotent success and does not create another Inbox row. The request never waits for material retrieval or model generation.

```json
{
  "accepted": true,
  "duplicate": false,
  "eventId": "daily-data-finished:2026-07-16:batch-001"
}
```

Required runtime settings:

```env
DAILY_AWARENESS_INTERNAL_EVENT_KEY=
DAILY_AWARENESS_WORKER_POLL_MS=2000
DAILY_AWARENESS_INBOX_LEASE_SECONDS=300
DAILY_AWARENESS_INBOX_MAX_ATTEMPTS=5
DAILY_AWARENESS_INBOX_RETRY_SECONDS=30
```

The fixed Inbox states are `RECEIVED`, `PROCESSING`, `RETRY_PENDING`, `PROCESSED`, and `DEAD_LETTER`. Day data states are `WAITING`, `READY`, and `NO_DATA`; generation states are `WAITING`, `PENDING`, `GENERATING`, `SUCCESS`, `GENERATION_FAILED`, and `NOT_REQUIRED`. Zero usable records produce `NO_DATA` without a brief. A terminal model failure produces `GENERATION_FAILED` while the triggering event is still marked `PROCESSED`. Infrastructure failures follow the configured Inbox retry policy and eventually become `DEAD_LETTER`.

### Deployment order

Use this order so permission and response migrations remain compatible during a rolling release:

1. **Schema:** apply `scripts/init-daily-awareness.sql`. It is additive, preserves legacy briefs, selects one canonical `GLOBAL` brief per historical date, and enforces unique event, day-status, and global-brief dates.
2. **Permission mapping:** apply `scripts/init-rbac.sql`. It keeps legacy permission rows, copies old read assignments to `daily-awareness:view`, and explicitly grants administrators view and `system:daily-awareness:manage`.
3. **Backend:** deploy with all five Daily Awareness environment variables. The model call runs outside long database transactions, and every automatic/manual path uses the same business-date advisory lock.
4. **Verification:** check `/api/hermes/health`, submit an authenticated invalid internal event and expect HTTP 400, then submit a unique smoke event only when its business date and source data are real.
5. **Frontend:** deploy the read-only user workspace and the separately authorized management console. Users need `daily-awareness:view`; operators need `system:daily-awareness:manage`.
6. **Writer integration:** enable the external data writer last. It must use a stable unique `eventId`, retry non-202 responses, and treat every 202 response as accepted regardless of the `duplicate` flag.

Inbox reprocessing never overwrites an already successful global brief. Only the management API's manual regeneration action, with a reason and `confirmOverwrite: true`, may replace that business date. Keep the writer disabled during rollback. Roll back the frontend and backend first; the additive schema and permission rows may remain in place for the previous backend. Do not drop Inbox, day-status, run, config, or historical brief data as part of application rollback.

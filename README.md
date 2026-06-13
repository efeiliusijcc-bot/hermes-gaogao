# hermes-gaogao

Hermes version of the AI report generation project.

The active frontend lives in:

```text
b_k3ewYvsOEc1/
```

The backend is a NestJS API that can run Hermes through the cloud container CLI.
The report workflow, frontend/backend layout, and pgvector database integration are kept from the original project.

## Backend Hermes Connection

For local testing against the cloud Hermes node, use remote CLI mode:

```env
HERMES_RUN_MODE=remote_cli
HERMES_REMOTE_HOST=74.121.148.204
HERMES_REMOTE_USER=root
HERMES_REMOTE_SSH_KEY=~/.ssh/id_ed25519
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

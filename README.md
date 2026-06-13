# hermes-gaogao

Hermes version of the AI report generation project.

The active frontend lives in:

```text
b_k3ewYvsOEc1/
```

The backend is a NestJS API that talks to Hermes through an OpenAI-compatible API.

## Backend Hermes Connection

For local testing against the cloud Hermes node:

```env
HERMES_BASE_URL=http://74.121.148.204:1888/v1
HERMES_API_KEY=
HERMES_MODEL=hermes/report-agent
```

For Docker deployment on the same host/network as the `hermes` container:

```env
HERMES_BASE_URL=http://hermes:18789/v1
```

The cloud health endpoint currently responds at:

```text
http://74.121.148.204:1888/health
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

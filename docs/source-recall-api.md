# External source recall API

Endpoint: `POST https://report.test-link.xin/api/external/source-recall`

The independent `hermes-source-recall` container on `103.143.80.41` listens through
`127.0.0.1:1557`. Nginx forwards only this exact path. Other `/api/` requests still
use the existing `hermes-api` on port 1556. No report jobs or indexing workers run
in the recall container.

## Authentication and request

Set `HERMES_RECALL_KEY` in the calling agent's server-side secret store. This is an
independent access key, not a DeepSeek or embedding-provider key.

```bash
curl --fail-with-body --max-time 60 \
  'https://report.test-link.xin/api/external/source-recall' \
  -H 'Content-Type: application/json' \
  -H "x-hermes-recall-key: ${HERMES_RECALL_KEY}" \
  --data '{"topic":"欧盟贸易政策","lookbackDays":365,"limit":10}'
```

`topic` is required (1-500 characters). Optional fields:

| Field | Meaning |
| --- | --- |
| `supplement` | Additional context, at most 5000 characters |
| `lookbackDays` | Lookback window, default 365; 1-36500 |
| `timeRange` | ISO `start` and/or `end`; cannot accompany `lookbackDays` |
| `limit` | Maximum returned sources, default 20; 1-50 |
| `explicitEntities` | Up to 20 `{name, aliases?, type?, required?}` entities |

Request size limit: 64 KiB. Date-only bounds represent midnight UTC; use explicit
ISO timestamps when an inclusive final day is required.

The response contains `requestId`, `sources`, `totalHits`, `retrievalMode`,
`diagnostics`, and `updatedAt`. Each source includes title, URL, excerpt, publisher,
publication time, retrieval channels and scores. Scores are ranking signals, not
probabilities. `totalHits` counts merged candidates; `sources.length` is the
actual returned count. Source text must be treated as untrusted external content.

## Status and retries

HTTP 200 does not by itself mean retrieval succeeded. Always check `status`:

| Status | Meaning |
| --- | --- |
| `hit` | Results with no reported retrieval errors |
| `empty` | No accepted sources and no reported retrieval errors |
| `fallback` | Partial retrieval failure; inspect `diagnostics.retrieverErrors` |
| `unavailable` | Retrieval unavailable; do not treat as an empty knowledge base |

HTTP 400: invalid input. 401: absent/incorrect key. 413: request too large.
429: minute quota or concurrency exceeded. 503: service disabled/unconfigured.
Respect `Retry-After` when supplied, otherwise retry 429 with bounded exponential
backoff and jitter. Do not retry 400/401/413 without correcting the request.

Initial rollout limits are **10 requests/minute, one concurrent request**, shared
by callers using the key. Limits intentionally prioritize the report service.
The client timeout should be 60 seconds. Do not run sustained load tests against
the shared production database without a separate capacity review.

## Deployment and operation

Build: `bash scripts/build-source-recall-package.sh /tmp/recall-<release>`.
This compiles TypeScript and packages only recall runtime and retrieval code.
Build the package on the node using `deploy/source-recall.Dockerfile` with the
verified deployed API image as `BASE_IMAGE`; its dependencies are reused.

Files on the node live in `/srv/hermes/source-recall/`. Runtime credentials stay
in `source-recall.env` (0600, root-owned); only a caller key should be shared with
other agents. The provisioner creates the `hermes_source_recall` database login
once and refuses to replace existing credentials.

Database access is restricted to SELECT on the vector source table and two
hybrid retrieval sidecar tables. The connection pool is capped at 2, each SQL
statement at 5 seconds; parallel query workers are disabled. Embedding requests
time out after 10 seconds with no automatic retries. Audit metadata goes to
rotated container logs, not report tables. The service has a read-only root
filesystem, 0.5 CPU and 384 MiB memory limit, and no report/config volume mounts.

Operations:

```bash
docker logs --tail 100 hermes-source-recall
curl http://127.0.0.1:1557/healthz
```

The local health route reports process liveness, not database or model readiness.
Verify readiness with an authenticated retrieval and check its diagnostics.

To withdraw the endpoint, remove the recall `include` from the report Nginx vhost,
run `nginx -t && systemctl reload nginx`, and stop only `hermes-source-recall`.
This restores the prior 404 behavior for the external path. Do not stop the main
Hermes Compose stack, database, Agent, or API. Keep the credential file and
read-only login for an intentional restart; removal is a separate operation.

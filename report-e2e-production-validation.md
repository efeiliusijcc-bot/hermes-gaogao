# Report E2E Production Validation

Note: the early sections below preserve the initial local validation failure that exposed the artifact path-mapping bug. The authoritative production migration evidence starts at **Real Server Artifact Migration** and **Current Deployment Topology Confirmation**.

## Credentials And Scope

- Validation role: `retrieval_e2e_reporter`
- Validation users: `retrieval_e2e_tester`, `retrieval_e2e_peer`, `retrieval_e2e_admin`
- The reporter role has only report, crawler, preference, and template-read permissions required for this validation. It has no user, role, research-key, vector-source, or report-delete permission.
- Passwords, JWTs, cookies, and research keys were generated or supplied only in the process environment and are omitted from this record.

## Live Run Result

The live API login and report creation flow was executed against local API port 3101. The primary report job was created by the normal validation user:

| Scenario | Job ID | Status | Web trigger | Result |
| --- | --- | --- | --- | --- |
| Magnequench / NEO | `1aa029a2-2621-4f9f-ae24-175e2a2b1f6d` | failed | true | Report agent returned a Markdown file pointer that was not available in the local report output mount. |
| Database sufficient | not created after access-token expiry | n/a | n/a | E2E client refresh handling was added before the next run. |
| Arm Holdings confusion | not created after access-token expiry | n/a | n/a | Same blocker. |
| Insufficient public evidence | not created after access-token expiry | n/a | n/a | Same blocker. |

The primary job ran for approximately 534 seconds. Its API calls to database sources, every source channel, event log, and candidate sources returned `200`; result/download correctly returned `409` because no Markdown was recoverable.

## Retrieval And Context Evidence

The primary job's persisted artifacts were inspected from the configured local E2E output directory. Its model produced a syntactically valid but entity-empty policy, producing zero database/Web query terms. This revealed a first-stage contract gap: entity-empty model output had prevented the existing deterministic entity-policy fallback. The gap is now fixed and covered by `tests/entity-policy-extraction.test.ts`.

Before that correction, the observed context contained zero database, Web, and crawler accepted sources. No uncertain/rejected body was present in context, and the report could not generate citations from diagnostics. This is a fail-closed outcome, but it is not sufficient to certify final Markdown and reference behavior.

## API And Isolation

- Owner A requests by peer B for job detail, result, sources, and download returned `403` before token expiry: pass.
- The dedicated admin user could read the owner job detail (`200`). Its source/download checks were not conclusive in the first run because the report file mapping failure returned `500`/`409` independently of authorization.
- The E2E client now retains the refresh cookie in memory and refreshes access tokens on a `401`; no token or cookie is written to output.
- DataCanvas API inputs were available from `/database-sources` and `/sources?type=all|database_recall|tool_search|crawler|report_refs`; browser rendering cannot be certified until at least one job produces a report and references.

## Blocking Condition

The report agent emits a `REPORT_FILE` path, but the local validation service cannot read it from `REPORT_OUTPUT_DIR`. Configure a shared/local report output mount or the correct `HERMES_REMOTE_*` mapping before rerunning. This is separate from entity filtering and must be fixed before certifying Markdown, `report_references.json`, accepted-source citation coverage, and the four-scenario suite.

## Path Mapping Fix

The failing run returned this final pointer format:

`REPORT_FILE: /opt/data/workspace/report-agent/reports/NEO_Magnequench_HB_20260710.md`

The backend local report root in the E2E run was `/tmp/hermes-live-e2e-reports`. The code previously tried to validate the Hermes absolute path directly against the local report root, so the file could not be read.

The backend now resolves report artifacts through `ArtifactPathResolver`:

1. Resolve safe `relativePath` values under `REPORT_OUTPUT_DIR`.
2. Map configured remote prefixes such as `HERMES_REMOTE_OUTPUT_DIR` or `HERMES_REMOTE_CONTAINER_REPORT_DIR` to `HERMES_LOCAL_OUTPUT_DIR` / `REPORT_OUTPUT_DIR`.
3. If Hermes returns a legacy root-level Markdown file, stage it into `REPORT_OUTPUT_DIR/<jobId>/final/report.md` before reading.
4. If `HERMES_ARTIFACT_BASE_URL` is configured, fetch only whitelisted artifact names through a bounded internal artifact endpoint.
5. Reject path traversal, URI paths, wrong-job paths, and symlink realpaths escaping `REPORT_OUTPUT_DIR`.

Current deployment assessment: this local run is not backed by a shared Hermes report volume. The local machine has no readable `/opt/data/workspace/report-agent/reports` or `/opt/hermes/workspace/report-agent/reports` artifact tree, and the Hermes runs API exposes run status/output but returns `404` for `/artifacts`, `/files`, and `/output` artifact endpoints. Therefore the code fix is ready for shared-volume deployments and for deployments that provide `HERMES_ARTIFACT_BASE_URL`, but the four-scenario final Markdown validation cannot honestly pass in this environment until one of those artifact transports exists.

Verification added:

- `tests/artifact-path-resolver.test.ts`
- `tests/hermes-report-artifact-sync.test.ts`

## Docker + Vercel Deployment Architecture

Target production flow:

`Hermes -> ArtifactSyncService -> ArtifactStorageService -> report job artifact metadata -> NestJS result/download APIs -> Vercel frontend`

Current provider: `local`.

Standard logical artifact key:

`reports/<jobId>/final/report.md`

The key is intentionally not a server path. The frontend must not receive `/opt/data/...`, `/app/storage/...`, `file://`, Docker paths, object-storage secrets, or private bucket paths.

Recommended current Docker shared-volume configuration:

| Purpose | Container path / setting |
| --- | --- |
| Hermes report output | `/opt/data/workspace/report-agent/reports` |
| NestJS shared inbox | `/app/hermes-inbox` |
| NestJS persistent artifact root | `/app/storage/artifacts` |
| Hermes returned root | `HERMES_REMOTE_REPORT_ROOT=/opt/data/workspace/report-agent/reports` |
| NestJS readable shared root | `HERMES_SHARED_REPORT_ROOT=/app/hermes-inbox` |
| Artifact provider | `ARTIFACT_STORAGE_MODE=local` |
| Artifact root | `ARTIFACT_LOCAL_ROOT=/app/storage/artifacts` |

Compose shape:

```yaml
services:
  api:
    environment:
      ARTIFACT_STORAGE_MODE: local
      ARTIFACT_LOCAL_ROOT: /app/storage/artifacts
      HERMES_REMOTE_REPORT_ROOT: /opt/data/workspace/report-agent/reports
      HERMES_SHARED_REPORT_ROOT: /app/hermes-inbox
    volumes:
      - report-artifacts:/app/storage/artifacts
      - hermes-reports:/app/hermes-inbox:ro

  hermes:
    volumes:
      - hermes-reports:/opt/data/workspace/report-agent/reports

volumes:
  report-artifacts:
  hermes-reports:
```

Artifact sync order now implemented:

1. Use inline Markdown when Hermes returns actual Markdown content.
2. Map `REPORT_FILE` from `HERMES_REMOTE_REPORT_ROOT` to `HERMES_SHARED_REPORT_ROOT`, with traversal, URI, wrong-root, symlink escape, file-type, and size checks.
3. Fall back to the existing `ArtifactPathResolver` mappings for legacy deployments.
4. Fall back to `HERMES_ARTIFACT_BASE_URL` if an internal artifact endpoint is configured.
5. If no transport can supply `report.md`, fail the job with `ARTIFACT_TRANSPORT_UNAVAILABLE` instead of pretending the report is complete.

NestJS APIs:

- `GET /api/report-jobs/:jobId/result` reads the normalized artifact when available.
- `GET /api/report-jobs/:jobId/download?format=md` returns Markdown with `Content-Disposition`, `Content-Length`, `ETag`, and `X-Artifact-SHA256`.
- `GET /api/report-jobs/:jobId/artifacts` returns sanitized metadata only.

Vercel frontend config:

- Use `VITE_API_BASE_URL=https://<backend-api-domain>/api` in Vercel.
- The previous `VITE_API_BASE` remains a compatibility fallback.
- CORS must set `FRONTEND_ORIGINS` to the production Vercel domain, custom frontend domain, and any explicitly allowed preview domains. The API now exposes `Content-Disposition`, `Content-Length`, `ETag`, and `X-Artifact-SHA256`.

Future S3/MinIO/OSS-compatible mode:

- Switch `ARTIFACT_STORAGE_MODE=s3`.
- Use object keys under `S3_ARTIFACT_PREFIX/reports/<jobId>/final/report.md`.
- Keep frontend APIs unchanged; only the ArtifactStorage provider changes.
- The current code includes the provider boundary and a guarded S3 provider stub. Full S3 client wiring still requires adding the object-storage SDK dependency and credentials in deployment.

Current environment status:

- This local validation environment still does not expose Hermes' `/opt/data/workspace/report-agent/reports` as a readable NestJS shared volume.
- Container restart persistence was not honestly validated here because the Docker shared volume is not mounted in this workspace.
- The four live E2E report scenarios must be rerun after the deployment mounts `hermes-reports` and `report-artifacts` as persistent volumes.

## Docker Shared-Volume Validation

Validation date: 2026-07-10.

## Confirmed Deployment Facts

Confirmed from `.env`, `deploy.sh`, and the remote Docker host on 2026-07-10. Secrets, tokens, passwords, and database credentials are intentionally omitted.

| Question | Confirmed fact |
| --- | --- |
| NestJS API host | `74.121.148.204`, hostname `bwg-us-204`, container `hermes-api`, image `hermes-api:latest`, published as `0.0.0.0:1556->1555/tcp` |
| Hermes host | Same host: `74.121.148.204` / `bwg-us-204`, container `hermes`, image `nousresearch/hermes-agent:latest`, published as `0.0.0.0:18799->8642/tcp` |
| PostgreSQL host | Same host: `74.121.148.204` / `bwg-us-204`, container `todo_postgres`, image `pgvector/pgvector:pg15-trixie`, published as `0.0.0.0:5432->5432/tcp` |
| API and Hermes same Docker Host | Yes. Both containers run on Docker host `bwg-us-204` and are attached to Docker network `hermes-net` |
| Deployment mode | Current running containers are managed by `docker run`, not Docker Compose. The inspected containers have no Compose labels |
| Hermes actual report write path | Container path `/opt/data/workspace/report-agent/reports` |
| API actual readable report path today | Current running API reads the same bind mount at `/opt/data/workspace/report-agent/reports`; `/app/hermes-inbox` is not mounted in the currently running container |
| Artifact persistent mount today | Current running API has only bind mount `/opt/hermes -> /opt/data`; it does not yet have the new `report-artifacts -> /app/storage/artifacts` volume mounted |
| Current API/Hermes shared storage | Both `hermes` and `hermes-api` currently mount host path `/opt/hermes` to `/opt/data` with read-write access |
| Current container user | Both inspected `hermes` and `hermes-api` run as `root` in the current deployment |
| Current report directory permissions | `/opt/data/workspace/report-agent/reports` is owned by `0:0` and has mode `755` in both containers |

Conclusion: the current production-like host does place API, Hermes, and PostgreSQL on the same Docker host. However, it is still using the legacy shared bind mount `/opt/hermes:/opt/data`, not the new least-privilege artifact transport layout (`/app/hermes-inbox:ro` plus `report-artifacts:/app/storage/artifacts`). The updated `deploy.sh` now defines the intended new layout, but it has not yet been applied to the running remote container at the time of this record.

Docker context:

| Item | Result |
| --- | --- |
| Docker context | `desktop-linux` |
| Docker engine | Docker Desktop, server `29.6.1` |
| Running production API/Hermes containers | none in this local workspace |
| Real Hermes/API same-host check | not verifiable here because no live containers were running |

Deployment files updated:

- `deploy.sh` now uploads `server/artifact-storage/*.ts`.
- `deploy.sh` now creates `report-artifacts`, initializes it for UID/GID `1000:1000`, runs API as `1000:1000`, and mounts Hermes reports into `/app/hermes-inbox:ro`.
- `docker-compose.artifacts.example.yml` documents the equivalent Compose shared-volume layout.

Configured transport:

| Setting | Value |
| --- | --- |
| `ARTIFACT_STORAGE_MODE` | `local` |
| `HERMES_ARTIFACT_TRANSPORT` | `shared_volume` |
| Hermes write path | `/opt/data/workspace/report-agent/reports` |
| API inbox path | `/app/hermes-inbox` |
| API artifact root | `/app/storage/artifacts` |

Local Docker validation used temporary volumes:

| Purpose | Volume |
| --- | --- |
| Hermes report output simulation | `hermes-reports-validation` |
| API artifact persistence simulation | `report-artifacts-validation` |

Shared-volume visibility test:

- A simulated Hermes container wrote `artifact-volume-check.md` under `/opt/data/workspace/report-agent/reports`.
- A simulated API container mounted the same volume at `/app/hermes-inbox:ro`.
- API user `uid=1000(node) gid=1000(node)` read the file successfully.
- API write attempt to `/app/hermes-inbox` failed as expected.
- API wrote successfully to `/app/storage/artifacts`.

Observed permissions:

| Path | Permission | Owner |
| --- | --- | --- |
| simulated Hermes report directory | `750` | `1000:1000` |
| simulated report file | `640` | `1000:1000` |
| simulated artifact root | `770` | `1000:1000` |

Artifact import validation:

| Item | Result |
| --- | --- |
| Test job ID | `docker-validation-job` |
| Input pointer | `REPORT_FILE: /opt/data/workspace/report-agent/reports/artifact-volume-check.md` |
| Import mode | `shared_volume` |
| Stored storageKey | `reports/docker-validation-job/final/report.md` |
| sizeBytes | `59` |
| SHA-256 | `1cfa7b71b6c87b1433bb2a299b17148e01dcd81bb47e3efa98c9e3a6971f2093` |
| metadata sidecar | present |
| frontend-facing metadata contains server paths | no |

Persistence validation:

- A new container mounted `report-artifacts-validation` after the import.
- `reports/docker-validation-job/final/report.md` and `report.md.metadata.json` were still present.
- SHA-256 remained `1cfa7b71b6c87b1433bb2a299b17148e01dcd81bb47e3efa98c9e3a6971f2093`.
- A true `docker compose down/up` persistence test is still pending because this workspace has no live production Compose stack.

Vercel/CORS validation:

- `VITE_API_BASE_URL` is supported by the frontend and remains compatible with `VITE_API_BASE`.
- CORS exposes `Content-Disposition`, `Content-Length`, `ETag`, and `X-Artifact-SHA256`.
- Allowed origins are exact-match only from `FRONTEND_ORIGINS`; arbitrary `*.vercel.app` is not allowed.

Current E2E status:

- Four live report jobs were not rerun in this local workspace because there is no running production API/Hermes stack and no real shared Hermes report volume.
- Therefore final Markdown citation checks, `report_references.json` contamination checks, DataCanvas final references, and real Owner/Peer/Admin download calls remain pending for the deployed Docker host.

## Real Server Artifact Migration

Migration date: 2026-07-10 / 2026-07-11 local China time.

## Current Deployment Topology Confirmation

Confirmation time: 2026-07-11 13:50 CST. Source: read-only remote `docker ps`, `docker inspect`, `docker volume inspect`, and in-container path/stat checks on `74.121.148.204`. Secrets, tokens, passwords, and database connection strings are intentionally not recorded.

| Question | Confirmed current fact |
| --- | --- |
| NestJS API host | Host `74.121.148.204`, hostname `bwg-us-204`; container `hermes-api`; image `hermes-api:latest`; published as `0.0.0.0:1556->1555/tcp` |
| Hermes host | Same host `74.121.148.204` / `bwg-us-204`; container `hermes`; image `nousresearch/hermes-agent:latest`; published as `0.0.0.0:18799->8642/tcp` |
| PostgreSQL host | Same host `74.121.148.204` / `bwg-us-204`; container `todo_postgres`; image `pgvector/pgvector:pg15-trixie`; published as `0.0.0.0:5432->5432/tcp` |
| API and Hermes same Docker Host | Yes. `hermes-api` and `hermes` are both running on `bwg-us-204` and both are attached to Docker network `hermes-net` |
| Current container deployment mode | `docker run`. Current inspected containers have no Docker Compose labels. This is not a Vercel/Nest cloud container service and not a current Compose stack |
| Hermes actual report write path | Container path `/opt/data/workspace/report-agent/reports`; host bind source `/opt/hermes/workspace/report-agent/reports`; directory owner/mode observed from Hermes container: `0:0`, `755` |
| API actual inbox read path | Container path `/app/hermes-inbox`, mounted read-only from host `/opt/hermes/workspace/report-agent/reports`; owner/mode observed from API container: `0:0`, `755` |
| Artifact persistent volume mount | Docker volume `report-artifacts`, mounted in API at `/app/storage/artifacts`; host mountpoint `/var/lib/docker/volumes/report-artifacts/_data`; owner/mode `1000:1000`, `770` |

Current API mounts:

| API mount | Mode | Purpose |
| --- | --- | --- |
| `/opt/hermes -> /opt/data` | read-write | Stage A legacy compatibility mount |
| `/opt/hermes/workspace/report-agent/reports -> /app/hermes-inbox` | read-only | Least-privilege Hermes report inbox for artifact import |
| `report-artifacts -> /app/storage/artifacts` | read-write | Persistent API-managed artifact storage |

Current network notes:

- `hermes-api` is on `hermes-net` as `172.25.0.3`.
- `hermes` is on `hermes-net` as `172.25.0.2` with alias `hermes`.
- `todo_postgres` is attached to `hermes-net` as `172.25.0.4` with alias `todo_postgres`, while its primary Docker network mode remains `openclaw-net`.

Server and containers:

| Item | Value |
| --- | --- |
| Server | `74.121.148.204` |
| Hostname | `bwg-us-204` |
| API container | `hermes-api` |
| Hermes container | `hermes` |
| PostgreSQL container | `todo_postgres` |
| Docker network | `hermes-net` |
| Deployment mode | `docker run` |

Pre-migration inspect backups:

- `/root/hermes-api-inspect-before-artifact-migration.json`
- `/root/hermes-inspect-before-artifact-migration.json`
- Both files are mode `0600`.

Stage A mount layout now applied to production:

| Mount | Result |
| --- | --- |
| Legacy compatibility mount | kept: `/opt/hermes:/opt/data` |
| New read-only inbox | added: `/opt/hermes/workspace/report-agent/reports:/app/hermes-inbox:ro` |
| Artifact persistent volume | added: `report-artifacts:/app/storage/artifacts` |
| API user | `uid=1000(node) gid=1000(node)` |
| Production image | `hermes-api:artifact-20260711025714` |
| Rollback container | `hermes-api-rollback-20260711-032050` and later `hermes-api-rollback-tavily-<timestamp>` kept stopped |

Artifact configuration:

| Setting | Value |
| --- | --- |
| `ARTIFACT_STORAGE_MODE` | `local` |
| `ARTIFACT_LOCAL_ROOT` | `/app/storage/artifacts` |
| `HERMES_ARTIFACT_TRANSPORT` | `shared_volume` |
| `HERMES_REMOTE_REPORT_ROOT` | `/opt/data/workspace/report-agent/reports` |
| `HERMES_SHARED_REPORT_ROOT` | `/app/hermes-inbox` |
| `REPORT_OUTPUT_DIR` | `/app/storage/artifacts` |

Permission findings and fix:

- `report-artifacts` was created and initialized with owner `1000:1000`, mode `0770`.
- API uid `1000` can write `report-artifacts`.
- API inbox mount is read-only; write probes failed as expected.
- Hermes creates some report files with `0600 root:root`, which overrides default ACL masks.
- A root-owned ACL repair watcher was installed at `/usr/local/sbin/hermes-report-acl-watch.sh`.
- The watcher recursively keeps report directories traversable and Markdown files readable by uid `1000`, without using `chmod 777`.

ArtifactSync probes:

| Probe | Result |
| --- | --- |
| Flat report pointer import | passed |
| Nested `<jobId>/final/report.md` readability | passed after recursive ACL watcher |
| Actual transport | `shared_volume` |
| Actual source mapping | `/app/hermes-inbox` |
| Probe storageKey | `reports/production-artifact-validation/final/report.md` |
| Probe SHA-256 | `a6e6faaa50cf57c635c1d2e412228cca760b7c1709a9225b639a479b7fb1ac59` |

Canary result:

| Item | Result |
| --- | --- |
| Canary container | `hermes-api-artifact-canary` |
| Canary port | `127.0.0.1:1557->1555` |
| Canary image | `hermes-api:artifact-20260711025714` |
| Smoke job ID | `265674a0-c166-4cc5-835c-6f4929674090` |
| Status | `succeeded` |
| Artifact sync | `completed` |
| storageKey | `reports/265674a0-c166-4cc5-835c-6f4929674090/final/report.md` |
| SHA-256 | `cee3c7975c6099e0391cb1efbd0079988f40179ccc5b9ad28dba9d0be477314f` |
| result/download/artifacts | all `200` |

Production smoke and persistence:

| Item | Result |
| --- | --- |
| First successful production smoke job | `ee4e2842-cc0b-48d4-a493-5d782ce865b3` |
| storageKey | `reports/ee4e2842-cc0b-48d4-a493-5d782ce865b3/final/report.md` |
| SHA-256 | `901f24b7d8439e92823798fa5c71e27ac6314b1045ac66dc1a88e3bd71b817ac` |
| result/download/artifacts | all `200` |
| `docker restart hermes-api` persistence | passed |
| SHA-256 after restart | unchanged |

Tavily/Web configuration:

- Initial post-migration E2E showed `TAVILY_API_KEY is not configured`; Web supplement triggered but returned zero search results.
- The production env-file was updated with the Tavily key previously provided by the operator. The key value is not recorded here.
- `deploy.sh` was updated to preserve `TAVILY_API_KEY` in future deployments.

Final four-scenario E2E after Tavily configuration:

| Scenario | Job ID | Status | Web triggered | result/download/artifacts |
| --- | --- | --- | --- | --- |
| Magnequench / NEO | `389204cb-dea3-4884-a243-a382ec4eaa37` | succeeded | true | `200/200/200` |
| Database sufficient candidate | `4c0db467-5167-4395-9c8b-4d95cf1ac3d1` | succeeded | true | `200/200/200` |
| Arm Holdings confusion | `2e2cea0b-a1c1-4baa-a761-ebf95c8495f5` | succeeded | true | `200/200/200` |
| Insufficient evidence | `7b2fe3b2-c319-47d0-884c-c87e1bcd8ce4` | succeeded | true | `200/200/200` |

Artifact metadata for final E2E:

| Job ID | storageKey | SHA-256 match |
| --- | --- | --- |
| `389204cb-dea3-4884-a243-a382ec4eaa37` | `reports/389204cb-dea3-4884-a243-a382ec4eaa37/final/report.md` | yes |
| `4c0db467-5167-4395-9c8b-4d95cf1ac3d1` | `reports/4c0db467-5167-4395-9c8b-4d95cf1ac3d1/final/report.md` | yes |
| `2e2cea0b-a1c1-4baa-a761-ebf95c8495f5` | `reports/2e2cea0b-a1c1-4baa-a761-ebf95c8495f5/final/report.md` | yes |
| `7b2fe3b2-c319-47d0-884c-c87e1bcd8ce4` | `reports/7b2fe3b2-c319-47d0-884c-c87e1bcd8ce4/final/report.md` | yes |

Current production artifact API recheck:

Validation time: 2026-07-11 04:55 CST. Authentication used the existing admin smoke account; token/cookie values are not recorded.

| Job ID | detail | result | artifacts | download | artifactSyncStatus | storageKey | Artifact metadata path leak |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `389204cb-dea3-4884-a243-a382ec4eaa37` | `200` | `200` | `200` | `200` | `completed` | `reports/389204cb-dea3-4884-a243-a382ec4eaa37/final/report.md` | no `/opt/data`, `/app/hermes-inbox`, or `/app/storage/artifacts` |
| `4c0db467-5167-4395-9c8b-4d95cf1ac3d1` | `200` | `200` | `200` | `200` | `completed` | `reports/4c0db467-5167-4395-9c8b-4d95cf1ac3d1/final/report.md` | no `/opt/data`, `/app/hermes-inbox`, or `/app/storage/artifacts` |
| `2e2cea0b-a1c1-4baa-a761-ebf95c8495f5` | `200` | `200` | `200` | `200` | `completed` | `reports/2e2cea0b-a1c1-4baa-a761-ebf95c8495f5/final/report.md` | no `/opt/data`, `/app/hermes-inbox`, or `/app/storage/artifacts` |
| `7b2fe3b2-c319-47d0-884c-c87e1bcd8ce4` | `200` | `200` | `200` | `200` | `completed` | `reports/7b2fe3b2-c319-47d0-884c-c87e1bcd8ce4/final/report.md` | no `/opt/data`, `/app/hermes-inbox`, or `/app/storage/artifacts` |
| `ee4e2842-cc0b-48d4-a493-5d782ce865b3` | `200` | `200` | `200` | `200` | `completed` | `reports/ee4e2842-cc0b-48d4-a493-5d782ce865b3/final/report.md` | no `/opt/data`, `/app/hermes-inbox`, or `/app/storage/artifacts` |

Owner/Peer/Admin validation:

- Owner API calls returned `200`.
- Peer calls to detail/result/sources/download returned `403`.
- Admin calls to detail/result/sources/download returned `200`.

Vercel browser validation:

Validation time: 2026-07-11 04:55-04:56 CST using `https://hermes-gaogao.vercel.app`.

| Check | Result |
| --- | --- |
| Public app load | passed; page title `AI深度编报` |
| Vercel API proxy health | passed; `/api/hermes/health` returned `200` |
| Unauthenticated report API behavior | passed; report list requests returned `401` before login |
| Login | passed with the existing admin smoke account |
| Report history | passed; the final four E2E reports were visible |
| Open final Markdown | passed for job `389204cb-dea3-4884-a243-a382ec4eaa37`; report body rendered |
| Source overview | passed; DataCanvas showed database `0`, crawler `0`, internet search `4` for the selected job |
| Source type filter | passed; internet search source list requested `/sources?type=tool_search` and returned `200` |
| Internal path leak check | passed; page text contained no `/opt/data`, `/app/hermes-inbox`, or `/app/storage/artifacts` |
| Logout | passed; page returned to unauthenticated state |

Deployment reproducibility update:

- `deploy.sh` now writes the API runtime environment to `/usr/docker/hermes-api/hermes-api.env` with mode `0600` and starts the container with `--env-file` instead of expanding secrets through many `docker run -e ...` arguments.
- The remote env-file was corrected in place so `REPORT_OUTPUT_DIR=/app/storage/artifacts` and `HERMES_LOCAL_OUTPUT_DIR=/app/storage/artifacts`; a timestamped backup was kept on the server.
- `deploy.sh` now installs/starts `/usr/local/sbin/hermes-report-acl-watch.sh` when `setfacl` is available, preserving uid `1000` read access to Hermes-created report files without `chmod 777`.
- `deploy.sh` initializes `report-artifacts` with owner `1000:1000` and mode `0770`, mounts `/app/hermes-inbox` read-only, mounts `/app/storage/artifacts`, uploads `server/artifact-storage/*.ts`, and preserves the Stage A legacy `/opt/hermes:/opt/data` mount.
- `scripts/run-live-report-e2e-validation.ts` now includes `/api/report-jobs/:jobId/artifacts` in per-scenario checks and in Owner/Peer/Admin isolation paths.
- `deploy.sh` now keeps the previous production container as `hermes-api-rollback-<timestamp>` instead of deleting it.
- `deploy.sh` now supports `HERMES_API_LEGACY_DATA_MOUNT=false` for a controlled Stage B deployment. The default remains Stage A; when disabled, `HERMES_STATE_DIR` defaults to `/app/storage/artifacts/hermes-state` and the broad `/opt/hermes:/opt/data` API mount is omitted.

Production redeploy on 2026-07-11 05:06 CST:

| Item | Result |
| --- | --- |
| New production image tag | `hermes-api:latest` |
| Previous production container | kept as `hermes-api-rollback-20260711-050612` |
| Production port | `0.0.0.0:1556->1555/tcp` |
| Stage | Stage A; `/opt/hermes:/opt/data` still retained |
| Production mounts | `/opt/hermes:/opt/data`, `report-artifacts:/app/storage/artifacts`, `/opt/hermes/workspace/report-agent/reports:/app/hermes-inbox:ro` |
| Post-deploy health | passed |
| Post-deploy auth/vector smoke | passed |

Post-deploy path leak recheck:

| API | Status | Internal path leak |
| --- | --- | --- |
| `/api/report-jobs/389204cb-dea3-4884-a243-a382ec4eaa37/result` | `200` | no `/opt/data`, `/app/hermes-inbox`, or `/app/storage/artifacts` |
| `/api/report-jobs/389204cb-dea3-4884-a243-a382ec4eaa37/artifacts` | `200` | no `/opt/data`, `/app/hermes-inbox`, or `/app/storage/artifacts` |
| `/api/report-jobs/389204cb-dea3-4884-a243-a382ec4eaa37/download?format=md` | `200` | no `/opt/data`, `/app/hermes-inbox`, or `/app/storage/artifacts` |

Source channel correction deployed on 2026-07-11 13:33 CST:

| Item | Result |
| --- | --- |
| Change | `sources?type=tool_search` no longer includes `report_refs` items with `matchStatus=raw_only` or empty URL |
| Production rollback container | previous production kept as `hermes-api-rollback-20260711-133309` |
| Validation job | `389204cb-dea3-4884-a243-a382ec4eaa37` |
| `sources?type=tool_search` | `200`, total `0`, raw-only count `0` |
| `sources?type=all` | `200`, total `0`, raw-only count `0` |
| `sources?type=report_refs` | `200`, total `4`, raw-only count `4` |

Interpretation: for this historical job, the previously displayed “互联网搜索工具 4 条” were raw report-reference entries rather than URL-backed accepted Web sources. They are now kept only in the report-reference channel. This improves channel separation but also confirms that citation-to-accepted-Web traceability remains uncertified for that historical run.

Stage B canary audit:

| Check | Result |
| --- | --- |
| Canary container | `hermes-api-stageb-canary` |
| Canary image | `hermes-api:artifact-20260711025714` |
| Canary port | `127.0.0.1:1558->1555` |
| Broad API mount `/opt/hermes:/opt/data` | omitted |
| Kept mounts | `/app/hermes-inbox:ro`, `/app/storage/artifacts` |
| `HERMES_STATE_DIR` | `/app/storage/artifacts/hermes-state` |
| Container user | `uid=1000(node) gid=1000(node)` |
| Health | passed |
| `/app/hermes-inbox` read-only probe | passed |
| `/app/storage/artifacts` write probe | passed |
| `/opt/data` absence probe | passed |
| Existing report detail/result/artifacts/sources/download | passed, all `200` |
| Stage B production cutover | not performed |

The Stage B canary was stopped after validation. It demonstrated that historical artifact serving can work without the broad API bind mount when API state is moved to the artifact volume. A full Stage B production cutover still requires a fresh report-generation smoke on a Stage B image that includes the latest `/result` sanitization change.

Latest-image Stage B report-generation smoke:

| Check | Result |
| --- | --- |
| Canary container | `hermes-api-stageb-canary-latest` |
| Canary image | `hermes-api:latest` |
| Broad API mount `/opt/hermes:/opt/data` | omitted |
| Kept mounts | `/app/hermes-inbox:ro`, `/app/storage/artifacts` |
| `HERMES_STATE_DIR` | `/app/storage/artifacts/hermes-state` |
| Smoke job ID | `9c0920f5-d969-4584-9f22-638cb61c3838` |
| Final status | `succeeded` / `quality_review_done` |
| Artifact sync | `completed` |
| storageKey | `reports/9c0920f5-d969-4584-9f22-638cb61c3838/final/report.md` |
| result/artifacts/download | `200/200/200` |
| Internal path leak | none in result, artifacts, or Markdown download |

This proves the report artifact path itself can complete without the broad API `/opt/data` mount on the latest image.

Stage B narrow-config canary:

| Check | Result |
| --- | --- |
| Confirmation time | 2026-07-11 13:52 CST |
| Canary container | `hermes-api-stageb-config-canary` |
| Canary image | `hermes-api:latest` |
| Canary port | `127.0.0.1:1558->1555` |
| Broad API mount `/opt/hermes:/opt/data` | omitted |
| Kept mounts | `/app/hermes-inbox:ro`, `/app/storage/artifacts`, `/app/hermes-config` |
| `HERMES_STATE_DIR` | `/app/storage/artifacts/hermes-state` |
| `HERMES_RESEARCH_KEYS_DIR` | `/app/hermes-config` |
| Config propagation probe | passed; `/app/hermes-config/research-keys.env` is readable and the config directory is writable by the API user |
| `/app/hermes-inbox` read-only probe | passed |
| `/app/storage/artifacts` write probe | passed |
| `/opt/data` absence probe | passed |
| Research key status probe | passed; Tavily is configured |
| Smoke job ID | `8e171124-f8b6-4bad-8f37-62aa361edb13` |
| Web supplement | triggered; database accepted `0`, Web search candidates `30`, entity guard accepted `19`, accepted Web sources `14` |
| Hermes artifacts produced before failure | `context.json`, `plan.json`, `database/vector_sources.json`, `database/database_sources.json`, `groups/group_A.json`, `groups/group_B.json`, `groups/group_C.json`, `research/research_A.json`, `research/research_B.json`, `research/research_C.json` |
| Missing artifacts | `research/consolidated.json`, `final/report.md` |
| Final status | failed before final Markdown |
| Root cause evidence | Hermes log reported `HTTP 402: Insufficient Balance` from the DeepSeek report-generation provider |
| Provider availability probe | 2026-07-11 provider probe from both `hermes-api` and `hermes-api-stageb-config-canary` classified the report base/model as DeepSeek and returned `402` / `invalid_request_error` / `Insufficient Balance`; a later production `hermes-api` recheck at 2026-07-11 23:27 CST returned the same `402` / `Insufficient Balance` result |
| Artifact path conclusion | The failure occurred before Hermes returned `REPORT_FILE`; it is not evidence of `/app/hermes-inbox` or `report-artifacts` mapping failure |
| Stage B production cutover | not performed |

`ResearchKeysService` now supports `HERMES_RESEARCH_KEYS_DIR`, and the Stage B canary mounts `/opt/hermes/workspace/report-agent/config` into the API at `/app/hermes-config`. That resolves the previous API-to-Hermes research-key propagation blocker without reintroducing the broad `/opt/hermes:/opt/data` mount. The current remaining Stage B blocker is external model/provider availability for a fresh full report-generation smoke: the active report-agent configuration is classified as DeepSeek for both base URL and model, and Hermes returned `HTTP 402: Insufficient Balance` during final report generation. Tavily quota does not address this failure because Tavily covers search/extraction, not the report-generation LLM call.

Canary cleanup:

- `hermes-api-stageb-canary` was stopped after Stage B validation.
- `hermes-api-stageb-canary-latest` was stopped after latest-image smoke validation.
- The older `hermes-api-artifact-canary` was also stopped after production redeploy validation.
- `hermes-api-stageb-config-canary` was stopped after post-failure provider and artifact inspection.
- Production `hermes-api` remains running on `0.0.0.0:1556->1555/tcp`.

Build and regression verification on 2026-07-11:

| Command | Result |
| --- | --- |
| `bash -n deploy.sh` | passed |
| `npx pnpm@9.15.9 build` | passed |
| `npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 build` | passed |
| `npx tsx tests/artifact-path-resolver.test.ts` | passed |
| `npx tsx tests/hermes-report-artifact-sync.test.ts` | passed |
| `npx tsx tests/report-artifacts-api.test.ts` | passed |
| `npx tsx tests/report-result-artifact-sanitization.test.ts` | passed |
| `npx tsx tests/source-channel-report-ref-filter.test.ts` | passed |
| `npx tsx tests/artifact-cors-download.test.ts` | passed |
| `npx tsx tests/reports-context-source-filter.test.ts` | passed |
| `npx tsx tests/context-multi-source-filter.test.ts` | passed |
| `npx tsx tests/source-cross-channel-dedup.test.ts` | passed |
| `npx tsx tests/crawler-report-integration.test.ts` | passed |
| `npx tsx tests/owner-isolation.test.ts` | passed |
| `npx tsx tests/account-permissions.test.ts` | passed; emitted expected development warning that `JWT_SECRET` is not configured |
| `npx tsx scripts/run-live-report-e2e-validation.ts` | passed disabled-path parse check |

Remaining non-artifact findings:

- The “database sufficient” scenario still triggered Web because database accepted count was `0`; this means the chosen scenario did not actually prove the no-Web branch.
- Final E2E showed references can exist when accepted source diagnostics are `0` in some scenarios. Therefore “references only from accepted sources” is not fully certified by this run.
- `acceptedWebUsed` in the E2E script remained `false` even when Web accepted counts were nonzero, so citation-to-accepted-Web traceability still needs a narrower follow-up audit.
- Production source API spot checks showed `report_refs` items have empty URL fields and `matchStatus=raw_only`; the same raw report-reference items can appear under `sources?type=tool_search`, so channel-level citation traceability is still not certified.
- Stage B production cutover was not performed. The API still keeps `/opt/hermes:/opt/data` during Stage A; latest-image no-legacy-mount canary report generation passed, narrow config propagation passed, but the latest narrow-config smoke failed before final Markdown because the configured DeepSeek report-generation provider returned `HTTP 402: Insufficient Balance`.

## Optional Next Run

Run only with explicit variables:

```bash
RUN_LIVE_REPORT_E2E_TESTS=true \
E2E_TEST_USERNAME=... E2E_TEST_PASSWORD=... \
E2E_PEER_USERNAME=... E2E_PEER_PASSWORD=... \
E2E_ADMIN_USERNAME=... E2E_ADMIN_PASSWORD=... \
E2E_BASE_URL=http://74.121.148.204:1556 \
npx tsx scripts/run-live-report-e2e-validation.ts
```

The script is intentionally excluded from default CI. A stronger follow-up rerun should replace the current “database sufficient” scenario with a topic that actually yields `acceptedDatabaseSources >= 3`, then re-check no-Web behavior and citation-to-accepted-source traceability.

## Conclusion

**Artifact migration Stage A: passed.**

Hermes writes reports under `/opt/data/workspace/report-agent/reports`; NestJS imports them through `/app/hermes-inbox:ro`; final Markdown is stored under `report-artifacts` as `reports/<jobId>/final/report.md`; result/download/artifacts APIs return `200`; artifact metadata exposed to frontend contains no server absolute paths; Vercel can log in, render a final report, display source channels, and log out.

Stage B is not complete. The broad API mount `/opt/hermes:/opt/data` remains intentionally retained in production. Latest-image Stage B canary report generation passed without that mount, and the narrow config mount design now covers API-to-Hermes research-key propagation. A later narrow-config Stage B canary failed before final Markdown because Hermes' configured DeepSeek report-generation provider returned `HTTP 402: Insufficient Balance`; this is an external model-provider availability blocker, not an Artifact mapping failure. The remaining open issues are source/citation certification gaps and provider availability for a fresh full Stage B production-cutover smoke, not blockers for the Stage A Artifact storage migration itself.

## 2026-07-12 Stage B Production Completion

This section supersedes the earlier Stage B blocker and conclusion above. DeepSeek service was restored, the Stage B production cutover was completed, and a post-cutover report finished successfully.

### Final production topology

| Item | Final state |
| --- | --- |
| Server | `74.121.148.204` / `bwg-us-204` |
| API / Hermes / PostgreSQL | `hermes-api` / `hermes` / `todo_postgres`, on the same Docker host and `hermes-net` |
| Deployment mode | `docker run` |
| Previous production image | `hermes-api:stageb-refs-20260712012303` |
| Final production image | `hermes-api:stageb-final-v2-20260712030252` |
| First Stage B production cutover | `20260712-014023` |
| Final reference/source persistence cutover | `20260712-030431` |
| Broad API mount `/opt/hermes:/opt/data` | removed |
| API mounts | `report-artifacts:/app/storage/artifacts` RW; `/opt/hermes/workspace/report-agent/reports:/app/hermes-inbox` RO; `/opt/hermes/workspace/report-agent/config:/app/hermes-config` RW |
| API user | `1000:1000` |
| Rollback | timestamped stopped rollback containers preserved; latest is `hermes-api-rollback-20260712-030431` |

The API no longer has `/opt/data`. The inbox read-only probe failed writes as expected; Artifact and config write probes passed. `report-artifacts` remains mounted at `/var/lib/docker/volumes/report-artifacts/_data`, owned for API uid/gid `1000:1000` with mode `0770`.

### Artifact transport and smoke

- Hermes still writes under `/opt/data/workspace/report-agent/reports` in the Hermes container.
- `ArtifactPathResolver` maps that remote root to `/app/hermes-inbox` in the API container.
- `ArtifactSyncService` uses `shared_volume` and imports the final Markdown into `report-artifacts`.
- Latest-image Stage B canary smoke: `9c0920f5-d969-4584-9f22-638cb61c3838`.
- Final production smoke: `53385afa-9f59-4c19-8320-be1d956b9cc4`.

| Production smoke evidence | Result |
| --- | --- |
| Status | `succeeded` |
| Artifact sync | `completed` |
| storageKey | `reports/53385afa-9f59-4c19-8320-be1d956b9cc4/final/report.md` |
| SHA-256 | `19a67cadb9fe83c09fc124d39f8c0c45489b4d3f8e961ce8b9f1ce4b93e8b141` |
| result / artifacts / download | `200 / 200 / 200` |
| Web supplement | database accepted `0`; queries `8`; search candidates `30`; fetched `14`; accepted Web `10`; filtered `9` |
| Source API after restart | Web items `10`; candidate detail items `35` |
| Internal path leak | none in result, artifacts, Markdown download, or browser page text |

The Artifact metadata SHA and downloaded Markdown SHA matched. Both `docker restart hermes-api` and a separate `docker stop hermes-api` / `docker start hermes-api` cycle were repeated on the final image; health returned `200`, Web source detail remained `10`, and the SHA remained unchanged.

### Four production E2E scenarios

| Scenario | Job ID | DB accepted | Web accepted | Artifact status | storageKey / SHA |
| --- | --- | ---: | ---: | --- | --- |
| Magnequench Web supplement | `5d2895e4-33e2-45c2-b304-119bfea1345a` | 0 | 10 | `completed`; result/artifacts/download `200` | `reports/5d2895e4-33e2-45c2-b304-119bfea1345a/final/report.md`; `98f0bb209092771856b3a81cd1c67d7df189a7ed0a3cb85a294f129c6a0f770a` |
| Database sufficient / no Web | `b0c39d2d-7df8-4cc5-8bd1-997df8f64b90` | 29 | 0 | `completed`; result/artifacts/download `200` | `reports/b0c39d2d-7df8-4cc5-8bd1-997df8f64b90/final/report.md`; `6200f986de3871d7603c981d0e90b89fd4e4a970e4323f61ac9105f9343fa252` |
| Arm entity-confusion guard | `d1f8d731-c5ab-4ad1-ae96-2648e173495f` | 0 | 1 | `completed`; result/artifacts/download `200` | `reports/d1f8d731-c5ab-4ad1-ae96-2648e173495f/final/report.md`; `391740059fb0859ee30bb1433b54cc03a0259eaa771efc55a1371bbced1386fc` |
| Insufficient evidence | `2d5887dd-04b4-403e-a476-6e63038266c5` | 0 | 0 | `completed`; result/artifacts/download `200` | `reports/2d5887dd-04b4-403e-a476-6e63038266c5/final/report.md`; `fc1fbd4054b73ce9d244136aea36fbc47b1810a88522c4404a1c39aca05da76e` |

Arm output contained no army/military/军队 contamination. The insufficient-evidence report kept accepted source and final reference counts at zero rather than filling from rejected candidates.

### Source persistence and final-reference guard

Production restart testing found that accepted Web diagnostics survived while source detail initially disappeared. Root cause: `toolSearchSources()` used the file-only `RemoteFileService.exists()` method to test directories and returned before reading the persisted Artifact `context.json`. The final implementation reads the persisted context directly and tolerates absent research directories. `tests/report-source-artifact-persistence.test.ts` reproduces the restart case.

Legacy reference sidecars also contained numbered “information gap” text incorrectly labeled as report references. The final implementation:

- stops reference parsing before credibility and information-gap sections;
- matches references only against accepted database, Web, or crawler sources;
- returns and persists only `matchStatus=matched` references;
- versions the sidecar with `referenceGuardVersion=2`, forcing old sidecars to rebuild;
- makes the frontend citation view consume the accepted backend reference endpoint instead of rebuilding raw Markdown references.

After rebuilding the five audited tasks, final-reference APIs returned no `raw_only`, missing-URL, out-of-accepted-set, or information-gap entries. Unprovable references are conservatively omitted.

### Authorization

For the final production smoke, detail/result/artifacts/sources/references/candidates/download returned:

| Role | Result |
| --- | --- |
| Owner | all `200` |
| Peer | all `403` |
| Admin | all `200` |

### Browser validation

Frontend commit `86aea03` (`Deploy report source validation UI`) was pushed to `origin/main` on 2026-07-12, triggering the repository's Vercel deployment. The production site at `https://hermes-gaogao.vercel.app` served the new bundle (`/assets/index-DeTiMnGm.js`) and was independently validated in the Codex in-app browser from 12:16 to 12:21 CST against the real production API.

The deployed Vercel application passed:

- Artifact sync display (`报告可查看`);
- supplement metrics (`0 / 8 / 30 / 14 / 10 / 9 / 10` for DB/query/candidate/fetched/accepted/rejected/final);
- all six source filters: `全部`, `数据库检索工具`, `资料采集工具`, `互联网搜索工具`, `最终引用`, and `被过滤候选`;
- 10 Web accepted rows and real filtered-candidate rows; the UI reported a candidate pool of 32 with 10 detailed rows on the first page;
- accepted-only final-reference empty state after legacy-cache rebuild;
- final Markdown rendering and Artifact state (`报告可查看`);
- an empty structured citation-evidence view for the legacy smoke report rather than unprovable references;
- no `/opt/data`, `/app/hermes-inbox`, or `/app/storage/artifacts` in page text or rendered links;
- zero browser console errors during the validation;
- logout returning the independent browser to the unauthenticated state.

The production smoke used for browser validation was `53385afa-9f59-4c19-8320-be1d956b9cc4`. Its displayed supplement metrics were database accepted `0`, queries `8`, search candidates `30`, fetched `14`, accepted Web `10`, filtered `9`, and final usable `10`. The conservative final-reference count remained `0`, matching the accepted-only backend guard for this legacy report.

### Final verification

On 2026-07-12:

- 22 targeted Artifact, permission, context, dedupe, Web guard, reference, persistence, and frontend source-display tests passed.
- `npx pnpm@9.15.9 build` passed.
- `npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 build` passed.
- `bash -n deploy.sh` passed.
- `git diff --check` passed.
- The Browserslist data-age warning is informational; it did not affect the frontend build.

### Updated conclusion

**Artifact migration Stage B: passed.** The production API no longer mounts `/opt/hermes:/opt/data`; the shared read-only inbox, named Artifact volume, standardized storageKey, API serving, access control, source-detail persistence, container restart persistence, and full post-cutover report smoke are verified on the real host.

**Overall release gate: passed.** The latest frontend is deployed on Vercel, consumes the production Artifact/report APIs, renders the accepted Web and filtered-candidate views, preserves the accepted-only reference boundary, exposes no internal storage paths, and completes login-to-logout validation against the real production stack.

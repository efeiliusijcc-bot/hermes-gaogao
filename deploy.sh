#!/bin/bash
set -Eeuo pipefail
export COPYFILE_DISABLE=1

if [ ! -f .env ]; then
  echo "Missing .env. Copy .env.example and fill deployment values."
  exit 1
fi

ENV_FILE=$(mktemp)
sed '1s/^\xef\xbb\xbf//' .env | tr -d '\r' > "$ENV_FILE"
set -a
source "$ENV_FILE"
set +a
rm -f "$ENV_FILE"

: "${REMOTE_HOST:?Missing REMOTE_HOST}"
: "${REMOTE_USER:?Missing REMOTE_USER}"
: "${SSH_KEY:=~/.ssh/hermes_bwg_us_204_ed25519}"
: "${HERMES_API_KEY:?Missing HERMES_API_KEY}"
: "${PGVECTOR_DATABASE_URL:?Missing PGVECTOR_DATABASE_URL}"
: "${JWT_SECRET:?Missing JWT_SECRET}"
: "${DAILY_AWARENESS_INTERNAL_EVENT_KEY:?Missing DAILY_AWARENESS_INTERNAL_EVENT_KEY}"
: "${AUTH_DATABASE_URL:=${PGVECTOR_DATABASE_URL%/*}/hermes_auth}"
: "${BOOTSTRAP_ADMIN_PASSWORD:?Missing BOOTSTRAP_ADMIN_PASSWORD}"

if [ "${#BOOTSTRAP_ADMIN_PASSWORD}" -lt 16 ]; then
  echo "BOOTSTRAP_ADMIN_PASSWORD must be at least 16 characters." >&2
  exit 1
fi
ROTATE_BOOTSTRAP_ADMIN_PASSWORD="${ROTATE_BOOTSTRAP_ADMIN_PASSWORD:-false}"
ROTATE_BOOTSTRAP_ADMIN_PASSWORD=$(printf '%s' "$ROTATE_BOOTSTRAP_ADMIN_PASSWORD" | tr '[:upper:]' '[:lower:]')
case "$ROTATE_BOOTSTRAP_ADMIN_PASSWORD" in
  true|false) ;;
  *)
    echo "ROTATE_BOOTSTRAP_ADMIN_PASSWORD must be true or false." >&2
    exit 1
    ;;
esac

BOOTSTRAP_ADMIN_PASSWORD_HASH=$(
  BOOTSTRAP_ADMIN_PASSWORD="$BOOTSTRAP_ADMIN_PASSWORD" node --input-type=module -e \
    "import bcrypt from 'bcrypt'; process.stdout.write(await bcrypt.hash(process.env.BOOTSTRAP_ADMIN_PASSWORD, 12));"
)

REMOTE_DIR=/usr/docker/hermes-api
RELEASE_ID="$(date +%Y%m%d-%H%M%S)-$$"
SRC_DIR=$REMOTE_DIR/releases/$RELEASE_ID
REMOTE_ENV_FILE=$REMOTE_DIR/hermes-api.env
REMOTE_BOOTSTRAP_FILE=$REMOTE_DIR/bootstrap-$RELEASE_ID.secret
HERMES_API_LEGACY_DATA_MOUNT="${HERMES_API_LEGACY_DATA_MOUNT:-true}"
if [[ "$HERMES_API_LEGACY_DATA_MOUNT" == "false" ]]; then
  DEFAULT_HERMES_STATE_DIR=/app/storage/artifacts/hermes-state
else
  DEFAULT_HERMES_STATE_DIR=/opt/data
fi
DEFAULT_HERMES_RESEARCH_KEYS_DIR=/app/hermes-config

DEPLOY_ENV_FILE=$(mktemp)
DEPLOY_BOOTSTRAP_FILE=$(mktemp)
cleanup_local_files() {
  rm -f "$DEPLOY_ENV_FILE" "$DEPLOY_BOOTSTRAP_FILE"
}
trap cleanup_local_files EXIT

printf '%s\n%s\n' "$BOOTSTRAP_ADMIN_PASSWORD_HASH" "$ROTATE_BOOTSTRAP_ADMIN_PASSWORD" > "$DEPLOY_BOOTSTRAP_FILE"
chmod 600 "$DEPLOY_BOOTSTRAP_FILE"

write_env() {
  local key="$1"
  local value="${2-}"
  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    echo "Environment value for $key contains a newline; refusing to write deploy env-file." >&2
    exit 1
  fi
  printf '%s=%s\n' "$key" "$value" >> "$DEPLOY_ENV_FILE"
}

write_env PORT "1555"
write_env HERMES_API_LEGACY_DATA_MOUNT "$HERMES_API_LEGACY_DATA_MOUNT"
write_env HERMES_STATE_DIR "${HERMES_STATE_DIR:-$DEFAULT_HERMES_STATE_DIR}"
write_env HERMES_RESEARCH_KEYS_DIR "${HERMES_RESEARCH_KEYS_DIR:-$DEFAULT_HERMES_RESEARCH_KEYS_DIR}"
write_env HERMES_RUN_MODE "${HERMES_RUN_MODE:-runs}"
write_env HERMES_BASE_URL "${HERMES_BASE_URL:-http://hermes:8642/v1}"
write_env HERMES_HEALTH_URL "${HERMES_HEALTH_URL:-http://hermes:8642/health}"
write_env HERMES_RUNS_URL "${HERMES_RUNS_URL:-http://hermes:8642/v1/runs}"
write_env HERMES_API_KEY "$HERMES_API_KEY"
write_env TAVILY_API_KEY "${TAVILY_API_KEY:-}"
write_env JWT_SECRET "$JWT_SECRET"
write_env AUTH_DATABASE_URL "$AUTH_DATABASE_URL"
write_env DAILY_AWARENESS_INTERNAL_EVENT_KEY "$DAILY_AWARENESS_INTERNAL_EVENT_KEY"
write_env DAILY_AWARENESS_WORKER_POLL_MS "${DAILY_AWARENESS_WORKER_POLL_MS:-2000}"
write_env DAILY_AWARENESS_INBOX_LEASE_SECONDS "${DAILY_AWARENESS_INBOX_LEASE_SECONDS:-300}"
write_env DAILY_AWARENESS_INBOX_MAX_ATTEMPTS "${DAILY_AWARENESS_INBOX_MAX_ATTEMPTS:-5}"
write_env DAILY_AWARENESS_INBOX_RETRY_SECONDS "${DAILY_AWARENESS_INBOX_RETRY_SECONDS:-30}"
write_env DAILY_AWARENESS_MYSQL_HOST "${DAILY_AWARENESS_MYSQL_HOST:-my_mysql}"
write_env DAILY_AWARENESS_MYSQL_PORT "${DAILY_AWARENESS_MYSQL_PORT:-3306}"
write_env DAILY_AWARENESS_MYSQL_DATABASE "${DAILY_AWARENESS_MYSQL_DATABASE:-news}"
write_env DAILY_AWARENESS_MYSQL_USER "${DAILY_AWARENESS_MYSQL_USER:-root}"
write_env DAILY_AWARENESS_MYSQL_PASSWORD "${DAILY_AWARENESS_MYSQL_PASSWORD:-}"
write_env DAILY_AWARENESS_MYSQL_TABLE_PREFIX "${DAILY_AWARENESS_MYSQL_TABLE_PREFIX:-data_}"
write_env DAILY_AWARENESS_AUTO_ENABLED "${DAILY_AWARENESS_AUTO_ENABLED:-true}"
write_env DAILY_AWARENESS_AUTO_TIME "${DAILY_AWARENESS_AUTO_TIME:-06:00}"
write_env DAILY_AWARENESS_AUTO_TIMEZONE "${DAILY_AWARENESS_AUTO_TIMEZONE:-Asia/Shanghai}"
write_env DAILY_AWARENESS_SOURCE_DAY_OFFSET "${DAILY_AWARENESS_SOURCE_DAY_OFFSET:-1}"
write_env DAILY_AWARENESS_DATA_RETRY_MINUTES "${DAILY_AWARENESS_DATA_RETRY_MINUTES:-15}"
write_env DAILY_AWARENESS_DATA_WAIT_UNTIL "${DAILY_AWARENESS_DATA_WAIT_UNTIL:-08:00}"
write_env DAILY_AWARENESS_SCHEDULER_POLL_MS "${DAILY_AWARENESS_SCHEDULER_POLL_MS:-60000}"
write_env FRONTEND_ORIGINS "${FRONTEND_ORIGINS:-https://hermes-gaogao.vercel.app,http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173,http://127.0.0.1:3000}"
write_env HERMES_MODEL "${HERMES_MODEL:-hermes-agent}"
write_env HERMES_QA_AGENT_ID "${HERMES_QA_AGENT_ID:-qa-agent}"
write_env HERMES_QA_MODEL "${HERMES_QA_MODEL:-openclaw/qa-agent}"
write_env HERMES_QA_MODE "${HERMES_QA_MODE:-direct_pg}"
write_env HERMES_QA_TIMEOUT_MS "${HERMES_QA_TIMEOUT_MS:-900000}"
write_env DIRECT_QA_BASE_URL "${DIRECT_QA_BASE_URL:-https://dashscope.aliyuncs.com/compatible-mode/v1}"
write_env DIRECT_QA_API_KEY "${DIRECT_QA_API_KEY:-${OPENAI_API_KEY:-}}"
write_env DIRECT_QA_MODEL "${DIRECT_QA_MODEL:-deepseek-v4-flash}"
write_env REPORT_AGENT_BASE_URL "${REPORT_AGENT_BASE_URL:-${DIRECT_QA_BASE_URL:-https://dashscope.aliyuncs.com/compatible-mode/v1}}"
write_env REPORT_AGENT_API_KEY "${REPORT_AGENT_API_KEY:-${DIRECT_QA_API_KEY:-${OPENAI_API_KEY:-}}}"
write_env REPORT_AGENT_MODEL "${REPORT_AGENT_MODEL:-${DIRECT_QA_MODEL:-deepseek-v4-flash}}"
write_env INTERNAL_SKILL_TOKEN "${INTERNAL_SKILL_TOKEN:-}"
write_env ARTIFACT_STORAGE_MODE "${ARTIFACT_STORAGE_MODE:-local}"
write_env ARTIFACT_LOCAL_ROOT "${ARTIFACT_LOCAL_ROOT:-/app/storage/artifacts}"
write_env HERMES_ARTIFACT_TRANSPORT "${HERMES_ARTIFACT_TRANSPORT:-shared_volume}"
write_env HERMES_REMOTE_HOST ""
write_env REPORT_OUTPUT_DIR "/app/storage/artifacts"
write_env HERMES_REMOTE_REPORT_DIR "${HERMES_REMOTE_REPORT_DIR:-/opt/hermes/workspace/report-agent/reports}"
write_env HERMES_REMOTE_REPORT_ROOT "${HERMES_REMOTE_REPORT_ROOT:-/opt/data/workspace/report-agent/reports}"
write_env HERMES_SHARED_REPORT_ROOT "${HERMES_SHARED_REPORT_ROOT:-/app/hermes-inbox}"
write_env HERMES_CONTAINER_REPORT_DIR "${HERMES_CONTAINER_REPORT_DIR:-/opt/data/workspace/report-agent/reports}"
write_env HERMES_REMOTE_CONTAINER_REPORT_DIR "${HERMES_REMOTE_CONTAINER_REPORT_DIR:-/opt/data/workspace/report-agent/reports}"
write_env HERMES_REMOTE_OUTPUT_DIR "${HERMES_REMOTE_OUTPUT_DIR:-/opt/data/workspace/report-agent/reports}"
write_env HERMES_LOCAL_OUTPUT_DIR "${HERMES_LOCAL_OUTPUT_DIR:-/app/storage/artifacts}"
write_env PGVECTOR_DATABASE_URL "$PGVECTOR_DATABASE_URL"
write_env PGVECTOR_NEWS_TABLE "${PGVECTOR_NEWS_TABLE:-vector_materials_text_embedding_v4}"
write_env PGVECTOR_EMBEDDING_MODEL "${PGVECTOR_EMBEDDING_MODEL:-text-embedding-v4}"
write_env PGVECTOR_EMBEDDING_DIMENSIONS "${PGVECTOR_EMBEDDING_DIMENSIONS:-1024}"
write_env PGVECTOR_EMBEDDING_INPUT_CHARS "${PGVECTOR_EMBEDDING_INPUT_CHARS:-600}"
write_env PGVECTOR_EMBEDDING_BASE_URL "${PGVECTOR_EMBEDDING_BASE_URL:-https://dashscope.aliyuncs.com/compatible-mode/v1}"
write_env HYBRID_RETRIEVAL_ENABLED "${HYBRID_RETRIEVAL_ENABLED:-1}"
write_env OPENAI_API_KEY "${OPENAI_API_KEY:-}"

echo "=== 1. Upload backend source ==="
ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" "
  rm -rf '$SRC_DIR'
  mkdir -p '$SRC_DIR/server/artifact-storage' '$SRC_DIR/server/reports' '$SRC_DIR/server/migrations' '$SRC_DIR/src/types' '$SRC_DIR/scripts' /opt/hermes/workspace/report-agent/agents /opt/hermes/workspace/report-agent/skills
  rm -f /opt/hermes/workspace/report-agent/agents/source-collection-agent.md
  rm -rf /opt/hermes/workspace/report-agent/skills/controlled-web-collector
"

scp -i "$SSH_KEY" \
  package.json pnpm-lock.yaml tsconfig.server.json Dockerfile \
  "$REMOTE_USER@$REMOTE_HOST:$SRC_DIR/"

scp -i "$SSH_KEY" server/*.ts "$REMOTE_USER@$REMOTE_HOST:$SRC_DIR/server/"
scp -i "$SSH_KEY" server/artifact-storage/*.ts "$REMOTE_USER@$REMOTE_HOST:$SRC_DIR/server/artifact-storage/"
scp -i "$SSH_KEY" -r server/reports "$REMOTE_USER@$REMOTE_HOST:$SRC_DIR/server/"
scp -i "$SSH_KEY" server/migrations/20260714_hybrid_retrieval.sql "$REMOTE_USER@$REMOTE_HOST:$SRC_DIR/server/migrations/"
scp -i "$SSH_KEY" src/types/report.ts "$REMOTE_USER@$REMOTE_HOST:$SRC_DIR/src/types/"
scp -i "$SSH_KEY" \
  scripts/init-auth-users.sql scripts/init-chat-sessions.sql scripts/init-draft-assistant.sql \
  scripts/init-report-plans.sql scripts/init-daily-awareness.sql scripts/init-rbac.sql \
  scripts/init-audit-logs.sql scripts/init-user-preferences.sql scripts/init-report-edits.sql \
  scripts/init-crawler.sql scripts/init-report-quality-reviews.sql \
  scripts/backfill-hybrid-retrieval.ts scripts/install-hybrid-retrieval-timer.sh \
  scripts/uninstall-hybrid-retrieval-timer.sh \
  "$REMOTE_USER@$REMOTE_HOST:$SRC_DIR/scripts/"

scp -i "$SSH_KEY" agents/*.md "$REMOTE_USER@$REMOTE_HOST:/opt/hermes/workspace/report-agent/agents/"
scp -r -i "$SSH_KEY" skills/planning-source-collection "$REMOTE_USER@$REMOTE_HOST:/opt/hermes/workspace/report-agent/skills/"
scp -i "$SSH_KEY" "$DEPLOY_ENV_FILE" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_ENV_FILE.tmp"
ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" "install -m 600 '$REMOTE_ENV_FILE.tmp' '$REMOTE_ENV_FILE' && rm -f '$REMOTE_ENV_FILE.tmp'"
scp -i "$SSH_KEY" "$DEPLOY_BOOTSTRAP_FILE" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_BOOTSTRAP_FILE.tmp"
ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" "install -m 600 '$REMOTE_BOOTSTRAP_FILE.tmp' '$REMOTE_BOOTSTRAP_FILE' && rm -f '$REMOTE_BOOTSTRAP_FILE.tmp'"
ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" "find '$SRC_DIR/server' -type f -name '._*' -delete"

echo "=== 2. Build and deploy backend remotely ==="
ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" << REMOTE_SCRIPT
set -Eeuo pipefail

REMOTE_DIR=/usr/docker/hermes-api
SRC_DIR=$SRC_DIR
REMOTE_ENV_FILE=$REMOTE_ENV_FILE
REMOTE_BOOTSTRAP_FILE=$REMOTE_BOOTSTRAP_FILE
trap 'rm -f "\$REMOTE_BOOTSTRAP_FILE"' EXIT
mapfile -t BOOTSTRAP_VALUES < "\$REMOTE_BOOTSTRAP_FILE"
BOOTSTRAP_ADMIN_PASSWORD_HASH="\${BOOTSTRAP_VALUES[0]:-}"
ROTATE_BOOTSTRAP_ADMIN_PASSWORD="\${BOOTSTRAP_VALUES[1]:-false}"
if [ -z "\$BOOTSTRAP_ADMIN_PASSWORD_HASH" ]; then
  echo "Missing administrator bootstrap hash." >&2
  exit 1
fi
set -a
. "\$REMOTE_ENV_FILE"
set +a
cd "\$SRC_DIR"

echo "--- Build image ---"
IMAGE_TAG=hermes-api:$RELEASE_ID
docker build -t "\$IMAGE_TAG" .

echo "--- Apply database migrations ---"
AUTH_DATABASE_NAME="\${AUTH_DATABASE_URL##*/}"
AUTH_DATABASE_NAME="\${AUTH_DATABASE_NAME%%\?*}"
docker exec todo_postgres psql -U postgres -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '\$AUTH_DATABASE_NAME'" | grep -q 1 \
  || docker exec todo_postgres createdb -U postgres "\$AUTH_DATABASE_NAME"
docker exec -i todo_postgres psql -v ON_ERROR_STOP=1 \
  -v bootstrap_admin_password_hash="\$BOOTSTRAP_ADMIN_PASSWORD_HASH" \
  -v rotate_bootstrap_admin_password="\$ROTATE_BOOTSTRAP_ADMIN_PASSWORD" \
  "\$AUTH_DATABASE_URL" < scripts/init-auth-users.sql
docker exec -i todo_postgres psql "\$AUTH_DATABASE_URL" < scripts/init-chat-sessions.sql
docker exec -i todo_postgres psql "\$AUTH_DATABASE_URL" < scripts/init-draft-assistant.sql
docker exec -i todo_postgres psql "\$AUTH_DATABASE_URL" < scripts/init-report-plans.sql
docker exec -i todo_postgres psql -v ON_ERROR_STOP=1 "\$AUTH_DATABASE_URL" < scripts/init-daily-awareness.sql
docker exec -i todo_postgres psql -v ON_ERROR_STOP=1 "\$AUTH_DATABASE_URL" < scripts/init-rbac.sql
docker exec -i todo_postgres psql "\$AUTH_DATABASE_URL" < scripts/init-audit-logs.sql
docker exec -i todo_postgres psql "\$AUTH_DATABASE_URL" < scripts/init-user-preferences.sql
docker exec -i todo_postgres psql "\$AUTH_DATABASE_URL" < scripts/init-report-edits.sql
docker exec -i todo_postgres psql "\$AUTH_DATABASE_URL" < scripts/init-crawler.sql
docker exec -i todo_postgres psql "\$AUTH_DATABASE_URL" < scripts/init-report-quality-reviews.sql
docker exec -i todo_postgres psql -v ON_ERROR_STOP=1 "\$PGVECTOR_DATABASE_URL" < server/migrations/20260714_hybrid_retrieval.sql

echo "--- Ensure shared Docker network ---"
docker network create hermes-net 2>/dev/null || true
docker network connect --alias hermes hermes-net hermes 2>/dev/null || true
docker network connect --alias todo_postgres hermes-net todo_postgres 2>/dev/null || true
docker network connect --alias my_mysql hermes-net my_mysql 2>/dev/null || true

echo "--- Ensure report artifact volumes ---"
docker volume create report-artifacts >/dev/null
mkdir -p /opt/hermes/workspace/report-agent/reports
mkdir -p /opt/hermes/workspace/report-agent/config
chown -R 1000:1000 /opt/hermes/workspace/report-agent/config
chmod 700 /opt/hermes/workspace/report-agent/config
find /opt/hermes/workspace/report-agent/config -maxdepth 1 -type f -exec chmod 600 {} \;
if command -v setfacl >/dev/null 2>&1; then
  setfacl -R -m u:1000:rX /opt/hermes/workspace/report-agent/reports || true
  setfacl -R -m d:u:1000:rX /opt/hermes/workspace/report-agent/reports || true
  setfacl -R -m u:1000:rwX /opt/hermes/workspace/report-agent/config || true
  setfacl -R -m d:u:1000:rwX /opt/hermes/workspace/report-agent/config || true
  cat >/usr/local/sbin/hermes-report-acl-watch.sh <<'ACL_WATCH'
#!/bin/sh
set -eu
REPORT_DIR=\${HERMES_REPORT_DIR:-/opt/hermes/workspace/report-agent/reports}
while true; do
  if [ -d "\$REPORT_DIR" ]; then
    setfacl -R -m u:1000:rX "\$REPORT_DIR" 2>/dev/null || true
    setfacl -R -m d:u:1000:rX "\$REPORT_DIR" 2>/dev/null || true
  fi
  sleep 5
done
ACL_WATCH
  chmod 755 /usr/local/sbin/hermes-report-acl-watch.sh
  if [ -f /run/hermes-report-acl-watch.pid ] && kill -0 "\$(cat /run/hermes-report-acl-watch.pid)" 2>/dev/null; then
    :
  else
    nohup /usr/local/sbin/hermes-report-acl-watch.sh >/var/log/hermes-report-acl-watch.log 2>&1 &
    echo \$! >/run/hermes-report-acl-watch.pid
  fi
else
  echo "WARNING: setfacl is unavailable; API uid 1000 may not be able to read root-owned Hermes reports." >&2
fi
docker run --rm --user 0:0 \
  --mount type=volume,source=report-artifacts,target=/data \
  alpine:3.20 \
  sh -lc 'chown -R 1000:1000 /data && chmod 770 /data'

run_api_container() {
  local name="\$1"
  local restart_policy="\$2"
  local publish_port="\${3:-false}"
  local scheduler_enabled="\${4:-}"
  local stage_label="hermes.stage=artifact-stage-a"
  local publish_args=()
  local scheduler_args=()
  local legacy_mount_args=(--mount type=bind,src=/opt/hermes,dst=/opt/data)
  if [ "\${HERMES_API_LEGACY_DATA_MOUNT:-true}" = "false" ]; then
    stage_label="hermes.stage=artifact-stage-b"
    legacy_mount_args=()
  fi
  if [ "\$publish_port" = "true" ]; then
    publish_args=(-p 1556:1555)
  fi
  if [ -n "\$scheduler_enabled" ]; then
    scheduler_args=(-e "DAILY_AWARENESS_AUTO_ENABLED=\$scheduler_enabled")
  fi

  docker run -d \
    --label "\$stage_label" \
    --name "\$name" \
    --network hermes-net \
    --restart="\$restart_policy" \
    --user 1000:1000 \
    "\${publish_args[@]}" \
    --env-file "\$REMOTE_ENV_FILE" \
    "\${scheduler_args[@]}" \
    --mount type=volume,source=report-artifacts,target=/app/storage/artifacts \
    --mount type=bind,src=/opt/hermes/workspace/report-agent/reports,dst=/app/hermes-inbox,readonly \
    --mount type=bind,src=/opt/hermes/workspace/report-agent/config,dst=/app/hermes-config \
    "\${legacy_mount_args[@]}" \
    "\$IMAGE_TAG"
}

wait_container_health() {
  local name="\$1"
  local attempt
  for attempt in \$(seq 1 30); do
    if docker exec "\$name" node -e \
      "fetch('http://127.0.0.1:1555/api/hermes/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"; then
      return 0
    fi
    sleep 1
  done
  docker logs --tail 80 "\$name" >&2 || true
  return 1
}

echo "--- Validate candidate hermes-api container ---"
TS=\$(date +%Y%m%d-%H%M%S)
CANDIDATE_NAME="hermes-api-candidate-\$TS"
ROLLBACK_NAME=""
LIVE_REPLACED=false
FINAL_STARTED=false

rollback_deploy() {
  local exit_code=\$?
  set +e
  [ -z "\$CANDIDATE_NAME" ] || docker rm -f "\$CANDIDATE_NAME" >/dev/null 2>&1
  if [ "\$LIVE_REPLACED" = "true" ]; then
    if [ "\$FINAL_STARTED" = "true" ]; then
      docker rm -f hermes-api >/dev/null 2>&1
    fi
    if [ -n "\$ROLLBACK_NAME" ] && docker inspect "\$ROLLBACK_NAME" >/dev/null 2>&1; then
      docker rename "\$ROLLBACK_NAME" hermes-api
      docker start hermes-api >/dev/null
      echo "Deployment failed; previous hermes-api was restored." >&2
    elif docker inspect hermes-api >/dev/null 2>&1; then
      docker start hermes-api >/dev/null
    fi
  fi
  exit "\$exit_code"
}
trap 'rollback_deploy' ERR

docker rm -f "\$CANDIDATE_NAME" >/dev/null 2>&1 || true
run_api_container "\$CANDIDATE_NAME" no false false
docker exec "\$CANDIDATE_NAME" getent hosts todo_postgres
docker exec "\$CANDIDATE_NAME" getent hosts my_mysql
wait_container_health "\$CANDIDATE_NAME"
docker rm -f "\$CANDIDATE_NAME" >/dev/null
CANDIDATE_NAME=""

echo "--- Replace hermes-api container ---"
LIVE_REPLACED=true
if docker inspect hermes-api >/dev/null 2>&1; then
  ROLLBACK_NAME="hermes-api-rollback-\$TS"
  docker stop hermes-api
  docker rename hermes-api "\$ROLLBACK_NAME"
  echo "Previous hermes-api kept as \$ROLLBACK_NAME"
fi

run_api_container hermes-api unless-stopped true
FINAL_STARTED=true
docker exec hermes-api getent hosts todo_postgres
docker exec hermes-api getent hosts my_mysql
wait_container_health hermes-api
curl -fsS http://127.0.0.1:1556/api/hermes/health
INTERNAL_EVENT_CHECK=\$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST http://127.0.0.1:1556/internal/events/daily-data-finished \
  -H 'Content-Type: application/json' \
  -H "X-Hermes-Internal-Key: \$DAILY_AWARENESS_INTERNAL_EVENT_KEY" \
  -d '{}')
if [ "\$INTERNAL_EVENT_CHECK" != "400" ]; then
  echo "Daily awareness internal event contract check failed with HTTP \$INTERNAL_EVENT_CHECK" >&2
  exit 1
fi
LIVE_REPLACED=false
trap - ERR

docker ps --filter name=hermes-api --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
docker logs --tail 30 hermes-api
chmod +x scripts/install-hybrid-retrieval-timer.sh scripts/uninstall-hybrid-retrieval-timer.sh
HYBRID_FLAG="\$(printf '%s' "\${HYBRID_RETRIEVAL_ENABLED:-1}" | tr '[:upper:]' '[:lower:]')"
HYBRID_SOURCE_TABLE="\${PGVECTOR_NEWS_TABLE:-vector_materials_text_embedding_v4}"
case "\$HYBRID_FLAG" in
  0|false|off) scripts/uninstall-hybrid-retrieval-timer.sh ;;
  *)
    if [[ "\$HYBRID_SOURCE_TABLE" == "vector_materials_text_embedding_v4" ]]; then
      scripts/install-hybrid-retrieval-timer.sh
    else
      scripts/uninstall-hybrid-retrieval-timer.sh
    fi
    ;;
esac

mapfile -t OLD_RELEASES < <(find "\$REMOTE_DIR/releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r | tail -n +6)
for release_name in "\${OLD_RELEASES[@]}"; do
  rm -rf -- "\$REMOTE_DIR/releases/\$release_name"
done
REMOTE_SCRIPT

echo "=== Deploy complete ==="

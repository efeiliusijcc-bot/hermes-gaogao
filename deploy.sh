#!/bin/bash
set -euo pipefail

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
: "${SSH_KEY:=~/.ssh/id_ed25519}"
: "${HERMES_API_KEY:?Missing HERMES_API_KEY}"
: "${PGVECTOR_DATABASE_URL:?Missing PGVECTOR_DATABASE_URL}"
: "${JWT_SECRET:?Missing JWT_SECRET}"
: "${AUTH_DATABASE_URL:=${PGVECTOR_DATABASE_URL%/*}/hermes_auth}"

REMOTE_DIR=/usr/docker/hermes-api
SRC_DIR=$REMOTE_DIR/src

echo "=== 1. Upload backend source ==="
ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" "mkdir -p '$SRC_DIR/server' '$SRC_DIR/src/types' '$SRC_DIR/scripts'"

scp -i "$SSH_KEY" \
  package.json pnpm-lock.yaml tsconfig.server.json Dockerfile \
  "$REMOTE_USER@$REMOTE_HOST:$SRC_DIR/"

scp -i "$SSH_KEY" server/*.ts "$REMOTE_USER@$REMOTE_HOST:$SRC_DIR/server/"
scp -i "$SSH_KEY" src/types/report.ts "$REMOTE_USER@$REMOTE_HOST:$SRC_DIR/src/types/"
scp -i "$SSH_KEY" \
  scripts/init-auth-users.sql scripts/init-chat-sessions.sql scripts/init-draft-assistant.sql \
  scripts/init-report-plans.sql scripts/init-daily-awareness.sql scripts/init-rbac.sql \
  scripts/init-audit-logs.sql scripts/init-user-preferences.sql scripts/init-report-edits.sql \
  "$REMOTE_USER@$REMOTE_HOST:$SRC_DIR/scripts/"

echo "=== 2. Build and deploy backend remotely ==="
ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" << REMOTE_SCRIPT
set -euo pipefail

SRC_DIR=/usr/docker/hermes-api/src
AUTH_DATABASE_URL='${AUTH_DATABASE_URL}'
cd "\$SRC_DIR"

echo "--- Build image ---"
IMAGE_TAG=hermes-api:latest
docker build -t "\$IMAGE_TAG" .

echo "--- Apply database migrations ---"
AUTH_DATABASE_NAME="\${AUTH_DATABASE_URL##*/}"
AUTH_DATABASE_NAME="\${AUTH_DATABASE_NAME%%\?*}"
docker exec todo_postgres psql -U postgres -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '\$AUTH_DATABASE_NAME'" | grep -q 1 \
  || docker exec todo_postgres createdb -U postgres "\$AUTH_DATABASE_NAME"
docker exec -i todo_postgres psql "${AUTH_DATABASE_URL}" < scripts/init-auth-users.sql
docker exec -i todo_postgres psql "${AUTH_DATABASE_URL}" < scripts/init-chat-sessions.sql
docker exec -i todo_postgres psql "${AUTH_DATABASE_URL}" < scripts/init-draft-assistant.sql
docker exec -i todo_postgres psql "${AUTH_DATABASE_URL}" < scripts/init-report-plans.sql
docker exec -i todo_postgres psql "${AUTH_DATABASE_URL}" < scripts/init-daily-awareness.sql
docker exec -i todo_postgres psql "${AUTH_DATABASE_URL}" < scripts/init-rbac.sql
docker exec -i todo_postgres psql "${AUTH_DATABASE_URL}" < scripts/init-audit-logs.sql
docker exec -i todo_postgres psql "${AUTH_DATABASE_URL}" < scripts/init-user-preferences.sql
docker exec -i todo_postgres psql "${AUTH_DATABASE_URL}" < scripts/init-report-edits.sql

echo "--- Ensure shared Docker network ---"
docker network create hermes-net 2>/dev/null || true
docker network connect --alias hermes hermes-net hermes 2>/dev/null || true
docker network connect --alias todo_postgres hermes-net todo_postgres 2>/dev/null || true

echo "--- Replace hermes-api container ---"
docker stop hermes-api 2>/dev/null || true
docker rm hermes-api 2>/dev/null || true

docker run -d \
  --name hermes-api \
  --network hermes-net \
  --restart=unless-stopped \
  --user 0:0 \
  -p 1556:1555 \
  -e PORT=1555 \
  -e HERMES_STATE_DIR=/opt/data \
  -e HERMES_RUN_MODE=${HERMES_RUN_MODE:-runs} \
  -e HERMES_BASE_URL=${HERMES_BASE_URL:-http://hermes:8642/v1} \
  -e HERMES_HEALTH_URL=${HERMES_HEALTH_URL:-http://hermes:8642/health} \
  -e HERMES_RUNS_URL=${HERMES_RUNS_URL:-http://hermes:8642/v1/runs} \
  -e HERMES_API_KEY=${HERMES_API_KEY} \
  -e JWT_SECRET=${JWT_SECRET} \
  -e AUTH_DATABASE_URL=${AUTH_DATABASE_URL} \
  -e HERMES_MODEL=${HERMES_MODEL:-hermes-agent} \
  -e HERMES_QA_AGENT_ID=${HERMES_QA_AGENT_ID:-qa-agent} \
  -e HERMES_QA_MODEL=${HERMES_QA_MODEL:-openclaw/qa-agent} \
  -e HERMES_QA_MODE=${HERMES_QA_MODE:-direct_pg} \
  -e HERMES_QA_TIMEOUT_MS=${HERMES_QA_TIMEOUT_MS:-900000} \
  -e DIRECT_QA_BASE_URL=${DIRECT_QA_BASE_URL:-https://dashscope.aliyuncs.com/compatible-mode/v1} \
  -e DIRECT_QA_API_KEY=${DIRECT_QA_API_KEY:-${OPENAI_API_KEY:-}} \
  -e DIRECT_QA_MODEL=${DIRECT_QA_MODEL:-deepseek-v4-flash} \
  -e REPORT_AGENT_BASE_URL=${REPORT_AGENT_BASE_URL:-${DIRECT_QA_BASE_URL:-https://dashscope.aliyuncs.com/compatible-mode/v1}} \
  -e REPORT_AGENT_API_KEY=${REPORT_AGENT_API_KEY:-${DIRECT_QA_API_KEY:-${OPENAI_API_KEY:-}}} \
  -e REPORT_AGENT_MODEL=${REPORT_AGENT_MODEL:-${DIRECT_QA_MODEL:-deepseek-v4-flash}} \
  -e HERMES_REMOTE_HOST= \
  -e REPORT_OUTPUT_DIR=/opt/data/workspace/report-agent/reports \
  -e HERMES_REMOTE_REPORT_DIR=/opt/hermes/workspace/report-agent/reports \
  -e HERMES_CONTAINER_REPORT_DIR=/opt/data/workspace/report-agent/reports \
  -e HERMES_REMOTE_CONTAINER_REPORT_DIR=/opt/data/workspace/report-agent/reports \
  -e PGVECTOR_DATABASE_URL=${PGVECTOR_DATABASE_URL} \
  -e PGVECTOR_NEWS_TABLE=${PGVECTOR_NEWS_TABLE:-vector_materials_text_embedding_v4} \
  -e PGVECTOR_EMBEDDING_MODEL=${PGVECTOR_EMBEDDING_MODEL:-text-embedding-v4} \
  -e PGVECTOR_EMBEDDING_DIMENSIONS=${PGVECTOR_EMBEDDING_DIMENSIONS:-1024} \
  -e PGVECTOR_EMBEDDING_INPUT_CHARS=${PGVECTOR_EMBEDDING_INPUT_CHARS:-600} \
  -e PGVECTOR_EMBEDDING_BASE_URL=${PGVECTOR_EMBEDDING_BASE_URL:-https://dashscope.aliyuncs.com/compatible-mode/v1} \
  -e OPENAI_API_KEY=${OPENAI_API_KEY:-} \
  -v /opt/hermes:/opt/data \
  "\$IMAGE_TAG"

sleep 3
docker exec hermes-api getent hosts todo_postgres
curl -fsS http://127.0.0.1:1556/api/hermes/health
AUTH_TOKEN=\$(curl -fsS -X POST http://127.0.0.1:1556/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin"}' | node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8')).access_token")
curl -fsS -H "Authorization: Bearer \$AUTH_TOKEN" http://127.0.0.1:1556/api/auth/me
curl -fsS -H "Authorization: Bearer \$AUTH_TOKEN" http://127.0.0.1:1556/api/vector-sources/status
docker ps --filter name=hermes-api --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
docker logs --tail 30 hermes-api
REMOTE_SCRIPT

echo "=== Deploy complete ==="

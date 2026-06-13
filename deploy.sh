#!/bin/bash
set -euo pipefail

if [ ! -f .env ]; then
  echo "Missing .env. Copy .env.example and fill deployment values."
  exit 1
fi

set -a
source .env
set +a

: "${REMOTE_HOST:?Missing REMOTE_HOST}"
: "${REMOTE_USER:?Missing REMOTE_USER}"
: "${SSH_KEY:=~/.ssh/id_ed25519}"
: "${HERMES_API_KEY:?Missing HERMES_API_KEY}"
: "${PGVECTOR_DATABASE_URL:?Missing PGVECTOR_DATABASE_URL}"

REMOTE_DIR=/usr/docker/gaogao-api
SRC_DIR=$REMOTE_DIR/src

echo "=== 1. Upload backend source ==="
ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" "mkdir -p '$SRC_DIR/server' '$SRC_DIR/src/types'"

scp -i "$SSH_KEY" \
  package.json pnpm-lock.yaml tsconfig.server.json Dockerfile \
  "$REMOTE_USER@$REMOTE_HOST:$SRC_DIR/"

scp -i "$SSH_KEY" server/*.ts "$REMOTE_USER@$REMOTE_HOST:$SRC_DIR/server/"
scp -i "$SSH_KEY" src/types/report.ts "$REMOTE_USER@$REMOTE_HOST:$SRC_DIR/src/types/"

echo "=== 2. Build and deploy backend remotely ==="
ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" << REMOTE_SCRIPT
set -euo pipefail

SRC_DIR=/usr/docker/gaogao-api/src
cd "\$SRC_DIR"

echo "--- Build image ---"
docker build -t gaogao-api:latest .

echo "--- Ensure shared Docker network ---"
docker network create hermes-net 2>/dev/null || true
docker network connect hermes-net hermes 2>/dev/null || true
docker network connect hermes-net todo_postgres 2>/dev/null || true

echo "--- Replace old container ---"
docker stop gaogao-api 2>/dev/null || true
docker rm gaogao-api 2>/dev/null || true

docker run -d \
  --name gaogao-api \
  --network hermes-net \
  --restart=unless-stopped \
  -p 1555:1555 \
  -e PORT=1555 \
  -e HERMES_BASE_URL=http://hermes:18789/v1 \
  -e HERMES_API_KEY=${HERMES_API_KEY} \
  -e HERMES_MODEL=${HERMES_MODEL:-openclaw/report-agent} \
  -e HERMES_QA_AGENT_ID=${HERMES_QA_AGENT_ID:-qa-agent} \
  -e HERMES_QA_MODEL=${HERMES_QA_MODEL:-openclaw/qa-agent} \
  -e HERMES_QA_MODE=${HERMES_QA_MODE:-direct_pg} \
  -e HERMES_QA_TIMEOUT_MS=${HERMES_QA_TIMEOUT_MS:-900000} \
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
  gaogao-api:latest

sleep 3
docker ps --filter name=gaogao-api --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
docker logs --tail 30 gaogao-api
REMOTE_SCRIPT

echo "=== Deploy complete ==="

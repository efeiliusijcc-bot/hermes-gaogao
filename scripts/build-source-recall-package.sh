#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_DIR="${1:?Provide an empty output directory}"
if [[ -e "$PACKAGE_DIR" ]]; then
  echo "Output directory already exists" >&2
  exit 1
fi
cd "$ROOT_DIR"
./node_modules/.bin/tsc -p tsconfig.server.json
mkdir -p "$PACKAGE_DIR/dist-server/server/reports"
cp dist-server/server/source-recall*.js "$PACKAGE_DIR/dist-server/server/"
cp -R dist-server/server/reports/retrieval "$PACKAGE_DIR/dist-server/server/reports/"
cp deploy/source-recall.Dockerfile "$PACKAGE_DIR/Dockerfile"
cp deploy/source-recall.compose.yml "$PACKAGE_DIR/compose.yml"
cp deploy/nginx/source-recall.location.conf "$PACKAGE_DIR/"
cp scripts/provision-source-recall.mjs "$PACKAGE_DIR/"
# Package only recall runtime files; retain the deployed image's dependencies and other code.
find "$PACKAGE_DIR" -type f -exec shasum -a 256 {} \;

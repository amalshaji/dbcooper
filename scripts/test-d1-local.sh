#!/usr/bin/env bash

set -euo pipefail

D1_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
D1_LOCAL_PORT="${DBCOOPER_D1_LOCAL_PORT:-8791}"
D1_TMP_DIR="$(mktemp -d)"
D1_LOG_FILE="${D1_TMP_DIR}/wrangler.log"

cleanup() {
  if [[ -n "${D1_WRANGLER_PID:-}" ]]; then
    kill "${D1_WRANGLER_PID}" 2>/dev/null || true
    wait "${D1_WRANGLER_PID}" 2>/dev/null || true
  fi
  rm -rf "${D1_TMP_DIR}"
}
trap cleanup EXIT

cd "${D1_REPO_ROOT}"
WRANGLER_LOG_PATH="${D1_LOG_FILE}" bunx wrangler dev \
  --config tests/d1-local/wrangler.jsonc \
  --port "${D1_LOCAL_PORT}" \
  --persist-to "${D1_TMP_DIR}/state" \
  >"${D1_LOG_FILE}" 2>&1 &
D1_WRANGLER_PID=$!

for _ in {1..60}; do
  if curl --fail --silent "http://127.0.0.1:${D1_LOCAL_PORT}/healthz" >/dev/null; then
    DBCOOPER_D1_LOCAL_URL="http://127.0.0.1:${D1_LOCAL_PORT}/client/v4" \
      cargo test \
      --manifest-path src-tauri/Cargo.toml \
      database::d1::tests::local_wrangler_supports_schema_browsing_and_crud \
      --lib -- --ignored --exact
    exit 0
  fi
  sleep 0.25
done

cat "${D1_LOG_FILE}"
exit 1

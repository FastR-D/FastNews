#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
TASK_DATA="$(mktemp -d)"
trap 'rm -rf "$TASK_DATA"' EXIT
export FASTNEWS_DATA_DIR="$TASK_DATA"
export FASTNEWS_COOKIE_SECURE=false
export FASTNEWS_HOST=127.0.0.1
export FASTNEWS_PORT="${1:-4189}"
export FASTNEWS_PUBLIC_PATH="${2:-}"
export FASTNEWS_WEB_DIR="${3:-web/dist}"
export FASTNEWS_FASTCAS_ENABLED=false
export OPENAI_API_KEY=''
export FASTNEWS_INITIAL_PASSWORD='browser-test-password-123'
export FASTNEWS_REQUIRE_LOGIN="${FASTNEWS_TEST_REQUIRE_LOGIN:-false}"
./bin/fastnews create --email browser-test@example.com --name 测试研究者 >/dev/null
./bin/fastnews serve &
TASK_PID=$!
trap 'kill "$TASK_PID" 2>/dev/null || true; wait "$TASK_PID" 2>/dev/null || true; rm -rf "$TASK_DATA"' EXIT
wait "$TASK_PID"

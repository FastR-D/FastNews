#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="${FASTNEWS_RELEASES_ROOT:-/home/dev/ci-releases/fastnews}"
UNIT="${FASTNEWS_UNIT:-fastnews.service}"
FORCE=0
SKIP_PULL=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --skip-pull) SKIP_PULL=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

uid="$(id -u)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/${uid}}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"

mkdir -p "$STATE_DIR"
cd "$ROOT"

if [[ "$SKIP_PULL" -eq 0 ]]; then
  git fetch origin main
  git pull --ff-only origin main
fi

sha="$(git rev-parse HEAD)"
prev=""
if [[ -f "$STATE_DIR/deployed-sha" ]]; then
  prev="$(tr -d '[:space:]' < "$STATE_DIR/deployed-sha")"
fi

if [[ "$FORCE" -eq 0 && "$sha" == "$prev" ]] && systemctl --user is-active --quiet "$UNIT"; then
  echo "FastNews already deployed $sha"
  exit 0
fi

# The unit must use bin/fastnews serve (see deployments/fastnews.service).
if ! systemctl --user cat "$UNIT" | grep -q 'ExecStart=.*bin/fastnews'; then
  echo "Install the native Go systemd unit before deploying; current unit still starts the legacy runtime." >&2
  exit 1
fi
pnpm --dir web install --frozen-lockfile
make test
make build
systemctl --user daemon-reload
systemctl --user restart "$UNIT"
systemctl --user is-active "$UNIT"
TASK_HEALTH="http://${FASTNEWS_HOST:-127.0.0.1}:${FASTNEWS_PORT:-8788}/api/health"
curl --fail --silent --show-error --retry 5 --retry-connrefused --retry-delay 1 "$TASK_HEALTH"

echo "$sha" > "$STATE_DIR/deployed-sha"
echo "FastNews deployed $sha"

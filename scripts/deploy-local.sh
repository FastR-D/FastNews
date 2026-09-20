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

systemctl --user daemon-reload || true
systemctl --user restart "$UNIT"
systemctl --user is-active "$UNIT"
sleep 2
python3 - <<'PY'
import sys, urllib.error, urllib.request
urls = ["http://127.0.0.1:8788/", "http://127.0.0.1/news/"]
ok = {200, 301, 302, 401}
for url in urls:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="GET"), timeout=8) as resp:
            status, body = resp.status, resp.read(120)
    except urllib.error.HTTPError as exc:
        status, body = exc.code, exc.read(120)
    text = body.decode("utf-8", "replace")
    if status not in ok:
        print("FAIL", url, status, text)
        sys.exit(1)
    print("OK", status, url)
PY

echo "$sha" > "$STATE_DIR/deployed-sha"
echo "FastNews deployed $sha"

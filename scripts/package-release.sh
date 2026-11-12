#!/usr/bin/env bash
# Package only tested runtime inputs. Business data and credentials stay external.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$ROOT/dist/release}"
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cd "$ROOT"
test -x bin/fastnews
test -f web/dist/index.html
test -f web/dist/reports/handoff.js
test -f web/dist/reports/report.css
mkdir -p "$STAGE/bin" "$STAGE/web"
cp bin/fastnews "$STAGE/bin/fastnews"
cp -R web/dist "$STAGE/web/dist"
tar -czf "$DEST/release.tar.gz" -C "$STAGE" bin web
TASK_SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"
TASK_SUM="$(sha256sum "$DEST/release.tar.gz" | cut -d ' ' -f1)"
printf '{"repository":"%s","sha":"%s","archive_sha256":"%s"}\n' "${GITHUB_REPOSITORY:-FastR-D/FastNews}" "$TASK_SHA" "$TASK_SUM" > "$DEST/manifest.json"
printf 'Packaged %s\n' "$DEST/release.tar.gz"

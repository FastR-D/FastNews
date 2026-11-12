#!/usr/bin/env bash
# Called only by serialized main-branch data workflows. Do not stage unrelated files.
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" != true || "${GITHUB_REF:-}" != refs/heads/main ]]; then
  echo 'Data commits are only allowed in main-branch GitHub Actions runs.' >&2
  exit 1
fi
if [[ "$#" -eq 0 ]]; then
  echo 'Provide at least one generated data path.' >&2
  exit 2
fi
git config user.name 'github-actions[bot]'
git config user.email 'github-actions[bot]@users.noreply.github.com'
git add -- "$@"
if git diff --cached --quiet; then
  exit 0
fi
git commit -m "${FASTNEWS_DATA_COMMIT_MESSAGE:?Set a data commit message}"
git pull --rebase origin main
git push origin HEAD:main

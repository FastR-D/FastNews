#!/usr/bin/env bash
set -euo pipefail
artifact="${1:?Usage: upload-release.sh ARTIFACT_DIR}"
archive="$artifact/release.tar.gz"
url="${FASTNEWS_DEPLOY_URL:?Missing production variable FASTNEWS_DEPLOY_URL}"
token="${FASTNEWS_DEPLOY_TOKEN:?Missing production secret FASTNEWS_DEPLOY_TOKEN}"
unset FASTNEWS_DEPLOY_TOKEN

if [[ ! "$url" =~ ^https://[^/?#@[:space:]]+/__fastnews/deploy$ ]]; then
  printf 'FASTNEWS_DEPLOY_URL must be an HTTPS URL ending in /__fastnews/deploy\n' >&2
  exit 1
fi
if [[ ! "$token" =~ ^[a-f0-9]{64}$ ]]; then
  printf 'FASTNEWS_DEPLOY_TOKEN must contain 64 lowercase hexadecimal characters\n' >&2
  exit 1
fi
if [[ ! "$GITHUB_REF_NAME" =~ ^v[0-9][A-Za-z0-9._-]{0,99}$ || ! "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ || ! "$GITHUB_RUN_ID" =~ ^[1-9][0-9]{0,18}$ ]]; then
  printf 'Invalid release metadata\n' >&2
  exit 1
fi
digest=$(sha256sum "$archive")
digest=${digest%% *}
jq -e --arg repo "$GITHUB_REPOSITORY" --arg sha "$GITHUB_SHA" --arg digest "$digest" \
  '. == {repository: $repo, sha: $sha, archive_sha256: $digest}' "$artifact/manifest.json" >/dev/null

printf 'Uploading verified release %s over HTTPS\n' "$GITHUB_REF_NAME"
status=$(printf 'Authorization: Bearer %s\n' "$token" | curl --disable --silent --show-error \
  --proto '=https' --globoff --connect-timeout 15 --max-time 1200 \
  --output /dev/null --write-out '%{http_code}' --header @- \
  --header 'Content-Type: application/gzip' \
  --header "X-FastDeploy-Tag: $GITHUB_REF_NAME" \
  --header "X-FastDeploy-Sha: $GITHUB_SHA" \
  --header "X-FastDeploy-Run-Id: $GITHUB_RUN_ID" \
  --header "X-FastDeploy-Archive-Sha256: $digest" \
  --data-binary "@$archive" "$url")
if [[ "$status" != 200 ]]; then
  printf 'Deployment receiver returned HTTP %s; check the receiver journal before retrying\n' "$status" >&2
  exit 1
fi
printf 'Release is active and healthy\n'

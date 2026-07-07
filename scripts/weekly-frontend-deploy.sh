#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${WEEKLY_ADMIN_BASE_DIR:-/vol1/1000/Docker/weekly-admin}"
ENV_FILE="${WEEKLY_ADMIN_ENV_FILE:-$BASE_DIR/.env}"
REPO="${WEEKLY_FRONTEND_REPO:-NorthSeacoder/weekly}"
WORKFLOW="${WEEKLY_FRONTEND_WORKFLOW:-deploy.yml}"
REF="${WEEKLY_FRONTEND_REF:-main}"
REASON="${WEEKLY_FRONTEND_DEPLOY_REASON:-weekly-admin-db-change}"
API_URL="${GITHUB_API_URL:-https://api.github.com}"

if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

TOKEN="${WEEKLY_FRONTEND_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"
action="${1:-dry-run}"

case "$action" in
  dry-run|dispatch|latest) ;;
  *)
    echo "Usage: $0 {dry-run|dispatch|latest}" >&2
    exit 2
    ;;
esac

token_state="missing"
if [ -n "$TOKEN" ]; then
  token_state="configured"
fi

if [ "$action" = "dry-run" ]; then
  cat <<EOF
repo=$REPO
workflow=$WORKFLOW
ref=$REF
reason=$REASON
token=$token_state
EOF
  exit 0
fi

if [ -z "$TOKEN" ]; then
  echo "WEEKLY_FRONTEND_GITHUB_TOKEN or GITHUB_TOKEN is required" >&2
  exit 1
fi

github_api() {
  curl --fail --show-error --silent \
    -H "Accept: application/vnd.github+json" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$@"
}

if [ "$action" = "dispatch" ]; then
  payload="$(python3 - "$REF" "$REASON" <<'PY'
import json, sys
print(json.dumps({
    "ref": sys.argv[1],
    "inputs": {"reason": sys.argv[2]},
}))
PY
)"
  github_api -X POST "$API_URL/repos/$REPO/actions/workflows/$WORKFLOW/dispatches" \
    -H "Content-Type: application/json" \
    --data "$payload" > /dev/null
  echo "dispatched repo=$REPO workflow=$WORKFLOW ref=$REF reason=$REASON"
  sleep "${WEEKLY_FRONTEND_DEPLOY_LATEST_DELAY:-3}"
fi

latest_response="$(github_api "$API_URL/repos/$REPO/actions/runs?branch=$REF&event=workflow_dispatch&per_page=1")"
python3 - "$latest_response" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
runs = data.get("workflow_runs") or []
if not runs:
    print("latest_run=none")
else:
    run = runs[0]
    print(f"latest_run={run.get('id')}")
    print(f"status={run.get('status')}")
    print(f"conclusion={run.get('conclusion')}")
    print(f"html_url={run.get('html_url')}")
PY

#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${WEEKLY_ADMIN_BASE_DIR:-/vol1/1000/Docker/weekly-admin}"
ENV_FILE="${WEEKLY_ADMIN_ENV_FILE:-$BASE_DIR/.env}"
API_URL="${WEEKLY_API_URL:-http://127.0.0.1:3000}"
HERMES_TARGET="${HERMES_TARGET:-wecom}"
HERMES_SEND_CMD="${HERMES_SEND_CMD:-docker exec hermes-agent hermes send}"

if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

if [ -z "${CRON_API_TOKEN:-}" ]; then
  echo "CRON_API_TOKEN is not configured" >&2
  exit 1
fi

action="${1:-notify}"
limit="${WEEKLY_HERMES_CANDIDATE_LIMIT:-10}"
max_items="${WEEKLY_HERMES_MAX_ITEMS:-12}"
stamp="$(date +%Y%m%d-%H%M%S)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

auth_header="Authorization: Bearer $CRON_API_TOKEN"

curl_json() {
  curl --fail --show-error --silent "$@"
}

current_json="$tmpdir/current.json"
candidates_json="$tmpdir/candidates.json"
message_file="$tmpdir/message.md"

curl_json "$API_URL/api/v1/weekly/current?weekOffset=0" \
  -H "$auth_header" > "$current_json"

curl_json "$API_URL/api/v1/weekly/candidates?weekOffset=0&limit=$limit&status=ready" \
  -H "$auth_header" > "$candidates_json"

issue_id="$(python3 - "$current_json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
issue = data.get("data", {}).get("issue") or {}
print(issue.get("id") or "")
PY
)"

if [ -z "$issue_id" ]; then
  echo "No current weekly issue found" >&2
  exit 1
fi

suggest_json=""
if [ "$action" = "suggest" ]; then
  suggest_json="$tmpdir/suggest.json"
  curl_json -X POST "$API_URL/api/v1/weekly/suggestions" \
    -H "$auth_header" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: hermes-weekly-suggest-$stamp" \
    --data "{\"weeklyIssueId\":$issue_id,\"maxItems\":$max_items}" > "$suggest_json"
elif [ "$action" != "notify" ]; then
  echo "Usage: $0 {notify|suggest}" >&2
  exit 2
fi

python3 - "$current_json" "$candidates_json" "${suggest_json:-}" > "$message_file" <<'PY'
import json, sys

current = json.load(open(sys.argv[1]))
candidates = json.load(open(sys.argv[2]))
suggest = json.load(open(sys.argv[3])) if len(sys.argv) > 3 and sys.argv[3] else None

issue = current.get("data", {}).get("issue") or {}
range_ = current.get("data", {}).get("range") or {}
cdata = candidates.get("data") or {}
items = cdata.get("candidates") or []

print("## Weekly Ops")
print()
print(f"- Issue: #{issue.get('issueNumber')} {issue.get('title')} ({issue.get('status')})")
print(f"- Range: {issue.get('startDate')} ~ {issue.get('endDate')} (target {range_.get('startDate')} ~ {range_.get('endDate')})")
print(f"- Linked: {issue.get('linkedCount')} / totalItems {issue.get('totalItems')}")
print(f"- Candidates: {cdata.get('total', 0)} ready items in current target week")
if suggest:
    meta = suggest.get("meta") or {}
    data = suggest.get("data") or {}
    print(f"- Suggest job: {data.get('runId') or meta.get('runId')} ({data.get('status') or meta.get('status')})")
print()
print("Top candidates:")
for idx, item in enumerate(items[:10], 1):
    title = str(item.get("title") or "").strip()
    score = item.get("score")
    source = item.get("source") or ""
    print(f"{idx}. [{score}] {title} - {source}")
print()
print("Next: review Admin workbench, apply suggestions manually, then publish with deliver=false first.")
PY

# shellcheck disable=SC2086
$HERMES_SEND_CMD --to "$HERMES_TARGET" --subject "[weekly]" --file "$message_file"

#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${WEEKLY_ADMIN_BASE_DIR:-/vol1/1000/Docker/weekly-admin}"
ENV_FILE="${WEEKLY_ADMIN_ENV_FILE:-$BASE_DIR/.env}"
API_URL="${WEEKLY_API_URL:-http://127.0.0.1:3000}"
HERMES_TARGET="${HERMES_TARGET:-wecom}"
HERMES_ONESHOT_CMD="${HERMES_ONESHOT_CMD:-docker exec -i hermes-agent hermes --provider krill -m gpt-5.5 --ignore-rules -z}"
HERMES_SEND_CMD="${HERMES_SEND_CMD:-docker exec -i hermes-agent hermes send}"
HERMES_ATTEMPTS="${HERMES_ATTEMPTS:-2}"

if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

if [ -z "${CRON_API_TOKEN:-}" ]; then
  echo "CRON_API_TOKEN is not configured" >&2
  exit 1
fi

action="${1:-dry-run}"
limit="${WEEKLY_HERMES_CANDIDATE_LIMIT:-15}"
max_items="${WEEKLY_HERMES_MAX_ITEMS:-12}"
stamp="$(date +%Y%m%d-%H%M%S)"
tmpdir="$(mktemp -d)"
if [ "${HERMES_RUNTIME_KEEP_TMP:-0}" = "1" ]; then
  echo "Keeping runtime tmpdir: $tmpdir" >&2
else
  trap 'rm -rf "$tmpdir"' EXIT
fi

case "$action" in
  dry-run|register|notify) ;;
  *)
    echo "Usage: $0 {dry-run|register|notify}" >&2
    exit 2
    ;;
esac

auth_header="Authorization: Bearer $CRON_API_TOKEN"
current_json="$tmpdir/current.json"
candidates_json="$tmpdir/candidates.json"
feedback_json="$tmpdir/feedback.json"
prompt_file="$tmpdir/prompt.md"
raw_output_file="$tmpdir/hermes-output.txt"
artifact_file="$tmpdir/artifact.json"
register_file="$tmpdir/register.json"
job_file="$tmpdir/job.json"
message_file="$tmpdir/message.md"

curl_json() {
  curl --fail --show-error --silent "$@"
}

curl_json "$API_URL/api/v1/weekly/current?weekOffset=0" \
  -H "$auth_header" > "$current_json"

curl_json "$API_URL/api/v1/weekly/candidates?weekOffset=0&limit=$limit&status=ready" \
  -H "$auth_header" > "$candidates_json"

curl_json "$API_URL/api/v1/ai/feedback/digest?format=json" \
  -H "$auth_header" > "$feedback_json"

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

python3 - "$current_json" "$candidates_json" "$feedback_json" "$max_items" "$stamp" > "$prompt_file" <<'PY'
import json, sys

current = json.load(open(sys.argv[1]))
candidates = json.load(open(sys.argv[2]))
feedback = json.load(open(sys.argv[3]))
max_items = int(sys.argv[4])
stamp = sys.argv[5]

issue = current.get("data", {}).get("issue") or {}
cdata = candidates.get("data") or {}
fdata = feedback.get("data") or {}

context = {
    "issue": issue,
    "candidateRange": cdata.get("range"),
    "candidates": (cdata.get("candidates") or [])[:max_items],
    "feedbackCounts": fdata.get("counts") or {},
    "recentFeedback": (fdata.get("actions") or [])[:20],
}

print("You are generating a Weekly Admin preview artifact.")
print("Return ONLY one JSON object. Do not wrap it in markdown.")
print("The JSON object must match this shape:")
print(json.dumps({
    "artifactVersion": "weekly-suggestion.v1",
    "provider": "hermes",
    "agentRunId": f"hermes-weekly-runtime-{stamp}",
    "weeklyIssueId": issue.get("id"),
    "status": "preview",
    "intro": "short optional intro",
    "items": [{
        "content_id": 123,
        "section": "AI",
        "featured": False,
        "reason": "why this item belongs in the issue",
        "confidence": 0.75,
        "evidenceRefs": [{"type": "candidate", "sourceId": 123, "summary": "short evidence"}],
    }],
    "confidence": 0.75,
}, ensure_ascii=False))
print()
print("Rules:")
print("- Use only candidate ids from context.candidates.")
print("- If no candidate is suitable, return status empty and items [].")
print("- Never include token, api_key, password, database_url, redis_password, authorization or secret fields.")
print("- Keep sections concise and useful for a Chinese weekly newsletter.")
print("- Do not apply, publish or write MySQL directly.")
print()
print("Context:")
print(json.dumps(context, ensure_ascii=False, indent=2))
PY

parse_artifact() {
  python3 - "$raw_output_file" "$issue_id" "$stamp" > "$artifact_file" <<'PY'
import json, re, sys

raw = open(sys.argv[1], encoding="utf-8").read().strip()
issue_id = int(sys.argv[2])
stamp = sys.argv[3]
secret_re = re.compile(r"(authorization|token|token_hash|tokenhash|password|secret|api[_-]?key|provider[_-]?key|database[_-]?url|db[_-]?url|redis[_-]?password)", re.I)

def extract_json_object(text):
    start = text.find("{")
    if start < 0:
        raise ValueError("Hermes output does not contain a JSON object")
    depth = 0
    in_string = False
    escape = False
    for i, ch in enumerate(text[start:], start):
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start:i + 1])
    raise ValueError("Hermes output JSON object is incomplete")

def walk_no_secret(value, path=""):
    if isinstance(value, dict):
        for key, nested in value.items():
            if secret_re.search(key):
                raise ValueError(f"Artifact contains secret-like key: {path + key}")
            walk_no_secret(nested, path + key + ".")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            walk_no_secret(item, f"{path}{index}.")

artifact = extract_json_object(raw)
if "artifact" in artifact and isinstance(artifact["artifact"], dict):
    artifact = artifact["artifact"]

walk_no_secret(artifact)

artifact.setdefault("artifactVersion", "weekly-suggestion.v1")
artifact.setdefault("provider", "hermes")
artifact.setdefault("agentRunId", f"hermes-weekly-runtime-{stamp}")
artifact["weeklyIssueId"] = int(artifact.get("weeklyIssueId") or issue_id)
if artifact["weeklyIssueId"] != issue_id:
    raise ValueError(f"Artifact weeklyIssueId {artifact['weeklyIssueId']} does not match current issue {issue_id}")

items = artifact.get("items") or []
if not isinstance(items, list):
    raise ValueError("Artifact items must be an array")
if len(items) > 30:
    raise ValueError("Artifact items must contain at most 30 items")

normalized_items = []
for item in items:
    if not isinstance(item, dict):
        raise ValueError("Artifact item must be an object")
    content_id = int(item.get("content_id") or 0)
    section = str(item.get("section") or "").strip()
    if content_id <= 0 or not section:
        raise ValueError("Artifact preview items require content_id and section")
    normalized = {
        **item,
        "content_id": content_id,
        "section": section,
        "featured": bool(item.get("featured", False)),
    }
    normalized_items.append(normalized)

artifact["items"] = normalized_items
artifact["status"] = artifact.get("status") or ("preview" if normalized_items else "empty")
if artifact["status"] == "preview" and not normalized_items:
    raise ValueError("Preview artifact requires at least one item")
if artifact["status"] not in {"preview", "empty", "stale", "rejected"}:
    raise ValueError(f"Unsupported artifact status: {artifact['status']}")

print(json.dumps(artifact, ensure_ascii=False, indent=2))
PY
}

attempt=1
artifact_ok=0
while [ "$attempt" -le "$HERMES_ATTEMPTS" ]; do
  # shellcheck disable=SC2086
  $HERMES_ONESHOT_CMD "$(cat "$prompt_file")" > "$raw_output_file"
  if parse_artifact; then
    artifact_ok=1
    break
  fi
  echo "Hermes output parse failed on attempt $attempt/$HERMES_ATTEMPTS" >&2
  echo "--- Hermes output tail ---" >&2
  tail -c 2000 "$raw_output_file" >&2 || true
  echo >&2
  attempt=$((attempt + 1))
  sleep 2
done

if [ "$artifact_ok" != "1" ]; then
  echo "Hermes did not produce a valid weekly-suggestion artifact" >&2
  exit 1
fi

if [ "$action" = "dry-run" ]; then
  cat "$artifact_file"
  exit 0
fi

python3 - "$artifact_file" > "$register_file" <<'PY'
import json, sys
artifact = json.load(open(sys.argv[1]))
print(json.dumps({"mode": "register", "artifact": artifact}, ensure_ascii=False))
PY

curl_json -X POST "$API_URL/api/v1/weekly/suggestions" \
  -H "$auth_header" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: hermes-weekly-runtime-$stamp" \
  --data-binary "@$register_file" > "$job_file"

run_id="$(python3 - "$job_file" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
payload = data.get("data") or {}
meta = data.get("meta") or {}
print(payload.get("runId") or payload.get("jobId") or meta.get("runId") or "")
PY
)"

if [ -n "$run_id" ]; then
  sleep 2
  curl_json "$API_URL/api/v1/jobs/$run_id" -H "$auth_header" > "$job_file.status" || true
fi

if [ "$action" = "notify" ]; then
  python3 - "$artifact_file" "$job_file" "${job_file}.status" > "$message_file" <<'PY'
import json, os, sys

artifact = json.load(open(sys.argv[1]))
queued = json.load(open(sys.argv[2]))
status = None
if len(sys.argv) > 3 and os.path.exists(sys.argv[3]):
    status = json.load(open(sys.argv[3]))

data = queued.get("data") or {}
meta = queued.get("meta") or {}
sdata = (status or {}).get("data") or {}

print("## Weekly Hermes Runtime")
print()
print(f"- Issue: {artifact.get('weeklyIssueId')}")
print(f"- Artifact: {artifact.get('status')} / {len(artifact.get('items') or [])} items")
print(f"- Agent run: {artifact.get('agentRunId')}")
print(f"- Queue run: {data.get('runId') or data.get('jobId') or meta.get('runId')}")
print(f"- Worker status: {sdata.get('status') or data.get('status') or meta.get('status')}")
print()
for idx, item in enumerate((artifact.get("items") or [])[:10], 1):
    print(f"{idx}. {item.get('section')}: content {item.get('content_id')} - {item.get('reason', '')}")
print()
print("Next: review Admin workbench before apply/publish.")
PY

  # shellcheck disable=SC2086
  $HERMES_SEND_CMD --to "$HERMES_TARGET" --subject "[weekly hermes]" --file - < "$message_file"
fi

cat "$job_file"
if [ -f "${job_file}.status" ]; then
  printf '\n'
  cat "${job_file}.status"
fi

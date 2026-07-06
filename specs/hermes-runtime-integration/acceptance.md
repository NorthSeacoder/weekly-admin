# Acceptance: Hermes Runtime Integration

**Workspace**: `hermes-runtime-integration`
**Date**: 2026-07-07
**Verdict**: PASS

## Accepted Scope

- NAS host-side `scripts/weekly-hermes-runtime.sh` can collect Admin context through `/api/v1` only.
- Runtime builds a Hermes prompt from current issue, ready candidates and feedback digest.
- Runtime invokes Hermes one-shot, extracts a `weekly-suggestion.v1` JSON artifact, rejects malformed/no-secret output, and retries failed parses.
- Runtime supports `dry-run`, `register`, and `notify`.
- Runtime registers artifacts through queued `/api/v1/weekly/suggestions` register mode and verifies `/api/v1/jobs/{runId}`.
- Runtime sends WeCom notification through `hermes send`.
- Default one-shot command uses NAS-verified `krill/gpt-5.5`; `HERMES_ONESHOT_CMD` remains overrideable.
- Admin docs/runbook and roadmap describe usage and human apply/publish boundary.

## Verification

See `specs/hermes-runtime-integration/verify-evidence.md`.

## Deferred

- `hermes-db` / PG / pgvector long-term read model is intentionally not part of this runtime slice; split to a later feature if semantic preference memory becomes necessary.
- Frontend DB-only rebuild/deploy automation remains a separate follow-up.
- Task Center UI remains a separate follow-up.

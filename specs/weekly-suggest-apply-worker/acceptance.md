# Acceptance: Weekly Suggest Apply Worker

**Workspace**: `weekly-suggest-apply-worker`
**Date**: 2026-07-07
**Verdict**: PASS

## Accepted Scope

- `weekly.suggest` and `weekly.apply` are submittable Redis/BullMQ jobs.
- `/api/v1/weekly/suggestions` queues Admin suggestion generation or Hermes artifact registration.
- `/api/v1/weekly/suggestions/{id}/apply` queues suggestion apply.
- Hermes register payloads are still schema/secret-key validated before enqueue.
- `/api/v1/weekly/current` lets Hermes discover the current issue through Admin API.
- OpenAPI, automation contract docs, production runbook and roadmap are updated.
- NAS has a host-side Hermes/WeCom helper for weekly ops notifications.

## Verification

See `specs/weekly-suggest-apply-worker/verify-evidence.md`.

## Deferred

- Full Hermes skill/runtime implementation, hermes-db/PG migrations and WeCom gateway hardening remain in `hermes-runtime-integration`.
- Public weekly frontend DB-only rebuild/deploy automation remains a separate follow-up.

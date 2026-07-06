# Acceptance: Weekly Production Readiness

**Date**: 2026-07-06  
**Verdict**: PASS

## Result

The current weekly issue is live from the production database through Quail and the public Astro site.

| Requirement | Verdict | Evidence |
|---|---|---|
| FR-001 current/cross-week issue | PASS | Issue 92 keeps numbering continuous and covers `2026-03-29` through the current production week ending `2026-07-11`. |
| FR-002 issue content | PASS | 12 contents linked to issue 92. |
| FR-003 queued jobs | PASS | sync, score, suggestion apply, and publish runs recorded in `automation_runs`. |
| FR-004 NAS worker | PASS | Web healthy; worker running with healthcheck disabled. |
| FR-005 schedule | PASS | NAS crontab and reusable script installed. |
| FR-006 Quail dry-run | PASS | Quail post `issue-92`, `deliver=false`, no email delivery timestamp. |
| FR-007 frontend deploy | PASS | Public RSS, search JSON, and `/weekly/issue-92/` show issue 92. |
| FR-008 runbook | PASS | `docs/runbooks/weekly-production.md`. |

## Follow-Up Features

- `weekly-suggest-apply-worker`: move long-running suggestion generation into worker/status.
- Frontend deployment automation: rebuild Astro when Admin publishes a DB-backed issue, not only when `sections/` changes.
- Schema cleanup: either add `contents.auto_promoted` as documented, or retire that older requirement and standardize on `inbox_items.auto_promoted`.
- Operations UI: expose token/schedule/run status in Admin instead of relying on SSH and SQL.
- Historical draft issue cleanup: confirm whether old empty draft issues should be archived, merged, or kept as audit records.

## Closeout

P1 is complete. The weekly can run from this week onward using NAS-hosted Admin, Redis worker, Karakeep sync, cron scheduling, Quail publish, and the deployed Astro frontend.

# Context Manifest: Weekly Publish Worker

**Workspace**: `weekly-publish-worker`  
**Created**: 2026-06-22  
**Status**: active

---

## Implement Context

| File / Source | Reason | Phase | Required |
|---|---|---|---|
| `specs/weekly-publish-worker/spec.md` | Scope and acceptance boundaries | implement | yes |
| `specs/weekly-publish-worker/plan.md` | ADRs and module boundaries | implement | yes |
| `specs/weekly-publish-worker/tasks.md` | Task order and checks | implement | yes |
| `specs/karakeep-resync-redis-state/acceptance.md` | Previous slice pattern for queued side effects | implement | yes |

---

## Check Context

| File / Source | Reason | Phase | Required |
|---|---|---|---|
| `specs/weekly-publish-worker/spec.md` | Verify requirements and out-of-scope | verify | yes |
| `specs/weekly-publish-worker/plan.md` | Verify architecture decisions | verify | yes |
| `specs/weekly-publish-worker/tasks.md` | Verify task completion | verify | yes |
| `specs/weekly-automation-runtime-roadmap/roadmap.md` | Verify roadmap current/next | verify | yes |

---

## Research Context

| File / Source | Reason | Phase | Verified |
|---|---|---|---|
| `src/app/api/v1/weekly/publish/route.ts` | Current synchronous publish route | implement | yes |
| `src/lib/jobs/worker-handlers.ts` | Existing worker handler switch | implement | yes |
| `src/lib/jobs/retry.ts` | Retry workflow mapping | implement | yes |

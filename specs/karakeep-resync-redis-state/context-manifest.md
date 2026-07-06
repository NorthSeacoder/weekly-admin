# Context Manifest: Karakeep Resync Redis State

**Workspace**: `karakeep-resync-redis-state`  
**Created**: 2026-06-22  
**Status**: active

---

## Implement Context

| File / Source | Reason | Phase | Required |
|---|---|---|---|
| `specs/karakeep-resync-redis-state/spec.md` | Defines scope, user scenarios, trait-driven gates, and out-of-scope boundaries | implement | yes |
| `specs/karakeep-resync-redis-state/plan.md` | Defines ADRs, module boundaries, and status/data flow | implement | yes |
| `specs/karakeep-resync-redis-state/data-model.md` | Defines job payload, status mapping, and durable evidence boundaries | implement | yes |
| `specs/karakeep-resync-redis-state/tasks.md` | Defines ordered implementation slices and verification requirements | implement | yes |
| `specs/redis-job-orchestration/acceptance.md` | Captures existing Redis/BullMQ worker behavior and known follow-up for Karakeep resync | implement | yes |

---

## Check Context

| File / Source | Reason | Phase | Required |
|---|---|---|---|
| `specs/karakeep-resync-redis-state/spec.md` | Verify P1/P2 requirements and out-of-scope constraints | verify | yes |
| `specs/karakeep-resync-redis-state/plan.md` | Check implementation against ADRs and quality attributes | verify | yes |
| `specs/karakeep-resync-redis-state/tasks.md` | Check task completion and evidence coverage | verify | yes |
| `specs/weekly-automation-runtime-roadmap/roadmap.md` | Verify roadmap current/next status after closeout | verify | yes |

---

## Research Context

| File / Source | Reason | Phase | Verified |
|---|---|---|---|
| Context7 BullMQ query for `Queue.add`, `Worker`, attempts/backoff, `queue.getJob()` | Confirms current BullMQ primitives used by the plan | plan / implement / verify | yes |
| `src/lib/jobs/submit.ts` | Existing submit, target lock, rate-limit, queue add behavior | implement | yes |
| `src/lib/jobs/worker.ts` | Existing worker lifecycle, runtime snapshot, lock refresh, complete/fail behavior | implement | yes |
| `src/lib/jobs/status.ts` | Existing automation job status reader used by compatibility GET | implement | yes |
| `src/app/api/weekly/workbench/[id]/publish/route.ts` | Existing internal automation token wrapper pattern | implement | yes |

---

## Rules

- Do not reintroduce production module-level `Map` state for Karakeep resync.
- Do not restore image writeback or screenshot mutation in this feature.
- Do not start `weekly-publish-worker` until this feature reaches closeout or is explicitly paused.

# Tasks: Weekly Publish Worker

**Workspace**: `weekly-publish-worker` | **Date**: 2026-06-22  
**Input**: `spec.md` + `plan.md`

---

## Phase 1: Queue Contract

- [x] T001 将 `weekly.publish` 改为 submittable job
  - scope: `src/lib/jobs/definitions.ts`, tests
  - slice: route 能提交 publish job，target lock 为 weekly issue
  - blocked_by: none
  - verify: definitions test

- [x] T002 将 `/api/v1/weekly/publish` 改为 queued route
  - scope: `src/app/api/v1/weekly/publish/route.ts`, tests
  - slice: POST 返回 202 queued，不调用 Quail
  - blocked_by: T001
  - verify: route test

## Phase 2: Worker And Retry

- [x] T003 新增 weekly publish worker handler
  - scope: `src/lib/jobs/worker-handlers.ts`, tests
  - slice: worker 执行 Quail publish success/failure
  - blocked_by: T001
  - verify: worker handler tests

- [x] T004 支持 weekly publish retry
  - scope: `src/lib/jobs/retry.ts`, tests
  - slice: failed weekly publish run 可用 retained payload retry
  - blocked_by: T001
  - verify: retry tests

## Phase 3: Wrapper, Docs, Verification

- [x] T005 更新 workbench publish wrapper expectations
  - scope: `src/app/api/weekly/workbench/[id]/publish/route.test.ts`
  - slice: wrapper 返回 queued envelope + humanCaller
  - blocked_by: T002
  - verify: wrapper tests

- [x] T006 更新 OpenAPI/docs
  - scope: `src/lib/automation/openapi.ts`, docs
  - slice: contract 表达 publish queued/retry
  - blocked_by: T002, T004
  - verify: OpenAPI/docs tests or rg

- [x] T007 运行 focused tests
  - scope: touched tests
  - blocked_by: T001-T006
  - verify: vitest targeted

- [x] T008 运行静态检查
  - scope: touched TS files
  - blocked_by: T007
  - verify: tsc + eslint targeted

- [x] T009 closeout 和 roadmap 回写
  - scope: acceptance.md, roadmap.md
  - blocked_by: T007, T008
  - verify: acceptance PASS, roadmap next `weekly-suggest-apply-worker`

---

## Stage Readiness

- 推荐下一步：`implement`
- 阻塞项：无。

# Tasks: Karakeep Resync Redis State

**Workspace**: `karakeep-resync-redis-state` | **Date**: 2026-06-22  
**Input**: `specs/karakeep-resync-redis-state/spec.md` + `plan.md`  
**Prerequisites**: spec.md, plan.md, data-model.md

---

## 执行原则

- 主要任务按端到端 slice 拆分：提交任务、worker 执行、状态读取、可观测与文档。
- 横向配置和类型任务必须服务于后续 slice，不做开放式重构。
- GET status 改为纯读；所有 Karakeep update/poll/apply 副作用由 worker 执行。
- 不新增 MySQL 表，不恢复图片写回，不实现 weekly publish/suggest/apply worker。

---

## Phase 1: Job Contract And Scope

**目标**: 让 `karakeep.resync` 成为现有 automation queue 可识别、可提交、可锁定的 job。

- [x] T001 [Setup] 新增 `content:resync` automation scope
  - scope: `src/lib/automation/auth.ts`, token/bootstrap 或测试 fixture, OpenAPI scope 定义
  - slice: 为 Karakeep resync 建立最小权限，服务于 T003/T004
  - blocked_by: none
  - maps_to: FR-002, ADR-001, ADR-002
  - verify: auth/openapi/type tests 能识别 `content:resync`

- [x] T002 [Setup] 新增 `karakeep.resync` job definition
  - scope: `src/lib/jobs/definitions.ts`, related tests
  - slice: jobName -> workflow/step/scope/target/rate-limit/attempts 可被 submit/worker 识别
  - blocked_by: T001
  - maps_to: FR-002, FR-006, ADR-001
  - verify: definition test 覆盖 `content:{contentId}` target 和 submittable definition

---

## Phase 2: Submit Slice

**目标**: POST route 从同步/内存任务创建切换为 queued job 创建。

- [x] T003 [US1] 实现内部 automation caller 解析
  - scope: `src/app/api/content/[id]/karakeep-resync/route.ts` 或 shared helper
  - slice: cookie-auth UI route 能使用 `ADMIN_UI_AUTOMATION_TOKEN` / `CRON_API_TOKEN` 提交 automation job
  - blocked_by: T001
  - maps_to: US1, FR-002, ADR-002, 安全
  - verify: route test 覆盖 token missing / invalid scope / valid token

- [x] T004 [US1] POST 提交 `karakeep.resync` queued job
  - scope: `src/app/api/content/[id]/karakeep-resync/route.ts`, `src/lib/jobs/submit.ts` as needed
  - slice: 用户触发 resync 后快速得到 jobId/runId/statusUrl，不调用 Karakeep API
  - blocked_by: T002, T003
  - maps_to: US1, FR-002, NFR-001
  - verify: route test assert `submitAutomationJob` called with payload and response compatible with old `jobId`

- [x] T005 [US1] 移除 production 内存 `Map` 状态源
  - scope: `src/lib/services/karakeep-resync.ts`
  - slice: create/progress 不再依赖 module-level `Map`
  - blocked_by: T004
  - maps_to: FR-001
  - verify: `rg "new Map<string, KarakeepResyncJob>|jobs.set|jobs.get" src/lib/services/karakeep-resync.ts` 无 production 状态源

---

## Phase 3: Worker Execution Slice

**目标**: worker 完成 Karakeep update/poll/apply 并写回 durable evidence。

- [x] T006 [US2] 提取 Karakeep resync 执行函数
  - scope: `src/lib/services/karakeep-resync.ts`
  - slice: 给定 payload，执行 updateBookmark -> poll getBookmark -> apply summary
  - blocked_by: T005
  - maps_to: US2, FR-003, FR-007
  - verify: service tests 覆盖 success、timeout、Karakeep 未配置、API failure

- [x] T007 [US2] 接入 worker handler
  - scope: `src/lib/jobs/worker-handlers.ts`, `src/lib/jobs/worker.ts` types as needed
  - slice: `processAutomationJob` 能执行 `karakeep.resync` 并 complete/fail automation_runs
  - blocked_by: T002, T006
  - maps_to: US2, FR-003, ADR-001
  - verify: worker handler tests 覆盖 success/failure result summary

- [x] T008 [US2] 保证同 content 并发锁和 retry 行为
  - scope: `src/lib/jobs/definitions.ts`, `src/lib/jobs/submit.test.ts`, `src/lib/jobs/locks.test.ts` if needed
  - slice: 同 content 第二次 resync 被 target lock 拦截或 idempotent replay
  - blocked_by: T004, T007
  - maps_to: US2, FR-006, 一致性
  - verify: focused test 覆盖 `JOB_TARGET_LOCKED` 或 replay path

---

## Phase 4: Status Compatibility Slice

**目标**: GET route 只读 automation status，并保持旧 response shape。

- [x] T009 [US3] 实现 status -> Karakeep response mapper
  - scope: `src/lib/services/karakeep-resync.ts` or new helper
  - slice: queued/running/retrying/succeeded/failed/expired 都能映射到 legacy phase
  - blocked_by: T007
  - maps_to: US3, FR-004, ADR-003
  - verify: pure unit tests 覆盖 mapping matrix

- [x] T010 [US3] GET status 改为纯读
  - scope: `src/app/api/content/[id]/karakeep-resync/route.ts`
  - slice: GET 使用 `getAutomationJobStatus(jobId)`，校验 target content，返回兼容 shape
  - blocked_by: T009
  - maps_to: US3, FR-004, FR-005, ADR-002
  - verify: route tests 覆盖 found、not found、mismatch、expired、failed

- [x] T011 [US3] 更新前端兼容点（如需要）
  - scope: content UI caller for Karakeep resync
  - slice: 前端仍使用 `jobId` 轮询，并正确显示 success/failed/message
  - blocked_by: T010
  - maps_to: US3, user-visible-output
  - verify: no-op；旧 response shape 保留，`simplified-editor.tsx` 仍按 `jobId` + `phase` + `attempt/maxAttempts` 轮询；route/service tests 覆盖兼容 shape

---

## Phase 5: Observability, Docs, Verification

**目标**: 补齐健康、文档和验收证据。

- [x] T012 [Quality] job health/status 覆盖 Karakeep job
  - scope: `src/lib/jobs/health.ts`, status tests as needed
  - slice: Karakeep failed/running backlog 不被 job summary 隐藏
  - blocked_by: T007
  - maps_to: FR-008, 可观测性
  - verify: health/status focused tests

- [x] T013 [Docs] 更新自动化和 NAS 文档
  - scope: `docs/automation-plan-admin.md`, `docs/nas-deployment.md`, `.env.example` if needed
  - slice: 运维知道 `content:resync` scope、worker 和 token 配置要求
  - blocked_by: T003
  - maps_to: ADR-002, NFR-003
  - verify: docs mention `content:resync` and Karakeep resync worker behavior

- [x] T014 [Verify] 运行 focused tests
  - scope: tests touched by T001-T012
  - slice: 自动化证明 submit/worker/status/doc-critical behavior
  - blocked_by: T001-T013
  - maps_to: Evidence Gate
  - verify: targeted `vitest run ...` passes

- [x] T015 [Verify] 运行静态检查
  - scope: TypeScript and lint for touched files
  - slice: 类型和 lint 不引入回归
  - blocked_by: T014
  - maps_to: NFR-004
  - verify: `pnpm type-check` and lint/focused equivalent passes or documented limitation

- [x] T016 [Closeout Prep] 准备验收记录和 roadmap 回写
  - scope: `acceptance.md`, `specs/weekly-automation-runtime-roadmap/roadmap.md`
  - slice: 记录三维 verdict、Workflow Replay、下一推荐 feature
  - blocked_by: T014, T015
  - maps_to: closeout, roadmap governance
  - verify: acceptance includes evidence table and roadmap current/next update

---

## 依赖与顺序

- 关键路径：T001 -> T002 -> T003/T004 -> T006/T007 -> T009/T010 -> T014/T015 -> T016。
- T013 可在 T003 后并行进行。
- T011 只有在 route response 变化影响前端时需要实质修改；否则记录 no-op。
- T012 可在 T007 后并行，但最终验证依赖 T010。

---

## 覆盖检查

| 场景 / 需求 | 对应任务 |
|---|---|
| US1 状态可恢复 / 快速创建 | T001-T005, T008 |
| US2 Worker 执行 update/poll/apply | T006-T008 |
| US3 兼容旧状态接口 | T009-T011 |
| FR-001 移除内存 Map | T005 |
| FR-008 job health/status 可见 | T012 |

| 架构决策 / 质量属性 | 对应任务 | 验证任务 |
|---|---|---|
| ADR-001 existing automation queue | T001, T002, T007 | T014 |
| ADR-002 internal automation token | T003, T013 | T014 |
| ADR-003 automation_runs durable evidence | T007, T009, T010 | T014 |
| ADR-004 worker bounded polling | T006, T007 | T014 |
| 可用性 / 一致性 / 可观测性 | T004, T008, T010, T012 | T014, T015 |

---

## Notes

- 本 feature 不新增任务中心页面。
- 本 feature 不迁移 weekly publish/suggest/apply。
- 如 implementation 发现 `automation_runs` token 约束导致 route 兼容性不可接受，应回到 plan 修正 ADR，而不是临时引入私有 Map fallback。

---

## Stage Readiness

- 推荐下一步：`execute-plan`
- 阻塞项（如有）：无。任务较多且跨 auth/job/worker/route/docs/tests，建议先按 phase 执行。

# Acceptance Record: Karakeep Resync Redis State

**Workspace**: `karakeep-resync-redis-state` | **Date**: 2026-06-22 | **Spec**: [spec.md](spec.md)  
**Verdict**: PASS

---

## Summary

Karakeep resync 已从 web 进程内 `Map` 状态迁入现有 automation job 体系。内容页原有 `/api/content/[id]/karakeep-resync` 路径保留：POST 现在提交 `karakeep.resync` queued job，GET 只读取 status 并映射为旧 UI 兼容 shape。Worker 执行 Karakeep update/poll/apply，成功后只写回 `contents.summary` 与 Karakeep sync attributes，不恢复图片写回。

---

## Evidence Table

| Requirement | Evidence | Test or File | Verdict |
|---|---|---|---|
| FR-001 移除进程内 `Map` 状态源 | `karakeep-resync.ts` 不再包含 `new Map<string, KarakeepResyncJob>`、`jobs.set` 或 `jobs.get` production state。 | `rg "new Map<string, KarakeepResyncJob>|jobs\\.set|jobs\\.get"` | PASS |
| FR-002 queued job 创建 | POST route 使用内部 automation token 提交 `karakeep.resync`，返回 HTTP 202 和 legacy-compatible job shape。 | `src/app/api/content/[id]/karakeep-resync/route.test.ts` | PASS |
| FR-003 worker 执行 update/poll/apply | `executeAutomationJob('karakeep.resync')` 调用 `executeKarakeepResyncJob`；service test 覆盖 updateBookmark、getBookmark、DB write。 | `src/lib/jobs/worker-handlers.test.ts`, `src/lib/services/karakeep-resync.test.ts` | PASS |
| FR-004 GET status 纯读 | GET route 调用 `getKarakeepResyncStatus(jobId)`，不再调用旧 `progressResyncJob`。 | `src/app/api/content/[id]/karakeep-resync/route.ts`, route tests | PASS |
| FR-005 错误可见 | 缺少内部 token 返回 `ADMIN_UI_AUTOMATION_TOKEN_MISSING`；failed status 映射 message。 | route/service tests | PASS |
| FR-006 同 content target lock | `karakeep.resync` target 为 `content:{contentId}`，复用现有 submit lock 体系。 | `src/lib/jobs/definitions.test.ts` | PASS |
| FR-007 不恢复图片写回 | service 只更新 summary、`karakeep_synced_at` 和 `karakeep_id`；`appliedImage` 固定为 null。 | `src/lib/services/karakeep-resync.ts`, service tests | PASS |
| FR-008 status 可观测 | `content:resync` scope 可读取 content workflow job status；OpenAPI 和 status read scope 已更新。 | `src/app/api/v1/jobs/[id]/route.ts`, `src/app/api/v1/openapi.json/route.test.ts` | PASS |
| FR-009 保留旧路径 | 原 `/api/content/[id]/karakeep-resync` POST/GET 保留，前端无需改动。 | route tests, no-op T011 | PASS |
| FR-010 测试覆盖 | Focused suite 5 files / 27 tests passed；type-check and ESLint targeted passed。 | Verification Commands | PASS |

---

## Verification Commands

| Command | Result |
|---|---|
| `pnpm exec vitest run src/lib/jobs/definitions.test.ts src/lib/jobs/worker-handlers.test.ts src/lib/services/karakeep-resync.test.ts 'src/app/api/content/[id]/karakeep-resync/route.test.ts' src/app/api/v1/openapi.json/route.test.ts` | PASS: 5 files / 27 tests |
| `pnpm exec tsc --noEmit --pretty false` | PASS |
| `pnpm exec eslint ...touched files...` | PASS: 0 errors / 0 warnings |

---

## Verdict Summary

| Dimension | Verdict | Notes |
|---|---|---|
| Component capability | PASS | scope、job definition、route、worker handler、service、status mapping 和 docs 已落地。 |
| Workflow closure | PASS | UI POST -> queued job -> worker -> Karakeep API -> MySQL write -> GET status 兼容 shape 的闭环已由 tests 覆盖。 |
| User-visible outcome | PASS | 用户仍使用原内容页重跑入口；应用重启后不再依赖 route 进程内 Map 状态。 |

**Overall**: PASS

---

## Workflow Replay

- **输入摘要**: 内容页用户触发 Karakeep resync，内容存在 `karakeep_id` 和 `source_url`，服务端有 `ADMIN_UI_AUTOMATION_TOKEN` 或 `CRON_API_TOKEN` 且 token 包含 `content:resync` scope。
- **最终 payload 摘要**: POST 返回 `jobId/runId/statusUrl/phase=updating`；worker job payload 包含 `contentId/karakeepId/sourceUrl/maxAttempts`；成功 result summary 包含 `appliedSummary`、`karakeepSyncedAt` 和 attempt 信息。
- **用户可见结果断言**: 前端继续轮询同一路径，看到 `waiting/success/failed` 等旧 phase；成功后表单 summary 被更新。
- **Replay 类型**: focused fixture tests。未跑真实 Karakeep runtime smoke。

---

## Closeout Checklist

| Item | Status | Evidence / Rationale | Next Step |
|---|---|---|---|
| 旧逻辑、旧路径、fallback 或临时兼容退役 | 已完成 | 旧进程内 Map 状态源移除；旧 route 路径保留但语义改为 queue/status。 | 无。 |
| 发布、CI 或 follow-through | 延后 | 本次未执行 git commit/push；未跑完整 `pnpm test` / `pnpm build`。 | 提交前可按需跑全量验证。 |
| 文档更新 | 已完成 | `docs/automation-plan-admin.md`, `docs/nas-deployment.md`, `scripts/README.md` 记录 `content:resync`。 | 无。 |
| ADR / 架构债 | 已完成 | `plan.md` 记录复用 automation queue、GET 纯读、automation_runs durable evidence 和 worker bounded polling。 | 下一 feature 复用同一模式。 |
| Roadmap 状态 | 已完成 | `weekly-automation-runtime-roadmap` 标记本 feature PASS，下一推荐 `weekly-publish-worker`。 | 用户确认后进入 `weekly-publish-worker` specify。 |

---

## Knowledge Capture

| Type | Title | Summary | Evidence | Scope | Sync Status | Follow-up |
|---|---|---|---|---|---|---|
| decision | Karakeep resync uses automation job framework | 不新增私有 queue 或 MySQL 表，复用 `automation_runs` + BullMQ/Redis worker/status。 | [plan.md](plan.md) | Weekly automation runtime | recorded-only | `weekly-publish-worker` 应沿用该模式。 |
| convention | Content UI route can delegate to internal automation token | Cookie-auth UI route 保留，但外部副作用通过 `ADMIN_UI_AUTOMATION_TOKEN` / `CRON_API_TOKEN` 的 scope 进入 automation governance。 | route implementation, docs | Admin UI side effects | recorded-only | 后续 publish/suggest/apply worker 化复用。 |
| gotcha | Old GET status must remain side-effect free | 旧 GET 曾推进 Karakeep 轮询；现在 GET 只读 status，worker 负责推进副作用。 | route tests | Resync polling | recorded-only | 若前端要显示更细 phase，需要 worker 写更细 runtime snapshot。 |

---

## Completion Record

- **最终结论**: PASS
- **完成依据**: Evidence Table 覆盖 FR-001 到 FR-010；focused tests、type-check、targeted ESLint 均通过。
- **阻塞项**: 无。
- **延后项**: 真实 Karakeep/NAS runtime smoke、完整任务中心、weekly publish/suggest/apply worker 化。
- **下一步**: `weekly-publish-worker` 进入 `specify`。

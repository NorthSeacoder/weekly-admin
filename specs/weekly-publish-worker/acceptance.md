# Acceptance Record: Weekly Publish Worker

**Workspace**: `weekly-publish-worker` | **Date**: 2026-06-22 | **Spec**: [spec.md](spec.md)  
**Verdict**: PASS

---

## Summary

周刊 Quail 发布已从同步 automation route 迁入 Redis/BullMQ worker。`POST /api/v1/weekly/publish` 现在只做鉴权、幂等和 `weekly.publish` job submission，返回 HTTP 202 queued；worker 执行原有 `quailService.publishWeekly` 业务规则，并将成功 result、externalRef 或失败原因写入 automation run/status 体系。Workbench wrapper 继续可用，返回 queued envelope 和 humanCaller meta。

---

## Evidence Table

| Requirement | Evidence | Test or File | Verdict |
|---|---|---|---|
| FR-001 publish route queued submission | route 调用 `runQueuedAutomationRoute`，不再导入 prisma/quail 或同步 handler。 | `src/app/api/v1/weekly/publish/route.ts`, route test | PASS |
| FR-002 `weekly.publish` submittable | `weekly.publish.firstBatch=true`，attempts/backoff 使用 worker queue 策略，target 为 `weekly_issue:{id}`。 | `src/lib/jobs/definitions.ts`, definitions test | PASS |
| FR-003 worker 执行 Quail publish | `executeAutomationJob('weekly.publish')` 查询 issue 并调用 `quailService.publishWeekly`。 | `src/lib/jobs/worker-handlers.ts`, worker tests | PASS |
| FR-004 失败作为 worker evidence | issue missing、已发布未 force、Quail failure 均抛出 `AutomationJobExecutionError`。 | worker tests | PASS |
| FR-005 workbench wrapper 保持 envelope | wrapper 代理 automation route，返回 HTTP 202 queued 并附带 humanCaller meta。 | `src/app/api/weekly/workbench/[id]/publish/route.test.ts` | PASS |
| FR-006 failed publish retry | `workflow=weekly, step=publish` 映射到 `weekly.publish`，需要 `weekly:publish` scope。 | `src/lib/jobs/retry.ts`, retry tests | PASS |
| FR-007 OpenAPI queued/retry/status scope | `/weekly/publish` 响应 `QueuedJobResult`，status/retry security 包含 `weekly:publish`。 | `src/lib/automation/openapi.ts`, OpenAPI test | PASS |
| FR-008 旧管理页 out of scope | 未修改 `/api/quail/publish`。 | git diff scope | PASS |

---

## Verification Commands

| Command | Result |
|---|---|
| `pnpm exec vitest run src/lib/jobs/definitions.test.ts src/lib/jobs/worker-handlers.test.ts src/lib/jobs/retry.test.ts src/app/api/v1/weekly/publish/route.test.ts 'src/app/api/weekly/workbench/[id]/publish/route.test.ts' src/app/api/v1/openapi.json/route.test.ts` | PASS: 6 files / 36 tests |
| `pnpm exec tsc --noEmit --pretty false` | PASS |
| `pnpm exec eslint ...touched TS files...` | PASS: 0 errors / 0 warnings |

---

## Verdict Summary

| Dimension | Verdict | Notes |
|---|---|---|
| Component capability | PASS | job definition、queued route、worker handler、retry、OpenAPI 和 docs 已落地。 |
| Workflow closure | PASS | API/UI -> queued job -> worker -> Quail -> automation status/retry 的闭环由 focused tests 覆盖。 |
| User-visible outcome | PASS | 点击发布后快速得到 queued run/statusUrl；最终成功或失败在 job status 中查看。 |

**Overall**: PASS

---

## Workflow Replay

- **输入摘要**: automation caller 或 Admin UI internal token 具备 `weekly:publish` scope，并提供 `Idempotency-Key` 与 `weeklyIssueId`。
- **最终 payload 摘要**: queued job payload 包含 `weeklyIssueId`、`forceRepublish`、`deliver`；target lock 为 `weekly_issue:{id}`。
- **用户可见结果断言**: publish route 和 workbench wrapper 返回 `status=queued`、`runId/jobId/statusUrl`；worker 完成后 status endpoint 可读成功 result 或失败原因。
- **Replay 类型**: focused fixture tests。未跑真实 Quail/NAS runtime smoke。

---

## Closeout Checklist

| Item | Status | Evidence / Rationale | Next Step |
|---|---|---|---|
| 旧逻辑、旧路径、fallback 或临时兼容退役 | 已完成 | `/api/v1/weekly/publish` 不再同步发布；旧 workbench wrapper 保留并代理 queued route。 | 无。 |
| 发布、CI 或 follow-through | 延后 | 本次未执行 git commit/push；未跑完整 `pnpm test` / `pnpm build`。 | 提交前可按需跑全量验证。 |
| 文档更新 | 已完成 | `docs/automation-plan-admin.md`, `docs/nas-deployment.md` 记录 publish worker 化。 | 无。 |
| ADR / 架构债 | 已完成 | `plan.md` 记录复用 automation queue/status/retry，不新增表。 | 下一 feature 复用同一模式。 |
| Roadmap 状态 | 已完成 | `weekly-automation-runtime-roadmap` 标记本 feature PASS，下一推荐 `weekly-suggest-apply-worker`。 | 用户确认后进入 `weekly-suggest-apply-worker` specify。 |

---

## Completion Record

- **最终结论**: PASS
- **完成依据**: Evidence Table 覆盖 FR-001 到 FR-008；focused tests、type-check、targeted ESLint 均通过。
- **阻塞项**: 无。
- **延后项**: 真实 Quail/NAS runtime smoke、weekly suggest/apply worker 化、任务中心 UI。
- **下一步**: `weekly-suggest-apply-worker` 进入 `specify`。

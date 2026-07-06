# Implementation Plan: Weekly Publish Worker

**Workspace**: `weekly-publish-worker` | **Date**: 2026-06-22 | **Spec**: [spec.md](spec.md)

---

## Summary

复用 `karakeep-resync-redis-state` 刚建立的 automation worker 模式，把 `/api/v1/weekly/publish` 从同步 Quail 发布改为 queued job。Worker 执行原有 Quail publish 业务规则，retry endpoint 支持 failed weekly publish run。

---

## Architecture Overview

```text
/api/v1/weekly/publish
  -> authenticate weekly:publish
  -> submitAutomationJob("weekly.publish")
  -> 202 queued

worker
  -> executeAutomationJob("weekly.publish")
  -> validate weekly issue state
  -> quailService.publishWeekly(...)
  -> complete/fail automation_runs

/api/weekly/workbench/[id]/publish
  -> cookie auth
  -> internal token delegates to /api/v1/weekly/publish
  -> returns queued envelope + humanCaller
```

---

## Producer-Consumer Matrix

| Producer | Artifact | Consumer | Consumption Proof |
|---|---|---|---|
| Publish route | `weekly.publish` job payload | Automation worker | route test asserts queued job |
| Worker publish handler | Quail post id/slug result | automation_runs result/status UI | worker test asserts result summary |
| Failed worker execution | error code/message | status/retry endpoint | retry test supports weekly publish |
| Workbench wrapper | queued envelope + humanCaller meta | Workbench publish UI | wrapper route test |

**孤儿 artifact 处理**: 无；旧 `/api/quail/publish` 明确 out of scope。

---

## Lightweight ADR

| 决策 | 背景 | 候选 | 结论 | 代价 | 来源 |
|---|---|---|---|---|---|
| ADR-001 `/api/v1/weekly/publish` 只入队 | Quail 是外部副作用，request 内同步执行不可观测 | A queued worker / B 保持同步 / C 新 route | 选 A | 调用方不能立即拿到 quail slug，需要查 status | Existing job framework |
| ADR-002 复用现有 QuailService | 发布内容生成和 DB 写入已集中 | A worker 调用 service / B 拆服务内部步骤 | 选 A | service 内部错误粒度不变 | Existing service |
| ADR-003 retry 支持 weekly publish | publish 外部失败需要重试 | A 扩展 retry mapping / B 等任务中心 | 选 A | retry 依赖 BullMQ payload retention | Existing retry service |

---

## Module Design

### Module: Job definition

将 `weekly.publish` 的 `firstBatch` 改为 true，保持 scope `weekly:publish`、target `weekly_issue:{id}`、attempts 2、exponential backoff。

### Module: Publish route

`/api/v1/weekly/publish` 保留 body validation 和 Idempotency-Key 要求，但调用 `runQueuedAutomationRoute`，不查询 weekly issue，不调用 Quail。

### Module: Worker handler

新增 `executeWeeklyPublishJob`：查询 issue、处理已发布/forceRepublish、调用 `quailService.publishWeekly`，返回 `AutomationRunSuccess`，失败抛 `AutomationJobExecutionError` 或 route error equivalent。

### Module: Retry

`jobNameForRun` 支持 `workflow=weekly, step=publish` -> `weekly.publish`，caller 必须有 `weekly:publish`。

---

## Data Model

不新增表。复用：

- `automation_runs`: durable run evidence
- BullMQ retained payload: retry source
- `weekly_issues`: Quail publish fields 仍由 `quailService.publishWeekly` 写入

---

## Verification Strategy

- Route tests: publish route returns 202 queued; no Quail/prisma call in route.
- Worker tests: success, already published without force, missing issue, Quail failure.
- Retry tests: weekly publish retry with retained payload and scope guard.
- Workbench wrapper tests: expected status changes from 200 published to 202 queued.
- OpenAPI tests: queued response already references `QueuedJobResult`; retry security includes `weekly:publish`.
- Static checks: type-check and targeted lint.

---

## Stage Readiness

- 是否需要 `data-model.md`：不需要；无新增存储，plan 已覆盖状态边界。
- 下一步建议：`tasks`
- 阻塞项：无。

# Data Model: Karakeep Resync Redis State

**Workspace**: `karakeep-resync-redis-state` | **Date**: 2026-06-22

---

## Storage Decision

本 feature 不新增 MySQL 表，不生成 Prisma migration。

状态分层：

- MySQL `automation_runs`: durable run evidence，记录 queued/running/terminal、target、request digest、result summary、error。
- Redis / BullMQ: queue、retry、target lock、runtime snapshot、worker heartbeat。
- MySQL `contents` / `content_attributes`: 业务结果事实源，仅在 Karakeep summary/tagging 成功后写入。

Redis 不是业务事实源；Redis status 过期不影响已写入的内容摘要和同步属性。

---

## Job Definition

### Automation Job: `karakeep.resync`

| 字段 | 值 |
|---|---|
| queue | `automation` |
| workflow | `content` |
| step | `karakeep_resync` |
| scope | `content:resync` |
| targetType | `content` |
| targetId | `String(contentId)` |
| targetKey | `content:{contentId}` |
| attempts | 2 |
| backoff | exponential, 30s |

---

## Payload

```ts
type KarakeepResyncPayload = {
  contentId: number;
  karakeepId: string;
  sourceUrl: string;
  refreshScreenshot: boolean;
  screenshotLocked: boolean;
  maxAttempts: number;
};
```

Notes:

- `refreshScreenshot` 和 `screenshotLocked` 保留兼容字段，但本 feature 不恢复图片写回。
- `maxAttempts` 继续使用 route 现有 clamp 规则：最小 6，最大 30，默认 12。
- 后续可在 plan/tasks 阶段决定是否增加 polling interval env；若新增，应复用 config-validation 模式。

---

## Runtime Status

旧 Karakeep phase 到 automation status 的兼容映射：

| Legacy phase | Automation / worker state | 说明 |
|---|---|---|
| `updating` | `queued` or early `running` | 任务已提交或 worker 正在调用 Karakeep update |
| `waiting` | `running` | worker 正在等待 Karakeep summary/tagging |
| `applying` | `running` | worker 正在写回 Admin content |
| `success` | `succeeded` or `partial_success` | worker 已完成并写入 result summary |
| `failed` | `failed` | worker 最终失败、超时或配置错误 |

兼容 response 应包含：

```ts
type KarakeepResyncJobResponse = {
  jobId: string;
  runId?: string;
  contentId: number;
  karakeepId?: string;
  phase: 'updating' | 'waiting' | 'applying' | 'success' | 'failed';
  attempt: number;
  maxAttempts: number;
  refreshScreenshot: boolean;
  screenshotLocked: boolean;
  message?: string;
  summarizationStatus?: string;
  taggingStatus?: string;
  appliedSummary?: string | null;
  appliedImage?: string | null;
  updatedAt: string;
  statusUrl?: string;
  historyOnly?: boolean;
};
```

---

## Durable Result Summary

`automation_runs.result_summary` should store a compact JSON object:

```ts
type KarakeepResyncResultSummary = {
  status: 'succeeded' | 'empty' | 'partial_success';
  contentId: number;
  karakeepId: string;
  appliedSummary: string | null;
  appliedImage: null;
  summarizationStatus?: string;
  taggingStatus?: string;
  attempts: number;
  maxAttempts: number;
  karakeepSyncedAt: string;
};
```

Failure evidence should use:

- `automation_runs.error_code`
- `automation_runs.error_message`
- Redis runtime snapshot `error` while retained

---

## Business Writes

On success only:

- `contents.summary = bookmark.summary || bookmark.content?.description || null`
- upsert `content_attributes(attribute_name='karakeep_synced_at')`
- upsert `content_attributes(attribute_name='karakeep_id')`

No writes to image fields:

- no `contents.image_url`
- no `weekly_issues.cover`
- no screenshot/image attribute update

---

## State Transition

```text
queued
  -> running(updating)
  -> running(waiting) [repeat until Karakeep ready or maxAttempts]
  -> running(applying)
  -> succeeded

queued/running
  -> retrying
  -> running
  -> failed

running(waiting)
  -> failed(timeout)
```

---

## Migration Notes

- Prisma migration: not required.
- Existing module-level `Map` state should be removed or reduced to test-only dependency injection; it must not remain a production fallback.
- Existing callers of `/api/content/[id]/karakeep-resync` should keep working with `jobId`.

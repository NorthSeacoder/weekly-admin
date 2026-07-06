# Implementation Plan: Karakeep Resync Redis State

**Workspace**: `karakeep-resync-redis-state` | **Date**: 2026-06-22 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `specs/karakeep-resync-redis-state/spec.md`

---

## Summary

将 Karakeep resync 从模块级 `Map` 状态迁入现有 `automation_runs` + BullMQ/Redis worker 体系。保留 `/api/content/[id]/karakeep-resync` 作为 cookie-auth UI 入口，但创建任务时通过内部 automation token 提交 `karakeep.resync` job，GET 只读取状态，不再推进副作用。

---

## Architecture Overview

```text
Content UI
  -> POST /api/content/[id]/karakeep-resync
      -> cookie auth + content validation
      -> internal automation caller from ADMIN_UI_AUTOMATION_TOKEN / CRON_API_TOKEN
      -> submitAutomationJob("karakeep.resync")
      -> automation_runs queued + BullMQ job + Redis target lock

weekly-admin-worker
  -> processAutomationJob("karakeep.resync")
      -> update Karakeep bookmark URL
      -> poll Karakeep summary/tagging until done or timeout
      -> update contents.summary + content_attributes
      -> complete/fail automation_runs + Redis runtime snapshot

Content UI
  -> GET /api/content/[id]/karakeep-resync?jobId=auto_...
      -> read getAutomationJobStatus(jobId)
      -> map to legacy KarakeepResyncJob-compatible response
```

本方案不新增队列类型，不新增 MySQL 表；它扩展现有 automation job registry、worker handler 和 status reader。

---

## Architecture Reference

| 参考模式 / 模板 | 来源 URL | 适配点 | 不适配点 | 当前阶段 |
|---|---|---|---|---|
| Redis-backed worker queue | https://github.com/taskforcesh/bullmq | BullMQ 官方示例支持 `Queue.add`、`Worker` processor、`attempts`、`backoff`、`queue.getJob()`；与现有 Redis job orchestration 一致 | 不引入 parent-child jobs、manual locks 或独立 dashboard | 成长期 |
| Existing automation job orchestration | `specs/redis-job-orchestration/acceptance.md` | 已验证 submit -> worker -> retry -> automation_runs -> status/health 闭环 | 首批只支持 sync/score，需要扩展 job definition 和 handler | 成长期 |

---

## Producer-Consumer Matrix

| Producer | Artifact | Consumer | Consumption Proof |
|---|---|---|---|
| Content resync POST route | `karakeep.resync` job payload | Automation worker | route test asserts queued response; worker test receives payload |
| Worker Karakeep update step | Karakeep bookmark refresh request | Karakeep API | mocked API called with source URL and unarchived flag |
| Karakeep API | bookmark summary/status | Worker apply step | worker test applies summary only after summary/tagging success |
| Worker apply step | updated `contents.summary` + `content_attributes` | Content UI / downstream weekly workflow | service test verifies DB update and status response result |
| Automation worker | Redis runtime snapshot + `automation_runs` row | status GET / job health | status route test maps running/succeeded/failed/expired states |

**孤儿 artifact 处理**: 无。每个中间产物都有明确 consumer；Redis snapshot 过期后由 `automation_runs` 和 content attributes 承接历史证据。

---

## Quality Attribute Targets

| 属性 | 目标 | 设计影响 | 验证方式 |
|---|---|---|---|
| 可用性 | 任务状态不依赖 web 进程内存 | 删除模块级 `Map` 状态源，改用 automation status | route/status tests |
| 一致性 | 同一 content 不并发 resync | 复用 target lock，targetKey = `content:{id}` | submit lock test |
| 可观测性 | running/retry/failed/success 可查 | 复用 Redis runtime snapshot + `automation_runs` | status tests |
| 安全 | cookie UI 不直接绕过 automation side-effect governance | 通过内部 automation token 提交 job | auth/config tests |
| 可演进性 | publish/suggest/apply 后续复用同一模式 | 扩展 existing job definition，不另起私有队列 | roadmap 后续 feature 可继承 |

---

## Capacity / Scale Notes

- **规模假设**: Karakeep resync 是人工触发低频任务，通常单 content 单任务。
- **读写特征**: 创建少、轮询多；worker 会调用外部 Karakeep API 并最终写一次 MySQL。
- **失败代价**: 失败不能影响内容主数据；必须可见、可重试或重新触发。

---

## Lightweight ADR

| 决策 | 背景 | 候选 | 结论 | 代价 | 来源 |
|---|---|---|---|---|---|
| ADR-001 使用 existing automation queue | 当前已有 Redis/BullMQ/worker/status | A: 复用 automation queue；B: 新建 Karakeep 私有 queue；C: 只把 Map 换成 Redis key | 选 A | 需要内部 automation token 和新 scope；实现面更广 | BullMQ docs + existing code |
| ADR-002 GET status 不再推进任务 | 旧 GET 有副作用且依赖内存状态 | A: GET 纯读；B: 保留 GET 推进；C: POST 同步阻塞 | 选 A | 前端依赖轮询节奏，但不再由 GET 触发进展 | UNVERIFIED |
| ADR-003 使用 automation_runs 作为 durable evidence | 现有 job status 依赖 automation_runs | A: 使用 automation_runs；B: 只用 Redis；C: 新 MySQL resync 表 | 选 A | 需要 automation token 归属；不保留每次 poll 的完整历史 | Existing schema |
| ADR-004 Worker 内部轮询 Karakeep | Karakeep 生成 summary/tagging 是异步外部过程 | A: worker loop bounded polling；B: BullMQ delayed chained jobs；C: route polling | 选 A | 长任务占用一个 worker slot；后续高频时再演进 | BullMQ docs |

---

## Key Design Decisions

### Decision 1: 新增 `karakeep.resync` automation job

- **背景**: 当前 `AutomationJobName` 已预留 weekly jobs，但没有 content/Karakeep job；Karakeep resync 是外部副作用 + 内容写回，应进入同一治理面。
- **选项**:
  - A: 扩展 existing automation job definition。
  - B: 新建 `karakeep` queue 和 worker。
  - C: 只用 Redis string/hash 保存旧 Map。
- **结论**: 选择 A。新增 `content:resync` scope、`workflow='content'`、`step='karakeep_resync'`、`jobName='karakeep.resync'`。
- **影响**: 需要更新 auth scope、job definition、worker handler、OpenAPI/测试。换来统一 status、target lock、retry 和 health。
- **来源**: BullMQ official docs via Context7; existing `src/lib/jobs/*`。

### Decision 2: UI route 使用内部 automation token

- **背景**: `/api/content/[id]/karakeep-resync` 是 cookie-auth UI route，但 `automation_runs` 要求 `token_id`。
- **选项**:
  - A: 读取 `ADMIN_UI_AUTOMATION_TOKEN`，fallback 到 `CRON_API_TOKEN`，要求具备 `content:resync` scope。
  - B: 为 human user 创建 pseudo automation token。
  - C: 放弃 automation_runs。
- **结论**: 选择 A，与现有 workbench publish wrapper 保持一致。
- **影响**: 环境缺失时 route 返回明确配置错误；部署文档和 token bootstrap 需要补充 scope。
- **来源**: `src/app/api/weekly/workbench/[id]/publish/route.ts`。

### Decision 3: 保持旧 API shape 的兼容映射

- **背景**: 前端可能依赖 `phase/attempt/maxAttempts/message/appliedSummary` 等字段。
- **选项**:
  - A: status route 映射 automation status 到旧 KarakeepResyncJob shape。
  - B: 前端改用 `/api/v1/jobs/{id}` 原始 shape。
- **结论**: 选择 A。POST/GET 仍返回旧字段超集，并额外允许 `runId/statusUrl`。
- **影响**: UI 改动最小；mapping 需要 focused tests 覆盖。
- **来源**: Existing route contract。

---

## Module Design

### Module: Automation auth scope

**职责**: 允许 Karakeep resync 使用独立最小 scope。

**改动概述**: 扩展 `AutomationScope` 为 `content:resync`，更新 token bootstrap/fixtures/OpenAPI scopes。

**YAGNI 停止层级**: 第 4 层，复用已安装和已实现的 automation token system；不新增权限系统。

### Module: Job definition and submission

**职责**: 将 Karakeep resync 建模为可提交 job。

**改动概述**: 新增 `karakeep.resync` definition；允许它成为 submittable job；target 使用 `content:{contentId}`；attempt/backoff 保守设置为 2 次、exponential。

**关键接口 / 行为**:

```text
submitAutomationJob({
  jobName: "karakeep.resync",
  payload: { contentId, karakeepId, sourceUrl, refreshScreenshot, screenshotLocked, maxAttempts }
})
```

**YAGNI 停止层级**: 第 4 层，复用现有 submit/lock/rate-limit 代码；不新增 queue abstraction。

### Module: Karakeep worker handler

**职责**: 在 worker 中执行 update/poll/apply。

**改动概述**: 将 `karakeep-resync.ts` 从 Map 状态服务改为纯执行函数：update bookmark、轮询 bookmark、写回 content summary/attributes、返回 legacy-compatible result。

**关键接口 / 行为**:

```text
executeKarakeepResyncJob(payload)
  validate content still exists
  updateBookmark(karakeepId, { url: sourceUrl, archived: false })
  repeat maxAttempts:
    bookmark = getBookmark(karakeepId)
    if summary/tagging done: apply summary; return success
    wait polling interval
  throw timeout
```

**YAGNI 停止层级**: 第 5 层，bounded loop 比 delayed chained jobs 简单；当 resync 频率升高再升级。

### Module: Content resync route compatibility

**职责**: 保留现有 UI API。

**改动概述**: POST 从创建内存 job 改为提交 automation job；GET 从 `progressResyncJob` 改为读取 `getAutomationJobStatus` 并映射为旧 response。

**注意事项**:

- GET 必须校验 `targetId/contentId`，防止用户拿其他 job id 查询。
- 不再由 GET 推进外部副作用。
- POST 环境 token 缺失或 scope 不足时返回明确错误。

**YAGNI 停止层级**: 第 4 层，复用 route 和 status reader；不引入新前端状态模型。

### Module: Status mapping

**职责**: 将 automation job status 映射为 `KarakeepResyncJob` 兼容 shape。

**改动概述**: 新增 mapping helper，覆盖 queued/running/retrying/succeeded/failed/expired。

**YAGNI 停止层级**: 第 5 层，简单纯函数即可；不做通用 status translation framework。

---

## Data Model

详见 [data-model.md](data-model.md)。本 feature 不新增 MySQL 表或 Prisma migration；新增 Redis/BullMQ job payload/status 语义，并复用 `automation_runs` durable evidence。

---

## Project Structure

```text
src/lib/automation/auth.ts
src/lib/automation/openapi.ts
src/lib/jobs/definitions.ts
src/lib/jobs/worker-handlers.ts
src/lib/services/karakeep-resync.ts
src/app/api/content/[id]/karakeep-resync/route.ts
src/lib/services/karakeep-resync.test.ts
src/app/api/content/[id]/karakeep-resync/route.test.ts
src/lib/jobs/worker-handlers.test.ts
docs/automation-plan-admin.md
docs/nas-deployment.md
```

---

## Risks and Tradeoffs

- 需要内部 automation token 具备 `content:resync` scope；配置缺失会让该功能不可用，但失败是显式的。
- Worker 内部轮询会占用 worker slot；当前人工触发低频可接受。
- `automation_runs` 记录最终 evidence，不保存每次 polling 的完整历史；如未来需要审计每个 poll，再新增 attempt/history 表。
- 增加 scope 会影响 token bootstrap、文档和测试 fixtures，需要同步更新。

---

## Evolution Path

- **MVP**: `karakeep.resync` 进入 existing automation queue；status 兼容旧 route；不新增 UI 页面。
- **成长期**: `weekly.publish`、`weekly.suggest`、`weekly.apply` 迁入同一 worker 模式。
- **成熟期**: 当任务类型和历史查询需求增多，再做 `task-center-v1` 和持久 job_attempts。

---

## Anti-Pattern Check

- 是否把成熟期架构套到了 MVP：否。未新增任务中心、job_attempts 或多队列平台。
- 是否引用了外部模式但没有适配检查：否。BullMQ 只作为现有依赖和现有 worker 模式的延续。
- 是否新增未记录的状态、依赖、缓存、队列或失败模式：否。新增 job name/scope/status mapping 已在本 plan 和 data-model 记录。

---

## Verification Strategy

- Unit tests:
  - Karakeep resync worker success / timeout / API failure / content missing。
  - status mapping queued/running/retrying/succeeded/failed/expired。
  - job definition target lock for same content。
- Route tests:
  - POST validates auth/content/karakeep id/source URL and submits queued job。
  - POST returns config/scope error when internal token missing or invalid。
  - GET reads automation status and rejects mismatched target。
- Integration-focused tests:
  - `processAutomationJob` handles `karakeep.resync` and updates `automation_runs` through existing worker path。
- Static checks:
  - `pnpm type-check`
  - targeted Vitest suite
  - lint if touched files trigger rules
- Runtime smoke:
  - Optional after implementation: start Redis + app + worker, submit one Karakeep resync against a controlled fixture or mocked local path if real Karakeep is unavailable.

---

## Stage Readiness

- 是否需要 `data-model.md`：需要。涉及 Redis job payload/status、`automation_runs` 复用和 content attribute evidence。
- 下一步建议：`tasks`
- 阻塞项（如有）：无。

---

## Design Artifacts

| 产物 | 是否需要 | 说明 |
|---|---|---|
| plan.md | 必须 | 当前文件 |
| data-model.md | 需要 | 记录 job payload/status 和 evidence 边界 |
| tasks.md | 后续阶段生成 | 拆分可执行任务 |
| acceptance.md | 后续阶段生成 | 最终验收记录 |

---

## Sources

| 决策 | 来源 URL | 备注 |
|---|---|---|
| BullMQ Queue/Worker attempts/backoff/status | https://github.com/taskforcesh/bullmq | Context7 查询确认 `Queue.add` attempts/backoff、`Worker` processor、`queue.getJob()` 等行为 |
| Existing Redis job orchestration | `specs/redis-job-orchestration/acceptance.md` | 本 repo 已验证的实现基础 |
| Internal UI automation token wrapper | `src/app/api/weekly/workbench/[id]/publish/route.ts` | 复用相同内部委托模式 |

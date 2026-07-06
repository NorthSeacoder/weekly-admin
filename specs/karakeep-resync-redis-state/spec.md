# Feature Specification: Karakeep Resync Redis State

**Workspace**: `karakeep-resync-redis-state`  
**Created**: 2026-06-22  
**Status**: Draft  
**Input**: 用户选择“周刊自动化优先”，要求把剩余 deferred feature 按 roadmap 组织并实现；首个执行切片为 Karakeep resync Redis 化。

> 本 feature 属于 `specs/weekly-automation-runtime-roadmap/roadmap.md`，写入后 `specs/.active` 应指向当前 workspace。

---

## Feature Traits *(LM 自动检测，用户可 override)*

| Trait | 是否命中 | 依据 |
|---|---|---|
| `multi-stage-workflow` | ✅ | Karakeep resync 包含触发 Karakeep 更新、等待 summary/tagging、应用结果到 Admin 内容、前端轮询状态。 |
| `external-side-effects` | ✅ | 会调用 Karakeep API 更新 bookmark，并在完成后写回 Admin MySQL 内容摘要和属性。 |
| `artifact-handoff` | ✅ | Karakeep 生成的 bookmark summary/tagging 状态被 Admin worker 消费，再写入 content summary / attributes。 |
| `user-visible-output` | ✅ | 用户在内容页触发重跑并看到进度、成功、失败或超时状态。 |
| `prior-closure-failure` | ✅ | `redis-job-orchestration` closeout 明确 Karakeep resync 仍使用内存 `Map`，是后续 execution-control slice。 |
| `bugfix-loop-breaker` | ❌ | 这是已知架构债迁移，不是 root cause 未明或重复失败 bugfix。 |

**结论**: 下游 `plan` 必须包含 Producer-Consumer Matrix；`verify` 必须有 Evidence Gate；`closeout` 需要三维 Verdict 和 Workflow Replay，并生成/更新 `acceptance.md`。

---

## Context Summary

现有 `src/lib/services/karakeep-resync.ts` 使用模块级 `Map<string, KarakeepResyncJob>` 保存任务状态。`POST /api/content/[id]/karakeep-resync` 创建任务并调用 Karakeep `updateBookmark`，`GET` 通过 `jobId` 推进轮询并在 summary/tagging 完成后写回 `contents.summary` 与 `content_attributes`。

该模式的问题是状态只存在当前 Next.js 进程内，应用重启、横向扩容或 route runtime 切换都会丢失任务；它也没有进入现有 BullMQ/Redis worker、job health、retry、status endpoint 和 dashboard/workbench 可观测体系。

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 内容维护者触发 Karakeep 重跑后状态可恢复 (Priority: P1)

作为周刊内容维护者，我希望点击 Karakeep 重跑后任务状态不依赖当前 web 进程内存，以便应用重启后仍能继续查询任务结果或看到明确失败。

**Why this priority**: 这是当前 deferred 项的核心缺口；不解决它，Karakeep resync 仍游离于 Redis job orchestration 之外。

**Acceptance Scenarios**:

1. **创建任务快速返回**
   **Given** 内容存在且绑定 `karakeep_id` 与 `source_url`  
   **When** 用户触发 Karakeep resync  
   **Then** API 返回 `jobId`、当前 phase/status、content id 和可轮询状态，不在 request 内完成长轮询。

2. **状态不依赖进程内 Map**
   **Given** resync 任务已创建  
   **When** 后续 GET status 请求到达同一或不同 app 进程  
   **Then** API 从 Redis/job status 或 durable evidence 读取任务状态，而不是依赖模块级 `Map`。

**Edge Cases**:

- Redis 不可用时，创建任务必须返回明确 degraded/error，不得静默退回内存 `Map`。
- 未配置 Karakeep 时，任务必须进入可见失败状态，并给出机器可读错误码。
- job status TTL 过期时，API 必须返回 history-only 或 expired 语义，而不是 404 误导用户认为任务从未存在。

### User Story 2 - Worker 负责轮询并应用 Karakeep 结果 (Priority: P1)

作为维护者，我希望 Karakeep 的 update/poll/apply 流程由 worker 执行，以便长任务、重试、超时和失败记录与现有 automation job 体系一致。

**Why this priority**: 现有 route 每次 GET 都推进轮询，副作用与读请求耦合，难以观测和恢复。

**Acceptance Scenarios**:

1. **Worker 执行完整流程**
   **Given** Karakeep resync job 已入队  
   **When** worker 领取任务  
   **Then** worker 调用 Karakeep 更新 bookmark、按配置轮询 summary/tagging，并在完成时写回 Admin 内容。

2. **结果写回保持边界**
   **Given** Karakeep summary/tagging 成功  
   **When** worker 应用结果  
   **Then** 只更新 `contents.summary`、`content_attributes.karakeep_synced_at` 和兼容所需 `karakeep_id` 属性，不引入图片写回。

**Edge Cases**:

- Karakeep summary 长时间未完成时，任务必须超时失败，并保留 attempt/maxAttempts。
- Karakeep API 失败时，任务必须按 retry 策略处理，最终失败需可查询。
- 内容或属性在任务期间被删除时，worker 必须失败并记录原因，不得写入错误 content。

### User Story 3 - 用户可见状态与现有接口兼容 (Priority: P2)

作为前端使用者，我希望现有 Karakeep resync UI/API 尽量保持返回结构兼容，以便本次迁移不要求大范围 UI 重写。

**Why this priority**: 本 feature 的目标是执行控制迁移，不是重新设计内容页体验。

**Acceptance Scenarios**:

1. **兼容旧轮询形态**
   **Given** 前端持有旧接口返回的 `jobId`  
   **When** 前端轮询 status  
   **Then** 仍能得到 phase、attempt、maxAttempts、message、summarizationStatus、taggingStatus、appliedSummary 等字段或兼容映射。

2. **状态进入 job health 可见面**
   **Given** Karakeep resync job 正在运行或失败  
   **When** 查看 job health/workbench summary  
   **Then** 能看到对应 backlog/running/failed 信号，至少不会被现有 job summary 隐藏。

**Edge Cases**:

- 旧 `jobId` 查不到时，返回明确 `RESYNC_JOB_NOT_FOUND` 或 `RESYNC_JOB_EXPIRED`。
- 多个 content 同时触发 resync 时，同一 content 应有 target lock 或幂等策略，避免重复写回互相覆盖。

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统必须移除 Karakeep resync 的模块级进程内 `Map` 作为唯一状态源。
- **FR-002**: 创建 resync 任务必须进入 Redis-backed queue/status 体系，并快速返回可查询 job id。
- **FR-003**: Worker 必须执行 Karakeep update -> poll -> apply 的完整流程。
- **FR-004**: GET status 必须从 Redis/job status 或 durable evidence 读取状态，并保持现有字段兼容或提供清晰映射。
- **FR-005**: Redis 不可用、Karakeep 未配置、Karakeep API 失败、轮询超时、内容缺失都必须有机器可读错误码和用户可见 message。
- **FR-006**: 同一 content 的并发 resync 必须通过 target lock、idempotency 或等效机制避免重复执行。
- **FR-007**: 成功写回不得恢复已退役图片链路；`appliedImage` 应为 `null` 或兼容字段，不写 legacy image 字段。
- **FR-008**: 任务必须进入现有 job health/status 可观测面，至少覆盖 running、failed、stale/expired 和 success。
- **FR-009**: 保留现有 `/api/content/[id]/karakeep-resync` 路径，避免本 feature 引入前端大迁移。
- **FR-010**: 测试必须覆盖 create/status/worker success/failure/timeout/Redis unavailable/compat response。

### Non-Functional Requirements

- **NFR-001**: POST 创建任务不应阻塞等待 Karakeep summary/tagging 完成。
- **NFR-002**: Redis status 过期不得删除 MySQL 中已成功写回的业务结果。
- **NFR-003**: Worker retry 和 polling interval 必须可配置或复用现有 job 配置模式。
- **NFR-004**: 不新增新的业务事实源；MySQL 仍是内容事实源，Redis 只保存 queue/status/lock/heartbeat。

### Quality Attributes

| 属性 | 目标 | 为什么重要 | 验收 / 证据 | 是否阻塞 plan |
|------|------|------------|-------------|----------------|
| 可用性 | App 重启后 status 不依赖内存 | 当前缺口就是进程内状态丢失 | focused tests + smoke replay | 是 |
| 一致性 | 同一 content 不重复并发写回 | 防止多 job 互相覆盖 summary/attributes | lock/idempotency 测试 | 是 |
| 可观测性 | failure/timeout/retry 可查 | 方便用户和运维判断重跑是否成功 | status/health 测试 | 是 |
| 可演进性 | 复用现有 Redis job 体系 | 后续 publish/suggest/apply worker 化要共用模式 | plan 中说明复用边界 | 是 |

### Key Entities

- **Karakeep Resync Job**: 用户触发的一次内容重跑，包含 `jobId`、`contentId`、`karakeepId`、phase/status、attempt、maxAttempts、message 和 applied result。
- **Job Target**: 用于锁定同一 content 或 karakeep bookmark，避免并发 resync。
- **Karakeep Bookmark Result**: Karakeep API 返回的 summary、summarizationStatus、taggingStatus，被 worker 消费并写回 Admin。
- **Durable Content Evidence**: `contents.summary` 和 `content_attributes.karakeep_synced_at` / `karakeep_id`，表示成功应用结果。

---

## Out of Scope

- 不迁移 weekly publish/suggest/apply；这些进入后续 roadmap feature。
- 不新增完整任务中心页面；本 feature 只保证现有 job health/status 可见。
- 不实现 Hermes external runtime 或 hermes-db/PG migrations。
- 不做 legacy image fields drop。
- 不改变 Karakeep API 本身的抓取/摘要质量策略。
- 不让 Redis 成为业务事实源。

---

## Unclear Questions

- 是否将 Karakeep resync 纳入现有 `automation_runs` 表作为 durable run evidence，还是只使用 Redis status + content attribute evidence？该问题影响 plan 阶段的数据边界。
- 是否需要为旧前端保留 GET 请求推进任务的兼容行为，还是直接改为纯 status read？推荐 plan 阶段选择纯 status read，并用 worker 推进。

---

## Stage Readiness

- 下一步建议：`plan`
- 阻塞项（如有）：无。两个未决问题属于方案选择，不阻塞 plan；plan 阶段需要给出候选并固定 ADR。

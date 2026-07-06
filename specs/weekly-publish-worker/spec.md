# Feature Specification: Weekly Publish Worker

**Workspace**: `weekly-publish-worker`  
**Created**: 2026-06-22  
**Status**: Completed  
**Input**: 用户确认按 `weekly-automation-runtime-roadmap` 继续，下一项为 `weekly-publish-worker`。

> 本 feature 属于 `specs/weekly-automation-runtime-roadmap/roadmap.md`，写入后 `specs/.active` 应指向当前 workspace。

---

## Feature Traits *(LM 自动检测，用户可 override)*

| Trait | 是否命中 | 依据 |
|---|---|---|
| `multi-stage-workflow` | ✅ | 发布流程为 UI/API 提交 -> Redis queue -> worker -> Quail API -> status/readback。 |
| `external-side-effects` | ✅ | Quail publish/deliver 是外部副作用，不能自动回滚。 |
| `artifact-handoff` | ✅ | queued job payload 被 worker 消费，worker result 被 status/UI 消费。 |
| `user-visible-output` | ✅ | 用户点击发布后看到 queued/status/run evidence，最终周刊发布到 Quail。 |
| `prior-closure-failure` | ✅ | roadmap 明确 `weekly.publish` 仍是 reserved job，尚未 worker 化。 |
| `bugfix-loop-breaker` | ❌ | 这是执行控制迁移，不是 root cause 未明 bugfix。 |

**结论**: plan 必须包含 Producer-Consumer Matrix；verify 必须有 Evidence Gate；closeout 需要三维 Verdict、Workflow Replay 和 acceptance.md。

---

## Context Summary

现有 `/api/v1/weekly/publish` 使用 `runAutomationRoute` 同步执行 `quailService.publishWeekly`。`src/lib/jobs/definitions.ts` 已有 `weekly.publish` reserved definition，但 `firstBatch=false`，worker handler 目前不支持该 job。Workbench UI wrapper `/api/weekly/workbench/[id]/publish` 已通过内部 `ADMIN_UI_AUTOMATION_TOKEN` / `CRON_API_TOKEN` 委托 `/api/v1/weekly/publish`。

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 发布请求快速入队 (Priority: P1)

作为周刊发布负责人，我希望点击发布后 API 快速返回 queued run，而不是在 request 内等待 Quail 发布完成。

**Acceptance Scenarios**:

1. **Automation publish 入队**
   **Given** automation caller 有 `weekly:publish` scope 和 Idempotency-Key  
   **When** 调用 `/api/v1/weekly/publish`  
   **Then** 返回 HTTP 202，包含 `runId/jobId/statusUrl/status=queued`。

2. **Workbench wrapper 保持可用**
   **Given** 登录用户点击 workbench 发布  
   **When** 服务端内部 token 有 `weekly:publish` scope  
   **Then** wrapper 返回 queued envelope，并附带 humanCaller meta。

**Edge Cases**:

- 缺 Idempotency-Key 仍返回 409。
- 已发布 issue 且未 forceRepublish 时，应在 worker 中失败并写入 durable error，而不是 route 同步 409。
- Redis unavailable 时返回明确 queue unavailable，不静默同步 fallback。

### User Story 2 - Worker 执行 Quail 发布并保留 evidence (Priority: P1)

作为维护者，我希望 Quail 发布由 worker 执行，以便重试、状态查询、失败原因和外部引用都进入 automation job 体系。

**Acceptance Scenarios**:

1. **Worker 成功发布**
   **Given** queued `weekly.publish` job  
   **When** worker 执行  
   **Then** 调用 `quailService.publishWeekly`，成功后 result summary 包含 weeklyIssueId、issueNumber、title、quailPostId、quailPostSlug、deliver/force flags。

2. **Worker 失败可观测**
   **Given** Quail API 或业务校验失败  
   **When** worker 执行失败  
   **Then** `automation_runs` 进入 failed，status endpoint 可看到错误。

**Edge Cases**:

- issue 不存在。
- issue 已发布且未 forceRepublish。
- Quail 返回 `{ success:false }`。
- deliver 邮件失败但 publish 成功时，沿用 `quailService.publishWeekly` 现有语义。

### User Story 3 - Retry 支持 weekly publish (Priority: P2)

作为运维者，我希望 failed weekly publish job 在 BullMQ payload retained 时可通过 retry endpoint 重试。

**Acceptance Scenarios**:

1. **Retry retained weekly publish**
   **Given** failed `workflow=weekly, step=publish` run 且 BullMQ payload 仍存在  
   **When** 调用 `/api/v1/jobs/{id}/retry` 且 caller 有 `weekly:publish` scope  
   **Then** 创建新的 queued run。

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `/api/v1/weekly/publish` 必须改为 queued job submission。
- **FR-002**: `weekly.publish` 必须从 reserved job 改为 submittable job。
- **FR-003**: Worker 必须支持 `weekly.publish` 并执行现有 Quail publish 业务规则。
- **FR-004**: 已发布 issue 未 forceRepublish、issue missing、Quail failure 必须作为 worker failure evidence。
- **FR-005**: Workbench wrapper 必须继续返回 envelope，并保留 humanCaller meta。
- **FR-006**: `weekly.publish` failed run 必须支持 retry endpoint。
- **FR-007**: OpenAPI 必须继续表达 publish queued response、job status 和 retry scope。
- **FR-008**: 旧 `/api/quail/publish` 管理页路径不在本 feature 范围内。

### Non-Functional Requirements

- **NFR-001**: Publish submit route 不应调用 Quail API。
- **NFR-002**: Redis unavailable 不得静默 fallback 到同步发布。
- **NFR-003**: Quail 外部引用必须写入 automation run result/externalRef。
- **NFR-004**: 不新增 MySQL 表，不改变 `quailService.publishWeekly` 的业务写入语义。

### Quality Attributes

| 属性 | 目标 | 为什么重要 | 验收 / 证据 | 是否阻塞 plan |
|---|---|---|---|---|
| 可用性 | 发布请求快速返回 queued | 外部 Quail 慢/失败不应占住 request | route test | 是 |
| 可观测性 | 发布 run 可 status/retry | 外部副作用需要 evidence | worker/status/retry tests | 是 |
| 一致性 | 同一 issue 发布 target locked | 防止重复发布 | job definition/submit tests | 是 |
| 安全 | 保留 weekly:publish scope | 发布是高风险外部副作用 | auth/OpenAPI tests | 是 |

### Key Entities

- **Weekly Publish Job**: `jobName=weekly.publish`, `workflow=weekly`, `step=publish`, target 为 weekly issue。
- **Publish Payload**: `weeklyIssueId`, `forceRepublish`, `deliver`。
- **Publish Result Summary**: `status=published`, issue metadata, Quail post id/slug, flags。

---

## Out of Scope

- 不迁移 `/api/quail/publish` 旧管理页路径。
- 不实现完整任务中心 UI。
- 不迁移 weekly suggest/apply。
- 不改变 QuailService 的发布内容生成逻辑。

---

## Stage Readiness

- 下一步建议：`plan`
- 阻塞项（如有）：无。

# Feature Specification: Weekly Suggest Apply Worker

**Workspace**: `weekly-suggest-apply-worker`
**Created**: 2026-07-07
**Status**: Accepted
**Input**: 用户要求运营链路接入 Hermes 和企微渠道，并完整实现未完成的周刊自动化 feature；前端样式由另一个 agent 处理，不应冲突。

---

## Scope

本 feature 将 automation 侧 `weekly.suggest` 和 `weekly.apply` 纳入 Redis/BullMQ worker/status 体系，并补齐 Hermes 发现当前周刊的只读入口。浏览器工作台的人类操作 wrapper 保持同步体验；外部 Hermes、cron、n8n、企微运营脚本走 `/api/v1` queued contract。

## Requirements

- **FR-001**: Hermes 必须能通过 Admin API 获取当前周覆盖的 `weeklyIssueId`，不得直读 MySQL。
- **FR-002**: `/api/v1/weekly/suggestions` 必须返回 queued job；worker 负责 Admin fallback preview 生成或 Hermes preview artifact 登记。
- **FR-003**: `/api/v1/weekly/suggestions/{id}/apply` 必须返回 queued job；worker 负责调用现有 `applyWeeklySuggestion` 写回逻辑。
- **FR-004**: Hermes register payload 必须在 route 侧先做 schema/secret-key 校验，避免含 secret 的 payload 落入 `automation_runs.request_payload`。
- **FR-005**: Workbench cookie-auth preview/apply wrapper 保持现有同步行为，不破坏人工编辑体验。
- **FR-006**: 提供 NAS 可用的 Hermes/WeCom ops helper，把当前 issue、候选摘要和 suggest run id 发送到 Hermes target。
- **FR-007**: OpenAPI 和 runbook 必须反映 queued contract、current issue discovery 和 Hermes/WeCom 操作方式。

## Out of Scope

- 不实现 Hermes skill 本体、PG/pgvector/hermes-db schema 或企业微信 gateway 配置；这些归 Hermes 仓和 NAS runtime。
- 不改 weekly 前端样式或正在被其它 agent 修改的 Astro 组件。
- 不自动 apply/publish；企微只做通知/处理入口，写回仍需 Admin 确认。

## Stage Readiness

- 当前阶段：`closeout`
- 阻塞项：无；本地验证、部署和 NAS smoke 已完成。

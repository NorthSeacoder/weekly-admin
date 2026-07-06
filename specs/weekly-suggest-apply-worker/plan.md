# Implementation Plan: Weekly Suggest Apply Worker

**Workspace**: `weekly-suggest-apply-worker`
**Date**: 2026-07-07

## Approach

复用现有 queued job 基础设施，不新增表：

- `weekly.suggest` / `weekly.apply` 从 reserved job 改为 submittable job。
- `/api/v1/weekly/suggestions` 和 `/api/v1/weekly/suggestions/{id}/apply` 使用 `runQueuedAutomationRoute`。
- Worker handlers 复用现有 Admin organizer、Hermes artifact adapter、`validateWeeklySuggestionItems` 和 `applyWeeklySuggestion`。
- 新增 `/api/v1/weekly/current`，让 Hermes 通过 `weekly:read` scope 获取当前 issue。
- `scripts/weekly-hermes-ops.sh` 在 NAS host 上调用 Admin API，再用 `docker exec hermes-agent hermes send` 发到 WeCom。

## Boundaries

- MySQL/Prisma 仍是业务事实源；Hermes 只能通过 `/api/v1` 消费和登记 artifact。
- Human workbench wrapper 保持同步，避免 UI 等待队列状态。
- WeCom 仅承接通知和人工处理入口；不承接自动发布。

## Verification

- Focused route/service/worker/OpenAPI tests。
- `pnpm type-check`、`pnpm lint --quiet`、`pnpm build`。
- NAS smoke：
  - `/api/v1/weekly/current`
  - queue `weekly.suggest`
  - `GET /api/v1/jobs/{runId}`
  - `scripts/weekly-hermes-ops.sh notify` 或 dry smoke。

## Risks

- Hermes WeCom runtime 日志仍出现过 WebSocket close；可用于运营通知，但关键无人值守通知需 smoke 后再依赖。
- Frontend DB 构建已实现，但 DB-only publish 后仍需自动 rebuild/deploy feature。

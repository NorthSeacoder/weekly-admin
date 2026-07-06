# Feature Specification: Hermes Runtime Integration

**Workspace**: `hermes-runtime-integration`
**Created**: 2026-07-07
**Status**: Accepted
**Input**: 继续完成周刊自动化后续内容；roadmap 在 `weekly-suggest-apply-worker` closeout 后推荐进入外部 Hermes runtime 集成。

---

## Scope

本 feature 将现有 Admin `/api/v1` contract、NAS `hermes-agent`、WeCom channel 和周刊 worker/status 体系连接成可运行的 Hermes 周刊建议 runtime。目标不是让 Hermes 绕过 Admin 写库，而是让 Hermes 能在 NAS 上读取 Admin API 上下文、生成或登记 `weekly-suggestion.v1` artifact，并把 run id / 摘要发到企微供人工处理。

## Requirements

- **FR-001**: Runtime 必须通过 Admin `/api/v1/weekly/current`、`/api/v1/weekly/candidates`、`/api/v1/ai/feedback/digest` 获取上下文，不得直连 MySQL。
- **FR-002**: Runtime 必须调用 Hermes one-shot 能力生成 `weekly-suggestion.v1` JSON artifact；输出必须可解析、可校验，不能包含 secret-like 字段。
- **FR-003**: Runtime 必须通过 `/api/v1/weekly/suggestions` register mode 入队登记 artifact，并通过 `/api/v1/jobs/{runId}` 可追踪 worker 结果。
- **FR-004**: Runtime 必须支持 `dry-run`，用于验证上下文获取、prompt 生成和 artifact 解析，而不写入 Admin。
- **FR-005**: Runtime 必须支持 WeCom 通知，把 Hermes 生成/登记结果发送到 `wecom` 或 `wecom:MengPeng`。
- **FR-006**: Runtime 必须在 NAS host 上可执行，读取 `/vol1/1000/Docker/weekly-admin/.env` 中的 `CRON_API_TOKEN`，且不打印 token。
- **FR-007**: Runtime 失败时必须明确失败在 Admin API、Hermes one-shot、artifact parse/register、job status 或 WeCom send 哪一步，便于排障。
- **FR-008**: 文档和 roadmap 必须说明 Hermes runtime 与 Admin/writeback 边界：apply/publish 仍由 Admin 人工确认。

## Out of Scope

- 不修改 `~/personal/weekly/weekly` 前端样式或构建逻辑。
- 不让 Hermes 自动 apply 或 publish。
- 不在本 feature 中设计 hermes-db/PG/pgvector 长期记忆 schema；若需要，作为后续 `hermes-memory-read-model` 或 hardening feature。
- 不迁移企微 gateway；只消费已部署的 Hermes WeCom send 能力。

## Stage Readiness

- 当前阶段：`closeout`
- 下一阶段：继续 `frontend-db-deploy-automation` 或 `task-center-v1`。

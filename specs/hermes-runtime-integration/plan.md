# Implementation Plan: Hermes Runtime Integration

**Workspace**: `hermes-runtime-integration`
**Date**: 2026-07-07

## Approach

采用一个 NAS host-side shell runtime，保持与 `weekly-hermes-ops.sh` 一样的部署和 token 模型：

- 读取 `WEEKLY_ADMIN_BASE_DIR/.env`，拿 `CRON_API_TOKEN`。
- 调用 Admin API 获取 current issue、ready candidates 和 feedback digest。
- 将上下文压缩成 JSON + prompt。
- 调用 `docker exec -i hermes-agent hermes --ignore-rules -z "$prompt"` 生成 artifact。
- 用 Python 抽取和规范化 Hermes stdout 中的 JSON。
- `dry-run` 只输出 artifact；`register` 通过 `/api/v1/weekly/suggestions` 入队，随后查询 `/api/v1/jobs/{runId}`。
- 可选调用 `docker exec -i hermes-agent hermes send --file -` 发企微通知。

## Boundaries

- Admin MySQL 仍是事实源；Hermes runtime 只通过 `/api/v1` 读上下文和登记 artifact。
- `weekly-suggestion.v1` 仍是 preview；人工确认边界不变。
- 企微是运营通知/处理入口，不是写库权限。
- `hermes-db-mcp` 暂不作为验收依赖；本切片先证明 runtime contract 可以跑。

## Verification

- `bash -n scripts/weekly-hermes-runtime.sh`
- 使用 stub `HERMES_ONESHOT_CMD` 做本地/远端 dry-run parse smoke。
- NAS live smoke：
  - runtime 能获取 issue 92。
  - runtime 能通过 Hermes/stub 生成 empty 或 preview artifact。
  - register mode 返回 queued run 并在 `/api/v1/jobs/{runId}` 可追踪。
  - notify mode 能发送到 `wecom:MengPeng`。

## Risks

- Hermes provider 可能失败或输出非 JSON；脚本需要抽取 JSON 并在失败时保留错误摘要。
- 生成 preview 会依赖当前候选内容质量；无候选时允许登记 `empty`。
- Host-side 脚本不会随 GitHub Actions 自动复制到 NAS，需要手动 `scp` 或后续补部署同步。

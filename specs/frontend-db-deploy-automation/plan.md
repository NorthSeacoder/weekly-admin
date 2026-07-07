# Implementation Plan: Frontend DB Deploy Automation

**Workspace**: `frontend-db-deploy-automation`
**Date**: 2026-07-07

## Approach

- 在 `~/personal/weekly/weekly/.github/workflows/deploy.yml` 增加 `workflow_dispatch`。
- dispatch 事件下将 `content_changed=true`，绕开旧的 `sections/` diff gate。
- 给 Deploy step 增加相同条件，避免普通非内容 push 缺少 `dist/` 仍部署。
- 在 Admin repo 增加 `scripts/weekly-frontend-deploy.sh`：
  - `dry-run`: 输出 repo/workflow/ref/reason/token 配置状态。
  - `dispatch`: POST GitHub workflow dispatch。
  - `latest`: 查询最新 workflow run。
- NAS 侧通过 `.env` 提供 `WEEKLY_FRONTEND_GITHUB_TOKEN`。

## Verification

- Frontend workflow diff only touches `.github/workflows/deploy.yml`。
- Admin script `bash -n`。
- Local curl/dispatch smoke using an available GitHub token。
- GitHub Actions run succeeds and deploys public weekly.

## Risks

- NAS 当前 `.env` 未配置 `WEEKLY_FRONTEND_GITHUB_TOKEN`；部署到 NAS 前需要放入具备 `actions:write`/workflow dispatch 权限的 token。
- Frontend repo 当前有其它 agent 的样式改动，提交时必须只 stage workflow 文件。

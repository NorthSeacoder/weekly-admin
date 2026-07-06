# Automation Contracts

本文档说明外部 agent、cron、n8n、Hermes 调用 Admin `/api/v1` API 时必须遵守的认证、scope、幂等和响应契约。

## Token

Automation token 与 human admin JWT 分离。创建 token：

```bash
pnpm tsx scripts/create-automation-token.ts \
  --name n8n-prod \
  --caller-type n8n \
  --scopes sync:run,score:run,weekly:read,weekly:suggest,ops:read
```

脚本只保存 token hash，明文 `wa_...` token 只输出一次。调用时使用：

```http
Authorization: Bearer wa_...
```

响应和日志只允许展示 `tokenPrefix`，不得写入完整 token、token hash、外部 API key、数据库 URL、Redis password 或 provider key。

## Scopes

| Scope | 用途 |
|-------|------|
| `sync:run` | 执行数据源同步 |
| `score:run` | 执行 inbox 批量评分 |
| `weekly:read` | 读取周刊候选和周刊相关只读数据 |
| `weekly:suggest` | 生成周刊组织建议预览 |
| `weekly:publish` | 发布或投递周刊，权限高于草稿/预览类动作 |
| `ops:read` | 读取运维审计摘要和 feedback digest |

为 cron、n8n、Hermes 分别创建 token，按最小权限分配 scope。Hermes planner / preference learning token 默认只需要 `weekly:read,weekly:suggest,ops:read`；不得默认授予 `weekly:publish`。

## Idempotency

写入类 endpoint 必须携带：

```http
Idempotency-Key: <caller-stable-key>
```

规则：

- 同 token、workflow、step、同 key、同 payload：返回已记录的 run summary，`meta.idempotentReplay = true`。
- 同 token、workflow、step、同 key、不同 payload：返回 `409 IDEMPOTENCY_PAYLOAD_CONFLICT`。
- 旧 run 仍是 `running`：返回 `409 IDEMPOTENCY_RUN_IN_PROGRESS`。
- 只读 endpoint 不要求调用方提供 key，系统会按 URL 生成 read-only key。

推荐 key 例子：

- `sync-karakeep-2026-06-04`
- `score-inbox-2026-06-04`
- `weekly-suggest-issue-123-v1`

## Response Envelope

成功响应：

```json
{
  "success": true,
  "data": {
    "status": "succeeded"
  },
  "meta": {
    "timestamp": "2026-06-04T00:00:00.000Z",
    "runId": "auto_...",
    "status": "succeeded",
    "idempotentReplay": false,
    "caller": {
      "type": "n8n",
      "tokenPrefix": "wa_xxxxxxxxxxxxx"
    }
  }
}
```

错误响应：

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "参数验证失败",
    "details": []
  },
  "meta": {
    "timestamp": "2026-06-04T00:00:00.000Z"
  }
}
```

常见 `meta.status`：

| Status | 含义 |
|--------|------|
| `succeeded` | 步骤成功完成 |
| `partial_success` | 部分成功，调用方需要检查失败项 |
| `empty` | 没有可处理数据，不是系统故障 |
| `skipped` | 因业务条件跳过 |
| `failed` | 步骤失败 |

## Error Codes

| Code | HTTP | 含义 |
|------|------|------|
| `AUTOMATION_TOKEN_MISSING` | 401 | 缺少 Bearer automation token |
| `AUTOMATION_TOKEN_INVALID` | 401 | token 不存在或 hash 不匹配 |
| `AUTOMATION_TOKEN_INACTIVE` | 401 | token 被禁用或撤销 |
| `AUTOMATION_TOKEN_EXPIRED` | 401 | token 已过期 |
| `AUTOMATION_SCOPE_FORBIDDEN` | 403 | token 缺少所需 scope |
| `VALIDATION_ERROR` | 400 | 请求参数不符合 schema |
| `IDEMPOTENCY_PAYLOAD_CONFLICT` | 409 | 幂等 key 被不同 payload 复用，或写入端点缺少 key |
| `IDEMPOTENCY_RUN_IN_PROGRESS` | 409 | 同 key run 仍在执行中 |
| `INTERNAL_ERROR` | 500 | 未分类内部错误 |

## Endpoints

| Endpoint | Auth | Scope | Idempotency | 说明 |
|----------|------|-------|-------------|------|
| `GET /api/v1/openapi.json` | public | - | - | 机器可读契约 |
| `POST /api/v1/jobs/sync` | automation | `sync:run` | required | 同步数据源 |
| `POST /api/v1/jobs/score` | automation | `score:run` | required | 批量评分 |
| `GET /api/v1/weekly/current` | automation | `weekly:read` | generated | 查询覆盖目标周的 current issue，供 Hermes 获取 `weeklyIssueId` |
| `GET /api/v1/weekly/candidates` | automation | `weekly:read` | generated | 查询周刊候选 |
| `POST /api/v1/weekly/suggestions` | automation | `weekly:suggest` | required | 入队生成 Admin preview 或登记 Hermes preview artifact，不写 `weekly_content_items` |
| `POST /api/v1/weekly/suggestions/{id}/apply` | automation | `weekly:suggest` | required | `{id}` 是 weekly issue id；入队将 preview items 写入 `weekly_content_items`，保留 section/featured |
| `POST /api/v1/weekly/publish` | automation | `weekly:publish` | required | 发布周刊到 Quail；已发布内容必须显式 `forceRepublish` |
| `GET /api/v1/ai/feedback/digest` | automation | `ops:read` | generated | 从 `operation_logs` 汇总 inbox feedback |
| `POST /api/v1/ai/score` | human JWT | - | - | 管理端手动单条重评分；automation 使用 `/api/v1/jobs/score` |

Hermes 不应直读 MySQL 来寻找当前期号。先调用：

```text
GET /api/v1/weekly/current?weekOffset=0
```

返回的 `data.issue.id` 是后续 `/weekly/suggestions` 和 `/weekly/suggestions/{id}/apply` 的 `weeklyIssueId`。

`POST /api/v1/weekly/suggestions` 有两种模式。

Admin fallback 生成预览：

```json
{
  "weeklyIssueId": 78,
  "maxItems": 12
}
```

Hermes 登记已生成的 preview artifact：

```json
{
  "mode": "register",
  "artifact": {
    "artifactVersion": "weekly-suggestion.v1",
    "provider": "hermes",
    "weeklyIssueId": 78,
    "agentRunId": "hermes_...",
    "status": "preview",
    "confidence": 0.82,
    "evidenceRefs": [
      { "label": "feedback digest", "runId": "auto_..." }
    ],
    "preferenceRefs": ["pref_..."],
    "items": [
      {
        "content_id": 1001,
        "section": "AI",
        "featured": true,
        "reason": "匹配近期偏好",
        "confidence": 0.9
      }
    ]
  }
}
```

Hermes artifact 可以返回 `preview`、`empty`、`stale` 或 `rejected`。`preview` 会校验 content id 是否仍符合 Admin apply 规则；`empty` 不写业务表，只记录可复盘的空结果。Artifact 不得包含 token、token hash、DB URL、Redis password、provider key 或完整私密正文。

该接口返回 queued job envelope；通过 `data.statusUrl` 或 `GET /api/v1/jobs/{runId}` 查看 worker 生成的 preview artifact。浏览器工作台的 cookie-auth wrapper 仍可同步生成/展示预览，供人工编辑使用。

Suggestion apply body 使用 `/api/v1/weekly/suggestions` 返回的 preview items。写回必须由 Admin UI/workbench 人工确认后触发：

```json
{
  "replaceExisting": false,
  "sourceRunId": "auto_...",
  "agentRunId": "hermes_...",
  "items": [
    {
      "content_id": 1001,
      "section": "AI",
      "featured": true,
      "reason": "代表性强"
    }
  ]
}
```

Automation apply 同样返回 queued job envelope。浏览器工作台 wrapper 仍保留人工同步 apply 路径；外部 Hermes/cron/企微触发应走 queued `/api/v1` 路径。

Publish body：

```json
{
  "weeklyIssueId": 78,
  "forceRepublish": false,
  "deliver": false
}
```

已发布周刊在未设置 `forceRepublish: true` 时返回 `409 WEEKLY_ALREADY_PUBLISHED`。Quail 失败返回 `PUBLISH_FAILED`，不会把响应伪装为成功。

## OpenAPI

机器可读契约：

```bash
curl -sS https://your-domain.com/api/v1/openapi.json
```

OpenAPI 文档覆盖 security scheme、scope、`Idempotency-Key`、response envelope、主要 endpoint 和 `/api/v1/ai/score` 的 human/manual 兼容说明。

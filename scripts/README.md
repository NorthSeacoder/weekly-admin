# Scripts 脚本说明

本目录包含项目的各类脚本，用于数据库管理、部署、测试和数据迁移等任务。

## 运行方式

```bash
# TypeScript 脚本
pnpm tsx scripts/<script-name>.ts

# Shell 脚本
./scripts/<script-name>.sh

# JavaScript 脚本
node scripts/<script-name>.js
```

---

## 数据库相关

> F1.5 migration-tooling-baseline 之后，新的 schema 变更必须走 Prisma Migrate：
> `pnpm prisma migrate dev --name <change>` 创建迁移，`pnpm db:migrate` 部署迁移。
> 本节中的 legacy 脚本只保留用于历史排障，不再作为新增 schema change 入口。

### `check-db.ts`
检查数据库结构和连接状态。

```bash
pnpm tsx scripts/check-db.ts
```

**功能**：
- 验证所有必需表是否存在
- 统计各表记录数
- 检查关键字段是否正确配置

---

### `create-automation-token.ts`
创建 automation/service token。脚本只把 token hash 写入数据库，明文 token 只在创建时输出一次。

```bash
pnpm tsx scripts/create-automation-token.ts \
  --name n8n-prod \
  --caller-type n8n \
  --scopes sync:run,score:run,content:resync,weekly:read,weekly:suggest
```

**功能**：
- 生成 `wa_` 前缀 token
- 写入 `automation_tokens.token_hash`
- 输出 `token_prefix` 和一次性明文 token

---

### `migrate-db.ts` (legacy)
历史自定义数据库迁移脚本，已废弃。不要继续在这里新增 schema 变更。

```bash
pnpm tsx scripts/migrate-db.ts
```

**功能**：
- 创建 `users`、`operation_logs`、`content_versions` 表
- 为 `contents` 表添加 `user_id` 字段
- 为 `weekly_issues` 表添加 Quail 相关字段
- 创建默认用户（admin/editor）

**替代方式**：
- schema 变更：`pnpm prisma migrate dev --name <change>`
- 部署迁移：`pnpm db:migrate`
- 默认数据：`pnpm prisma db seed`

---

### `apply-schema-changes.ts`
为 `contents` 表添加 `image_url` 和 `summary` 字段。

```bash
pnpm tsx scripts/apply-schema-changes.ts
```

---

### `run-sql-migration.sh` (legacy)
执行历史 SQL 文件。F1.5 后不得新增 `database/*.sql` 作为 schema 变更入口。

```bash
./scripts/run-sql-migration.sh database/add_content_preview_fields.sql
```

**参数**：SQL 文件路径（默认 `database/add_content_preview_fields.sql`）

**替代方式**：使用 `prisma/migrations/<timestamp>_<name>/migration.sql`。

---

### `migrate-content-to-structured.ts`
将 `contents` 表的 Markdown 内容解析为结构化字段。

```bash
# 预览模式（不修改数据）
pnpm tsx scripts/migrate-content-to-structured.ts --dry-run

# 执行模式
pnpm tsx scripts/migrate-content-to-structured.ts
```

**功能**：
- 从 `content` 字段提取 `image_url`（`![img](url)` 格式）
- 从 `content` 字段提取 `summary`（去除标题和图片后的文本）
- 跳过 Blog 类型内容（`content_type_id = 4`）

---

## 搜索相关

### `init-search.ts`
初始化 Meilisearch 搜索索引。

```bash
pnpm tsx scripts/init-search.ts
```

**功能**：
- 配置搜索索引
- 同步数据库内容到搜索引擎

---

### `test-search.ts`
测试搜索功能。

```bash
pnpm tsx scripts/test-search.ts
```

---

## Karakeep 相关

### `karakeep-cleanup-draft-list.ts`
清理 Karakeep Draft 列表中已归档的书签。

```bash
# 预览模式
pnpm tsx scripts/karakeep-cleanup-draft-list.ts --dry-run

# 执行模式
pnpm tsx scripts/karakeep-cleanup-draft-list.ts
```

**功能**：将 `archived = true` 的书签从 Draft 列表移除

---

### `karakeep-refill-draft-list.ts`
将 Karakeep 中未归档的书签补回 Draft 列表。

```bash
# 预览模式
pnpm tsx scripts/karakeep-refill-draft-list.ts --dry-run

# 执行模式
pnpm tsx scripts/karakeep-refill-draft-list.ts
```

**功能**：获取所有 `archived = false` 的书签，添加到 `KARAKEEP_DRAFT_LIST_ID` 列表

---

## 部署相关

### `build-and-push.sh`
构建并推送 Docker 镜像。

```bash
# 本地构建（不推送）
./scripts/build-and-push.sh v1.0.0

# 推送到私有 Registry
DOCKER_REGISTRY="registry.nas.local:5000" ./scripts/build-and-push.sh v1.0.0

# 推送到 Docker Hub
DOCKER_REGISTRY="your-username" ./scripts/build-and-push.sh v1.0.0
```

**参数**：版本号（默认使用时间戳）

---

### `deploy-update.sh`
在 NAS 服务器上更新应用程序。

```bash
./scripts/deploy-update.sh
```

**功能**：
- 拉取最新镜像
- 重启应用程序
- 清理旧镜像

---

### `validate-startup.js`
Docker 容器启动前的环境变量验证。

```bash
node scripts/validate-startup.js
```

**验证项**：
- 必需变量：`DATABASE_URL`、`JWT_SECRET`
- 格式验证：数据库 URL、可选 Meilisearch URL、端口号
- 安全检查：JWT_SECRET 长度
- Meilisearch 是可选关键词搜索后端；未配置或不可达时应用应进入 fallback/degraded 模式

---

### `switch-to-mysql.sh`
切换数据库到 MySQL（已废弃，仅供参考）。

---

## 测试相关

### `test-content-api.ts`
测试内容 API。

```bash
pnpm tsx scripts/test-content-api.ts
```

---

## 迁移子目录 (`迁移/`)

历史数据迁移脚本，用于将已有周刊内容与 Karakeep 同步。

### `extract-weekly-source-urls.ts`
从周刊 Markdown 内容中提取 `source_url`。

```bash
# 预览模式
pnpm tsx scripts/迁移/extract-weekly-source-urls.ts --dry-run

# 执行模式
pnpm tsx scripts/迁移/extract-weekly-source-urls.ts
```

**输出**：报表保存在 `scripts/迁移/reports/` 目录

---

### `push-weekly-to-karakeep.ts`
将已发布周刊内容推送到 Karakeep。

```bash
# 预览模式
pnpm tsx scripts/迁移/push-weekly-to-karakeep.ts --dry-run

# 执行模式
pnpm tsx scripts/迁移/push-weekly-to-karakeep.ts

# 指定 ID
pnpm tsx scripts/迁移/push-weekly-to-karakeep.ts --ids=1,2,3

# 调整并发和延迟
pnpm tsx scripts/迁移/push-weekly-to-karakeep.ts --concurrency=5 --delay=100
```

**功能**：
- 创建 Karakeep 书签
- 添加到迁移列表
- 保存 `karakeep_id` 到 `content_attributes`

---

### `sync-weekly-from-karakeep.ts`
已退役。该脚本过去会从 Karakeep 下载图片、上传图床并回写 `contents.image_url`，与 `image-feature-retirement` 的退役边界冲突。

```bash
pnpm tsx scripts/迁移/sync-weekly-from-karakeep.ts
```

**行为**：
- 运行即返回退役提示并以非零状态退出
- 如需恢复 summary-only 回写，应新建脚本，且不得写入图片字段或调用图床

---

## 环境变量

部分脚本依赖以下环境变量：

| 变量名 | 说明 |
|--------|------|
| `DATABASE_URL` | 数据库连接字符串 |
| `KARAKEEP_HOST` | Karakeep API 地址 |
| `KARAKEEP_KEY` | Karakeep API 密钥 |
| `KARAKEEP_DRAFT_LIST_ID` | Karakeep Draft 列表 ID |
| `KARAKEEP_WEEKLY_LIST_ID` | Karakeep Weekly 列表 ID |
| `KARAKEEP_MIGRATION_LIST_ID` | Karakeep 迁移列表 ID |
| `MEILISEARCH_HOST` | 可选 Meilisearch 地址 |
| `MEILISEARCH_CONTENT_INDEX` | Admin 专用搜索 index，默认 `weekly_admin_contents` |
| `MEILISEARCH_SHARED_INSTANCE` | 复用共享 Meilisearch 时设为 `true`，禁止使用通用 `contents` index |
| `JWT_SECRET` | JWT 密钥 |

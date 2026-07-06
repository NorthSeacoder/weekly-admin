# Admin 项目 - 周刊自动化方案

> 基于 BestBlogs.dev 经验和 Hermes Agent 能力的后端自动化方案

## 项目职责

Admin 项目负责:
- 后端 API 开发(内容管理、AI 评分、周刊生成)
- 数据库 schema 变更和迁移
- 与 n8n/Hermes 的集成
- Docker 部署配置
- Quail Newsletter 发布集成

## 与其他文档的关系

- `docs/automation-plan.md` / `docs/automation-plan-v2.md`：**已废弃**，建议归档到 `docs/archive/`。本文档是 admin 子集的当前唯一来源。
- 本文档覆盖范围：仅 admin 项目内的后端 API、数据库、Hermes/n8n 对接契约、Docker 部署。
- 不覆盖：Hermes 技能实现细节(在 Hermes 项目仓库)、n8n 工作流文件本体(在 n8n 实例)。
- SDD 工作区:正式开发产物写到 `specs/<feature>/`,本文档仅作总览与 feature 拆分依据。

## 核心理念

**n8n 做简单的事,Hermes 做复杂的事**

- **n8n**: 数据搬运、定时触发、API 调用(可视化、易调试)
- **Hermes**: 学习偏好、生成建议、复盘解释(自主学习、持续优化);不直接写 MySQL 或发布

## 方案架构

```
┌─────────────────────────────────────────────────────────────┐
│                    数据源层 (NAS)                              │
├─────────────────────────────────────────────────────────────┤
│  Karakeep 收集箱 (RSS/Twitter/手动收藏)                        │
│  • 已有分类/标签建议 ✓                                         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              n8n: 数据同步层 (每小时)                          │
├─────────────────────────────────────────────────────────────┤
│  1. 从 Karakeep API 拉取新内容                                │
│  2. 插入 inbox_items 表                                       │
│  3. 保存 Karakeep 的分类/标签建议                             │
│  4. 去重检测 (URL/标题)                                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│         Admin API + Hermes 学习/建议层                         │
├─────────────────────────────────────────────────────────────┤
│  Admin 契约: /api/v1/jobs/sync, /api/v1/jobs/score             │
│    • 同步/评分由 Admin 服务层执行                              │
│    • automation token + scope + idempotency                    │
│    • automation_runs 记录 run 状态                             │
│    • Karakeep 内容重跑使用 content:resync scope + worker        │
│                                                               │
│  Hermes 技能: 学习用户偏好 (每周日触发)                        │
│    • 分析本周你的手动调整                                      │
│    • 提取偏好规律存入记忆                                      │
│    • 生成建议,经 Admin UI 人工确认后写回                       │
│                                                               │
│  Admin 契约: candidates -> suggestions -> apply -> publish      │
│    • AI 建议先 preview,再由 apply 写入 weekly_content_items     │
│    • publish 单独显式触发                                      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              人工审核 (微信/Admin 后台)                        │
├─────────────────────────────────────────────────────────────┤
│  • 查看周刊草稿                                               │
│  • 微调排序/删除不合适的内容                                   │
│  • 点击发布                                                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│           n8n: 发布层 (手动触发或定时)                         │
├─────────────────────────────────────────────────────────────┤
│  • 调用 Admin API 发布周刊                                    │
│  • 调用 Quail API 发送邮件                                    │
└─────────────────────────────────────────────────────────────┘
```

## AI 评分系统 (参考 BestBlogs)

### 六维评分体系

基于 [BestBlogs.dev](https://github.com/ginobefun/BestBlogs) 的实践:

| 维度 | 说明 | 权重 |
|------|------|------|
| **选题质量** | 话题的重要性、时效性、受众相关性 | 15% |
| **内容质量** | 信息准确性、论证充分性、结构完整性 | 25% |
| **技术深度** | 技术细节的深入程度、原理解释 | 20% |
| **实用价值** | 可操作性、实际应用场景、代码示例 | 20% |
| **创新性** | 新颖的观点、独特的视角、前沿技术 | 10% |
| **表达质量** | 文字流畅度、逻辑清晰度、可读性 | 10% |

**评分流程** (参考 BestBlogs 的 Dify Workflow):

```
1. 初评 (快速过滤)
   ↓
2. 长文分段分析 (>6000字)
   ↓
3. 六维评分
   ↓
4. 生成摘要和关键观点
   ↓
5. 分类和标签生成
   ↓
6. 检查反思
   ↓
7. 优化改进
```

### Hermes 技能设计

**技能 1: 内容评分**

> 2026-06-05 Post-F2 override: 评分由 **Admin 服务层 / automation contract** 跑，Hermes 不直接评分。automation 批量评分入口是 `POST /api/v1/jobs/score`；`POST /api/v1/ai/score` 只保留为 human-admin JWT 手动单条重评入口。Hermes 后续接管的是「偏好学习」和「周刊建议」，并通过 Admin `/api/v1` 契约消费/写回。

```yaml
名称: weekly_content_scoring
触发: 每小时 (cron: "0 * * * *") — Admin 内部调度
执行方: Admin Node 进程 (复用 ai_configs / ai_prompts 配置)
依赖:
  - inbox_items.summarization_status 状态机
  - ai_settings.inbox_promotion_threshold 阈值
  - ai_prompts (scene='inbox_scoring') 模板

幂等与状态机 (K6):
  summarization_status: pending → processing → done | failed
  - 取任务: WHERE status='pending' AND ai_score IS NULL
            AND (summarization_status IS NULL OR summarization_status='pending')
  - 抢占:  UPDATE … SET summarization_status='processing'
            WHERE id=? AND summarization_status<=>'pending'  (行级 CAS)
  - 失败:  summarization_status='failed', 记录失败原因到 ai_score_details.error
            重试上限 3 次,超限维持 failed 不再自动取
  - 成功:  summarization_status='done', 写入 ai_score / ai_score_details / summary

流程:
  1. CAS 抢占一批 pending 任务
  2. 对每条内容:
     a. 读取标题、description、URL、category_suggestion、tags_suggestion
     b. 调用 LLM 六维评分 (prompt 来自 ai_prompts)
     c. 生成 summary 与 key_points (合并写入 ai_score_details.key_points,K4)
     d. 写回:
        - ai_score (Float)
        - ai_score_details (JSON: {dimensions, key_points, raw, model, version})
        - summary (AI 摘要,K3 复用现有字段)
        - summarization_status='done'
  3. 自动晋升 (K5: 阈值取 ai_settings.inbox_promotion_threshold,默认 70):
     - 插入 contents (status='ready', original_score=ai_score, ai_metadata=ai_score_details)
     - 回写 inbox_items: content_id, auto_promoted=true, status='promoted'
     - 操作以单事务保证原子性
```

**技能 2: 学习用户偏好**

> 数据源约定:**复用现有 `operation_logs` 表,不新建 `user_feedback`**。
> 写入约定:`resource_type='inbox_item' | 'content'`,`operation_details` JSON
> 包含 `{ai_score_at_action, action, reason?, content_id?}`。

```yaml
名称: weekly_preference_learning
触发: 每周日 22:00 (cron: "0 22 * * 0")
执行方: Hermes (远程读取 admin 数据,写入 Hermes 记忆系统)
读取接口: GET /api/v1/ai/feedback/digest?from=&to=

流程:
  1. 通过 admin API 拉取本周操作摘要:
     - 手动晋升的低分内容 (action='promote' AND ai_score_at_action < 阈值)
     - 手动删除的高分内容 (action='delete' AND ai_score_at_action >= 阈值)
     - 标记为 featured 的内容 (action='feature')
  2. 分析共同特征:
     - 标题关键词、来源域名、技术栈标签、内容长度
  3. 提取偏好规律 (Hermes 记忆):
     "用户偏好 Rust 相关内容,即使评分 65 也会晋升"
     "用户不喜欢纯理论文章,实践类优先"
  4. 存入 Hermes 记忆系统 (type=feedback)
  5. 可选:写回 ai_settings.inbox_promotion_threshold_override (按分类/标签的偏置)
```

**技能 3: 周刊生成**

```yaml
名称: weekly_issue_generation
触发: 每周五 18:00 (cron: "0 18 * * 5")
工作目录: /path/to/admin

流程:
  1. 创建新周刊:
     - 期数 = 上期 + 1
     - 日期范围 = 上周五到本周五
     - 状态 = 'draft'
  2. 筛选本周内容:
     - status = 'ready'
     - created_at 在本周范围内
     - 按 original_score DESC 排序
  3. 按分类分组并排序
  4. 插入 weekly_content_items
  5. 生成封面配置 (统一模板)
  6. 通过微信通知:
     "第 N 期周刊草稿已生成,包含 X 条内容,请审核"
```

## 数据库 Schema 调整

> **重要**:本节已对齐 `prisma/schema.prisma` 现状。原方案中大量"新增字段"实际**已存在**,仅术语不同。请以本节为准。

### 现状对照(已存在,直接复用,不改动)

| 表 | 字段 | 用途 | 备注 |
|---|---|---|---|
| `inbox_items` | `category_suggestion` (VARCHAR 100) | Karakeep 分类建议 | 文档原误称 `suggested_category` |
| `inbox_items` | `tags_suggestion` (JSON) | Karakeep 标签建议 | 文档原误称 `suggested_tags` |
| `inbox_items` | `ai_score` (Float) | AI 综合评分 (100 分制) | — |
| `inbox_items` | `ai_score_details` (JSON) | AI 评分详情(6 维原始 + 加权 + 外层 4 维 + key_points) | 文档原误称 `ai_dimensions` |
| `inbox_items` | `summary` (Text) | AI 生成摘要 | 文档原误称 `ai_summary`,统一复用此字段 |
| `inbox_items` | `summarization_status` (VARCHAR 20) | **(限定语义)** Karakeep 摘要抓取状态(`success`/失败) | **不再承担"评分进度",评分进度走新字段 `scoring_status`** |
| `inbox_items` | `auto_promoted` (Boolean) | 是否自动晋升 | — |
| `inbox_items` | `content_id` (BigInt) | 晋升后关联的 contents.id | — |
| `inbox_items` | 已建索引 | `@@index([ai_score])` `@@index([status])` | 无需再建 |
| `contents` | `original_score` (Float) | 原始分数(晋升时复制 ai_score) | — |
| `contents` | `ai_metadata` (JSON) | AI 元数据(评分详情) | 文档原误称 `ai_dimensions`,合并复用 |
| `contents` | 已建索引 | `idx_original_score` | 无需再建 |
| `ai_settings` (KV 表) | `key=inbox_promotion_threshold` 等 | **(K5)** F1 配置项,详见 F0 seed | 不建表,写入这张 KV 表即可 |
| `ai_prompts` | `scene='inbox_scoring'` | 评分 prompt 模板(F1 升级为 6 维 schema) | 既有表,F0 seed,F1 定稿 |
| `operation_logs` | 全字段 | **(替代 user_feedback)** 反馈数据源 | 见下方约定 |

### 真正需要新增/修改的项

```sql
-- 1. inbox_items 新增评分状态机字段(F1 状态机依赖,与 summarization_status 解耦)
ALTER TABLE inbox_items
ADD COLUMN scoring_status VARCHAR(20) NOT NULL DEFAULT 'pending'
  COMMENT '评分状态机:pending|processing|done|failed';
CREATE INDEX idx_inbox_scoring_status ON inbox_items (scoring_status, created_at);

-- 2. contents 新增自动晋升标记(F2 偏好学习直接筛样本)
ALTER TABLE contents
ADD COLUMN auto_promoted BOOLEAN NOT NULL DEFAULT FALSE
  COMMENT '是否由自动晋升流程创建';
CREATE INDEX idx_contents_auto_promoted ON contents (auto_promoted, created_at);

-- 3. weekly_issues 自动化追溯字段(weekly-auto-generation feature 才需要,但 F0 一并建好)
ALTER TABLE weekly_issues
ADD COLUMN auto_generated BOOLEAN DEFAULT FALSE COMMENT '是否自动生成',
ADD COLUMN generation_metadata JSON COMMENT '生成元数据(技能版本、源 inbox_item 列表等)';

-- 4. ai_settings 初始化 F1 全部 4 个 key
INSERT INTO ai_settings(`key`, value) VALUES
  ('inbox_promotion_threshold',             JSON_OBJECT('value', 70)),
  ('inbox_scoring_enabled',                  JSON_OBJECT('value', true)),
  ('inbox_scoring_batch_size',               JSON_OBJECT('value', 50)),
  ('inbox_scoring_processing_timeout_minutes', JSON_OBJECT('value', 10))
ON DUPLICATE KEY UPDATE value = VALUES(value);

-- 5. ai_prompts 初始化 6 维评分 prompt(具体 prompt 在 inbox-ai-scoring spec/plan 中定稿)
INSERT INTO ai_prompts(scene, name, prompt, variables)
VALUES (
  'inbox_scoring',
  '内容六维评分',
  '<TBD by F1 plan>',
  JSON_OBJECT(
    'dimensions', JSON_ARRAY('topic','content','depth','practical','innovation','expression'),
    'weights',    JSON_OBJECT('topic',15,'content',25,'depth',20,'practical',20,'innovation',10,'expression',10),
    'output_scale', 10
  )
)
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;
```

### 不再做的事(对原方案的删除)

- ❌ **不新建 `user_feedback` 表**:复用 `operation_logs`
- ❌ **不新增 `ai_dimensions` / `ai_summary` / `ai_key_points` 独立列**:复用 `ai_score_details` / `summary`
- ❌ **不复用 `summarization_status` 承担评分进度**:新增独立 `scoring_status` 字段(K6 决议)
- ❌ **不重复建 `idx_inbox_ai_score` / `idx_inbox_status` / `idx_contents_ready`**:已有等价索引
- ❌ **不修改 `contents.image_url` 可空性**:当前已是 `String?`(本就可空)

### `operation_logs` 反馈写入约定 (K1 配套)

替代 `user_feedback`,后台所有用户对 inbox_item / content 的关键操作走统一日志:

```ts
// resource_type: 'inbox_item' | 'content'
// operation_type: (复用现有枚举,如 update/delete/promote 等)
// operation_details (JSON 文本):
{
  action: 'promote' | 'demote' | 'feature' | 'unfeature' | 'delete' | 'reject',
  ai_score_at_action: number | null,   // 当时的 AI 评分快照
  content_id?: number,                 // 若已晋升
  inbox_item_id?: number,
  reason?: string,                     // 可选,人工备注
  source: 'admin-ui' | 'api' | 'cron'  // 操作来源
}
```

**偏好学习技能 (Hermes) 通过 `GET /api/v1/ai/feedback/digest?from=&to=` 拉取聚合结果,不直接读库。**

## 术语对齐(原方案 → 现状)

| 原方案术语 | 实际字段/表 | 备注 |
|---|---|---|
| `suggested_category` | `inbox_items.category_suggestion` | — |
| `suggested_tags` | `inbox_items.tags_suggestion` | — |
| `ai_dimensions` | `inbox_items.ai_score_details` / `contents.ai_metadata` | 同一份 JSON,含 6 维原始 + 加权后分桶 |
| `ai_summary` | `inbox_items.summary` | — |
| `ai_key_points` | `ai_score_details.key_points` | **K4**:不单独建字段,合入 JSON |
| `user_feedback` 表 | `operation_logs` + 约定 | **K1 配套** |
| 阈值 70 (硬编码) | `ai_settings['inbox_promotion_threshold']` | **K5**:配置化 |
| 评分进度 / 状态机 | `inbox_items.scoring_status` (新增) | **K6**:独立字段,不与 `summarization_status` 混用 |
| 自动晋升内容标记 | `contents.auto_promoted` (新增) | **K8**:F2 样本筛选直接用 |

## 关键设计决议(K1–K6)

| # | 议题 | 结论 |
|---|---|---|
| K1 | 评分由谁执行 | **Admin 服务层 / automation contract** 跑;Hermes 仅承担偏好学习和建议。automation 批量评分入口是 `POST /api/v1/jobs/score`; human 手动单条重评入口是 `POST /api/v1/ai/score`。 |
| K2 | `ai_dimensions` vs `ai_score_details` | 复用 `ai_score_details`(JSON 内含 `dimensions / key_points / model / version / raw`),保留 6 维原始打分 |
| K3 | `ai_summary` vs `summary` | 复用 `summary` 字段;视为 AI 产物 |
| K4 | `ai_key_points` 是否单独建字段 | 否,合入 `ai_score_details.key_points` |
| K5 | 自动晋升阈值 | 配置化,`ai_settings['inbox_promotion_threshold']`,默认 70。F1 共 4 个 key,详见 F0 seed |
| K6 | 并发与幂等 | **新增独立 `scoring_status` 字段** + 行级 CAS;失败重试上限 3 次;`processing` 状态 10 分钟超时回收。`summarization_status` 仅承担 Karakeep 摘要抓取语义,不与评分进度混用 |
| K7 | 评分维度策略 | **6+3 混合**:LLM 输出 6 维 (BestBlogs 风格,各 0–10) → 加权聚合(15/25/20/20/10/10)→ ×4 = AI 质量(0–40);叠加来源可信度(30) / 完整度(20) / 时效性(10) → 100 分制。对外仍 100 分,与 `original_score` / 阈值 70 兼容 |
| K8 | `contents.auto_promoted` | **新增列**(F0 落地)。F2 偏好学习直接在 `contents` 侧筛"自动晋升后人工 demote"负样本,避免每次 JOIN inbox_items |

## Admin Docker 部署 (参考 StrideOS)

### Dockerfile (多阶段构建)

```dockerfile
# 参考 /Users/yqg/personal/webs/stride-os/Dockerfile.web

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/scripts/docker-entrypoint.sh ./scripts/

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENTRYPOINT ["sh", "./scripts/docker-entrypoint.sh"]
CMD ["node", "server.js"]
```

### Docker Compose (生产环境)

```yaml
# compose.prod.yml
services:
  admin:
    image: ${DOCKER_REGISTRY:-ghcr.io/your-org}/weekly-admin:${IMAGE_TAG:-latest}
    restart: unless-stopped
    expose:
      - "3000"
    env_file:
      - .env
    environment:
      - RUN_MIGRATIONS_ON_START=true
    networks:
      - proxy
      - default
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.weekly-admin.rule=Host(`admin.weekly.dev`)"
      - "traefik.http.routers.weekly-admin.entrypoints=websecure"
      - "traefik.http.routers.weekly-admin.tls=true"
      - "traefik.http.services.weekly-admin.loadbalancer.server.port=3000"

networks:
  proxy:
    external: true
```

### Docker Entrypoint

```bash
#!/bin/sh
# scripts/docker-entrypoint.sh

set -eu

# 运行数据库迁移
if [ "${RUN_MIGRATIONS_ON_START:-false}" = "true" ]; then
  echo "Running database migrations..."
  npx prisma migrate deploy
fi

# 启动应用
exec "$@"
```

## API 路由设计

> 2026-06-05 Post-F2 override: 下方是已落地的 agent-friendly 契约。完整机器可读契约见 `GET /api/v1/openapi.json`,调用说明见 `docs/automation-contracts.md`。

```
src/app/api/v1/
├── jobs/
│   ├── sync/route.ts         # POST /api/v1/jobs/sync
│   └── score/route.ts        # POST /api/v1/jobs/score
├── weekly/
│   ├── candidates/route.ts   # GET /api/v1/weekly/candidates
│   ├── suggestions/route.ts  # POST /api/v1/weekly/suggestions (preview)
│   ├── suggestions/[id]/apply/route.ts # POST /api/v1/weekly/suggestions/:id/apply
│   └── publish/route.ts      # POST /api/v1/weekly/publish (queued Quail publish)
├── openapi.json/route.ts     # GET /api/v1/openapi.json
└── ai/
    ├── score/route.ts        # POST /api/v1/ai/score (human JWT 手动单条重评)
    └── feedback/digest/route.ts # GET /api/v1/ai/feedback/digest
```

**API 示例** (参考 StrideOS):

```typescript
// src/app/api/v1/inbox/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { listInboxItems } from '@/lib/services/inbox-service';
import { requireAuth } from '@/lib/auth-middleware';

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  const status = request.nextUrl.searchParams.get('status');
  const items = await listInboxItems({ status });
  
  return NextResponse.json(items);
}
```

## n8n 工作流设计

### Karakeep 同步工作流

```javascript
// n8n Workflow: Karakeep to Inbox
// 触发器: Cron (每小时)

// Node 1: HTTP Request - 获取 Karakeep 新内容
GET https://api.karakeep.com/bookmarks/search
Headers: Authorization: Bearer ${KARAKEEP_TOKEN}
Query: {
  query: "is:inlist list:周刊收集箱",
  limit: 50
}

// Node 2: 转换数据格式
// 提取 Karakeep 的分类/标签建议

// Node 3: MySQL - 去重检测
SELECT id FROM inbox_items WHERE url = ?

// Node 4: MySQL - 插入新内容
INSERT INTO inbox_items (
  source_id,
  title,
  url,
  summary,
  raw_content,
  suggested_category,
  suggested_tags,
  status,
  collected_at
) VALUES (...)
```

### 周刊发布工作流

```javascript
// n8n Workflow: Publish Weekly
// 触发器: Webhook (Admin 后台点击发布)

// Node 1: HTTP Request - 获取周刊详情
GET http://admin.weekly.dev/api/v1/weekly/${weeklyId}

// Node 2: HTTP Request - 调用 Quail API
POST https://api.quail.ink/v1/newsletters/${newsletterId}/posts
Body: {
  title: weekly.title,
  content: weekly.content,
  send_email: true
}

// Node 3: MySQL - 更新周刊状态
UPDATE weekly_issues SET status = 'published' WHERE id = ?
```

## 预期效果

### 人工时间节省
- **当前**: 每周约 4-6 小时
- **自动化后**: 每周约 0.5-1 小时
- **节省**: 80-90%

### 内容质量提升
- AI 六维评分更客观
- 不会遗漏高质量内容
- 自动学习用户偏好

## 成本估算

### 开发成本
- 后端 API: 2-3 天
- Hermes 技能开发: 3-4 天
- n8n 工作流: 2-3 天
- Docker 部署: 1-2 天
- 测试和优化: 3-5 天

**总计: 2-3 周**

### 运行成本
- LLM API: 约 $20-50/月
- n8n: 免费 (自托管)
- Hermes: 免费 (自托管)
- 存储和带宽: 忽略不计

## 风险和应对

### 风险 1: AI 评分不准确
- **应对**: 
  - 保留人工审核环节
  - 持续优化 Prompt
  - 通过用户反馈学习

### 风险 2: Hermes 学习偏差
- **应对**:
  - 定期检查记忆内容
  - 提供手动调整评分权重的接口
  - 保留完整的操作日志

### 风险 3: NAS 服务不稳定
- **应对**:
  - 设置健康检查和自动重启
  - 关键服务使用云端备份
  - 降级方案: 手动触发工作流

## 参考资料

- [BestBlogs.dev GitHub](https://github.com/ginobefun/BestBlogs)
- [BestBlogs Dify Workflow 实践](https://github.com/ginobefun/BestBlogs/blob/main/flows/Dify/BestBlogs.dev%20%E5%9F%BA%E4%BA%8E%20Dify%20Workflow%20%E7%9A%84%E6%96%87%E7%AB%A0%E6%99%BA%E8%83%BD%E5%88%86%E6%9E%90%E5%AE%9E%E8%B7%B5.md)
- [Hermes Agent 文档](https://hermes-agent.nousresearch.com/docs)
- [n8n 官方文档](https://docs.n8n.io/)
- [Karakeep API 文档](https://karakeep.com/docs/api)
- StrideOS 参考: `/Users/yqg/personal/webs/stride-os`
- 项目现有文档:
  - `CLAUDE.md` - 项目架构
  - `docs/quail-api.md` - Quail 集成
  - `WEEKLY_WORKFLOW.md` - 当前工作流

## Feature 拆分与开发顺序

> 本节是后续 SDD `specify` 阶段的总目录。每个 feature 独立可交付,逐个进 `specs/<feature>/`。

### 依赖关系图

```
                    [F0] schema-baseline   ← 必做基线(scoring_status + auto_promoted + seed)
                            │
       ┌────────────────────┼─────────────────────────────────────┐
       │                    │                                     │
[F1] inbox-ai-scoring   [F4] n8n-karakeep-sync (可独立)      [F5] admin-docker-deploy (可独立并行)
       │
       └──► [F1.5] migration-tooling-baseline  ← 切换到标准 Prisma migrate 工作流
                   │
                   ├──► [F2] preference-learning   (依赖 F1 已有 ai_score / operation_logs 数据)
                   │
                   ├──► [F3] weekly-auto-generation (依赖 F1 提供高质量 ready 内容)
                   │           │
                   │           └──► [F6] publish-pipeline (Quail 发布,依赖 F3 草稿)
                   │
                   └──► [F7] karakeep-summary-quality (摘要 prompt / Twitter 抓取优化,F1 上线后插入)
```

### 推荐开发顺序

| 阶段 | Feature | 必须先于 | 预估 | 价值 | 风险 |
|---|---|---|---|---|---|
| 1 | **F0** schema-baseline | F1 | 0.5 天 | 解锁所有后续 feature | 低 |
| 2 | **F1** inbox-ai-scoring | F1.5 / F2 / F3 / F7 | 4–6 天 | **核心闭环**,立刻可见 AI 评分效果 | 中(prompt 调优需迭代) |
| 2.5 | **F1.5** migration-tooling-baseline | F2 / F7 | 1 天 | 解锁标准 Prisma 工作流 + Seed 分离 + CI/CD 自动迁移 | 低 |
| 3 | **F4** n8n-karakeep-sync | — | 1–2 天 | 让 F1 有持续数据流入 | 低(若已部分存在,可能更短) |
| 4 | **F5** admin-docker-deploy | — | 1–2 天 | 解耦运维 | 低 |
| 5 | **F2** preference-learning | — | 3–4 天 | 让评分越用越准 | 中(需积累至少 2 周反馈数据) |
| 6 | **F3** weekly-auto-generation | F6 | 2–3 天 | 周刊草稿自动化 | 低 |
| 7 | **F6** publish-pipeline | — | 1–2 天 | 一键发布到 Quail | 低 |
| 8 | **F7** karakeep-summary-quality | — | 1–2 天 | 提升纯文字摘要质量 + Twitter 来源 | 低(独立 prompt 优化) |

**关键调度**:F0→F1→F4 并行 F5,F1 完成后立即插入 F1.5(切换迁移工具链),再等 F1 跑 2 周积累反馈数据上 F2;F3/F6/F7 在 F1.5 落地后随时插入(以便享受标准 Prisma 工作流)。

### 各 Feature 范围速览

#### F0. schema-baseline (基线变更)
- **目标**:让现有 schema 满足后续所有自动化 feature 的最小可用状态
- **In scope**:
  - `inbox_items` 加 `scoring_status VARCHAR(20) NOT NULL DEFAULT 'pending'` + 索引 `(scoring_status, created_at)`(F1 状态机)
  - `contents` 加 `auto_promoted BOOLEAN NOT NULL DEFAULT FALSE` + 索引 `(auto_promoted, created_at)`(F2 样本筛选)
  - `weekly_issues` 加 `auto_generated` / `generation_metadata`(为 F3 准备)
  - `ai_settings` seed 4 个 key:`inbox_promotion_threshold=70` / `inbox_scoring_enabled=true` / `inbox_scoring_batch_size=50` / `inbox_scoring_processing_timeout_minutes=10`
  - `ai_prompts` seed `scene='inbox_scoring'`(6 维 prompt 占位,F1 时定稿)
- **Out of scope**:`ai_dimensions` / `ai_summary` / `ai_key_points` 等独立列(已驳回,见 K2/K3/K4)
- **验收候选**:`pnpm db:generate` 通过 + seed 数据可读 + 现有功能回归无异常

#### F1. inbox-ai-scoring (核心)
- **目标**:Karakeep 进来的内容自动 AI 评分(6+3 混合维度)+ 阈值自动晋升 + 失败可重试
- **In scope**:
  - 评分服务(Node 侧):**6 维 LLM 输出**(选题/内容/技术深度/实用/创新/表达,各 0–10)按 BestBlogs 权重 15/25/20/20/10/10 加权聚合 ×4 → AI 质量(0–40),叠加来源可信度(30) / 完整度(20) / 时效性(10) → 100 分制
  - Cron 调度(每小时,**Node 进程内**,不依赖外部触发器)
  - Prompt 模板升级(`ai_prompts.inbox_scoring`,6 维输出 schema + prompt_version 管理)
  - 状态机(`scoring_status` 独立字段)+ 行级 CAS + 失败重试上限 3 次
  - 自动晋升原子事务(`inbox_items.auto_promoted=true` ↔ `contents.auto_promoted=true`)
  - 配置化阈值与开关(`ai_settings`)
  - `POST /api/v1/ai/score` human JWT 手动单条重评接口
  - automation 批量评分通过 `POST /api/v1/jobs/score`
  - 2026-06-08 Redis job orchestration 更新：`POST /api/v1/jobs/sync` 和 `POST /api/v1/jobs/score` 返回 queued job envelope（HTTP 202，含 `jobId`、`runId`、`statusUrl`），实际长任务由 automation worker 执行；`automation_runs` 继续作为长期运行证据。
  - 2026-06-08 Redis job orchestration 兼容策略：进程内 hourly scoring scheduler 使用 `CRON_API_TOKEN` enqueue `score.run`；旧 `/api/inbox/score-batch` 和 `/api/sources/sync-all` 保持 human legacy 同步路径，成功响应标注 `X-Automation-Execution: legacy-sync` / `X-Automation-Run-Recorded: false`，不写 `automation_runs`。
  - `GET /api/v1/ai/feedback/digest` 已在 F2 中扩展为真实 digest
- **Out of scope**:偏好学习(F2)、周刊生成(F3)、UI 评分展示美化、Karakeep 摘要质量优化(F7)
- **验收候选**:
  - 100 条样本评分通过率 ≥ 95%
  - 评分耗时 P95 ≤ 30s/条
  - 重启进程不丢任务(`processing` 状态机 10 分钟超时回收)
  - 阈值改 80 后,新晋升数据正确切换
  - `ai_score_details.dimensions` 6 维原始打分可查

### Redis Job Worker 启动说明

2026-06-08 `redis-job-orchestration` 之后，`POST /api/v1/jobs/sync` 与 `POST /api/v1/jobs/score` 只提交队列，实际执行依赖独立 worker。

必需环境变量：

```bash
REDIS_URL=redis://<host>:6379
JOB_QUEUE_PREFIX=weekly-admin
JOB_QUEUE_STATUS_TTL_SECONDS=604800
JOB_TARGET_LOCK_TTL_SECONDS=3600
JOB_WORKER_HEARTBEAT_INTERVAL_MS=30000
JOB_WORKER_HEARTBEAT_TTL_SECONDS=90
CRON_API_TOKEN=wa_xxx
```

本地启动：

```bash
pnpm dev
pnpm worker:automation
```

本地 smoke：

```bash
curl -sS http://127.0.0.1:3000/api/health
curl -sS -X POST http://127.0.0.1:3000/api/v1/jobs/score \
  -H "Authorization: Bearer ${CRON_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: score-smoke-$(date +%Y%m%d%H%M)" \
  -d '{"limit":1,"delay":0}'
```

NAS / Docker：

- `docker/Dockerfile` runner 会复制 `src` 与 `tsconfig.json`，同一镜像可用 `pnpm worker:automation` 启动 worker。
- `docker/docker-compose.nas.yml` 包含 `weekly-admin-worker` 服务，与 `weekly-admin` 共用 `.env`。
- NAS `.env` 必须配置 `REDIS_URL`；若 Redis 未配置或不可达，`/api/health` 的 `jobQueue` 会显示 degraded，但不应让核心 app health 直接 503。
- Worker smoke：`docker logs weekly-admin-worker` 应出现 `[automation-worker] Worker started`；`curl http://localhost:3000/api/health` 应包含 `services.jobQueue` 与 `jobQueue.queue/workers`。

#### F1.5. migration-tooling-baseline
- **目标**:在 F1 完成后、F2 开始前,将项目从"自定义迁移脚本 + 裸 SQL"切换到"标准 Prisma migrate 工作流 + 独立 seed",为 F2+ 解锁标准化数据库变更管理
- **In scope**:
  - `prisma migrate diff --from-empty` 生成 baseline migration(包含当前 18 张表)
  - `prisma migrate resolve --applied` 标记 baseline 为已应用(不实际执行 SQL,零停机)
  - 独立 `prisma/seed.ts`(5 类 seed:ADMIN 用户 / 默认分类 / 默认标签 / AI 设置 4 key / AI prompts inbox_scoring scene)
  - `package.json` 配置 `"prisma": { "seed": "tsx prisma/seed.ts" }`
  - Dockerfile 仅运行 `pnpm prisma generate`,不在构建期跑 migrate
  - GitHub Actions 部署前自动 `prisma migrate deploy`
  - `scripts/migrate-db.ts` 顶部加 `@deprecated` 注释,`database/*.sql` 工作流文档标记废弃
  - `docs/migration-workflow.md` 覆盖开发 / 部署 / 回滚三场景
- **Out of scope**:重写 F1(F1 最后一次用旧流程)/ 历史迁移回溯 / 数据库结构变更 / 多数据库支持 / 迁移测试自动化
- **依赖**:F1 已完成(`database/inbox_scoring_baseline.sql` 是旧流程最后一次使用)
- **验收候选**:
  - dev 环境 `rtk pnpm prisma migrate status` 显示 baseline 已应用
  - prod 环境 `prisma migrate resolve --applied <baseline>` 成功且未修改 schema(`SHOW CREATE TABLE` 与执行前一致)
  - CI/CD 部署日志可见 `prisma migrate deploy` 输出(无 pending 时静默退出)
  - `scripts/migrate-db.ts` 顶部含 `@deprecated` JSDoc 注释
  - 详细 PRD 见 `specs/migration-tooling-baseline/spec.md`

#### F2. agent-and-automation-contracts / preference-learning contract
- **目标**:基于 operation_logs 提取用户偏好,反哺评分权重
- **In scope**:
  - automation token、scope、OpenAPI、idempotency、`automation_runs`
  - `GET /api/v1/ai/feedback/digest` 聚合接口
  - sync/score/candidates/suggestions/apply/publish contract
  - Hermes 技能 `weekly_preference_learning` 后续通过 digest 消费反馈
- **Out of scope**:权重直接改 prompt(交给 F1 下一迭代)

### Karakeep resync Redis 化

- **目标**: 内容页手动触发 Karakeep 重跑时，不再使用 web 进程内 `Map` 保存任务状态；任务进入 Redis/BullMQ worker，并由 `automation_runs` 记录 durable evidence。
- **入口**: `POST /api/content/[id]/karakeep-resync` 仍是 cookie-auth UI route；服务端使用 `ADMIN_UI_AUTOMATION_TOKEN` 或 `CRON_API_TOKEN` 提交 `karakeep.resync` job。
- **权限**: 内部 token 必须包含 `content:resync` scope。
- **状态**: `GET /api/content/[id]/karakeep-resync?jobId=...` 只读取状态，不推进 Karakeep 轮询副作用。
- **边界**: 只写回 `contents.summary` 与 `content_attributes.karakeep_synced_at` / `karakeep_id`；不恢复图片字段写回。
- **状态**:Admin contract 已完成并提交 commit `1f38443`; Hermes 记忆写入属于后续 `hermes-weekly-intelligence`
- **验收候选**:已由 `specs/agent-and-automation-contracts/acceptance.md` 覆盖

#### F3. weekly-auto-generation
- **目标**:每周五 18:00 自动生成周刊草稿
- **In scope**:
  - 使用 `GET /api/v1/weekly/candidates` 查询候选
  - 使用 `POST /api/v1/weekly/suggestions` 生成 preview artifact
  - 使用 `POST /api/v1/weekly/suggestions/{id}/apply` 在人工或明确确认后写入 `weekly_content_items`
  - 通过 `automation_runs` 追溯 run/status/result
  - **期数编号策略放宽**:历史周刊期数严格按自然时间(每周一期)递增,该约束在 F3 内**显式放宽**——允许跳号、合并、补发等场景。期数生成器接受外部传入的"目标期号 / 自动续号"两种模式,默认续号但不强制按自然周匹配。详见 F3 spec 阶段定稿。
  - 通知通道(待澄清:企微/飞书 webhook,本期暂用 admin 后台站内通知)
- **Out of scope**:封面图自动生成、直接自动发布
- **验收候选**:草稿生成后人工可在 `/weekly` 看到、可编辑、可手动发布;支持手动指定期号覆盖默认续号

#### F4. n8n-karakeep-sync (NAS 侧)
- **目标**:n8n 每小时把 Karakeep 收集箱同步到 `inbox_items`
- **In scope**:
  - n8n workflow:HTTP→去重检测→INSERT
  - 去重键:`(source_id, source_item_id)` 唯一约束(schema 已存在)
  - 写入 `category_suggestion` / `tags_suggestion`
- **Out of scope**:Karakeep 截图修复、Twitter/RSS 多源策略
- **依赖**:F0 完成(无字段新增依赖,但需 schema 基线就绪)
- **验收候选**:连跑 24h 无重复插入,Karakeep 新增 100% 同步成功率

#### F5. admin-docker-deploy
- **目标**:Admin 容器化 + Traefik 反代 + Prisma 迁移自启
- **In scope**:Dockerfile / docker-entrypoint.sh / compose.prod.yml / Traefik labels
- **Out of scope**:CI/CD 流水线(后续 feature)、镜像优化到极致
- **参考**:`/Users/yqg/personal/webs/stride-os/Dockerfile.web`
- **可并行**:与 F1-F4 完全解耦,任何时候都能插入
- **验收候选**:镜像 < 400MB,启动 ≤ 10s,migrate 自动跑通

#### F6. publish-pipeline
- **目标**:周刊草稿一键发布到 Quail + 邮件触达
- **In scope**:
  - `POST /api/v1/weekly/publish` 提交 `weekly.publish` queued job
  - Worker 内执行 Quail API 调用
  - 已发布无 `forceRepublish` 时 worker job 失败
  - Quail 失败不标记本地成功,失败 run 可通过 `/api/v1/jobs/{id}/retry` 重试
- **Out of scope**:订阅者管理(已在 Quail 侧)
- **状态**:Admin automation publish contract 已完成;UI 工作台和最终发布体验仍在后续 `admin-shell-and-weekly-workbench`
- **验收候选**:点击发布 → Admin 调 `/api/v1/weekly/publish` → Quail 收到 → 订阅邮件成功送达样例邮箱

#### F7. karakeep-summary-quality (后置优化)
- **目标**:在去掉截图后,Karakeep 抓取的纯文字摘要也能保持高可读性
- **背景**:旧周刊详情依赖截图视觉化,现转纯文字后发现 Karakeep 默认摘要文字稍显单薄;同时 Karakeep 对 Twitter / 短文本来源抓取不充分,F1 暂时接受现状
- **In scope**:
  - Karakeep 端 prompt 调优(摘要长度 / 结构 / 关键观点提炼)
  - Twitter / 短文本来源补充策略(可能的方案:从 URL 二次抓取 / 调用 Twitter API / Karakeep crawler 升级)
  - 与 inbox_items.summary 的兼容(不破坏 F1 评分链路)
- **Out of scope**:F1 评分流程改造、截图重启用
- **依赖**:F1 已运行,有真实摘要质量样本可对比
- **可并行**:与 F2/F3/F5/F6 完全解耦,F1 上线后随时插入
- **验收候选**:抽样 30 条对比新旧摘要,主观可读性提升;Twitter 来源摘要不再为空白率 ≥ 80%

### 待澄清项(进 specify 前需补)

- 通知通道:F3 / F1 失败告警走什么?(企微 webhook / 飞书 / 站内消息)
- F4 是否已存在 n8n workflow?需要先盘点 NAS 现状再决定 spec 范围
- F5 部署目标:NAS 还是公网 VPS?(影响 Traefik / 域名配置)
- F7 Twitter 抓取走 Karakeep crawler 升级还是引入第二信源?(spec 阶段决定)

## 下一步行动

> 2026-06-05 更新：本节原顺序已被 `specs/admin-modernization-roadmap/plan.md` 的 Post-F2 Reassessment 覆盖。`next16-upgrade-baseline`、`database-and-search-strategy`、`migration-tooling-baseline`、`inbox-ai-scoring-continuation`、`agent-and-automation-contracts` 均已完成；后续主线顺序为 `image-feature-retirement` → `admin-shell-and-weekly-workbench` → `redis-job-orchestration` → `hermes-weekly-intelligence`。后续任何 schema 变更必须使用 Prisma Migrate，不再新增 `database/*.sql` 作为 schema 变更入口。

1. ✅ 已完成基础链路:`next16-upgrade-baseline`、`database-and-search-strategy`、`migration-tooling-baseline`、`inbox-ai-scoring-continuation`、`agent-and-automation-contracts`
2. ⏭️  下一步进入 `image-feature-retirement` specify:先清理 Admin UI/API/上传/裁剪/AI 图片生成入口,再确认 Astro 展示端读取点,最后用 Prisma Migrate drop legacy image fields。
3. ⏭️  随后进入 `admin-shell-and-weekly-workbench` specify:工作台消费 `/api/v1/weekly/candidates`、`/api/v1/weekly/suggestions`、`/api/v1/weekly/suggestions/{id}/apply`、`/api/v1/weekly/publish` 和 `automation_runs`,不再围绕 legacy auto-link/图片入口设计。
4. ⏭️  再进入 `redis-job-orchestration` specify:只接管执行控制层,定义 Redis job/lock/status/rate-limit 与 `automation_runs` 的关系,不重新定义外部调用契约。
5. ⏭️  最后进入 `hermes-weekly-intelligence` specify:Hermes 只做偏好学习、建议和复盘解释,经 Admin UI 人工确认后由 apply/publish 写回;不直接写 MySQL 或发布。

---

**文档版本**: v2.4 (Post-F2 automation contract landed)
**创建日期**: 2026-05-22
**更新日期**: 2026-06-05
**作者**: Claude + 用户
**状态**: 历史总纲，当前执行顺序以 `specs/admin-modernization-roadmap/plan.md` 的 Post-F2 Reassessment 为准

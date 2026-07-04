# 每日动态感知模块设计 Spec

日期：2026-07-04

## 1. 目标与边界

新增“每日动态感知”模块。第一版采用同步接口，不做异步任务队列，不做实时爬虫，不新增外部采集流程。系统从现有 PG/PostgreSQL + pgvector 信源库中读取指定日期或近 24 小时材料，完成清洗、去重、候选事件聚合、LLM 分类评分、Top 事件筛选、每日简报入库和前端展示。

必须保持以下现有能力不受影响：

- 普通深度编报 `report-jobs` 主流程。
- 现有 PG/pgvector 向量召回逻辑。
- 现有 `chat / QA` 功能。
- Draft Assistant 既有分析、提纲、导入深度编报逻辑。
- 用户管理与 Auth 接口。
- 现有 pgvector 表结构。

## 2. 页面入口调整

首页入口调整为三个卡片：

1. `AI智能体深度编报`
   - 说明：围绕专题任务完成信源检索、研判分析和正式编报。
   - 行为：保持现有深度编报模式。

2. `QA问答`
   - 说明：基于知识库和数据库资料进行检索问答、背景查询和资料核验。
   - 行为：复用现有 `DataCanvas` QA 模式，不新做 QA，不改 chat/SSE 逻辑。
   - 原用户可见文案 `热点事件动态感知` 在 QA 入口和 QA 空状态中统一改为 `QA问答`。

3. `每日动态感知`
   - 说明：从现有信源库中筛选每日重点事件，自动分类并形成每日简报。
   - 行为：进入新增 `DailyAwareness.vue` 页面。

`App.vue` 增加页面状态，例如 `showDailyAwareness`，并在回到首页、打开用户管理、打开 Draft Assistant、切换 QA/编报时正确关闭每日动态感知页面。

## 3. 数据库表结构

新增 SQL 文件：

`scripts/init-daily-awareness.sql`

新增扩展：

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

新增表 `daily_briefs`：

```sql
CREATE TABLE IF NOT EXISTS daily_briefs (
    brief_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id),
    brief_date DATE NOT NULL,
    title VARCHAR(512),
    summary TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'completed',
    total_candidates INTEGER DEFAULT 0,
    selected_count INTEGER DEFAULT 0,
    categories JSONB NOT NULL DEFAULT '[]',
    content_json JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

新增表 `daily_brief_events`：

```sql
CREATE TABLE IF NOT EXISTS daily_brief_events (
    item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brief_id UUID NOT NULL REFERENCES daily_briefs(brief_id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id),
    rank_no INTEGER NOT NULL,
    event_title VARCHAR(512) NOT NULL,
    category VARCHAR(128),
    region VARCHAR(128),
    basic_situation TEXT,
    background_context TEXT,
    importance_judgement TEXT,
    risk_to_us TEXT,
    source_info JSONB NOT NULL DEFAULT '[]',
    related_material_ids JSONB NOT NULL DEFAULT '[]',
    importance_score NUMERIC(5,2) DEFAULT 0,
    risk_score NUMERIC(5,2) DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

索引：

```sql
CREATE INDEX IF NOT EXISTS daily_briefs_owner_id_idx ON daily_briefs(owner_id);
CREATE INDEX IF NOT EXISTS daily_briefs_brief_date_idx ON daily_briefs(brief_date);
CREATE INDEX IF NOT EXISTS daily_briefs_created_at_idx ON daily_briefs(created_at);
CREATE INDEX IF NOT EXISTS daily_brief_events_brief_id_idx ON daily_brief_events(brief_id);
CREATE INDEX IF NOT EXISTS daily_brief_events_owner_id_idx ON daily_brief_events(owner_id);
CREATE INDEX IF NOT EXISTS daily_brief_events_rank_no_idx ON daily_brief_events(rank_no);
CREATE INDEX IF NOT EXISTS daily_brief_events_category_idx ON daily_brief_events(category);
CREATE INDEX IF NOT EXISTS daily_brief_events_importance_score_idx ON daily_brief_events(importance_score);
CREATE INDEX IF NOT EXISTS daily_brief_events_risk_score_idx ON daily_brief_events(risk_score);
```

不新增爬虫表，不修改 `vector_materials_text_embedding_v4`、`news_vector_chunks` 或其他 pgvector 现有表。

## 4. 后端新增文件与注册

新增：

- `server/daily-awareness.controller.ts`
- `server/daily-awareness.service.ts`
- `server/daily-awareness.types.ts`

修改：

- `server/app.module.ts`
  - 注册 `DailyAwarenessController`
  - 注册 `DailyAwarenessService`
- `server/vector-source.service.ts`
  - 小范围新增 `listMaterialsByDate()`

`DailyAwarenessService` 使用 `createAuthPool()` 访问业务表 `daily_briefs` / `daily_brief_events`，使用注入的 `VectorSourceService` 读取现有信源库。

## 5. 后端接口

### 5.1 POST `/api/daily-awareness/generate`

功能：同步生成指定日期每日动态简报。

请求体：

```json
{
  "date": "2026-07-04",
  "maxItems": 50,
  "categories": ["欧洲政治", "欧洲经济", "国际安全", "科技产业"],
  "region": "",
  "keyword": "",
  "lookbackHours": 24
}
```

权限：

- `admin` 可以生成。
- `operator` 可以生成自己的简报。
- `viewer` 返回 403。

流程：

1. 校验登录和角色。
2. 校验 `date`、`maxItems`、`lookbackHours`。
3. 调用 `VectorSourceService.listMaterialsByDate()` 读取候选材料。
4. 服务内执行二次去重和候选事件聚合。
5. 将候选事件按 30-50 条分批交给 LLM 分类、摘要和评分。
6. 合并批次结果，按综合分排序。
7. 选出 `maxItems` 条，默认 50。
8. 调用 LLM 生成整体每日简报摘要。
9. 写入 `daily_briefs`。
10. 写入 `daily_brief_events`。
11. 返回 brief 和 events。

失败策略：

- 单个 LLM 批次失败时记录错误并跳过该批。
- JSON 解析失败时尝试修复一次。
- 全部批次无可用事件时返回明确错误。
- 不输出 token、数据库连接信息、API key。

### 5.2 GET `/api/daily-awareness/briefs`

参数：

- `page`
- `pageSize`
- `date`

权限：

- `admin` 可看全部。
- `operator/viewer` 只看自己的。

返回简报列表，包含 brief 基础信息、分类统计、事件数量。

### 5.3 GET `/api/daily-awareness/briefs/:briefId`

功能：查看简报详情。

权限：

- owner 或 admin 可访问。

返回：

- brief
- events
- categories
- content_json

### 5.4 GET `/api/daily-awareness/briefs/:briefId/events`

参数：

- `category`
- `page`
- `pageSize`

权限：

- owner 或 admin 可访问。

返回指定简报事件列表。

### 5.5 POST `/api/daily-awareness/events/:itemId/import-draft`

功能：将每日动态事件导入 Draft Assistant。

权限：

- `admin` 可导入任意事件。
- `operator` 可导入自己的事件。
- `viewer` 返回 403。

流程：

1. 读取 `daily_brief_events`。
2. 校验 owner/admin 权限。
3. 插入 Draft Assistant `events` 记录。
4. 将 `source_info` 映射插入 `event_sources`。
5. `raw_input` 记录来源 `daily_awareness`、`briefId`、`itemId`、相关材料 ID 和原事件结构。
6. 返回 `eventId`，前端进入 Draft Assistant 并加载该事件。

不修改 Draft Assistant 既有核心流程；只新增一个事件来源入口。

## 6. `VectorSourceService.listMaterialsByDate()` 字段兼容方案

新增输入类型：

```ts
interface ListMaterialsByDateInput {
  date: string;
  lookbackHours?: number;
  limit?: number;
  keyword?: string;
  categories?: string[];
  region?: string;
}
```

新增返回类型：

```ts
interface VectorMaterialByDate {
  id: string;
  title: string;
  content: string;
  url: string;
  publisher: string;
  publishedAt: string;
  metadata: Record<string, unknown>;
}
```

实现原则：

- 复用 `VectorSourceService` 内部 `getPool()` 和 `databaseUrl()`。
- 复用 `ACTIVE_VECTOR_CONFIG.sourceTable`，也就是 `PGVECTOR_NEWS_TABLE` 或默认 profile 表。
- 不创建新连接池。
- 不修改 `search()`。
- 默认 `limit = 3000`，上限 3000。
- 每条 `content` 返回前截断到 800 字。

字段发现复用并扩展现有 `discoverNewsColumns()`：

- id：`id` / `news_id`
- title：`ch_title` / `title` / `headline` / `entitle`
- content：`content` / `body` / `text` / `content_excerpt` / `summary` / `embedding_text`
- url：`data_source_url` / `url` / `source_url`
- publisher：`website_name` / `site_name` / `source_name`
- publishedAt：`publish_time` / `published_at` / `pub_time` / `crawl_time` / `crawled_at` / `created_at` / `updated_at` / `inserted_at`
- metadata：如存在 `metadata` / `meta` / `raw_metadata` 则读取，否则由已知字段组装。
- category/tags：`tag` / `tags` / `designated_tag` / `designated_tags`

日期过滤：

- 优先使用真实发布时间字段：`publish_time` / `published_at` / `pub_time`。
- 若不存在，使用 `sourceTime` 候选字段：`crawl_time` / `crawled_at` / `created_at` / `updated_at` / `inserted_at`。
- 若仍不存在，尝试从 JSON metadata 中读 `published_at` / `date` / `created_at`。
- 完全没有日期字段时，用近 N 天或 limit 候选兜底，并在返回 metadata 中标记 `dateFallback: true`，由服务日志记录提示。

过滤：

- `keyword` 不为空时，对标题和正文使用 `ILIKE` 过滤。
- `categories` 不为空时，对 tag/designated_tag 或 metadata 文本做保守匹配。
- `region` 不为空时，对标题、正文、tag、metadata 做保守匹配。
- 过滤条件使用参数化 SQL。

基础去重：

- URL 完全重复只保留第一条。
- 规范化标题完全重复只保留内容更长或发布时间更近的一条。
- 标题为空且正文为空的材料剔除。

## 7. 去重与事件聚合策略

第一版采用轻量规则，避免引入复杂聚类服务。

材料去重：

1. URL 完全相同视为重复。
2. 标题完全相同视为重复。
3. 标题规范化后相同视为重复。
4. 标题过短且正文过短的材料剔除。

标题规范化：

- 转小写。
- 去除空白、标点、括号。
- 去除常见媒体前缀。
- 截断明显的来源尾缀。

候选事件聚合：

- 每个规范化标题形成一个候选事件。
- 同一标题来自多个来源时合并 sources。
- 每个候选事件最多保留 5 条来源。
- `relatedMaterialIds` 保留所有被合并材料 ID。
- 若标题不同但正文或关键词高度重合，第一版不做强合并，交给 LLM 在批处理中识别相近事件并规范标题。

候选事件结构：

```json
{
  "candidateId": "candidate_xxx",
  "title": "",
  "summaryText": "",
  "sources": [],
  "relatedMaterialIds": [],
  "sourceCount": 0
}
```

## 8. 分类体系

默认分类：

- 欧洲政治
- 欧洲经济
- 美国政治
- 美国经济
- 国际安全
- 俄乌局势
- 中东局势
- 亚太安全
- 国际组织
- 科技产业
- 能源资源
- 金融市场
- 社会舆情
- 其他

如果用户传入 `categories`，前端用于筛选和显示，后端提示 LLM 优先在用户给定范围内选择；但模型仍可输出 `其他`，避免错分。

## 9. LLM 分批分类和评分策略

模型来源：

- 优先复用项目现有 OpenAI-compatible 配置和 key 读取模式。
- 第一版在 `DailyAwarenessService` 内建立私有 LLM client，使用与 Draft Assistant / QA 相同风格的 `OpenAI` SDK。
- 不在日志中输出 key。

批处理：

- 候选事件按 30-50 条一批。
- 每批输入字段：`candidateId`、`title`、`summaryText`、`sources`。
- 每批输出必须是 JSON。
- 解析失败时尝试一次 JSON 修复。
- 修复失败时跳过该批，并记录 batch error。

批处理输出结构：

```json
{
  "events": [
    {
      "candidateId": "",
      "eventTitle": "",
      "category": "",
      "region": "",
      "basicSituation": "",
      "backgroundContext": "",
      "importanceJudgement": "",
      "riskToUs": "",
      "importanceScore": 0,
      "riskScore": 0,
      "sourceInfo": [
        {
          "title": "",
          "publisher": "",
          "publishedAt": "",
          "url": ""
        }
      ]
    }
  ]
}
```

评分：

- `importanceScore` 范围 0-100。
- `riskScore` 范围 0-100。
- 服务层对分数做 clamp。
- 综合分：`importanceScore * 0.65 + riskScore * 0.35`。
- 综合分排序后取 Top `maxItems`。

整体简报摘要：

- Top 事件确定后，再调用一次 LLM 生成 brief summary。
- 生成内容包括：当日总体态势、主要类别、重点风险、涉我关注点。
- 摘要保存到 `daily_briefs.summary` 和 `content_json.summary`。

## 10. 每日简报 JSON 结构

`daily_briefs.content_json`：

```json
{
  "briefDate": "2026-07-04",
  "title": "2026-07-04 每日动态简报",
  "summary": "",
  "generation": {
    "lookbackHours": 24,
    "keyword": "",
    "region": "",
    "requestedCategories": [],
    "totalMaterials": 0,
    "totalCandidates": 0,
    "selectedCount": 0,
    "batchErrors": []
  },
  "categoryStats": [
    {
      "category": "欧洲政治",
      "count": 0
    }
  ]
}
```

事件详情以 `daily_brief_events` 为准，前端按接口组合展示。

## 11. 前端 `DailyAwareness.vue` 页面结构

新增组件：

`b_k3ewYvsOEc1/src/components/DailyAwareness.vue`

顶部：

- 标题：`每日动态感知`
- 副标题：`基于现有信源库自动筛选每日重点事件，生成动态简报。`
- 返回按钮。

筛选区：

- 日期选择，默认当天。
- 最大条数，默认 50，范围 1-50。
- 分类多选。
- 地区输入，可选。
- 关键词输入，可选。
- 生成每日简报按钮。

权限表现：

- admin/operator 显示可用生成按钮。
- viewer 生成按钮禁用，提示“viewer 账号仅可查看简报，不能生成每日简报。”

主区域：

1. 简报概览卡片
   - 简报日期
   - 候选材料数量
   - 入选事件数量
   - 分类数量
   - 生成时间

2. 分类分布
   - 展示每类数量。
   - 点击分类筛选事件列表。

3. 事件列表
   - `rank_no`
   - `event_title`
   - `category`
   - `importance_score`
   - `risk_score`
   - `basic_situation`
   - `background_context`
   - `importance_judgement`
   - `risk_to_us`
   - `source_info`
   - `导入拟稿助手`按钮

4. 历史简报列表
   - 按日期倒序。
   - 支持打开历史简报。
   - admin 可看到全部，普通用户只看到自己的，这一点由后端保证。

交互状态：

- loading：生成中显示明确状态。
- error：生成失败显示错误，保留筛选条件。
- empty：无简报时显示空状态。
- imported：导入 Draft Assistant 成功后返回 `eventId`，打开 Draft Assistant 并加载该事件。

## 12. 前端 API

修改：

`b_k3ewYvsOEc1/src/lib/api.js`

新增：

- `generateDailyBrief(payload)`
- `getDailyBriefs(params)`
- `getDailyBrief(briefId)`
- `getDailyBriefEvents(briefId, params)`
- `importDailyEventToDraft(itemId)`

所有请求复用现有 `request()`，自动携带 Auth token。

## 13. 权限规则

后端是最终权限边界。

`admin`：

- 可以生成每日简报。
- 可以查看全部每日简报。
- 可以查看全部事件。
- 可以导入任意简报事件到 Draft Assistant。

`operator`：

- 可以生成自己的每日简报。
- 只能查看自己的每日简报。
- 可以导入自己的简报事件到 Draft Assistant。

`viewer`：

- 只能查看自己的每日简报。
- 不能生成每日简报。
- 不能导入 Draft Assistant。
- 后端返回 403；前端按钮置灰。

## 14. 测试方案

后端：

1. 执行 `scripts/init-daily-awareness.sql`，确认两张表和索引存在。
2. admin 调用 `POST /api/daily-awareness/generate`，确认返回 `briefId` 和 events。
3. operator 调用 generate，确认 owner_id 是 operator 自己。
4. viewer 调用 generate，确认 403。
5. admin 查询 `/briefs` 能看到全部。
6. operator/viewer 查询 `/briefs` 只能看到自己的。
7. 访问非本人 brief，非 admin 返回 403/404。
8. 导入事件到 Draft Assistant，确认 `events` 和 `event_sources` 写入。
9. viewer 导入返回 403。
10. 普通深度编报向量召回仍生成 `vector_sources.json`、`database_sources.json`、`database_query_plan.json`。

前端：

1. 首页显示三个入口：`AI智能体深度编报`、`QA问答`、`每日动态感知`。
2. 点击 `QA问答` 进入现有 QA 页面。
3. 点击 `每日动态感知` 进入 `DailyAwareness.vue`。
4. admin/operator 能生成每日简报，并看到 loading。
5. 生成完成后显示概览、分类分布、事件列表和来源。
6. 点击分类可筛选事件。
7. 点击历史简报能打开详情。
8. viewer 生成按钮置灰。
9. 点击导入拟稿助手后进入 Draft Assistant 对应事件。
10. 不影响 Draft Assistant、report-jobs、chat/QA 原有页面。

构建验证：

```bash
npx pnpm@9.15.9 build
npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 build
```

Chrome 验证：

- 本地或 Vercel 页面确认首页三个入口。
- 登录 admin 生成简报并打开详情。
- 登录 viewer 确认生成/导入按钮禁用。

## 15. 实施顺序

1. SQL 文件与后端类型定义。
2. `VectorSourceService.listMaterialsByDate()`。
3. `DailyAwarenessService` 生成、查询、导入逻辑。
4. `DailyAwarenessController` 和 `AppModule` 注册。
5. 前端 API 方法。
6. 首页入口调整和 QA 文案统一。
7. `DailyAwareness.vue` 页面。
8. 构建、接口测试、Chrome 验证。

## 16. Spec 自检

- 无实时爬虫。
- 无异步任务队列。
- 不改 pgvector 表结构。
- 不改 report-jobs 主流程。
- 不改 chat/QA 执行逻辑。
- 不改 Draft Assistant 核心逻辑，只新增导入入口。
- viewer 权限只读且后端兜底。
- 同步生成路径有 loading、错误和空状态。

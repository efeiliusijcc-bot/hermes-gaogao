# 每日动态感知 V2.0 实施设计

日期：2026-07-16  
状态：已确认，待实施  
依据：`每日动态感知模块_详细技术设计报告_V2.0.md`、`daily_awareness_permission_design_report.docx`

## 1. 目标

将现有“用户同步生成、按用户隔离”的每日动态感知模块改造成全局简报服务：数据写入程序提交 `DAILY_DATA_FINISHED` 内部事件后，Hermes 先持久化 Inbox 并异步处理；所有拥有查看权限的用户读取同一份全局简报；管理员负责配置、状态、运行日志、死信重放和手动补生成。

本次不引入 Kafka、Outbox、BullMQ 或其他消息基础设施。数据写入程序不在本仓库实现，只交付内部 HTTP 接口契约和调用示例。

## 2. 已确认的实现路径

采用渐进式改造：扩展现有 `daily_briefs`、`daily_brief_events`、RBAC、NestJS 和 Vue 页面，并新增职责明确的小型服务。保留旧简报数据与旧接口适配层，避免一次性重写和数据丢失。

自动链路：

```text
数据写入程序
  -> POST /internal/events/daily-data-finished
  -> 独立内部密钥校验
  -> 校验事件并 INSERT Inbox
  -> HTTP 202
  -> 后台 Worker 领取 Inbox
  -> 获取统一 businessDate PostgreSQL advisory lock
  -> 查询材料并计算质量
  -> NO_DATA 或模型生成
  -> 重试、校验和状态流转
  -> 事务内 upsert 全局简报、替换事件明细、更新运行与每日状态
  -> 更新 Inbox 为已处理
```

## 3. 固定枚举

后端 TypeScript 常量、DTO 校验、数据库 `CHECK` 约束和前端显示映射必须共享以下固定字符串，不接受自由文本状态。

### 3.1 Inbox 状态

- `RECEIVED`
- `PROCESSING`
- `RETRY_PENDING`
- `PROCESSED`
- `DEAD_LETTER`

### 3.2 数据状态

- `WAITING`
- `READY`
- `NO_DATA`

### 3.3 生成状态

- `WAITING`
- `PENDING`
- `GENERATING`
- `SUCCESS`
- `GENERATION_FAILED`
- `NOT_REQUIRED`

`NOT_REQUIRED` 仅用于 `data_status = NO_DATA`，明确表示没有材料时未调用模型。

### 3.4 质量状态

- `NORMAL`
- `PARTIAL_SUMMARY`
- `TITLE_ONLY`

### 3.5 运行触发类型

- `EVENT`
- `AUTO_RETRY`
- `MANUAL`
- `INBOX_REPROCESS`

### 3.6 运行状态

- `QUEUED`
- `RUNNING`
- `SUCCESS`
- `NO_DATA`
- `FAILED`
- `IGNORED_DUPLICATE`

### 3.7 生成来源

- `SYSTEM`
- `MANUAL`

### 3.8 用户消息码

- `TODAY_READY`
- `TODAY_NO_DATA`
- `TODAY_GENERATING`
- `TODAY_GENERATION_FAILED`
- `TODAY_WAITING`
- `NO_SUCCESSFUL_BRIEF`

### 3.9 业务错误码

- `DAILY_AWARENESS_FORBIDDEN`
- `DAILY_AWARENESS_NO_BRIEF`
- `DAILY_AWARENESS_ALREADY_RUNNING`
- `DAILY_AWARENESS_NO_DATA`
- `DAILY_AWARENESS_MODEL_UNAVAILABLE`
- `DAILY_AWARENESS_INVALID_CONFIG`
- `DAILY_AWARENESS_INVALID_EVENT`
- `DAILY_AWARENESS_INTERNAL_KEY_MISSING`
- `DAILY_AWARENESS_INTERNAL_KEY_INVALID`
- `DAILY_AWARENESS_INBOX_DEAD_LETTER`
- `DAILY_AWARENESS_SUCCESS_ALREADY_EXISTS`

## 4. 内部事件入口

### 4.1 接口

`POST /internal/events/daily-data-finished`

该接口不使用普通用户 JWT、角色或业务权限。请求必须包含请求头：

```http
X-Hermes-Internal-Key: <secret>
```

密钥来自 `DAILY_AWARENESS_INTERNAL_EVENT_KEY`。服务端使用定时安全比较；未配置密钥时拒绝接口，不提供默认值，不将密钥或请求头写入日志。

### 4.2 请求结构

```json
{
  "eventId": "01J...",
  "eventType": "DAILY_DATA_FINISHED",
  "businessDate": "2026-07-16",
  "batchId": "20260716-001",
  "completedAt": "2026-07-17T06:10:00+08:00",
  "totalCount": 2864
}
```

规则：

- `eventId`、`batchId` 为非空字符串并限制长度。
- `eventType` 必须严格等于 `DAILY_DATA_FINISHED`。
- `businessDate` 必须为有效 `YYYY-MM-DD`。
- `completedAt` 必须为有效 ISO 时间。
- `totalCount` 可选，必须为非负整数；它只用于诊断，实际数据数量以数据库查询为准。
- 未识别字段不进入模型输入。

### 4.3 响应与幂等

首次提交：

```json
{
  "accepted": true,
  "duplicate": false,
  "eventId": "01J..."
}
```

重复 `eventId`：

```json
{
  "accepted": true,
  "duplicate": true,
  "eventId": "01J..."
}
```

两种情况均返回 HTTP 202。控制器只完成鉴权、校验、Inbox 插入和 Worker 唤醒，不查询材料、不调用模型、不等待生成。

### 4.4 调用示例

```bash
curl -X POST "https://hermes.example/internal/events/daily-data-finished" \
  -H "Content-Type: application/json" \
  -H "X-Hermes-Internal-Key: ${DAILY_AWARENESS_INTERNAL_EVENT_KEY}" \
  -d '{
    "eventId":"01JDAILY20260716001",
    "eventType":"DAILY_DATA_FINISHED",
    "businessDate":"2026-07-16",
    "batchId":"20260716-001",
    "completedAt":"2026-07-17T06:10:00+08:00",
    "totalCount":2864
  }'
```

## 5. 数据模型

所有迁移均为增量迁移，不删除现有简报或事件。

### 5.1 扩展 `daily_briefs`

保留 `brief_id`、`brief_date`、标题、摘要、`content_json` 和现有事件关系。新增：

- `publication_scope varchar`：`GLOBAL` 或 `LEGACY`。
- `quality_status varchar`：质量状态。
- `content_markdown text`：用户正文；与 `content_json` 同时保存。
- `generated_at timestamptz`。
- `generated_by_type varchar`：`SYSTEM` 或 `MANUAL`。
- `generation_run_id uuid nullable`。
- `source_count int`。
- `summary_count int`。
- `title_only_count int`。
- `skipped_count int`。

第二层幂等使用部分唯一索引：

```sql
CREATE UNIQUE INDEX daily_briefs_global_business_date_uidx
  ON daily_briefs (brief_date)
  WHERE publication_scope = 'GLOBAL';
```

`brief_date` 是当前表对应 `businessDate` 的权威字段。API 层统一命名为 `businessDate`。

### 5.2 `daily_awareness_day_status`

每个业务日期严格一行：

- `business_date date PRIMARY KEY`
- `data_status`
- `generation_status`
- `quality_status nullable`
- `batch_id nullable`
- `data_completed_at nullable`
- `source_count`
- `summary_count`
- `title_only_count`
- `skipped_count`
- `current_brief_id nullable`
- `last_run_id nullable`
- `last_error_code nullable`
- `last_error_message nullable`
- `created_at`
- `updated_at`

主键即每日状态唯一约束，不再额外创建同义日期行。

### 5.3 `daily_awareness_runs`

- `id uuid PRIMARY KEY`
- `business_date date`
- `trigger_type`
- `trigger_ref nullable`
- `status`
- `attempt_no int`
- `quality_status nullable`
- `source_count`
- `summary_count`
- `title_only_count`
- `skipped_count`
- `model_provider nullable`
- `model_name nullable`
- `prompt_version nullable`
- `started_at nullable`
- `finished_at nullable`
- `error_code nullable`
- `error_message nullable`
- `requested_by nullable`
- `manual_reason nullable`
- `created_at`

每次自动尝试、自动重试、手动补生成和 Inbox 重放都留下独立运行记录。错误文本必须脱敏和截断。

### 5.4 `daily_awareness_config`

全局单例，固定主键：

- `id = 1`
- `lookback_hours`
- `max_articles`
- `category_scope jsonb`
- `max_retry_count`
- `retry_interval_seconds`
- `summary_max_chars`
- `version`
- `updated_by nullable`
- `updated_at`

配置不包含自动任务开关和每日生成时间。更新时要求客户端提交当前 `version`，版本冲突返回 409。

### 5.5 `daily_awareness_event_inbox`

- `event_id varchar PRIMARY KEY`
- `event_type varchar`
- `business_date date`
- `batch_id varchar`
- `completed_at timestamptz`
- `total_count int nullable`
- `payload jsonb`
- `status`
- `attempt_count int`
- `next_attempt_at timestamptz nullable`
- `locked_at timestamptz nullable`
- `locked_by varchar nullable`
- `processed_at timestamptz nullable`
- `last_error_code nullable`
- `last_error_message nullable`
- `created_at`
- `updated_at`

`event_id` 主键是第一层幂等。对 `(status, next_attempt_at, created_at)` 建立领取索引。

## 6. 历史数据迁移

迁移必须可重复执行且不删除数据：

1. 为现有 `daily_briefs` 增加新字段，现有行先标记 `LEGACY`。
2. 按 `brief_date` 分组，在 `status = 'completed'` 的记录中选择 `updated_at DESC, created_at DESC, brief_id DESC` 第一条作为该日 canonical 记录。
3. canonical 记录更新为 `GLOBAL`，映射现有 `reportMarkdown`、生成统计和创建时间到新字段。
4. 同日期其余记录保持 `LEGACY`，其正文和 `daily_brief_events` 完整保留，但不进入新用户历史列表。
5. canonical 行保留原 `owner_id` 以满足现有外键；全局查询不再以 owner 过滤，也不向普通用户返回 owner。
6. 先完成 canonical 标记，再创建 `GLOBAL` 日期部分唯一索引。
7. 为每个 canonical 日期回填 `daily_awareness_day_status`，状态为 `READY/SUCCESS`，并关联 `current_brief_id`。
8. 新旧接口兼容期内，旧 `briefId` 接口可读取 `GLOBAL` 和调用者有权访问的 `LEGACY`；新接口只读取 `GLOBAL`。

## 7. 权限与部署顺序

### 7.1 新权限

- `daily-awareness:view`
- `system:daily-awareness:manage`

`manage` 不隐式包含 `view`。管理员角色迁移时显式获得两项权限。

### 7.2 权限迁移

- 对拥有 `daily_awareness:read` 的角色补授 `daily-awareness:view`。
- 旧 `daily_awareness:create/read/import` 在兼容期保留，不立即删除。
- 普通业务模块 `daily` 只授予 `daily-awareness:view`。
- 管理权限不出现在普通业务模块选择中，由系统权限或角色权限管理。
- 旧同步生成接口在兼容期改为要求 `system:daily-awareness:manage`，前端不再调用。
- 拟稿导入同时要求 `daily-awareness:view` 与拟稿模块创建权限。

### 7.3 Guard 规则

`PermissionsGuard` 不再根据 `admin` 角色名直接放行。所有请求都依据 `user.permissions`。系统管理员通过 RBAC 种子和认证回退映射获得完整显式权限。

### 7.4 部署顺序

1. 先执行增量数据库迁移：新表、新列、检查约束、索引和权限记录；旧接口仍可工作。
2. 执行权限映射：旧 read 角色补授 view，管理员补授 view 和 manage；此时不删除旧权限。
3. 配置 `DAILY_AWARENESS_INTERNAL_EVENT_KEY`，部署支持双读和兼容接口的新后端。
4. 验证历史 canonical 迁移、`/current` 回退、内部事件 202 和 Worker 恢复。
5. 部署纯阅读用户端和管理端，入口改用新权限。
6. 联调数据写入程序，确认事务提交后调用内部事件接口。
7. 观察稳定后，分版本移除旧同步生成入口和不再使用的旧权限；不删除历史简报。

该顺序避免前端先切换导致用户失权，也避免后端先停止旧接口导致短时不可用。

## 8. Inbox Worker 与重试

Worker 在 NestJS 模块初始化后启动轻量轮询，不增加队列依赖：

1. 启动时将超过处理租约的 `PROCESSING` 事件恢复为 `RETRY_PENDING`。
2. 在短事务中使用 `FOR UPDATE SKIP LOCKED` 领取一条 `RECEIVED/RETRY_PENDING` 事件，更新为 `PROCESSING` 后提交。
3. 事务外调用状态机。
4. 状态机到达 `SUCCESS`、`NO_DATA`、`GENERATION_FAILED` 或 `IGNORED_DUPLICATE` 后，将事件标记 `PROCESSED`。
5. 数据库暂时不可用、进程错误或不可归类的基础设施错误按指数受限间隔进入 `RETRY_PENDING`。
6. Inbox 重试超过上限后进入 `DEAD_LETTER`。
7. Worker 使用环境变量配置轮询间隔和租约，但管理页面不提供启停开关。

模型失败与 Inbox 失败分开处理：模型重试耗尽后，日期状态为 `GENERATION_FAILED`，对应事件仍为 `PROCESSED`；只有事件处理基础设施未能到达业务终态时才进入 Inbox 死信。

## 9. 统一业务日期锁

自动事件、自动重试、Inbox 重放和管理员补生成必须调用同一个 `withBusinessDateLock()`：

```sql
SELECT pg_try_advisory_lock(
  hashtext('daily-awareness'),
  hashtext($1)
);
```

实现使用独占数据库连接持有会话级锁，并在 `finally` 中解锁和释放连接。模型调用期间可以持有 advisory lock，但不能持有数据库事务。

锁内流程：

1. 短事务读取配置和日期状态，创建运行记录并写入 `PENDING/GENERATING`，随后提交。
2. 在无数据库事务的情况下查询材料、组织输入和调用模型。
3. 生成成功后开启短事务：upsert 全局简报、替换该简报事件、更新每日状态和运行记录，随后提交。
4. 失败时开启短事务更新状态和运行记录。

未获得锁时：自动路径记录 `IGNORED_DUPLICATE`；管理补生成返回 409 `DAILY_AWARENESS_ALREADY_RUNNING`。

## 10. Inbox 重放与成功简报保护

Inbox 的“重新处理”只恢复事件处理，不等价于补生成：

- 若 `businessDate` 已有 `GLOBAL/SUCCESS` 简报，重放记录 `IGNORED_DUPLICATE` 并结束，绝不隐式覆盖。
- 若日期为 `NO_DATA`，收到同一事件重放仍保持 `NO_DATA`；新的补批必须使用新的 `eventId`，并按迟到数据规则记录而不自动覆盖。
- 只有管理员调用 `/api/admin/daily-awareness/regenerate`、填写原因并明确确认覆盖，才允许更新已成功日期。
- 手动补生成使用 `MANUAL` trigger、业务日期锁和事务化 upsert，旧运行日志保留。

## 11. 材料组织与质量

### 11.1 查询边界

- 优先使用显式配置或发现到的业务日期字段查询。
- 无业务日期字段时，按现有发布时间字段查询并在运行诊断中记录降级，不仅依赖 `created_at`。
- 最大条数在查询或确定性截取阶段生效。
- 保持现有事件排名公式和分类体系，不引入新的内容排名算法。

### 11.2 最低可用记录

- 标题非空即可参与。
- `summary` 与正文为空不阻塞。
- 标题为空的记录跳过并计入 `skipped_count`。
- 单条 summary 按配置截断，记录截断统计，不随机丢弃材料。

### 11.3 质量计算

- `NORMAL`：所有纳入材料都有 summary。
- `PARTIAL_SUMMARY`：至少一条有 summary，至少一条无 summary。
- `TITLE_ONLY`：所有纳入材料都无 summary。

模型输入固定为：有摘要时“标题 + summary”，无摘要时仅标题。`TITLE_ONLY` Prompt 明确禁止补充标题未包含的事实。

### 11.4 去重与聚合修正

保留现有 URL 去重和规范化标题聚合，但避免在聚合前把所有同标题来源删除：先按 URL 去重，再按规范化标题分组，每组保留最多 5 个来源和全部材料 ID。候选仍按来源数和现有稳定顺序预选，最终评分仍使用当前 `importanceScore * 0.7 + riskScore * 0.3`。

## 12. 模型调用与保存

- 抽取可复用模型客户端/网关，沿用现有 OpenAI-compatible 配置、密钥、超时和模型名称。
- Prompt 集中管理，固定版本号写入运行记录。
- 可重试错误包括超时、限流、连接中断和供应商临时错误。
- 参数错误、Prompt 构造错误和权限错误不重试。
- 空文本、低于最低有效长度、无法解析的 JSON、拒答或错误页文本视为失败。
- 任何模型调用都不得处于长数据库事务内。
- 只有通过结果校验的内容可以保存为 `SUCCESS`。

## 13. 用户 API 与回退

所有新用户接口要求 `daily-awareness:view`：

- `GET /api/daily-awareness/current`
- `GET /api/daily-awareness/history`
- `GET /api/daily-awareness/briefs/by-date/:businessDate`
- `GET /api/daily-awareness/briefs/by-date/:businessDate/export`

旧 `briefId` 查询和下载接口暂时保留。

### 13.1 `/current` 固定响应

```json
{
  "businessDate": "2026-07-16",
  "dataStatus": "NO_DATA",
  "generationStatus": "NOT_REQUIRED",
  "qualityStatus": null,
  "messageCode": "TODAY_NO_DATA",
  "displayedBrief": {
    "businessDate": "2026-07-15",
    "title": "2026-07-15 每日动态简报",
    "contentMarkdown": "...",
    "qualityStatus": "NORMAL",
    "generatedAt": "2026-07-16T06:16:00+08:00"
  }
}
```

`displayedBrief` 还包含现有前端所需的事件、分类统计和导出标识，但不包含模型错误、供应商信息或摘要缺失数量。

### 13.2 回退决策

- 当日 `SUCCESS`：显示当日全局简报，`TODAY_READY`。
- 当日 `NO_DATA`：显示最近成功简报，`TODAY_NO_DATA`。
- 当日 `GENERATING/PENDING`：显示最近成功简报，`TODAY_GENERATING`。
- 当日 `GENERATION_FAILED`：显示最近成功简报，`TODAY_GENERATION_FAILED`。
- 尚未收到事件：显示最近成功简报，`TODAY_WAITING`。
- 无任何成功简报：`displayedBrief = null`，`NO_SUCCESSFUL_BRIEF`。

历史接口只返回 `GLOBAL/SUCCESS`。指定日期接口不存在时返回 404，不自动回退。

## 14. 管理 API

所有管理接口要求 `system:daily-awareness:manage`：

- `GET /api/admin/daily-awareness/status`
- `GET /api/admin/daily-awareness/config`
- `PUT /api/admin/daily-awareness/config`
- `GET /api/admin/daily-awareness/runs`
- `GET /api/admin/daily-awareness/runs/:id`
- `GET /api/admin/daily-awareness/inbox`
- `POST /api/admin/daily-awareness/inbox/:eventId/reprocess`
- `POST /api/admin/daily-awareness/regenerate`

`regenerate` 异步返回 HTTP 202 和 `runId`。请求必须含 `businessDate`、非空 `reason` 和显式 `confirmOverwrite: true`。同日运行中返回 409。

## 15. 前端设计

### 15.1 用户页面

现有 `DailyAwareness.vue` 改为纯阅读：

- 首次只调用 `/current`。
- 同时显示“今日业务日期”和“当前展示简报日期”。
- 删除生成参数、回溯时间、最大条数、分类设置和生成按钮。
- 保留历史、复制、导出和已确认的拟稿导入能力。
- `TITLE_ONLY` 显示“简要版”。
- Banner 只根据 `messageCode` 渲染，不根据中文文本推断。
- 历史查看模式不显示今日状态 Banner。
- 后端 403 使用统一无权限状态，不显示内部错误。

### 15.2 管理页面

沿用现有系统管理入口，新增 `DailyAwarenessAdmin.vue`：

- 当前状态与数据统计。
- 全局生成配置表单和版本冲突提示。
- 手动补生成对话框、原因、覆盖确认和 409 状态。
- 运行记录筛选及详情。
- Inbox 死信列表和重新处理。
- 不提供生成时间选择器或自动任务开关。

首页卡片、工作区入口、系统管理入口和组件挂载都使用新权限。当前项目没有独立 Vue Router，因此使用既有 App 工作区状态作为等价路由守卫；无权限时不挂载页面，后端接口仍是最终安全边界。

## 16. 错误与安全

- 内部事件接口与普通用户认证完全分离。
- 错误日志移除数据库口令、API key、Authorization 和内部密钥。
- 普通用户 API 不返回模型额度、供应商错误或缺失统计。
- 管理 API 仅返回截断后的脱敏错误摘要。
- Markdown 沿用现有清洗和安全渲染方式。
- 导出按新查看权限校验，不信任前端隐藏。
- 配置更新和手动补生成写入现有审计日志。

## 17. 测试与验收

### 17.1 单元测试

- 固定枚举和 DTO 校验。
- 内部密钥缺失、错误和正确。
- 事件字段、重复 eventId 和 202 响应。
- 全有 summary、部分缺失、全部缺失、标题缺失。
- 质量状态和标题级 Prompt。
- 模型错误可重试分类、次数和间隔。
- `/current` 六种回退决策。
- 权限迁移和去除 admin 隐式放行。

### 17.2 数据库与集成测试

- `event_id` 唯一。
- `business_date` 每日状态唯一。
- 每日仅一条 `GLOBAL` 简报。
- canonical 历史迁移可重复且不删除数据。
- HTTP 202 后生成不在请求生命周期执行。
- Worker 启动恢复、租约恢复和 `SKIP LOCKED`。
- 统一业务日期锁覆盖自动、重试、重放和手动路径。
- 0 数据进入 `NO_DATA/NOT_REQUIRED` 且不写简报。
- 模型重试耗尽进入 `GENERATION_FAILED`，Inbox 为 `PROCESSED`。
- 基础设施重试耗尽进入 `DEAD_LETTER`。
- Inbox 重放不覆盖已有成功简报。
- 手动补生成显式覆盖简报并保留运行日志。
- 模型调用时没有开放数据库事务。

### 17.3 前端与回归测试

- 无 view 权限看不到入口且接口返回 403。
- 用户页不存在生成设置和生成按钮。
- `NO_DATA`、生成中、失败和无历史分别显示正确状态。
- `TITLE_ONLY` 显示“简要版”。
- 历史模式显示所选日期，不冒充今日简报。
- 管理页面配置、运行、死信和补生成交互。
- 管理页面不存在时间选择器和任务开关。
- 现有编报、QA、拟稿、用户、角色、导出测试保持通过。

## 18. 主要文件边界

遵循现有扁平 `server/` 结构，避免与仓库风格冲突：

- `server/daily-awareness.constants.ts`：固定枚举、Prompt 版本和错误码。
- `server/daily-awareness.internal.controller.ts`：内部事件入口。
- `server/internal-event-key.guard.ts`：独立内部密钥鉴权。
- `server/daily-awareness.admin.controller.ts`：管理 API。
- `server/daily-awareness-inbox.service.ts`：Inbox 插入、领取、重试和死信。
- `server/daily-awareness-worker.service.ts`：后台轮询和消费。
- `server/daily-awareness-generation.service.ts`：业务日期锁、状态机、重试和保存。
- `server/daily-awareness-query.service.ts`：当前简报回退、历史和指定日期读取。
- `server/daily-awareness-config.service.ts`：全局配置。
- `server/daily-awareness-material.service.ts`：材料查询、降级和质量统计。
- `server/daily-awareness-prompt.ts`：版本化 Prompt。
- `server/daily-awareness.controller.ts`：新用户 API 与旧接口适配。
- `server/daily-awareness.service.ts`：逐步缩减为兼容层和现有导出/事件映射能力。
- `scripts/init-daily-awareness.sql`：增量表结构和历史迁移。
- `scripts/init-rbac.sql`、`server/permission-modules.ts`：权限迁移。
- `b_k3ewYvsOEc1/src/components/DailyAwareness.vue`：纯阅读页面。
- `b_k3ewYvsOEc1/src/components/DailyAwarenessAdmin.vue`：管理页面。
- `b_k3ewYvsOEc1/src/lib/api.js`、`App.vue`、系统管理组件：接口和权限入口。

## 19. 非目标

- 不实现数据写入程序。
- 不引入消息队列、ORM 或新前端状态管理框架。
- 不增加管理员时钟时间或启停配置。
- 不按用户或部门生成个性简报。
- 不保留同日多份当前正文版本。
- 不发送站内信、邮件或短信。
- 不自动用迟到数据覆盖已成功简报。

## 20. 完成定义

实现完成需同时满足：数据库增量迁移不丢历史数据；内部事件接口快速返回 202；Inbox 可恢复、重试和死信；同日并发不会产生两份全局简报；无数据、摘要降级和模型失败均有稳定状态；用户端纯阅读并正确回退；管理端可配置、查看日志、重放死信和显式补生成；专项测试、构建、lint 和相关回归测试通过。

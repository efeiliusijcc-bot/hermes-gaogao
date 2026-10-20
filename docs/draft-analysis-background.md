# 拟稿事件分析后台执行

仅“开始拟稿 → 事件分析”采用持久化后台执行。生成提纲、AI 修改和创建深度编报仍沿用原流程。

## 数据与执行

- `draft_analysis_jobs` 是独立 PostgreSQL 队列，不复用正式编报任务表。
- 每个账号最多一个 `queued/running` 任务，数据库部分唯一索引兜底。
- 全局两个执行槽位，由数据库事务锁及唯一索引分配，多 API 实例也不增加并发上限。
- 任务受理时持久化原材料、事件 ID、请求键及 120 秒截止时间；排队也计时。
- 独立 `DraftAnalysisWorkerService` 每秒处理队列，每 10 秒续租，45 秒无心跳明确失败。
- 检索和模型请求使用本任务的剩余预算及 AbortSignal，不改变其他业务的超时。
- 结果、资料和成功状态在同一事务落库；保存前后核验租约、截止时间。失败记录保留，不自动重跑。
- 重试创建新执行尝试，但复用原事件和历史记录；旧执行结果不能覆盖新尝试。

## API

所有接口沿用登录鉴权及 `draft_assistant:read/create` 权限，所有者仅来自登录身份。

| 接口 | 说明 |
| --- | --- |
| POST `/api/draft-assistant/analysis-jobs` | 原分析输入加 UUID `clientRequestId`，受理返回 202 |
| GET `/api/draft-assistant/analysis-jobs` | 当前账号最近 20 次尝试，可用 `clientRequestId` 查询 |
| GET `/api/draft-assistant/analysis-jobs/:jobId` | 当前账号单次执行摘要 |
| POST `/api/draft-assistant/analysis-jobs/:jobId/retry` | `{clientRequestId}`，只能重试最近一次失败尝试 |

同一账号同一请求键和相同输入返回原任务；同键不同输入返回 409。已有活动任务时返回 409 和其任务摘要。
旧 `/analyze` 接口复用同一队列与限制，成功仍返回 `{eventId, analysis, sources}`。
事件列表及详情增量返回 `analysisJob`；历史无任务记录时保持原展示。

## 页面与恢复

任务、当前选中历史和未提交材料彼此独立。当前任务每 2 秒查询，其他模块每 5 秒查询；后台标签暂停，重新可见立即查询。
已完成任务停止轮询；网络错误只表示连接中断，不改变服务端执行状态。
按账号在 sessionStorage 暂存当前标签页材料和未确认提交；在 localStorage 保存选中记录及已读标记，不存分析正文。
退出登录清除本标签页材料；切换账号立即隔离旧请求和页面。跨标签页登录身份变化使用现有登录恢复流程同步。
受理响应丢失时先查询原请求键，不擅自换键重跑。完成不抢焦点，失败可返回原任务手动重试。

## 验证

运行 `npm run build`、前端 `npm test` 和 `npm run build`。
受控 PostgreSQL 集成测试仅使用显式提供的隔离数据库：

```sh
DRAFT_ANALYSIS_TEST_PG_URL=postgresql://... npx tsx --test tests/draft-analysis-jobs.test.ts
```

测试创建随机独立 schema 并在结束时删除该测试 schema；未配置测试 URL 时跳过数据库集成部分。
`tests/fixtures/draft-analysis-browser.mjs` 为本地回环地址测试服务，替换外部 API 返回，不调用模型。不得部署到生产。

## 发布与回滚

先确认现有分析及正式编报没有正在执行，再发布增量表结构与兼容 API，最后切换前端。
只替换本次涉及的编译文件，以现有 API 镜像为基底，不重启数据库、Agent 或其他服务。
回滚保留新任务表及历史数据。优先回滚前端并保留兼容后端；若必须回滚 API，需先停受理并等待任务结束，或将未完成任务明确标记为执行中断，不能丢弃已受理任务。
真实模型端到端烟测需单独授权，受控测试不代表模型质量验收。

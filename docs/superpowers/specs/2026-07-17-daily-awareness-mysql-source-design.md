# 每日动态感知 MySQL 数据源与主题选取设计

## 目标

每日动态感知改为直接读取 MySQL `news` 数据库的业务日期分表。数据表已经完成摘要和分类，动态感知不再使用 PGVector 作为在线事实源，也不再让模型重写每条新闻摘要。

本次改造保留现有 Inbox、业务日期状态机、统一业务日期锁、失败重试、死信和简报幂等规则。

## 数据源契约

生产数据源为 MySQL `3306/news`，按业务日期读取严格派生的表名：

```text
businessDate=2026-07-16 -> data_20260716
```

表名只允许匹配 `data_YYYYMMDD`，由服务端根据已校验的业务日期生成，禁止从请求中直接拼接任意标识符。

使用字段：

| 字段 | 用途 |
| --- | --- |
| `id` | 来源记录标识 |
| `ch_title` | 模型热点判断和展示标题 |
| `summary` | 简报中的简要内容，直接使用 |
| `designated_tag` | 主分类：涉政、危安、涉华、其他 |
| `tag` | 细分主题标签 |
| `publish_time` | 来源时间和新鲜度排序辅助信息 |
| `website_name` | 来源名称 |
| `data_source_url` | 来源链接 |
| `data_type` | 数据类型记录 |

`ch_title` 为空时回退 `entitle`。没有标题或没有有效 `summary` 的记录不进入候选池。`designated_tag` 为空时归入“其他”，保证默认全选时不丢数据。

## 管理配置

将管理端现有“分类范围（逗号分隔）”改为多选复选框：

- 涉政
- 危安
- 涉华
- 其他

配置继续使用版本化 `categoryScope` 保存，保存时保留当前版本冲突检查。历史空配置解释为四类全选，以兼容已存在的配置记录；新配置至少选择一类。

配置只影响下一次生成。Inbox 重处理和自动事件处理不得覆盖已经成功生成的全局简报；同日覆盖仍只能由管理端手动补生成并显式确认。

## 50 条选取流程

1. 读取 `data_YYYYMMDD` 中选定 `designated_tag` 的有效记录。
2. 在服务端按 URL 和规范化标题去重，并合并同一事件的来源信息。
3. 按 `designated_tag + tag` 本地组织主题，不把 `summary` 发送给模型。
4. 将候选的 `candidateId`、`ch_title`、主分类和细分主题标签分批交给模型。模型只返回 `candidateId`、`importanceScore` 和 `riskScore`，不返回摘要和分类。
5. 服务端按现有规则计算 `importanceScore * 0.7 + riskScore * 0.3`，全局排序后取前 50 条。分类之间不做平均配额，所有已选分类共同竞争这 50 个名额。
6. 保存和展示时，事件的 `basicSituation/briefContent` 直接来自 MySQL `summary`；来源名称、时间和 URL 直接来自 MySQL。
7. 顶部“今日概览”可以继续由模型基于已选 50 条的标题和摘要生成，但单条新闻摘要不再次改写。

模型提示词使用固定输出 schema 和统一评分标准。模型调用在数据库事务之外执行；批量失败按照现有重试策略处理。

## 运行时配置

新增独立 MySQL 配置，禁止复用 PGVector 连接字符串：

```env
DAILY_AWARENESS_MYSQL_HOST=my_mysql
DAILY_AWARENESS_MYSQL_PORT=3306
DAILY_AWARENESS_MYSQL_DATABASE=news
DAILY_AWARENESS_MYSQL_USER=
DAILY_AWARENESS_MYSQL_PASSWORD=
DAILY_AWARENESS_MYSQL_TABLE_PREFIX=data_
```

API 使用独立 MySQL 连接池，部署时将 `my_mysql` 以网络别名接入 `hermes-net`。PGVector 相关环境和回填脚本保留给其他业务及历史数据，不再作为每日动态感知在线读取源。

## 状态与失败边界

- 当日分表不存在：视为数据源未就绪，触发 Inbox 重试，超过次数进入死信。
- 当日分表存在但筛选后无有效记录：记录 `NO_DATA`，不调用模型、不生成简报。
- MySQL 连接或查询失败：记录基础设施失败并重试，不标记 Inbox 已处理。
- 模型评分最终失败：记录 `GENERATION_FAILED`，事件本身仍可标记为已处理。
- 当日已有成功全局简报：自动事件和 Inbox 重处理只记录忽略，不覆盖成功简报。

## 迁移与部署顺序

1. 增加 MySQL 连接配置、驱动和数据源适配器。
2. 先部署支持新配置的后端，并把 `my_mysql` 接入共享 Docker 网络。
3. 验证指定业务日期表存在、字段契约可读，验证空表和缺表边界。
4. 部署管理端分类复选框和只读用户页面。
5. 再启用外部数据写入程序的每日完成事件。

旧 PGVector 表不删除，便于回滚。回滚应用时保留 Inbox、运行记录、配置和历史简报数据。

## 测试范围

- MySQL 表名派生和 SQL 标识符校验。
- 分类复选框保存、版本冲突和空配置兼容。
- `designated_tag` 过滤、空标题/空摘要过滤、URL/标题去重。
- 模型只接收标题与分类信息，不接收 `summary`，并返回固定评分结构。
- 简报事件正文严格来自 `summary`。
- 全局排序只取 50 条，分类不做平均配额。
- 缺表、空结果、MySQL 失败、模型失败、重试和死信。
- 生产构建、迁移幂等和管理端浏览器验收。

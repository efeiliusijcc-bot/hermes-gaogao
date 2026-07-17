# 每日动态感知前一日数据与 06:00 自动生成设计

## 目标

每日动态感知在上海时间每天 06:00 自动生成当天简报。由于 MySQL 每日分表存在写入延迟，当天简报固定读取前一自然日的数据表，使用户在 08:00 上班时优先看到已完成的当天简报。

本次不引入 Kafka、外部消息总线或新的调度基础设施。自动调度复用现有 PostgreSQL Inbox、后台 Worker、业务日期锁、运行状态、失败重试、死信和简报幂等机制。

## 日期语义

系统明确区分两个日期：

- `businessDate`：简报对外展示的业务日期，即当天。
- `sourceBusinessDate`：MySQL 数据来源日期，固定为 `businessDate - 1 day`。

日期计算统一使用 `Asia/Shanghai`，不能使用服务器本地时区或 UTC 日期直接减一天。

示例：

```text
调度时间：2026-07-18 06:00 Asia/Shanghai
businessDate：2026-07-18
sourceBusinessDate：2026-07-17
sourceTable：news.data_20260717
```

自动生成、Inbox 重处理和管理员手动补生成均遵循同一日期映射。已保存的历史简报不做回溯迁移或重写。

## 调度架构

新增应用内自动调度服务，不依赖服务器 Cron。服务启动后每分钟检查一次当前上海时间：

1. 当前时间未到 06:00 时不触发。
2. 当前时间已到 06:00 时，计算当天 `businessDate` 和前一天 `sourceBusinessDate`。
3. 检查当天是否已有成功全局简报；存在则不创建事件。
4. 以稳定 `eventId` 写入现有 Inbox；唯一约束保证多实例和重复检查幂等。
5. 唤醒现有 Worker，由状态机异步生成简报。

稳定事件标识：

```text
eventId=daily-awareness:auto:{businessDate}
batchId=scheduler:{sourceTable}
```

调度服务只负责确保自动事件存在，不直接读取 MySQL，也不直接调用模型。服务如果在 06:00 停机，06:00 后恢复时会执行当日补触发；如果当天已有成功简报则跳过。

## Inbox 负载

自动调度事件沿用 `DAILY_DATA_FINISHED` 类型，并在 payload 中记录调度元数据：

```json
{
  "eventId": "daily-awareness:auto:2026-07-18",
  "eventType": "DAILY_DATA_FINISHED",
  "businessDate": "2026-07-18",
  "batchId": "scheduler:data_20260717",
  "completedAt": "2026-07-18T06:00:00+08:00",
  "payload": {
    "triggerSource": "AUTO_SCHEDULER",
    "sourceBusinessDate": "2026-07-17",
    "sourceTable": "data_20260717",
    "dataWaitDeadline": "2026-07-18T08:00:00+08:00"
  }
}
```

上述 `payload` 是调度器写入 Inbox 的服务端元数据，不扩展公开 HTTP 请求 DTO，也不允许外部调用方指定 `sourceTable`。外部数据写入程序的 HTTP 事件入口继续保留；其事件由服务端根据 `businessDate - 1 day` 统一派生来源日期和表名。

## 数据读取

MySQL 适配器接收 `sourceBusinessDate`，并严格派生 `data_YYYYMMDD`。业务日期和来源日期都必须经过合法日期校验，表名仍不得直接来自请求。

读取规则保持不变：

- 标题：`ch_title`，为空时回退 `entitle`。
- 主分类：`designated_tag`，空值映射为“其他”。
- 细分标签：`tag`。
- 简要内容：原始 `summary`。
- 管理员分类范围在 MySQL 查询阶段过滤。
- 无标题或无有效 `summary` 的记录不进入候选。

模型只接收候选 ID、标题、主分类和细分标签，只返回重要性和风险评分。服务端按重要性 70% 与风险 30% 全局排序后取前 50 条。

## 06:00 至 08:00 数据等待

当来源表在 06:00 不存在时，不立即进入死信。该错误使用专门的数据等待策略：

```text
首次检查：06:00
重试间隔：15 分钟
等待截止：08:00
```

来源表缺失时，Inbox 状态转为 `RETRY_PENDING`，`next_attempt_at` 设置为下一次 15 分钟边界。每次重试创建独立运行记录，便于管理端审计。

08:00 前表出现后，下一次重试正常进入取数和模型评分。08:00 时仍不存在则终止等待：

- 运行记录标记失败。
- 当天状态记录数据源未就绪错误。
- Inbox 进入 `DEAD_LETTER`。
- 不生成空简报。
- 用户页面继续回退展示最近一期成功简报。

MySQL 连接失败和查询失败仍沿用基础设施重试边界。模型失败沿用现有模型自动重试，最终记录 `GENERATION_FAILED`，事件可标记为已处理。

## 幂等与覆盖

继续保留两层业务幂等：

1. Inbox `eventId` 唯一。
2. 全局简报 `businessDate` 唯一。

附加规则：

- 自动调度不能覆盖当天已有成功全局简报。
- Inbox 重处理不能覆盖当天已有成功全局简报。
- 外部事件与自动事件同时到达时，由业务日期锁和全局简报唯一约束保证只成功保存一次。
- 管理员手动补生成仍需填写原因并明确确认覆盖。
- 模型调用保持在长数据库事务之外。

## 状态与持久化

运行记录和简报必须可追溯到真实来源日期。为现有表增加可空字段并对历史数据保持兼容：

```text
daily_awareness_runs.source_business_date
daily_awareness_runs.source_table
daily_awareness_runs.data_wait_deadline
daily_briefs.source_business_date
daily_briefs.source_table
```

新生成记录必须写入这些字段；历史记录保持 `NULL`，不根据旧简报标题推断来源日期。

管理端状态和运行记录增加只读展示：

- 简报业务日期
- 来源数据日期
- 来源表
- 自动生成时间
- 当前尝试次数
- 下次重试时间
- 数据等待截止时间

调度时间暂定为系统固定策略，不新增管理员可编辑的调度控件。

## 配置

新增部署配置：

```env
DAILY_AWARENESS_AUTO_ENABLED=true
DAILY_AWARENESS_AUTO_TIME=06:00
DAILY_AWARENESS_AUTO_TIMEZONE=Asia/Shanghai
DAILY_AWARENESS_SOURCE_DAY_OFFSET=1
DAILY_AWARENESS_DATA_RETRY_MINUTES=15
DAILY_AWARENESS_DATA_WAIT_UNTIL=08:00
DAILY_AWARENESS_SCHEDULER_POLL_MS=60000
```

生产默认启用。测试环境可通过 `DAILY_AWARENESS_AUTO_ENABLED=false` 禁止后台自动事件，避免测试进程产生真实调度副作用。

## 权限边界

- 自动调度是服务内部行为，不使用普通用户 JWT，也不经过公开 HTTP 请求。
- 外部写入程序继续使用独立内部密钥调用事件接口。
- 管理员使用 `system:daily-awareness:manage` 查看状态、死信和执行手动补生成。
- 普通用户仅使用 `daily-awareness:view` 查看简报。

## 部署顺序

1. 部署可空来源日期字段和索引迁移。
2. 部署支持 `sourceBusinessDate` 的 MySQL 适配器、运行存储和查询响应。
3. 部署应用内调度器，但先设置 `DAILY_AWARENESS_AUTO_ENABLED=false`。
4. 验证历史简报查询、手动补生成和来源日期映射。
5. 启用生产自动调度，确认 06:00 创建唯一 Inbox 事件。
6. 保留外部事件入口；后续写入程序接入时无需关闭应用内调度器。

回滚时先关闭自动调度，再回滚应用。新增可空字段和已有 Inbox 记录保留，不删除历史状态或简报。

## 测试与验收

- 上海时区自然日减一天计算，包括月初、年初和闰日。
- `businessDate=2026-07-18` 严格读取 `data_20260717`。
- 06:00 前不触发，06:00 后只创建一个自动 Inbox 事件。
- 服务在 06:00 后重启会补触发。
- 多实例轮询不会产生重复事件。
- 来源表缺失时每 15 分钟重试，08:00 后进入死信。
- 08:00 前表出现后可以继续生成成功。
- 当天已有成功简报时自动调度和 Inbox 重放不覆盖。
- 手动补生成读取业务日期前一天的表。
- 成功简报正好保存 50 条，单条标题、分类和摘要与来源表一致。
- 管理端正确展示来源日期、来源表、下次重试和截止时间。
- 后端和前端生产构建、部署脚本语法、候选容器健康检查全部通过。

## 成功标准

正常情况下，用户在每天 08:00 打开每日动态感知时看到业务日期为当天、数据来源为前一天且包含 50 条新闻的成功简报。数据未就绪或生成失败时，页面明确展示当天状态并继续提供最近一期成功简报，不出现空白页或错误覆盖。

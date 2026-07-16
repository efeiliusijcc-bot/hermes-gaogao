# Hermes 编报与向量化共用模型凭据设计

## 目标

Hermes 正式编报成稿与向量化共用同一个模型 API key 和同一个 OpenAI 兼容 base URL，编报模型固定为 `deepseek-v4-flash`。

后台保存的 `openaiEmbeddingApiKey` 是唯一的业务模型 key 来源。向量化和编报都在每次调用前读取当前有效值，使后台更新 key 后无需复制到 `REPORT_AGENT_API_KEY`，也不会继续使用旧客户端中的 key。

## 当前问题

向量召回通过 `ResearchKeysService.getEffectiveKeys('openaiEmbeddingApiKey')` 读取后台保存的 key，并使用向量配置中的 DashScope 兼容 URL。正式编报当前默认通过 Hermes `/v1/runs` 执行，模型凭据由 Hermes 容器自身配置决定，因此不能保证与向量化使用同一个 key 和 URL。

`HERMES_API_KEY` 是 Hermes 网关鉴权 token，不是模型供应商 key。实现中必须继续保留它用于 `/v1/runs`、健康检查等网关请求，不能把它替换为 `openaiEmbeddingApiKey`。

## 方案

正式编报保留现有后端素材准备流程，但最终成稿使用 OpenAI 兼容接口直接调用 `deepseek-v4-flash`：

1. `ReportsService` 继续执行向量召回、Web Supplement、crawler 采集和拟稿上下文合并；
2. `HermesService` 根据 `REPORT_AGENT_PROVIDER` 选择执行通道；
3. `openai_compatible` 通道在调用时从统一配置解析器取得当前向量 key 和 URL；
4. 使用 `deepseek-v4-flash` 生成完整 Markdown；
5. 现有 `ReportsService` 校验、artifact 同步、引用资料写入和质量检查流程继续负责保存结果。

生产部署将正式编报 provider 明确设置为 `openai_compatible`。`hermes` provider 仍保留为兼容或人工回退通道，但不再作为满足“共用 key 和 URL”要求的默认正式编报通道。

## 统一配置

新增单一的模型连接配置边界，向量化和正式编报从同一来源解析：

- key：`ResearchKeysService.getEffectiveKey('openaiEmbeddingApiKey')`；
- base URL：`PGVECTOR_EMBEDDING_BASE_URL`，未配置时沿用当前向量 profile 的 DashScope 兼容 URL；
- 向量模型：保持当前向量 profile 配置；
- 编报模型：固定为 `deepseek-v4-flash`。

`REPORT_AGENT_API_KEY` 不再参与正式编报 key 选择。`REPORT_AGENT_BASE_URL` 不再形成第二套 URL；若为兼容旧部署暂时保留环境变量，只允许其默认值引用统一模型 URL，不允许覆盖正式编报的统一来源。

## 组件边界

### 统一模型连接解析器

解析器负责返回当前有效的 `{ apiKey, baseURL }`，不缓存 key。它依赖 `ResearchKeysService` 和集中后的向量 API URL 配置，不负责选择向量模型或编报模型。

### `VectorSourceService`

继续负责向量模型、维度、批量 embedding 和 key failover。其首选 key 和 base URL 改由统一配置边界提供，现有多 key 轮换能力保持不变。

### `HermesService`

新增 OpenAI 兼容正式编报执行方法。每个任务开始时创建或取得与当前 key 对应的客户端，调用模型固定为 `deepseek-v4-flash`。该方法返回完整 Markdown，不要求模型写远程文件或返回 `REPORT_FILE` 指针。

Hermes `/v1/runs`、HTTP 和 remote CLI 方法继续使用 `HERMES_API_KEY` 做网关鉴权，避免破坏兼容通道。

### `ReportsService`

继续作为编报工作流协调器。provider 为 `openai_compatible` 时调用新的直接成稿通道；得到 Markdown 后沿用现有可用性校验、artifact 存储、任务状态和质量检查逻辑。

## Prompt 调整

直接成稿通道复用现有报告结构、篇幅、来源约束和中文 UTF-8 约束，但移除只适用于 agent 工具执行的要求，包括：

- 调用 research harness 或其他工具；
- 把文件写入 Hermes 容器路径；
- 最终只返回 `REPORT_FILE`；
- agent 中间消息和工具审批协议。

直接调用的最终响应必须是完整 Markdown。素材不足、来源冲突和待核实内容仍按现有编报规则明确标注，不允许模型补造来源。

## 安全与错误处理

- key 不进入 prompt、任务 payload、metadata、artifact 或日志；
- 错误文本继续经过现有脱敏逻辑，禁止回显 Authorization header 或 key；
- 缺少 `openaiEmbeddingApiKey` 时，任务以明确的“模型 API key 未配置”错误失败，不回退到 `REPORT_AGENT_API_KEY`、`DIRECT_QA_API_KEY` 或 `HERMES_API_KEY`；
- base URL 非法或为空时在发起模型请求前失败；
- 401、429、超时和供应商错误进入现有任务失败与恢复流程；
- 不因直接模型调用失败而自动改用另一套模型 key，避免违反统一凭据要求。

## 范围

本次修改覆盖正式编报成稿主链路和其配置、部署入口。

本次不修改：

- 拟稿助手的事件分析与提纲生成；
- 每日态势感知生成；
- 已生成报告的局部修改；
- 向量模型、维度、索引表和召回排序；
- Web Supplement、crawler 和数据库信源采集逻辑；
- Hermes 网关 token 与健康检查协议。

## 测试

1. 正式编报从 `openaiEmbeddingApiKey` 取得 key，不读取 `REPORT_AGENT_API_KEY`；
2. 正式编报与向量化解析到同一个 base URL；
3. 正式编报请求模型始终为 `deepseek-v4-flash`；
4. 后台 key 更新后，新任务使用新 key，不复用旧 key 客户端；
5. 缺少统一 key 时明确失败，且不调用 Hermes 或其他模型通道；
6. 模型响应的完整 Markdown 能进入现有校验和 artifact 保存流程；
7. prompt 不再要求直接模型调用工具、写 Hermes 文件或返回 `REPORT_FILE`；
8. 日志、错误和任务元数据不包含 key；
9. 现有向量召回 key failover、报告 artifact、权限与任务状态测试保持通过；
10. 服务端 TypeScript build 和 `git diff --check` 通过。

## 验收标准

- 后台只配置 `openaiEmbeddingApiKey` 即可同时完成向量化和正式编报；
- 两条链路使用同一个 OpenAI 兼容 base URL；
- 编报供应商请求中的模型名为 `deepseek-v4-flash`；
- 更新后台 key 后，新建编报任务立即使用新 key；
- Hermes 网关 token 仍只用于 Hermes 网关鉴权；
- 编报结果能按现有方式保存、查看和下载。

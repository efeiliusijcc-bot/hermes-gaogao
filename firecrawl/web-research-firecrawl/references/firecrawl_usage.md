# Firecrawl 使用参考文档

## 1. Firecrawl 模式说明

Firecrawl 提供 6 种核心模式，覆盖网页调研的全部场景。

### search

通过关键词搜索网页，返回搜索结果列表。

- **输入**: 搜索关键词（query）
- **输出**: 搜索结果列表（标题、URL、摘要）
- **适合**: 研究主题探索、找寻相关资料、初步信息收集
- **特点**: 不直接抓取页面内容，仅返回搜索结果元数据；可配合 `scrape` 参数同时抓取结果页面

### scrape

抓取单个 URL 的内容，返回 markdown/html 等格式。

- **输入**: 目标 URL
- **输出**: 页面内容（markdown、html 或两者）
- **适合**: 抓取已知页面内容、获取特定文章或文档
- **特点**: 单次请求，速度快；支持多种输出格式；可配置等待时间、代理等参数

### map

分析网站结构，返回所有可访问的 URL 列表。

- **输入**: 网站根 URL
- **输出**: URL 列表（包含页面标题和路径）
- **适合**: 了解站点结构、发现子页面、规划爬取范围
- **特点**: 不抓取页面内容，仅返回 URL 映射；速度快，适合前期侦察

### crawl

爬取整个网站的多个页面，返回所有页面内容。

- **输入**: 起始 URL、爬取限制
- **输出**: 多个页面的内容集合
- **适合**: 文档站、知识库的全量抓取、小规模站点的内容采集
- **特点**: 异步任务，需要轮询状态；耗时较长；支持深度和范围限制

### batch_scrape

批量抓取多个 URL，适合已知多个目标 URL 的场景。

- **输入**: URL 列表
- **输出**: 每个 URL 对应的页面内容
- **适合**: 已有目标 URL 列表的批量抓取、竞品页面对比
- **特点**: 并发抓取，效率高于逐个 scrape；支持统一配置

### extract

从网页中提取结构化信息，支持 prompt 和 schema。

- **输入**: URL、提取 prompt 或 JSON schema
- **输出**: 结构化 JSON 数据
- **适合**: 提取特定字段数据、产品信息、表格数据
- **特点**: 基于 AI 的智能提取；支持自然语言描述提取需求；输出为结构化 JSON

---

## 2. 每种模式适合什么场景

| 模式 | 最佳使用场景 | 不适用场景 |
|------|-------------|-----------|
| **search** | 主题探索、找资料、初步调研 | 已知 URL 的直接抓取、需要完整页面内容 |
| **scrape** | 抓取单个已知页面、获取文章内容 | 大量 URL 批量处理、需要站点结构信息 |
| **map** | 了解站点结构、发现子页面、规划爬取 | 需要页面实际内容、只关心单个页面 |
| **crawl** | 文档站全量抓取、知识库采集 | 只需要少量页面、目标 URL 已知 |
| **batch_scrape** | 批量抓取已知 URL、竞品对比 | 需要发现未知 URL、单个页面抓取 |
| **extract** | 提取结构化数据、产品信息、表格 | 需要完整页面内容、纯文本抓取 |

---

## 3. 推荐默认限制

| 模式 | 推荐限制 | 说明 |
|------|---------|------|
| search | 5 | 避免返回过多结果，聚焦最相关内容 |
| map | 50 | 足够了解站点结构，不会过于庞大 |
| crawl | 20 | 避免长时间爬取，控制资源消耗 |
| batch_scrape | 20 个 URL/次 | 避免并发过高，保持稳定性 |

---

## 4. 推荐输出格式

| 场景 | 推荐格式 | 说明 |
|------|---------|------|
| AI 处理 / 分析 | `markdown` | 默认选择，结构清晰，适合 LLM 理解 |
| 保留原始结构 | `["markdown", "html"]` | 同时获取两种格式，按需使用 |
| 结构化提取 | JSON schema | 配合 extract 模式使用，输出结构化数据 |

---

## 5. 后期扩展方向

### 5.1 MCP Server

将每个函数暴露为 MCP tool，支持 Claude Desktop、Claude Code 等客户端直接调用。

**改造步骤：**

1. 安装 MCP SDK：`pip install mcp`
2. 创建 `scripts/firecrawl_mcp_server.py`
3. 将 6 个函数注册为 MCP tools
4. 支持 stdio 和 SSE 两种传输方式

**示例结构：**

```python
from mcp.server import Server
from mcp.types import Tool, TextContent
from firecrawl_client import scrape_url, search_web, map_site, crawl_site, batch_scrape, extract_structured

server = Server("firecrawl-research")

@server.list_tools()
async def list_tools():
    return [
        Tool(name="firecrawl_scrape", description="Scrape a URL", inputSchema={...}),
        Tool(name="firecrawl_search", description="Search the web", inputSchema={...}),
        # ... 其他 4 个 tools
    ]

@server.call_tool()
async def call_tool(name, arguments):
    dispatch = {
        "firecrawl_scrape": lambda: scrape_url(arguments["url"]),
        "firecrawl_search": lambda: search_web(arguments["query"], limit=arguments.get("limit", 5)),
        # ... 其他 dispatch
    }
    result = dispatch[name]()
    return [TextContent(type="text", text=json.dumps(result))]
```

**配置 Claude Desktop 使用：**

```json
{
  "mcpServers": {
    "firecrawl": {
      "command": "python",
      "args": ["path/to/scripts/firecrawl_mcp_server.py"],
      "env": {
        "FIRECRAWL_API_KEY": "fc-YOUR-API-KEY"
      }
    }
  }
}
```

---

### 5.2 Hermes Gateway

注册为 Hermes 可调用的 tool，通过 Hermes Gateway 统一管理 API Key 和调用限制。

**改造步骤：**

1. 创建 Hermes tool 定义文件
2. 将 `firecrawl_client.py` 的函数包装为 Hermes tool handler
3. 配置 Gateway 路由和权限

**示例 tool 定义：**

```python
# hermes_firecrawl_tool.py
from firecrawl_client import scrape_url, search_web, map_site, crawl_site

TOOL_DEFINITIONS = [
    {
        "name": "firecrawl_scrape",
        "description": "Scrape a single URL and return markdown content",
        "parameters": {
            "url": {"type": "string", "required": True},
            "formats": {"type": "array", "default": ["markdown"]},
        },
        "handler": lambda params: scrape_url(params["url"], formats=params.get("formats")),
    },
    {
        "name": "firecrawl_search",
        "description": "Search the web for a query",
        "parameters": {
            "query": {"type": "string", "required": True},
            "limit": {"type": "integer", "default": 5},
        },
        "handler": lambda params: search_web(params["query"], limit=params.get("limit", 5)),
    },
    # ... 其他 tools
]
```

**Gateway 配置要点：**
- API Key 由 Gateway 统一注入，tool 代码不直接持有
- 调用频率由 Gateway 限流，防止超额
- 结果经 Gateway 统一格式化后返回给调用方

---

### 5.3 Agent Team Researcher Agent

作为 Researcher Agent 的核心工具，负责信息收集和网页调研任务。

**在 Agent Team 中的定位：**

```
用户请求 → Planner Agent → Researcher Agent (firecrawl) → Writer Agent → 最终报告
                              ↓
                         Analyst Agent (分析数据)
```

**Researcher Agent 工具配置：**

```python
RESEARCHER_TOOLS = {
    "web_search": search_web,       # 主题探索
    "web_scrape": scrape_url,       # 抓取已知页面
    "web_map": map_site,            # 分析站点结构
    "web_crawl": crawl_site,        # 全量抓取文档站
    "web_batch": batch_scrape,      # 批量抓取
    "web_extract": extract_structured,  # 结构化提取
}
```

**Agent 间数据传递：**
- Researcher Agent 输出统一 JSON 格式
- Writer Agent 接收 JSON，提取 `data` 字段用于报告撰写
- Analyst Agent 接收 JSON，提取 `data` 字段用于数据分析
- 错误通过 `error` 字段传递，由 Planner Agent 决定是否重试

---

### 5.4 报告生成 Agent

抓取结果直接输入报告生成流程，自动完成来源标注和可信度评估。

**集成流程：**

1. Researcher Agent 完成调研，输出结构化 JSON
2. 报告生成 Agent 读取 JSON 中的 `data` 字段
3. 使用 `research_output_template.md` 模板组织内容
4. 自动填充：数据来源列表、关键发现、可引用资料
5. 人工审核：待核验信息、后续建议

**可信度自动评估规则：**

| 来源类型 | 默认可信度 |
|---------|----------|
| 官方文档 / 官网 | 高 |
| 知名媒体 / 学术论文 | 高 |
| 技术博客 / 社区 | 中 |
| 个人博客 / 论坛 | 低 |
| 匿名来源 | 低 |

---

### 5.5 RAG / 向量数据库

抓取内容经过 chunking 和 embedding 后存入向量数据库，支持语义搜索和知识检索。

**集成流程：**

1. 使用 firecrawl 抓取内容（返回 markdown）
2. 对 markdown 进行 chunking（按段落或固定长度切分）
3. 使用 embedding 模型（如 OpenAI text-embedding-3-small）生成向量
4. 存入向量数据库（Pinecone / Weaviate / Chroma）
5. 查询时使用语义搜索，返回最相关的 chunk

**示例集成代码：**

```python
from firecrawl_client import crawl_site
from langchain.text_splitter import RecursiveCharacterTextSplitter

# 1. 抓取
result = crawl_site("https://docs.example.com", limit=20)

# 2. Chunking
splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_size=200)
chunks = []
for page in result["data"]:
    chunks.extend(splitter.split_text(page["markdown"]))

# 3. Embedding + 存储（以 Chroma 为例）
import chromadb
client = chromadb.Client()
collection = client.create_collection("firecrawl_docs")
collection.add(
    documents=chunks,
    ids=[f"chunk_{i}" for i in range(len(chunks))],
    metadatas=[{"source": "firecrawl_crawl"} for _ in chunks],
)
```

**向量数据库选择建议：**

| 数据库 | 适合场景 | 特点 |
|-------|---------|------|
| Chroma | 本地开发、小规模 | 轻量、嵌入式 |
| Pinecone | 生产环境、大规模 | 托管服务、高性能 |
| Weaviate | 需要混合搜索 | 支持向量+关键词 |
| Qdrant | 高性能需求 | Rust 实现、低延迟 |

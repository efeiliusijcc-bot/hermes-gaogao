# web-research-firecrawl

Triad intelligence research tool combining Tavily (real-time search), Exa (semantic search), and Firecrawl (content extraction). Produces ranked sources, evidence cards, key findings, and full Markdown intelligence reports.

---

## Install

```bash
pip install firecrawl-py tavily-python exa-py
```

For MCP server support, also install:

```bash
pip install mcp
```

---

## Environment variables

The three API keys are read from environment variables. Never hardcode them.

### Windows PowerShell

```powershell
$env:TAVILY_API_KEY="tvly-YOUR-API-KEY"
$env:EXA_API_KEY="YOUR-EXA-API-KEY"
$env:FIRECRAWL_API_KEY="fc-YOUR-API-KEY"
```

### Linux / macOS

```bash
export TAVILY_API_KEY="tvly-YOUR-API-KEY"
export EXA_API_KEY="YOUR-EXA-API-KEY"
export FIRECRAWL_API_KEY="fc-YOUR-API-KEY"
```

| Variable | Engine | Get key from |
|----------|--------|-------------|
| `TAVILY_API_KEY` | Tavily | https://tavily.com |
| `EXA_API_KEY` | Exa | https://exa.ai |
| `FIRECRAWL_API_KEY` | Firecrawl | https://firecrawl.dev |

---

## CLI usage

The CLI entry point is `scripts/research_cli.py`. It supports three commands: `sources`, `brief`, and `report`.

### sources -- search without scraping

Discover and rank sources on a topic using Tavily + Exa. No content extraction.

```bash
python scripts/research_cli.py sources --query "AI regulation 2026" --max-sources 10
```

### brief -- research brief

Search, scrape top sources, extract key findings. Returns evidence cards and verification flags.

```bash
python scripts/research_cli.py brief --query "AI regulation 2026" --max-sources 8
```

With extraction instruction:

```bash
python scripts/research_cli.py brief --query "AI regulation 2026" --max-sources 8 --instruction "Focus on EU and US policy differences"
```

### report -- deep intelligence report

Full pipeline: search, scrape all sources, cross-verify, generate Markdown report.

```bash
python scripts/research_cli.py report --query "AI regulation 2026" --max-sources 12 --save-report report.md
```

Save both JSON and Markdown:

```bash
python scripts/research_cli.py report --query "AI regulation 2026" --max-sources 12 --output result.json --save-report report.md
```

### CLI arguments

| Argument | Commands | Default | Description |
|----------|----------|---------|-------------|
| `--query` | all | required | Research topic or question |
| `--max-sources` | sources=10, brief=8, report=12 | varies | Maximum number of sources |
| `--instruction` | brief, report | "" | Extra extraction instruction |
| `--output` | all | none | Save JSON result to file |
| `--save-report` | report | none | Save report_markdown to .md file |

---

## MCP server setup

The MCP server exposes the three triad pipeline functions as tools for any MCP-compatible client.

### Run the server

```bash
python scripts/search_tools_server.py
```

### Available tools

| Tool | Description |
|------|-------------|
| `triad_search_sources_tool` | Search sources only (no scraping) |
| `triad_research_brief_tool` | Brief: search + scrape + key findings |
| `triad_deep_report_tool` | Full report: search + scrape + verify + Markdown |

### Claude Desktop configuration

Add to your Claude Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "triad-intelligence": {
      "command": "python",
      "args": ["path/to/web-research-firecrawl/scripts/search_tools_server.py"],
      "env": {
        "TAVILY_API_KEY": "tvly-YOUR-API-KEY",
        "EXA_API_KEY": "YOUR-EXA-API-KEY",
        "FIRECRAWL_API_KEY": "fc-YOUR-API-KEY"
      }
    }
  }
}
```

---

## Claude Skill usage

This project functions as a Claude Code Skill.

### Installation

1. Place the `web-research-firecrawl` directory in `.claude/skills/` or your project directory.
2. Claude reads `SKILL.md` and automatically recognizes when to use this skill.

### Natural language examples

- "Research the latest developments in AI regulation" -- triggers `brief` mode
- "Find sources on quantum computing breakthroughs" -- triggers `sources` mode
- "Write a deep report on supply chain disruptions in 2026" -- triggers `report` mode
- "What are the key findings on LLM safety research?" -- triggers `brief` mode

---

## Architecture

```
scripts/
  tavily_client.py          # Tavily SDK wrapper (search + extract)
  exa_client.py             # Exa SDK wrapper (search + find similar)
  firecrawl_client.py       # Firecrawl SDK wrapper (scrape, search, map, crawl, batch, extract)
  source_ranker.py          # Deduplication, classification, credibility scoring
  intelligence_pipeline.py  # Triad orchestrator (sources, brief, report)
  search_tools_server.py    # MCP server (FastMCP)
  research_cli.py           # CLI entry point
  firecrawl_cli.py          # Standalone Firecrawl CLI (single-engine mode)
```

### Data flow

```
User query
    |
    v
intelligence_pipeline.py
    |
    +---> tavily_client.py  (real-time search)  ---+
    |                                              |
    +---> exa_client.py     (semantic search)  --->+---> source_ranker.py
                                                     |
                                                     v
                                              Ranked sources
                                                     |
                                                     v
                                    firecrawl_client.py (content extraction)
                                                     |
                                                     v
                                         Tavily extract (fallback)
                                                     |
                                                     v
                                         Evidence cards + key findings
                                                     |
                                                     v
                                    +----------------+----------------+
                                    |                                 |
                              research_cli.py                  search_tools_server.py
                                 (CLI)                              (MCP)
```

### Engine roles

| Engine | Module | Role |
|--------|--------|------|
| Tavily | `tavily_client.py` | Real-time web search, news, fresh content. Also serves as content extraction fallback. |
| Exa | `exa_client.py` | Semantic search, research papers, academic content, conceptual queries. |
| Firecrawl | `firecrawl_client.py` | Primary content extraction (scrape, crawl, map, batch, extract). |
| Source Ranker | `source_ranker.py` | Deduplicates, classifies, and scores all sources by credibility. |

---

## References

- `references/firecrawl_usage.md` -- Firecrawl API modes and usage patterns
- `references/source_policy.md` -- Source credibility tiers and classification rules
- `references/exa_usage.md` -- Exa API reference and integration guide

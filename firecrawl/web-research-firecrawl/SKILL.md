---
name: web-research-firecrawl
description: Triad intelligence research tool using Tavily (real-time search), Exa (semantic search), and Firecrawl (content extraction) for AI web research, intelligence briefs, K-reports, deep reports, and agent workflows.
---

# Triad Intelligence Research Skill

A three-engine web research system that combines Tavily for real-time search, Exa for semantic discovery, and Firecrawl for content extraction. Produces ranked sources, evidence cards, key findings, and full Markdown intelligence reports.

---

## 1. When to use this skill

Use this skill when the user needs:

- **Research topics** -- broad or scoped investigation of a subject across the public web.
- **Intelligence briefs** -- concise summaries with ranked, credible sources and extracted key findings.
- **Deep reports** -- full intelligence reports with source tables, evidence cards, cross-verification flags, and Markdown output.
- **Source discovery** -- finding and ranking relevant sources on a topic using multiple search engines.
- **Structured extraction** -- pulling specific fields (title, price, date, author, etc.) from web pages.

If the user's request involves gathering, analyzing, or reporting on web information, this is the correct skill.

---

## 2. When not to use this skill

Do NOT use this skill in the following situations:

- The target page requires **login, authentication, or session tokens** to access.
- The content is behind a **paywall or subscription** (e.g., paid news sites, gated dashboards).
- The target is an **internal, private, or intranet** website not accessible from the public internet.
- The user needs to **interact with the page dynamically** -- filling forms, clicking buttons, handling JavaScript-heavy SPAs that require browser interaction beyond simple rendering.
- The requested operation would **violate the target website's robots.txt or Terms of Service**.

In these cases, inform the user of the limitation and suggest alternatives (e.g., "If you can provide the page content directly, I can analyze it").

---

## 3. Core workflow

The triad pipeline operates in three modes. Choose the appropriate mode based on the user's request depth.

### Mode 1: sources-only (`triad_search_sources`)

**When**: User wants to discover and rank sources on a topic without scraping content.

**Flow**:
1. Tavily searches for real-time results (news, fresh content).
2. Exa searches for semantically relevant results (research papers, deep content).
3. Results are merged, deduplicated, and ranked by credibility.
4. Returns ranked source list only.

**Call**: `python scripts/research_cli.py sources --query "topic" --max-sources 10`

### Mode 2: research brief (`triad_research_brief`)

**When**: User wants a concise intelligence brief with key findings.

**Flow**:
1. Search with Tavily + Exa (parallel).
2. Merge and rank sources by credibility.
3. Scrape top sources using Firecrawl (Tavily extract as fallback).
4. Build evidence cards with content previews.
5. Extract key findings from high-credibility sources.
6. Flag sources needing manual verification.

**Call**: `python scripts/research_cli.py brief --query "topic" --max-sources 8`

### Mode 3: deep report (`triad_deep_report`)

**When**: User wants a full intelligence report in Markdown.

**Flow**:
1. Search with Tavily + Exa (parallel), higher source count.
2. Merge, deduplicate, and rank all sources.
3. Scrape every ranked source (Firecrawl first, Tavily extract fallback).
4. Build evidence cards, extract key findings, flag verification items.
5. Generate a complete Markdown report with source table, findings, evidence cards, and verification checklist.

**Call**: `python scripts/research_cli.py report --query "topic" --max-sources 12 --save-report report.md`

### Mode selection rules

1. **User asks "find sources" or "what's out there"** -- use `sources` mode.
2. **User asks "give me a summary" or "what are the key points"** -- use `brief` mode.
3. **User asks "write a report" or "full analysis"** -- use `report` mode.
4. **Ambiguous** -- default to `brief` mode, ask if deeper analysis is needed.

---

## 4. Engine selection

Each engine in the triad serves a distinct purpose. Select based on the information need.

| Engine | Strength | Best for | API function |
|--------|----------|----------|--------------|
| **Tavily** | Real-time search, news, fresh results | Current events, breaking news, recent developments | `tavily_search()` |
| **Exa** | Semantic search, academic depth | Research papers, technical analysis, conceptual queries | `exa_search()` |
| **Firecrawl** | Content extraction, full-page scraping | Getting full page content from known URLs | `scrape_url()` |
| **Tavily Extract** | Fallback content extraction | When Firecrawl fails or returns thin content | `tavily_extract()` |

### Selection logic

- **Tavily** is always used for the search phase (real-time freshness).
- **Exa** is always used alongside Tavily for the search phase (semantic depth).
- **Firecrawl** is the primary content extraction engine during the scrape phase.
- **Tavily Extract** is the fallback when Firecrawl returns empty or thin content (<100 chars).

The pipeline runs Tavily and Exa in parallel during search, then uses Firecrawl with automatic Tavily Extract fallback during scraping. No manual engine selection is needed -- the pipeline handles it.

---

## 5. Source credibility rules

Sources are classified and scored by the `source_ranker.py` module. Credibility determines ranking order and eligibility for key findings.

### Tier definitions

| Tier | Score | Source types |
|------|-------|-------------|
| **high** | 0.95 | Government (.gov, .mil), international orgs (un.org, who.int, europa.eu), .edu domains |
| **medium-high** | 0.80 | Major media (Reuters, AP, BBC, NYT, WSJ, FT, Economist), academic journals (Nature, Science, arXiv), research firms (McKinsey, Gartner) |
| **medium** | 0.60 | Tech blogs (Medium, dev.to, HuggingFace), company blogs (Google, OpenAI, Microsoft, AWS), GitHub |
| **low** | 0.30 | Forums (Reddit, Hacker News, Quora, Stack Overflow) |
| **excluded** | 0.00 | Aggregator sites, content farms |

### Classification rules

1. Domain suffix matching takes priority: `.gov` and `.mil` = government, `.edu` = academic.
2. Known domain matching: specific domains like `reuters.com` map to their tier.
3. Category fallback: if no domain match, classify by content category (media, research, tech_blog, forum, unknown).
4. Sources with credibility score < 0.5 are excluded from key findings.
5. Sources with credibility score < 0.6 are flagged for manual verification.

### How scoring works

The `score_credibility()` function in `scripts/source_ranker.py`:
1. Extracts the domain from the URL.
2. Checks against the `_DOMAIN_TIERS` mapping (exact domain and suffix patterns).
3. Falls back to `classify_source()` category-based scoring if no domain match.
4. Returns `{score, tier, reason}`.

### How deduplication works

The `deduplicate_sources()` function in `scripts/source_ranker.py`:
1. Normalizes URLs by stripping trailing slashes and lowercasing.
2. Keeps the first occurrence of each unique URL.
3. Preserves the original order of remaining sources.

---

## 6. Output format

All pipeline modes return a unified JSON structure. Fields vary by mode but share a common schema.

### Unified return format

```json
{
  "success": true,
  "mode": "triad_search_sources | triad_research_brief | triad_deep_report",
  "topic": "research query string",
  "sources": [
    {
      "url": "https://example.com/article",
      "title": "Article Title",
      "snippet": "First 300 chars of content or summary...",
      "engine": "tavily | exa",
      "score": 0.85,
      "category": "media | academic | government | tech_blog | forum | unknown",
      "credibility_score": 0.8,
      "credibility_tier": "medium-high",
      "credibility_reason": "domain match reuters.com"
    }
  ],
  "documents": [
    {
      "url": "https://example.com/article",
      "engine": "firecrawl | tavily_extract",
      "markdown": "Full page content in markdown...",
      "title": "Page Title",
      "success": true
    }
  ],
  "evidence_cards": [
    {
      "url": "https://example.com/article",
      "title": "Article Title",
      "category": "media",
      "credibility_score": 0.8,
      "credibility_tier": "medium-high",
      "engine": "firecrawl",
      "content_preview": "First 500 chars...",
      "content_length": 4523
    }
  ],
  "key_findings": [
    {
      "source": "https://example.com/article",
      "title": "Article Title",
      "credibility": "medium-high",
      "finding": "Extracted key insight..."
    }
  ],
  "verification_needed": [
    {
      "url": "https://low-cred-source.com/post",
      "title": "Forum Post Title",
      "reason": "Credibility low, cross-verify needed"
    }
  ],
  "report_markdown": "# Intelligence Report\n...",
  "errors": ["Tavily: timeout", "Exa: rate limited"]
}
```

### Mode-specific field availability

| Field | sources | brief | report |
|-------|---------|-------|--------|
| `sources` | populated | populated | populated |
| `documents` | empty | populated | populated |
| `evidence_cards` | empty | populated | populated |
| `key_findings` | empty | populated | populated |
| `verification_needed` | empty | populated | populated |
| `report_markdown` | empty | empty | populated |
| `errors` | populated if any | populated if any | populated if any |

### Downstream compatibility

The output format is designed to be consumed by:

- **Report generation pipelines** -- `report_markdown` and `key_findings` feed directly into report drafting.
- **RAG / vector databases** -- each document's `markdown` field can be chunked and embedded.
- **Agent Team workflows** -- the JSON format allows other agents (Writer, Analyst, Editor) to parse and act on results programmatically.
- **MCP clients** -- the MCP server returns this JSON as tool output.

---

## 7. Safety rules

### API key handling

All API keys are read exclusively from environment variables. Never hardcode, log, print, or expose them in output.

| Key | Environment variable | SDK client |
|-----|---------------------|------------|
| Tavily API key | `TAVILY_API_KEY` | `tavily.TavilyClient` |
| Exa API key | `EXA_API_KEY` | `exa_py.Exa` |
| Firecrawl API key | `FIRECRAWL_API_KEY` | `firecrawl.FirecrawlApp` |

### Enforcement

- Each client module (`tavily_client.py`, `exa_client.py`, `firecrawl_client.py`) reads the key from `os.environ.get()` at call time.
- If a key is missing, the function returns a structured error (`success: false`) with a message instructing the user to set the environment variable.
- API keys are never included in the return JSON, error messages, or log output.

### Compliance

- Always respect target website `robots.txt` directives.
- Never attempt to scrape pages requiring authentication.
- Use default rate limits; do not override concurrency settings.
- Default limits: search=5, crawl=20, sources=10, brief=8, report=12. Increase only with explicit user consent.

---

## 8. Error handling

### Per-engine error isolation

Each engine (Tavily, Exa, Firecrawl) can fail independently. The pipeline continues with partial results when at least one engine succeeds.

- **Tavily fails, Exa succeeds** -- pipeline continues with Exa results only. Error recorded in `errors` list.
- **Exa fails, Tavily succeeds** -- pipeline continues with Tavily results only. Error recorded in `errors` list.
- **Both search engines fail** -- pipeline returns `success: false` with combined error message.
- **Firecrawl fails on a URL** -- automatic fallback to Tavily Extract. If both fail, the document is marked `success: false` and excluded from evidence cards.

### Error response format

```json
{
  "success": false,
  "mode": "triad_search_sources",
  "input": {"query": "topic", "max_sources": 10},
  "data": null,
  "error": "Both engines failed: Tavily: API key invalid; Exa: rate limited"
}
```

### Partial results

When the pipeline produces partial results (some sources scraped, some failed), `success` is still `true` but `errors` contains the failure details. The caller decides whether partial results are sufficient.

---

## 9. Future extensions

### MCP Server

The MCP server (`scripts/search_tools_server.py`) is already implemented. It exposes three tools via FastMCP:

- `triad_search_sources_tool` -- sources-only search
- `triad_research_brief_tool` -- brief with scraping
- `triad_deep_report_tool` -- full report generation

Run with: `python scripts/search_tools_server.py`

### Hermes Gateway

Register the triad pipeline functions as Hermes tools. The Gateway manages API keys centrally, handles rate limiting, and routes tool calls to the pipeline.

### Agent Team Researcher

Deploy as the core capability of a dedicated Researcher Agent. The Researcher Agent handles all web information retrieval and passes structured JSON to Writer, Analyst, or Editor agents.

### RAG / Vector DB

Pipe scraped documents into a vector database (Pinecone, Weaviate, Chroma, Qdrant). Each document's `markdown` field is chunked, embedded, and stored with `url`, `title`, and `credibility_tier` as metadata.

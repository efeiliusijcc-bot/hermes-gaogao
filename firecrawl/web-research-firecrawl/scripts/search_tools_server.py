"""MCP server exposing triad intelligence tools.

This file is a thin MCP wrapper — all business logic lives in intelligence_pipeline.py.
API keys are read from environment variables, never hardcoded.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mcp.server.fastmcp import FastMCP
from intelligence_pipeline import triad_search_sources, triad_research_brief, triad_deep_report

mcp = FastMCP("triad-intelligence")


@mcp.tool()
def triad_search_sources_tool(query: str, max_sources: int = 10) -> str:
    """搜索信源（不抓取正文）。使用 Tavily 实时搜索 + Exa 语义搜索，返回去重排序的信源列表。

    Args:
        query: 研究主题或关键词
        max_sources: 最大信源数量，默认 10
    """
    result = triad_search_sources(query=query, max_sources=max_sources)
    return json.dumps(result, ensure_ascii=False, indent=2)


@mcp.tool()
def triad_research_brief_tool(query: str, max_sources: int = 8, instruction: str = "") -> str:
    """情报简报：搜索信源 + 抓取正文 + 提炼核心发现。

    Args:
        query: 研究主题
        max_sources: 最大信源数量，默认 8
        instruction: 额外提取指令（如"重点关注技术架构"）
    """
    result = triad_research_brief(query=query, max_sources=max_sources, instruction=instruction)
    return json.dumps(result, ensure_ascii=False, indent=2)


@mcp.tool()
def triad_deep_report_tool(query: str, max_sources: int = 12, instruction: str = "") -> str:
    """深度编报：搜索 + 抓取 + 交叉验证 + 生成完整 Markdown 报告。

    Args:
        query: 研究主题
        max_sources: 最大信源数量，默认 12
        instruction: 额外提取指令
    """
    result = triad_deep_report(query=query, max_sources=max_sources, instruction=instruction)
    return json.dumps(result, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    mcp.run()

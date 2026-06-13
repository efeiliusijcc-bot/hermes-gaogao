"""Tavily search client wrapper for real-time source discovery."""

import os
from typing import Any, Optional


def _get_api_keys() -> list[str]:
    raw_values = [os.environ.get("TAVILY_API_KEYS", ""), os.environ.get("TAVILY_API_KEY", "")]
    keys: list[str] = []
    for raw in raw_values:
        for item in raw.replace(";", ",").replace("\n", ",").split(","):
            key = item.strip()
            if key and key not in keys:
                keys.append(key)
    if not keys:
        raise ValueError(
            "TAVILY_API_KEY environment variable is not set. "
            "Set it with: export TAVILY_API_KEY='tvly-YOUR-API-KEY'"
        )
    return keys


def _init_client(api_key: str):
    from tavily import TavilyClient
    return TavilyClient(api_key=api_key)


def _is_failover_error(error: Exception) -> bool:
    text = f"{type(error).__name__}: {error}".lower()
    return any(token in text for token in [
        "429", "quota", "insufficient_quota", "rate limit", "too many requests",
        "billing", "credit", "balance", "exhausted", "额度", "余额", "限流",
    ])


def _with_key_failover(call):
    last_error: Exception | None = None
    keys = _get_api_keys()
    for index, key in enumerate(keys):
        try:
            return call(_init_client(key))
        except Exception as exc:
            last_error = exc
            if index >= len(keys) - 1 or not _is_failover_error(exc):
                raise
    raise last_error or RuntimeError("All Tavily API keys failed")


def _serialize(obj: Any) -> Any:
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if isinstance(obj, list):
        return [_serialize(i) for i in obj]
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    return obj


def tavily_search(
    query: str,
    max_results: int = 5,
    search_depth: str = "basic",
    topic: str = "general",
    include_answer: bool = True,
) -> dict:
    """Search with Tavily for real-time web results.

    Args:
        query: Search query.
        max_results: Number of results (default 5).
        search_depth: 'basic', 'advanced', 'fast', 'ultra-fast'.
        topic: 'general', 'news', 'finance'.
        include_answer: Include AI-generated answer summary.
    """
    if not query or not isinstance(query, str):
        return {"success": False, "mode": "tavily_search", "input": locals(), "data": None,
                "error": "query must be a non-empty string"}

    try:
        resp = _with_key_failover(
            lambda client: client.search(
                query=query,
                max_results=max_results,
                search_depth=search_depth,
                topic=topic,
                include_answer=include_answer,
            )
        )
        return {"success": True, "mode": "tavily_search",
                "input": {"query": query, "max_results": max_results},
                "data": _serialize(resp), "error": None}
    except ValueError as e:
        return {"success": False, "mode": "tavily_search", "input": {"query": query},
                "data": None, "error": str(e)}
    except Exception as e:
        return {"success": False, "mode": "tavily_search", "input": {"query": query},
                "data": None, "error": f"{type(e).__name__}: {e}"}


def tavily_extract(urls: list[str], extract_depth: str = "basic") -> dict:
    """Extract content from URLs using Tavily (fallback for Firecrawl).

    Args:
        urls: List of URLs to extract.
        extract_depth: 'basic' or 'advanced'.
    """
    if not urls or not isinstance(urls, list):
        return {"success": False, "mode": "tavily_extract", "input": locals(), "data": None,
                "error": "urls must be a non-empty list"}

    try:
        resp = _with_key_failover(
            lambda client: client.extract(urls=urls, extract_depth=extract_depth, format="markdown")
        )
        return {"success": True, "mode": "tavily_extract",
                "input": {"urls": urls}, "data": _serialize(resp), "error": None}
    except ValueError as e:
        return {"success": False, "mode": "tavily_extract", "input": {"urls": urls},
                "data": None, "error": str(e)}
    except Exception as e:
        return {"success": False, "mode": "tavily_extract", "input": {"urls": urls},
                "data": None, "error": f"{type(e).__name__}: {e}"}

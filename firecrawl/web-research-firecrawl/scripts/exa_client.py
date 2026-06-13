"""Exa semantic search client wrapper for high-relevance source discovery."""

import dataclasses
import os
from typing import Any, Optional


def _get_api_keys() -> list[str]:
    raw_values = [os.environ.get("EXA_API_KEYS", ""), os.environ.get("EXA_API_KEY", "")]
    keys: list[str] = []
    for raw in raw_values:
        for item in raw.replace(";", ",").replace("\n", ",").split(","):
            key = item.strip()
            if key and key not in keys:
                keys.append(key)
    if not keys:
        raise ValueError(
            "EXA_API_KEY environment variable is not set. "
            "Set it with: export EXA_API_KEY='YOUR-EXA-API-KEY'"
        )
    return keys


def _init_client(api_key: str):
    from exa_py import Exa
    return Exa(api_key=api_key)


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
    raise last_error or RuntimeError("All Exa API keys failed")


def _serialize(obj: Any) -> Any:
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return dataclasses.asdict(obj)
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if isinstance(obj, list):
        return [_serialize(i) for i in obj]
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    return obj


def exa_search(
    query: str,
    num_results: int = 5,
    use_autoprompt: bool = True,
    include_summary: bool = True,
    category: Optional[str] = None,
) -> dict:
    """Semantic search with Exa for high-relevance results.

    Args:
        query: Natural language query.
        num_results: Number of results (default 5).
        use_autoprompt: Let Exa optimize the query.
        include_summary: Include AI-generated summaries.
        category: Optional category filter (e.g. 'news', 'company', 'research paper').
    """
    if not query or not isinstance(query, str):
        return {"success": False, "mode": "exa_search", "input": locals(), "data": None,
                "error": "query must be a non-empty string"}

    try:
        kwargs: dict[str, Any] = {
            "query": query,
            "num_results": num_results,
            "type": "auto" if use_autoprompt else "keyword",
        }
        if include_summary:
            kwargs["contents"] = {"summary": True}
        if category:
            kwargs["category"] = category

        resp = _with_key_failover(lambda client: client.search(**kwargs))
        return {"success": True, "mode": "exa_search",
                "input": {"query": query, "num_results": num_results},
                "data": _serialize(resp), "error": None}
    except ValueError as e:
        return {"success": False, "mode": "exa_search", "input": {"query": query},
                "data": None, "error": str(e)}
    except Exception as e:
        return {"success": False, "mode": "exa_search", "input": {"query": query},
                "data": None, "error": f"{type(e).__name__}: {e}"}


def exa_find_similar(
    url: str,
    num_results: int = 5,
    include_summary: bool = True,
) -> dict:
    """Find pages similar to a given URL.

    Args:
        url: Reference URL.
        num_results: Number of similar results.
        include_summary: Include AI summaries.
    """
    if not url or not isinstance(url, str):
        return {"success": False, "mode": "exa_similar", "input": locals(), "data": None,
                "error": "url must be a non-empty string"}

    try:
        kwargs: dict[str, Any] = {"url": url, "num_results": num_results}
        if include_summary:
            kwargs["contents"] = {"summary": True}
        resp = _with_key_failover(lambda client: client.find_similar(**kwargs))
        return {"success": True, "mode": "exa_similar",
                "input": {"url": url, "num_results": num_results},
                "data": _serialize(resp), "error": None}
    except ValueError as e:
        return {"success": False, "mode": "exa_similar", "input": {"url": url},
                "data": None, "error": str(e)}
    except Exception as e:
        return {"success": False, "mode": "exa_similar", "input": {"url": url},
                "data": None, "error": f"{type(e).__name__}: {e}"}

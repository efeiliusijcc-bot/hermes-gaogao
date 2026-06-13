"""Firecrawl SDK client wrapper for web research workflows.

Provides scrape, search, map, crawl, batch, and extract functions
with unified return format, suitable for CLI, FastAPI, MCP, Hermes,
and Agent Team integration.
"""

import os
from typing import Any, Optional

from firecrawl import FirecrawlApp


def _get_api_keys() -> list[str]:
    """Read Firecrawl API key from environment variable."""
    raw_values = [os.environ.get("FIRECRAWL_API_KEYS", ""), os.environ.get("FIRECRAWL_API_KEY", "")]
    keys: list[str] = []
    for raw in raw_values:
        for item in raw.replace(";", ",").replace("\n", ",").split(","):
            key = item.strip()
            if key and key not in keys:
                keys.append(key)
    if not keys:
        raise ValueError(
            "FIRECRAWL_API_KEY environment variable is not set. "
            "Set it with: export FIRECRAWL_API_KEY='fc-YOUR-API-KEY'"
        )
    return keys


def _init_client(api_key: str) -> FirecrawlApp:
    """Initialize FirecrawlApp with API key from environment."""
    return FirecrawlApp(api_key=api_key)


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
    raise last_error or RuntimeError("All Firecrawl API keys failed")


def _serialize(obj: Any) -> Any:
    """Convert Pydantic models and nested objects to plain dicts/lists."""
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if isinstance(obj, list):
        return [_serialize(item) for item in obj]
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    return obj


def _wrap(mode: str, input_params: dict, func) -> dict:
    """Execute func and wrap result in unified return format."""
    try:
        data = _with_key_failover(func)
        return {
            "success": True,
            "mode": mode,
            "input": input_params,
            "data": _serialize(data),
            "error": None,
        }
    except ValueError as e:
        return {
            "success": False,
            "mode": mode,
            "input": input_params,
            "data": None,
            "error": str(e),
        }
    except Exception as e:
        return {
            "success": False,
            "mode": mode,
            "input": input_params,
            "data": None,
            "error": f"{type(e).__name__}: {e}",
        }


def scrape_url(
    url: str,
    formats: Optional[list[str]] = None,
    max_age: Optional[int] = None,
) -> dict:
    """Scrape a single URL and return its content.

    Args:
        url: The URL to scrape.
        formats: Output formats, defaults to ["markdown"].
        max_age: Cache max age in milliseconds.
    """
    if not url or not isinstance(url, str):
        return {
            "success": False,
            "mode": "scrape",
            "input": {"url": url, "formats": formats, "max_age": max_age},
            "data": None,
            "error": "url must be a non-empty string",
        }

    formats = formats or ["markdown"]

    def _call(client: FirecrawlApp):
        kwargs: dict[str, Any] = {"formats": formats}
        if max_age is not None:
            kwargs["max_age"] = max_age
        return client.scrape(url, **kwargs)

    return _wrap("scrape", {"url": url, "formats": formats, "max_age": max_age}, _call)


def search_web(
    query: str,
    limit: int = 5,
    scrape: bool = False,
) -> dict:
    """Search the web using Firecrawl.

    Args:
        query: Search query string.
        limit: Max number of results, defaults to 5.
        scrape: If True, also scrape each result page.
    """
    if not query or not isinstance(query, str):
        return {
            "success": False,
            "mode": "search",
            "input": {"query": query, "limit": limit, "scrape": scrape},
            "data": None,
            "error": "query must be a non-empty string",
        }
    if not isinstance(limit, int) or limit <= 0:
        return {
            "success": False,
            "mode": "search",
            "input": {"query": query, "limit": limit, "scrape": scrape},
            "data": None,
            "error": "limit must be a positive integer",
        }

    def _call(client: FirecrawlApp):
        kwargs: dict[str, Any] = {"limit": limit}
        if scrape:
            from firecrawl.v2.types import ScrapeOptions
            kwargs["scrape_options"] = ScrapeOptions(formats=["markdown"])
        return client.search(query, **kwargs)

    return _wrap("search", {"query": query, "limit": limit, "scrape": scrape}, _call)


def map_site(
    url: str,
    limit: int = 50,
) -> dict:
    """Map a website and return all discoverable URLs.

    Args:
        url: The base URL to map.
        limit: Max number of URLs to return, defaults to 50.
    """
    if not url or not isinstance(url, str):
        return {
            "success": False,
            "mode": "map",
            "input": {"url": url, "limit": limit},
            "data": None,
            "error": "url must be a non-empty string",
        }

    def _call(client: FirecrawlApp):
        return client.map(url, limit=limit)

    return _wrap("map", {"url": url, "limit": limit}, _call)


def crawl_site(
    url: str,
    limit: int = 20,
    formats: Optional[list[str]] = None,
) -> dict:
    """Crawl a website and return content from multiple pages.

    Args:
        url: The base URL to crawl.
        limit: Max number of pages, defaults to 20.
        formats: Output formats, defaults to ["markdown"].
    """
    if not url or not isinstance(url, str):
        return {
            "success": False,
            "mode": "crawl",
            "input": {"url": url, "limit": limit, "formats": formats},
            "data": None,
            "error": "url must be a non-empty string",
        }

    formats = formats or ["markdown"]

    def _call(client: FirecrawlApp):
        from firecrawl.v2.types import ScrapeOptions
        scrape_options = ScrapeOptions(formats=formats)
        return client.crawl(url, limit=limit, scrape_options=scrape_options)

    return _wrap("crawl", {"url": url, "limit": limit, "formats": formats}, _call)


def batch_scrape(
    urls: list[str],
    formats: Optional[list[str]] = None,
) -> dict:
    """Batch scrape multiple URLs.

    Args:
        urls: List of URLs to scrape.
        formats: Output formats, defaults to ["markdown"].
    """
    if not urls or not isinstance(urls, list):
        return {
            "success": False,
            "mode": "batch",
            "input": {"urls": urls, "formats": formats},
            "data": None,
            "error": "urls must be a non-empty list of URL strings",
        }
    for u in urls:
        if not isinstance(u, str) or not u:
            return {
                "success": False,
                "mode": "batch",
                "input": {"urls": urls, "formats": formats},
                "data": None,
                "error": f"Invalid URL in list: {u!r}",
            }

    formats = formats or ["markdown"]

    def _call(client: FirecrawlApp):
        return client.batch_scrape(urls, formats=formats)

    return _wrap("batch", {"urls": urls, "formats": formats}, _call)


def extract_structured(
    urls: Optional[list[str]] = None,
    prompt: Optional[str] = None,
    schema: Optional[dict] = None,
) -> dict:
    """Extract structured information from URLs.

    Args:
        urls: List of URLs to extract from.
        prompt: Instruction for what to extract.
        schema: JSON schema defining the extraction structure.
    """
    if not urls or not isinstance(urls, list):
        return {
            "success": False,
            "mode": "extract",
            "input": {"urls": urls, "prompt": prompt, "schema": schema},
            "data": None,
            "error": "urls must be a non-empty list of URL strings",
        }
    if not prompt or not isinstance(prompt, str):
        return {
            "success": False,
            "mode": "extract",
            "input": {"urls": urls, "prompt": prompt, "schema": schema},
            "data": None,
            "error": "prompt must be a non-empty string",
        }

    def _call(client: FirecrawlApp):
        kwargs: dict[str, Any] = {"urls": urls, "prompt": prompt}
        if schema:
            kwargs["schema"] = schema
        return client.extract(**kwargs)

    return _wrap("extract", {"urls": urls, "prompt": prompt, "schema": schema}, _call)

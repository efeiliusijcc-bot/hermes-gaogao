#!/usr/bin/env python3
"""web_fetch client — lightweight HTTP fetcher for evidence reading.

Replaces Firecrawl scrape + Tavily extract with direct HTTP GET.
Features:
  - HTML → plain text conversion (strips scripts, styles, nav)
  - Per-URL disk cache (/tmp/research_cache/)
  - Configurable timeout (default 12s)
  - CLI: python3 web_fetch_client.py <url> [--timeout 12] [--output file.json]
  - Batch CLI: python3 web_fetch_client.py --batch urls.json [--timeout 12]
"""

import hashlib
import json
import os
import re
import sys
import urllib.request
import urllib.error
from html.parser import HTMLParser
from typing import Optional

CACHE_DIR = "/tmp/research_cache"
DEFAULT_TIMEOUT = 12


class _HTMLTextExtractor(HTMLParser):
    """Strip HTML to readable plain text."""

    def __init__(self):
        super().__init__()
        self._parts: list[str] = []
        self._skip = False
        self._skip_tags = {"script", "style", "nav", "footer", "aside", "noscript", "svg"}
        self._block_tags = {
            "p", "div", "h1", "h2", "h3", "h4", "h5", "h6",
            "li", "tr", "blockquote", "section", "article", "br", "hr",
        }

    def handle_starttag(self, tag, attrs):
        if tag in self._skip_tags:
            self._skip = True

    def handle_endtag(self, tag):
        if tag in self._skip_tags:
            self._skip = False
        if tag in self._block_tags:
            self._parts.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self._parts.append(data)

    def get_text(self) -> str:
        raw = "".join(self._parts)
        raw = re.sub(r"\n{3,}", "\n\n", raw)
        raw = re.sub(r"[ \t]+", " ", raw)
        return raw.strip()


def html_to_text(html: str) -> str:
    ext = _HTMLTextExtractor()
    ext.feed(html)
    return ext.get_text()


def _url_hash(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()[:16]


def cache_get(url: str) -> Optional[str]:
    path = os.path.join(CACHE_DIR, f"{_url_hash(url)}.txt")
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            return None
    return None


def cache_set(url: str, content: str):
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, f"{_url_hash(url)}.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def cache_clear():
    if os.path.exists(CACHE_DIR):
        for f in os.listdir(CACHE_DIR):
            os.remove(os.path.join(CACHE_DIR, f))


def fetch_url(url: str, timeout: int = DEFAULT_TIMEOUT) -> dict:
    """Fetch a single URL via HTTP GET, return structured result."""
    cached = cache_get(url)
    if cached and len(cached) > 50:
        return {
            "success": True, "url": url, "content": cached,
            "engine": "cache", "content_length": len(cached), "error": None,
        }

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,text/plain,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "identity",
    }

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            content_type = resp.headers.get("Content-Type", "")

            for enc in ["utf-8", "gbk", "gb2312", "latin-1"]:
                try:
                    text = raw.decode(enc)
                    break
                except (UnicodeDecodeError, LookupError):
                    continue
            else:
                text = raw.decode("utf-8", errors="replace")

            if "html" in content_type or "xhtml" in content_type or "<html" in text[:500].lower():
                text = html_to_text(text)

            if text and len(text) > 100:
                cache_set(url, text)

            return {
                "success": True, "url": url, "content": text,
                "engine": "web_fetch", "content_length": len(text), "error": None,
            }

    except urllib.error.HTTPError as e:
        return {"success": False, "url": url, "content": "", "engine": "web_fetch",
                "content_length": 0, "error": f"HTTP {e.code}: {e.reason}"}
    except urllib.error.URLError as e:
        return {"success": False, "url": url, "content": "", "engine": "web_fetch",
                "content_length": 0, "error": f"URL error: {e.reason}"}
    except Exception as e:
        return {"success": False, "url": url, "content": "", "engine": "web_fetch",
                "content_length": 0, "error": f"{type(e).__name__}: {e}"}


def fetch_batch(urls: list[str], timeout: int = DEFAULT_TIMEOUT) -> list[dict]:
    return [fetch_url(u, timeout) for u in urls]


def _cli():
    import argparse
    parser = argparse.ArgumentParser(description="web_fetch client")
    parser.add_argument("url", nargs="?", help="Single URL to fetch")
    parser.add_argument("--batch", help="JSON file with array of URLs")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    parser.add_argument("--output", "-o")
    parser.add_argument("--clear-cache", action="store_true")
    args = parser.parse_args()

    if args.clear_cache:
        cache_clear()
        print(json.dumps({"cleared": True}))
        return

    if args.batch:
        with open(args.batch, "r") as f:
            urls = json.load(f)
        results = fetch_batch(urls, timeout=args.timeout)
    elif args.url:
        results = [fetch_url(args.url, timeout=args.timeout)]
    else:
        parser.print_help()
        sys.exit(1)

    output = json.dumps(results if args.batch else results[0], ensure_ascii=False, indent=2)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output)
        print(f"[Saved to {args.output}]", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    _cli()

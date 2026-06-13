#!/usr/bin/env python3
"""Firecrawl CLI - Command-line interface for Firecrawl web scraping operations."""

import argparse
import json
import os
import sys

# Allow importing firecrawl_client from the same directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from firecrawl_client import (
    scrape_url,
    search_web,
    map_site,
    crawl_site,
    batch_scrape,
    extract_structured,
)


def output_result(result, output_path=None):
    """Print result as JSON to stdout, optionally write to a file."""
    text = json.dumps(result, ensure_ascii=False, indent=2)
    print(text)
    if output_path:
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(text)


def cmd_scrape(args) -> dict:
    kwargs = {"url": args.url}
    if args.formats:
        kwargs["formats"] = args.formats
    return scrape_url(**kwargs)


def cmd_search(args) -> dict:
    kwargs = {"query": args.query}
    if args.limit:
        kwargs["limit"] = args.limit
    if args.scrape:
        kwargs["scrape"] = True
    return search_web(**kwargs)


def cmd_map(args) -> dict:
    kwargs = {"url": args.url}
    if args.limit:
        kwargs["limit"] = args.limit
    return map_site(**kwargs)


def cmd_crawl(args) -> dict:
    kwargs = {"url": args.url}
    if args.limit:
        kwargs["limit"] = args.limit
    if args.formats:
        kwargs["formats"] = args.formats
    return crawl_site(**kwargs)


def cmd_batch(args) -> dict:
    kwargs = {"urls": args.urls}
    if args.formats:
        kwargs["formats"] = args.formats
    return batch_scrape(**kwargs)


def cmd_extract(args) -> dict:
    kwargs = {"urls": args.urls, "prompt": args.prompt}
    if args.schema:
        kwargs["schema"] = json.loads(args.schema)
    return extract_structured(**kwargs)


def main() -> None:
    # Ensure UTF-8 output on Windows
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
    if sys.stderr.encoding and sys.stderr.encoding.lower() != "utf-8":
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(
        prog="firecrawl_cli",
        description="Firecrawl CLI - web scraping, search, and extraction tool",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # --- scrape ---
    sp_scrape = subparsers.add_parser("scrape", help="Scrape a single URL")
    sp_scrape.add_argument("--url", required=True, help="URL to scrape")
    sp_scrape.add_argument("--formats", nargs="+", help="Output formats (e.g. markdown html)")
    sp_scrape.add_argument("--output", help="Save result to file")

    # --- search ---
    sp_search = subparsers.add_parser("search", help="Search the web")
    sp_search.add_argument("--query", required=True, help="Search query")
    sp_search.add_argument("--limit", type=int, help="Max results to return")
    sp_search.add_argument("--scrape", action="store_true", help="Also scrape each result")
    sp_search.add_argument("--output", help="Save result to file")

    # --- map ---
    sp_map = subparsers.add_parser("map", help="Map a site's URLs")
    sp_map.add_argument("--url", required=True, help="Site URL to map")
    sp_map.add_argument("--limit", type=int, help="Max URLs to return")
    sp_map.add_argument("--output", help="Save result to file")

    # --- crawl ---
    sp_crawl = subparsers.add_parser("crawl", help="Crawl a site")
    sp_crawl.add_argument("--url", required=True, help="Site URL to crawl")
    sp_crawl.add_argument("--limit", type=int, help="Max pages to crawl")
    sp_crawl.add_argument("--formats", nargs="+", help="Output formats (e.g. markdown html)")
    sp_crawl.add_argument("--output", help="Save result to file")

    # --- batch ---
    sp_batch = subparsers.add_parser("batch", help="Batch scrape multiple URLs")
    sp_batch.add_argument("--urls", nargs="+", required=True, help="URLs to scrape")
    sp_batch.add_argument("--formats", nargs="+", help="Output formats (e.g. markdown html)")
    sp_batch.add_argument("--output", help="Save result to file")

    # --- extract ---
    sp_extract = subparsers.add_parser("extract", help="Extract structured data from URLs")
    sp_extract.add_argument("--urls", nargs="+", required=True, help="URLs to extract from")
    sp_extract.add_argument("--prompt", required=True, help="Extraction prompt")
    sp_extract.add_argument("--schema", help="JSON schema string for structured extraction")
    sp_extract.add_argument("--output", help="Save result to file")

    args = parser.parse_args()

    dispatch = {
        "scrape": cmd_scrape,
        "search": cmd_search,
        "map": cmd_map,
        "crawl": cmd_crawl,
        "batch": cmd_batch,
        "extract": cmd_extract,
    }

    try:
        result = dispatch[args.command](args)
    except Exception as e:
        result = {"success": False, "mode": args.command, "input": {}, "data": None, "error": str(e)}

    output_result(result, getattr(args, "output", None))

    if not result.get("success", False):
        sys.exit(1)


if __name__ == "__main__":
    main()

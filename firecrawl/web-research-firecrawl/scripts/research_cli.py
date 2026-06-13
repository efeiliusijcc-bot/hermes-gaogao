#!/usr/bin/env python3
"""Triad Intelligence CLI — Tavily + Exa + Firecrawl research tool."""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from intelligence_pipeline import triad_search_sources, triad_research_brief, triad_deep_report


def _ensure_utf8():
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
    if sys.stderr.encoding and sys.stderr.encoding.lower() != "utf-8":
        sys.stderr.reconfigure(encoding="utf-8")


def output_result(result: dict, output_path: str = None):
    text = json.dumps(result, ensure_ascii=False, indent=2)
    print(text)
    if output_path:
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"\n[Saved to {output_path}]", file=sys.stderr)


def main():
    _ensure_utf8()

    parser = argparse.ArgumentParser(
        prog="research_cli",
        description="Triad Intelligence CLI — Tavily + Exa + Firecrawl",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # --- sources ---
    sp = subparsers.add_parser("sources", help="Search sources only (no scraping)")
    sp.add_argument("--query", required=True, help="Research topic")
    sp.add_argument("--max-sources", type=int, default=10, help="Max sources (default: 10)")
    sp.add_argument("--output", help="Save result to file")

    # --- brief ---
    sp = subparsers.add_parser("brief", help="Research brief: search + scrape + key findings")
    sp.add_argument("--query", required=True, help="Research topic")
    sp.add_argument("--max-sources", type=int, default=8, help="Max sources (default: 8)")
    sp.add_argument("--instruction", default="", help="Extraction instruction")
    sp.add_argument("--output", help="Save result to file")

    # --- report ---
    sp = subparsers.add_parser("report", help="Deep report: search + scrape + verify + Markdown")
    sp.add_argument("--query", required=True, help="Research topic")
    sp.add_argument("--max-sources", type=int, default=12, help="Max sources (default: 12)")
    sp.add_argument("--instruction", default="", help="Extraction instruction")
    sp.add_argument("--output", help="Save result to file")
    sp.add_argument("--save-report", help="Save report_markdown to a .md file")

    args = parser.parse_args()

    dispatch = {
        "sources": lambda: triad_search_sources(args.query, args.max_sources),
        "brief": lambda: triad_research_brief(args.query, args.max_sources, args.instruction),
        "report": lambda: triad_deep_report(args.query, args.max_sources, args.instruction),
    }

    try:
        result = dispatch[args.command]()
    except Exception as e:
        result = {"success": False, "mode": args.command, "input": {}, "data": None, "error": str(e)}

    output_result(result, getattr(args, "output", None))

    # Save report markdown separately if requested
    if getattr(args, "save_report", None) and result.get("report_markdown"):
        with open(args.save_report, "w", encoding="utf-8") as f:
            f.write(result["report_markdown"])
        print(f"\n[Report saved to {args.save_report}]", file=sys.stderr)

    if not result.get("success", False):
        sys.exit(1)


if __name__ == "__main__":
    main()

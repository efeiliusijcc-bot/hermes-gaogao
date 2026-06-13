"""Triad intelligence pipeline: Tavily + Exa + Firecrawl.

Orchestrates three search/scrape engines for research, briefs, and deep reports.
Designed for MCP, Agent Team, Hermes, CLI, and automated report systems.
"""

import json
from datetime import datetime
from typing import Optional

from tavily_client import tavily_search, tavily_extract
from exa_client import exa_search
from firecrawl_client import scrape_url
from source_ranker import rank_sources, filter_core_findings, classify_source, score_credibility


def _now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def _merge_sources(tavily_data: Optional[dict], exa_data: Optional[dict]) -> list[dict]:
    """Merge and normalize results from Tavily and Exa into a flat source list."""
    sources = []

    # Tavily results
    if tavily_data and tavily_data.get("results"):
        for r in tavily_data["results"]:
            sources.append({
                "url": r.get("url", ""),
                "title": r.get("title", ""),
                "snippet": r.get("content", "")[:300],
                "engine": "tavily",
                "score": r.get("score", 0),
            })

    # Exa results (serialized via dataclasses.asdict)
    exa_results = None
    if exa_data and isinstance(exa_data, dict):
        exa_results = exa_data.get("results")
    if exa_results:
        for r in exa_results:
            if isinstance(r, dict):
                sources.append({
                    "url": r.get("url", ""),
                    "title": r.get("title", ""),
                    "snippet": (r.get("summary", "") or "")[:300],
                    "engine": "exa",
                    "score": r.get("score", 0),
                })

    return sources


def _scrape_with_fallback(url: str) -> dict:
    """Try Firecrawl scrape first, fall back to Tavily extract on failure."""
    result = scrape_url(url)
    if result.get("success") and result.get("data"):
        markdown = result["data"].get("markdown", "")
        if markdown and len(markdown) > 100:
            return {
                "url": url,
                "engine": "firecrawl",
                "markdown": markdown,
                "title": result["data"].get("metadata", {}).get("title", ""),
                "success": True,
            }

    # Fallback to Tavily extract
    fb = tavily_extract([url])
    if fb.get("success") and fb.get("data"):
        results = fb["data"].get("results", [])
        if results:
            return {
                "url": url,
                "engine": "tavily_extract",
                "markdown": results[0].get("raw_content", "") or results[0].get("content", ""),
                "title": results[0].get("title", ""),
                "success": True,
            }

    return {"url": url, "engine": None, "markdown": "", "title": "", "success": False,
            "error": result.get("error", "Firecrawl and Tavily extract both failed")}


def _build_evidence_cards(documents: list[dict], sources: list[dict]) -> list[dict]:
    """Build evidence cards from scraped documents, linked to ranked sources."""
    source_map = {s["url"]: s for s in sources}
    cards = []
    for doc in documents:
        if not doc.get("success"):
            continue
        url = doc.get("url", "")
        meta = source_map.get(url, {})
        cred = score_credibility(url)
        markdown = doc.get("markdown", "")
        cards.append({
            "url": url,
            "title": doc.get("title") or meta.get("title", ""),
            "category": classify_source(url),
            "credibility_score": cred["score"],
            "credibility_tier": cred["tier"],
            "engine": doc.get("engine", ""),
            "content_preview": markdown[:500] if markdown else "",
            "content_length": len(markdown),
        })
    return cards


def _extract_key_findings(evidence_cards: list[dict]) -> list[dict]:
    """Extract key findings from high-credibility evidence cards."""
    findings = []
    for card in evidence_cards:
        if card.get("credibility_score", 0) < 0.5:
            continue
        preview = card.get("content_preview", "")
        if not preview:
            continue
        findings.append({
            "source": card["url"],
            "title": card.get("title", ""),
            "credibility": card["credibility_tier"],
            "finding": preview[:300],
        })
    return findings


def _identify_verification_needed(evidence_cards: list[dict]) -> list[dict]:
    """Flag sources that need manual verification."""
    items = []
    for card in evidence_cards:
        if card.get("credibility_score", 0) < 0.6:
            items.append({
                "url": card["url"],
                "title": card.get("title", ""),
                "reason": f"可信度 {card['credibility_tier']}，需交叉验证",
            })
    return items


def _generate_report_markdown(
    topic: str,
    sources: list[dict],
    evidence_cards: list[dict],
    key_findings: list[dict],
    verification_needed: list[dict],
    instruction: str = "",
) -> str:
    """Generate a full intelligence report in Markdown."""
    lines = []
    lines.append(f"# 情报编报：{topic}")
    lines.append(f"\n> 生成时间：{_now_str()}")
    if instruction:
        lines.append(f"> 指令：{instruction}")

    # Source table
    lines.append("\n## 信源列表\n")
    lines.append("| # | 来源 | 类型 | 可信度 | 引擎 |")
    lines.append("|---|------|------|--------|------|")
    for i, s in enumerate(sources, 1):
        title = (s.get("title", "") or "")[:40]
        url = s.get("url", "")
        cat = s.get("category", "unknown")
        tier = s.get("credibility_tier", "unknown")
        engine = s.get("engine", "")
        lines.append(f"| {i} | [{title}]({url}) | {cat} | {tier} | {engine} |")

    # Key findings
    if key_findings:
        lines.append("\n## 关键发现\n")
        for i, f in enumerate(key_findings, 1):
            lines.append(f"### 发现 {i}：{f['title'][:60]}")
            lines.append(f"- **来源**: {f['source']}")
            lines.append(f"- **可信度**: {f['credibility']}")
            lines.append(f"- **摘要**: {f['finding']}")
            lines.append("")

    # Evidence cards
    if evidence_cards:
        lines.append("\n## 证据卡片\n")
        for i, c in enumerate(evidence_cards, 1):
            lines.append(f"### 证据 {i}")
            lines.append(f"- **URL**: {c['url']}")
            lines.append(f"- **标题**: {c.get('title', 'N/A')}")
            lines.append(f"- **类型**: {c['category']} | **可信度**: {c['credibility_tier']}")
            lines.append(f"- **抓取引擎**: {c['engine']} | **内容长度**: {c['content_length']} 字符")
            if c.get("content_preview"):
                lines.append(f"- **内容预览**: {c['content_preview'][:200]}...")
            lines.append("")

    # Verification needed
    if verification_needed:
        lines.append("\n## 待核验信息\n")
        for v in verification_needed:
            lines.append(f"- [ ] [{v['title'][:50]}]({v['url']}) — {v['reason']}")
        lines.append("")

    lines.append("\n---\n*本报告由 Tavily + Exa + Firecrawl 三引擎情报系统自动生成*")
    return "\n".join(lines)


# ============================================================
# Public API: three pipeline modes
# ============================================================

def triad_search_sources(query: str, max_sources: int = 10) -> dict:
    """Search only — return ranked sources without scraping content.

    Uses Tavily (real-time) and Exa (semantic) in parallel.
    """
    if not query or not isinstance(query, str):
        return {"success": False, "mode": "triad_search_sources", "input": locals(),
                "data": None, "error": "query must be a non-empty string"}

    errors = []

    # Tavily search
    t_res = tavily_search(query, max_results=max_sources)
    t_data = t_res.get("data") if t_res.get("success") else None
    if not t_res.get("success"):
        errors.append(f"Tavily: {t_res.get('error', 'unknown')}")

    # Exa search
    e_res = exa_search(query, num_results=max_sources)
    e_data = e_res.get("data") if e_res.get("success") else None
    if not e_res.get("success"):
        errors.append(f"Exa: {e_res.get('error', 'unknown')}")

    if not t_data and not e_data:
        return {"success": False, "mode": "triad_search_sources",
                "input": {"query": query, "max_sources": max_sources},
                "data": None, "error": "Both engines failed: " + "; ".join(errors)}

    merged = _merge_sources(t_data, e_data)
    ranked = rank_sources(merged, max_sources=max_sources)

    return {
        "success": True,
        "mode": "triad_search_sources",
        "topic": query,
        "sources": ranked,
        "documents": [],
        "evidence_cards": [],
        "key_findings": [],
        "verification_needed": [],
        "report_markdown": "",
        "errors": errors,
    }


def triad_research_brief(
    query: str,
    max_sources: int = 8,
    instruction: str = "",
) -> dict:
    """Search + scrape top sources + extract key findings (brief format)."""
    if not query or not isinstance(query, str):
        return {"success": False, "mode": "triad_research_brief", "input": locals(),
                "data": None, "error": "query must be a non-empty string"}

    errors = []

    # Step 1: Search
    t_res = tavily_search(query, max_results=max_sources)
    t_data = t_res.get("data") if t_res.get("success") else None
    if not t_res.get("success"):
        errors.append(f"Tavily: {t_res.get('error', 'unknown')}")

    e_res = exa_search(query, num_results=max_sources)
    e_data = e_res.get("data") if e_res.get("success") else None
    if not e_res.get("success"):
        errors.append(f"Exa: {e_res.get('error', 'unknown')}")

    if not t_data and not e_data:
        return {"success": False, "mode": "triad_research_brief",
                "input": {"query": query, "max_sources": max_sources},
                "data": None, "error": "Both engines failed: " + "; ".join(errors)}

    merged = _merge_sources(t_data, e_data)
    ranked = rank_sources(merged, max_sources=max_sources)

    # Step 2: Scrape top sources (use high-credibility ones first)
    scrape_targets = filter_core_findings(ranked)[:max_sources]
    documents = []
    for src in scrape_targets:
        doc = _scrape_with_fallback(src["url"])
        doc["url"] = src["url"]  # ensure URL is set
        documents.append(doc)
        if len([d for d in documents if d.get("success")]) >= max_sources:
            break

    # Step 3: Build evidence cards and findings
    evidence_cards = _build_evidence_cards(documents, ranked)
    key_findings = _extract_key_findings(evidence_cards)
    verification_needed = _identify_verification_needed(evidence_cards)

    return {
        "success": True,
        "mode": "triad_research_brief",
        "topic": query,
        "sources": ranked,
        "documents": documents,
        "evidence_cards": evidence_cards,
        "key_findings": key_findings,
        "verification_needed": verification_needed,
        "report_markdown": "",
        "errors": errors,
    }


def triad_deep_report(
    query: str,
    max_sources: int = 12,
    instruction: str = "",
) -> dict:
    """Full pipeline: search + scrape + cross-verify + generate report Markdown."""
    if not query or not isinstance(query, str):
        return {"success": False, "mode": "triad_deep_report", "input": locals(),
                "data": None, "error": "query must be a non-empty string"}

    errors = []

    # Step 1: Search both engines
    t_res = tavily_search(query, max_results=max_sources)
    t_data = t_res.get("data") if t_res.get("success") else None
    if not t_res.get("success"):
        errors.append(f"Tavily: {t_res.get('error', 'unknown')}")

    e_res = exa_search(query, num_results=max_sources)
    e_data = e_res.get("data") if e_res.get("success") else None
    if not e_res.get("success"):
        errors.append(f"Exa: {e_res.get('error', 'unknown')}")

    if not t_data and not e_data:
        return {"success": False, "mode": "triad_deep_report",
                "input": {"query": query, "max_sources": max_sources},
                "data": None, "error": "Both engines failed: " + "; ".join(errors)}

    merged = _merge_sources(t_data, e_data)
    ranked = rank_sources(merged, max_sources=max_sources)

    # Step 2: Scrape all ranked sources with Firecrawl + Tavily fallback
    documents = []
    for src in ranked:
        doc = _scrape_with_fallback(src["url"])
        doc["url"] = src["url"]
        documents.append(doc)

    # Step 3: Build evidence, findings, verification
    evidence_cards = _build_evidence_cards(documents, ranked)
    key_findings = _extract_key_findings(evidence_cards)
    verification_needed = _identify_verification_needed(evidence_cards)

    # Step 4: Generate report
    report_md = _generate_report_markdown(
        query, ranked, evidence_cards, key_findings, verification_needed, instruction
    )

    return {
        "success": True,
        "mode": "triad_deep_report",
        "topic": query,
        "sources": ranked,
        "documents": documents,
        "evidence_cards": evidence_cards,
        "key_findings": key_findings,
        "verification_needed": verification_needed,
        "report_markdown": report_md,
        "errors": errors,
    }

#!/usr/bin/env python3
"""Harness CLI — deterministic execution engine for the research pipeline.

All search, fetch, retry, validation, and disk I/O goes through this harness.
Sub-agents call this CLI instead of directly invoking Tavily/Firecrawl/web_fetch.

Commands:
    plan      Generate research plan from topic + context
    search    Execute Tavily + Exa parallel search with retry
    fetch     Execute Firecrawl → web_fetch → snippet fetch chain with retry
    validate  Validate output against schema
    run       Full pipeline: search + fetch for a task group
    orchestrate  Plan, run groups in parallel, consolidate, and validate a job
    status    Show job status
    list      List recent jobs
"""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import contextlib
import io
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tavily_client import tavily_search, tavily_extract
from exa_client import exa_search
from firecrawl_client import scrape_url
from web_fetch_client import fetch_url
from source_ranker import rank_sources, filter_core_findings, classify_source, score_credibility
from job_manager import JobManager


def _ensure_utf8():
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")


def _print_json(data: dict, output: str = None):
    text = json.dumps(data, ensure_ascii=False, indent=2)
    if output:
        Path(output).parent.mkdir(parents=True, exist_ok=True)
        with open(output, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"[Saved to {output}]", file=sys.stderr)
    else:
        print(text)


def _now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _iso_now():
    return datetime.now().astimezone().isoformat()


def _write_json_file(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with open(temporary, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    temporary.replace(path)


class ProgressRecorder:
    """Append safe, structured progress without exposing queries, URLs, or keys."""

    def __init__(self, path: Path, job_id: str):
        self.path = path
        self.job_id = job_id
        self.sequence = 0
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text("", encoding="utf-8")

    def emit(self, phase: str, status: str, summary: str, **metrics):
        self.sequence += 1
        safe_metrics = {
            key: value for key, value in metrics.items()
            if isinstance(value, (int, float, bool)) or value is None
        }
        event = {
            "occurredAt": _iso_now(),
            "origin": "research_harness",
            "runEvent": "research.progress",
            "sequence": self.sequence,
            "phase": phase,
            "status": status,
            "summary": str(summary)[:220],
            "metrics": safe_metrics,
        }
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")


CONFIG = {
    "search": {"tavily_timeout": 25, "tavily_retries": 1, "tavily_retry_delay": 2,
               "exa_timeout": 25, "exa_retries": 0, "max_results_per_query": 5},
    "fetch": {"firecrawl_timeout": 12, "web_fetch_timeout": 10,
              "max_retries": 1, "retry_delay": 2},
    "limits": {"max_search_queries": 8, "max_fetch_urls": 8, "max_group_queries": 8},
}


def _search_single(query: str, max_results: int, params: dict = None) -> dict:
    cfg = CONFIG["search"]
    params = params or {}
    errors = []
    sources = []
    tavily_ok = False
    search_depth = params.get("search_depth", "basic")
    topic = params.get("topic", "general")
    for attempt in range(1 + cfg["tavily_retries"]):
        try:
            res = tavily_search(query, max_results=max_results, search_depth=search_depth, topic=topic)
            if res.get("success") and res.get("data", {}).get("results"):
                for r in res["data"]["results"]:
                    sources.append({"url": r.get("url", ""), "title": r.get("title", ""),
                                    "snippet": (r.get("content") or "")[:300], "engine": "tavily", "score": r.get("score", 0)})
                tavily_ok = True
                break
            else:
                errors.append(f"Tavily attempt {attempt+1}: {res.get('error', 'no results')}")
        except Exception as e:
            errors.append(f"Tavily attempt {attempt+1}: {type(e).__name__}: {e}")
        if attempt < cfg["tavily_retries"]:
            time.sleep(cfg["tavily_retry_delay"])
    exa_ok = False
    for attempt in range(1 + cfg["exa_retries"]):
        try:
            res = exa_search(query, num_results=min(max_results, 5))
            if res.get("success") and res.get("data", {}).get("results"):
                for r in res["data"]["results"]:
                    if isinstance(r, dict):
                        sources.append({"url": r.get("url", ""), "title": r.get("title", ""),
                                        "snippet": (r.get("summary") or "")[:300], "engine": "exa", "score": r.get("score", 0)})
                exa_ok = True
                break
        except Exception as e:
            errors.append(f"Exa attempt {attempt+1}: {type(e).__name__}: {e}")
        if attempt < cfg["exa_retries"]:
            time.sleep(cfg["tavily_retry_delay"])
    return {"query": query, "sources": sources, "tavily_ok": tavily_ok, "exa_ok": exa_ok, "errors": errors}


def cmd_search(args):
    queries = json.loads(args.queries)
    max_results = args.max or CONFIG["search"]["max_results_per_query"]
    params = json.loads(args.params) if args.params else {}
    results = []
    all_sources = []
    all_errors = []
    seen_urls = set()
    for query in queries[:CONFIG["limits"]["max_search_queries"]]:
        res = _search_single(query, max_results, params)
        results.append(res)
        for src in res["sources"]:
            norm = (src["url"] or "").lower().rstrip("/")
            if norm and norm not in seen_urls:
                seen_urls.add(norm)
                all_sources.append(src)
        all_errors.extend(res["errors"])
    ranked = rank_sources(all_sources, max_sources=len(all_sources))
    output = {"success": len(all_sources) > 0, "mode": "harness_search", "queries": queries,
              "total_queries": len(queries), "queries_ok": sum(1 for r in results if r["tavily_ok"] or r["exa_ok"]),
              "sources": ranked, "total_sources": len(ranked), "per_query": results,
              "errors": all_errors, "timestamp": _now()}
    _print_json(output, args.output)
    return output


def _fetch_single(url: str, timeout: int = None) -> dict:
    cfg = CONFIG["fetch"]
    timeout = timeout or cfg["firecrawl_timeout"]
    for attempt in range(1 + cfg["max_retries"]):
        try:
            fc = scrape_url(url, timeout=cfg["firecrawl_timeout"])
            if fc.get("success") and fc.get("data"):
                md = fc["data"].get("markdown", "")
                if md and len(md) > 100:
                    return {"url": url, "engine": "firecrawl", "content": md,
                            "content_length": len(md), "success": True, "error": None}
        except Exception:
            if attempt < cfg["max_retries"]:
                time.sleep(cfg["retry_delay"])
                continue
    for attempt in range(1 + cfg["max_retries"]):
        try:
            wf = fetch_url(url, timeout=cfg["web_fetch_timeout"])
            if wf.get("success") and len(wf.get("content", "")) > 100:
                return {"url": url, "engine": wf.get("engine", "web_fetch"), "content": wf["content"],
                        "content_length": len(wf["content"]), "success": True, "error": None}
        except Exception:
            if attempt < cfg["max_retries"]:
                time.sleep(cfg["retry_delay"])
                continue
    return {"url": url, "engine": None, "content": "", "content_length": 0,
            "success": False, "error": "Firecrawl and web_fetch both failed"}


def cmd_fetch(args):
    urls = json.loads(args.urls)
    timeout = args.timeout or CONFIG["fetch"]["firecrawl_timeout"]
    results = []
    for url in urls[:CONFIG["limits"]["max_fetch_urls"]]:
        results.append(_fetch_single(url, timeout))
    success_count = sum(1 for r in results if r["success"])
    engine_counts = {}
    for r in results:
        eng = r.get("engine") or "failed"
        engine_counts[eng] = engine_counts.get(eng, 0) + 1
    output = {"success": success_count > 0, "mode": "harness_fetch", "results": results,
              "total": len(results), "success_count": success_count,
              "engine_breakdown": engine_counts, "timestamp": _now()}
    _print_json(output, args.output)
    return output


SCHEMAS = {
    "research": {"required_top": ["task_id", "sources", "evidence_cards", "key_findings"],
                 "source_fields": ["url", "title", "engine", "score"],
                 "evidence_fields": ["url", "content_preview", "credibility_score"],
                 "finding_fields": ["source", "title", "finding"]},
    "group": {"required_top": ["task_id", "dimensions", "queries"]},
    "plan": {"required_top": ["topic", "report_type", "groups"]},
}


def cmd_validate(args):
    with open(args.input, "r", encoding="utf-8") as f:
        data = json.load(f)
    schema_name = args.schema or "research"
    schema = SCHEMAS.get(schema_name)
    if not schema:
        print(json.dumps({"valid": False, "error": f"Unknown schema: {schema_name}"}))
        sys.exit(1)
    errors = []
    for field in schema.get("required_top", []):
        if field not in data:
            errors.append(f"Missing required field: {field}")
    if "sources" in data and isinstance(data["sources"], list):
        for i, src in enumerate(data["sources"][:5]):
            for field in schema.get("source_fields", []):
                if field not in src:
                    errors.append(f"Source[{i}] missing field: {field}")
    if "evidence_cards" in data and isinstance(data["evidence_cards"], list):
        for i, ev in enumerate(data["evidence_cards"][:5]):
            for field in schema.get("evidence_fields", []):
                if field not in ev:
                    errors.append(f"Evidence[{i}] missing field: {field}")
    result = {"valid": len(errors) == 0, "schema": schema_name, "errors": errors}
    _print_json(result)
    if not result["valid"]:
        sys.exit(1)


DIMENSION_PRESETS = {
    "国家": {"search_depth": "advanced", "topic": "general"},
    "地方": {"search_depth": "basic", "topic": "news"},
    "政策": {"search_depth": "advanced", "topic": "general"},
    "社会": {"search_depth": "basic", "topic": "general"},
    "传播": {"search_depth": "basic", "topic": "news"},
}

DIMENSION_GROUPS = {"A": ["国家", "政策"], "B": ["地方", "社会"], "C": ["传播"]}


def _guess_dimension(label: str, section: str) -> str:
    text = f"{label} {section}"
    if re.search(r'国家|外交|国际|地缘|战略', text): return "国家"
    if re.search(r'地方|地区|当地|民意', text): return "地方"
    if re.search(r'政策|法规|法律|制度|制裁|关税|管制', text): return "政策"
    if re.search(r'社会|舆情|公众|舆论', text): return "社会"
    if re.search(r'媒体|传播|报道|叙事', text): return "传播"
    return "国家"


def _compact_group_queries(topic: str, selected_queries: list, group_subtasks: list, max_queries: int) -> list:
    """Keep each group bounded so agent runtime scales predictably."""
    selected = [q for q in selected_queries if q][:3]
    task_queries = []
    seen_labels = set()
    for st in group_subtasks:
        label = (st.get("label") or "").strip()
        if not label or label in seen_labels:
            continue
        seen_labels.add(label)
        task_queries.append(f"{topic} {label}")
        if len(task_queries) >= max(0, max_queries - len(selected)):
            break
    compacted = []
    seen = set()
    for query in selected + task_queries:
        normalized = re.sub(r"\s+", " ", query).strip()
        if normalized and normalized not in seen:
            seen.add(normalized)
            compacted.append(normalized)
        if len(compacted) >= max_queries:
            break
    return compacted


def cmd_plan(args):
    """Generate research plan with dimension-based grouping."""
    topic = args.topic
    report_type = args.type or "K报"
    job_id = getattr(args, 'job_id', None)

    # Create job directory if job_id provided
    if job_id:
        job = JobManager(topic=topic, report_type=report_type, job_id=job_id)
        job_dir = str(job.root)
    else:
        job_dir = None

    context = {}
    if args.context:
        with open(args.context, "r", encoding="utf-8") as f:
            context = json.load(f)

    queries = []
    if args.queries:
        queries = [q.strip() for q in args.queries.split(",") if q.strip()]
    elif context.get("selectedSearchQueries"):
        queries = context["selectedSearchQueries"]
    else:
        queries = [f"{topic} 2025最新动态", f"{topic} 关税 谈判进展",
                   f"{topic} 贸易数据 进出口", f"{topic} 政策法规 最新", f"{topic} 影响分析 风险"]

    modules = context.get("selectedModules", [])
    subtasks = []
    task_id = 0
    if modules:
        for mod in modules:
            section = mod.get("sectionTitle") or mod.get("sectionKey", "")
            for direction in mod.get("selectedDirections", []):
                direction = direction if isinstance(direction, dict) else {"label": str(direction)}
                task_id += 1
                dim = _guess_dimension(direction.get("label", ""), section)
                subtasks.append({"id": f"S-{task_id:03d}", "dimension": dim,
                                 "label": direction.get("label", ""), "detail": direction.get("detail", ""), "section": section})
    else:
        for dim in ["国家", "地方", "政策", "社会", "传播"]:
            task_id += 1
            subtasks.append({"id": f"S-{task_id:03d}", "dimension": dim,
                             "label": f"{topic} - {dim}", "detail": "", "section": dim})

    groups = {}
    active_gids = [gid for gid, dims in DIMENSION_GROUPS.items()
                   if any(s["dimension"] in dims for s in subtasks)]
    # Distribute selectedSearchQueries evenly across active groups
    queries_per_group = {}
    if active_gids and queries:
        chunk_size = max(1, len(queries) // len(active_gids))
        for i, gid in enumerate(active_gids):
            start = i * chunk_size
            # Last group gets the remainder
            if i == len(active_gids) - 1:
                queries_per_group[gid] = queries[start:]
            else:
                queries_per_group[gid] = queries[start:start + chunk_size]
    for gid, dims in DIMENSION_GROUPS.items():
        group_subtasks = [s for s in subtasks if s["dimension"] in dims]
        if group_subtasks:
            group_queries = _compact_group_queries(
                topic,
                queries_per_group.get(gid, []),
                group_subtasks,
                CONFIG["limits"]["max_group_queries"],
            )
            groups[gid] = {"task_id": f"group-{gid}", "dimensions": dims,
                           "queries": group_queries,
                           "subtasks": group_subtasks,
                           "max_sources_per_query": args.max_sources or 5,
                           "max_fetch_urls": min(args.max_fetch or 8, CONFIG["limits"]["max_fetch_urls"]),
                           "fetch_timeout": min(args.fetch_timeout or 15, CONFIG["fetch"]["firecrawl_timeout"])}

    assigned = set()
    for g in groups.values():
        for st in g["subtasks"]:
            assigned.add(st["id"])
    unassigned = [s for s in subtasks if s["id"] not in assigned]
    if unassigned and "A" in groups:
        groups["A"]["subtasks"].extend(unassigned)

    plan = {"topic": topic, "report_type": report_type, "total_queries": len(queries),
            "total_subtasks": len(subtasks), "groups": groups,
            "modules": [{"sectionTitle": m.get("sectionTitle"), "sectionKey": m.get("sectionKey"),
                         "directions": [{"id": d.get("id"), "label": d.get("label"), "detail": d.get("detail")}
                                        for raw in m.get("selectedDirections", [])
                                        for d in [raw if isinstance(raw, dict) else {"label": str(raw)}]]} for m in modules],
            "context": {"source_domains": context.get("selectedSources", [])},
            "job_id": job_id, "job_dir": job_dir, "timestamp": _now()}

    if not getattr(args, "silent", False):
        _print_json(plan, args.output)

    # Auto-save plan to job directory
    if job_id and job_dir:
        plan_path = Path(job_dir) / "plan.json"
        if not str(plan_path) == str(args.output or ""):
            if getattr(args, "silent", False):
                _write_json_file(plan_path, plan)
            else:
                _print_json(plan, str(plan_path))

    return plan


def cmd_run(args):
    """Full pipeline: search + fetch + evidence for a task group."""
    with open(args.task, "r", encoding="utf-8") as f:
        task = json.load(f)
    job_id = args.job_id
    group_id = task.get("task_id", "unknown").replace("group-", "")
    queries = task.get("queries", [])
    max_src = task.get("max_sources_per_query", 5)
    max_fetch = task.get("max_fetch_urls", 8)
    fetch_timeout = task.get("fetch_timeout", 15)
    dims = task.get("dimensions", [])
    dim_params = {}
    for d in dims:
        if d in DIMENSION_PRESETS:
            dim_params = DIMENSION_PRESETS[d]
    params = {**dim_params}
    if not getattr(args, "silent", False):
        print(f"[harness] Group {group_id}: {len(queries)} queries, max_fetch={max_fetch}", file=sys.stderr)

    # Step 1: Search
    search_args = argparse.Namespace(queries=json.dumps(queries), max=max_src,
                                     params=json.dumps(params), output=None)
    with contextlib.redirect_stdout(io.StringIO()):
        search_result = cmd_search(search_args)

    # Step 2: Fetch top URLs
    top_urls = [s["url"] for s in search_result.get("sources", []) if s.get("url")]
    fetch_urls = top_urls[:max_fetch]
    fetch_result = {"results": [], "success_count": 0, "engine_breakdown": {}}
    if fetch_urls:
        fetch_args = argparse.Namespace(urls=json.dumps(fetch_urls), timeout=fetch_timeout, output=None)
        with contextlib.redirect_stdout(io.StringIO()):
            fetch_result = cmd_fetch(fetch_args)

    # Step 3: Build evidence with snippet fallback
    source_map = {s["url"]: s for s in search_result.get("sources", [])}
    documents = []
    for fr in fetch_result.get("results", []):
        url = fr["url"]
        src = source_map.get(url, {})
        if fr["success"] and len(fr.get("content", "")) > 100:
            documents.append({"url": url, "engine": fr["engine"], "markdown": fr["content"],
                              "title": src.get("title", ""), "success": True, "error": None})
        else:
            snippet = src.get("snippet", "")
            if snippet and len(snippet) > 50:
                documents.append({"url": url, "engine": "snippet_fallback", "markdown": snippet,
                                  "title": src.get("title", ""), "success": True, "error": fr.get("error")})
            else:
                documents.append({"url": url, "engine": None, "markdown": "", "title": src.get("title", ""),
                                  "success": False, "error": fr.get("error")})

    # Step 4: Build evidence cards
    evidence_cards = []
    for doc in documents:
        if not doc["success"]:
            continue
        src = source_map.get(doc["url"], {})
        cred = score_credibility(doc["url"])
        evidence_cards.append({"url": doc["url"], "title": doc.get("title") or src.get("title", ""),
                               "category": classify_source(doc["url"]), "credibility_score": cred["score"],
                               "credibility_tier": cred["tier"], "engine": doc["engine"],
                               "content_preview": (doc["markdown"] or "")[:500],
                               "content_length": len(doc.get("markdown", ""))})

    # Step 5: Key findings
    key_findings = [{"source": c["url"], "title": c["title"], "credibility": c["credibility_tier"],
                     "finding": c["content_preview"][:300]} for c in evidence_cards if c["credibility_score"] >= 0.5]

    # Step 6: Verification needed
    verification_needed = [{"url": c["url"], "title": c["title"],
                            "reason": f"可信度 {c['credibility_tier']}，需交叉验证"} for c in evidence_cards if c["credibility_score"] < 0.6]

    # Step 7: Gaps
    gaps = []
    for st in task.get("subtasks", []):
        label = st.get("label", "")
        has_evidence = any(label in (c.get("content_preview", "") + c.get("title", "")) for c in evidence_cards)
        if not has_evidence and label:
            gaps.append({"dimension": st.get("dimension", ""), "topic": label, "reason": "未找到直接相关证据"})

    compact_documents = []
    for doc in documents:
        markdown = doc.get("markdown", "") or ""
        compact_documents.append({
            "url": doc.get("url", ""), "engine": doc.get("engine"),
            "title": doc.get("title", ""), "success": bool(doc.get("success")),
            "error": doc.get("error"), "content_preview": markdown[:240],
            "content_length": len(markdown),
        })

    research = {
        "task_id": task.get("task_id"), "dimensions": dims, "status": "completed",
        "sources": search_result.get("sources", []), "evidence_cards": evidence_cards,
        "key_findings": key_findings, "verification_needed": verification_needed, "gaps": gaps,
        "documents": compact_documents,
        "stats": {"queries_executed": len(queries), "queries_ok": search_result.get("queries_ok", 0),
                  "sources_found": len(search_result.get("sources", [])),
                  "pages_fetched": fetch_result.get("success_count", 0),
                  "fetch_engine_breakdown": fetch_result.get("engine_breakdown", {}),
                  "evidence_cards": len(evidence_cards), "key_findings": len(key_findings), "gaps": len(gaps)},
        "errors": search_result.get("errors", []), "timestamp": _now(),
    }

    if job_id:
        try:
            job = JobManager.load(job_id)
            job.save_research(group_id, research)
            if not getattr(args, "silent", False):
                print(f"[harness] Saved research to {job.research_path(group_id)}", file=sys.stderr)
        except Exception as e:
            if not getattr(args, "silent", False):
                print(f"[harness] Warning: could not save to job: {e}", file=sys.stderr)

    if not getattr(args, "silent", False):
        _print_json(research, args.output)
    return research


def _dedupe_records(records: list, keys: tuple) -> list:
    output = []
    seen = set()
    for record in records:
        if not isinstance(record, dict):
            continue
        identity = tuple(str(record.get(key, "")).strip().lower().rstrip("/") for key in keys)
        if not any(identity) or identity in seen:
            continue
        seen.add(identity)
        output.append(record)
    return output


def _merge_research(job_id: str, results: list, errors: list) -> dict:
    sources = _dedupe_records(
        [item for result in results for item in result.get("sources", [])],
        ("url",),
    )
    evidence_cards = _dedupe_records(
        [item for result in results for item in result.get("evidence_cards", [])],
        ("url",),
    )
    key_findings = _dedupe_records(
        [item for result in results for item in result.get("key_findings", [])],
        ("source", "finding"),
    )
    verification_needed = _dedupe_records(
        [item for result in results for item in result.get("verification_needed", [])],
        ("url", "reason"),
    )
    gaps = _dedupe_records(
        [item for result in results for item in result.get("gaps", [])],
        ("dimension", "topic"),
    )
    documents = _dedupe_records(
        [item for result in results for item in result.get("documents", [])],
        ("url",),
    )
    return {
        "schema_version": 1,
        "job_id": job_id,
        "status": "completed" if results and not errors else "partial" if results else "failed",
        "sources": sources,
        "evidence_cards": evidence_cards,
        "key_findings": key_findings,
        "verification_needed": verification_needed,
        "gaps": gaps,
        "documents": documents,
        "groups": [result.get("task_id", "") for result in results],
        "errors": [str(error)[:300] for error in errors],
        "stats": {
            "groups_completed": len(results),
            "groups_failed": len(errors),
            "sources_found": len(sources),
            "evidence_cards": len(evidence_cards),
            "key_findings": len(key_findings),
            "gaps": len(gaps),
        },
        "timestamp": _iso_now(),
    }


def _compact_record(record: dict, fields: dict) -> dict:
    compact = {}
    for key, limit in fields.items():
        value = record.get(key)
        if value is None or value == "":
            continue
        compact[key] = value[:limit] if isinstance(value, str) else value
    return compact


def _load_json_list(path: Path) -> list:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        if isinstance(data, dict):
            for key in ("sources", "acceptedSources", "accepted_sources"):
                if isinstance(data.get(key), list):
                    return [item for item in data[key] if isinstance(item, dict)]
    except (OSError, json.JSONDecodeError):
        pass
    return []


def _build_synthesis_packet(job: JobManager, context: dict, consolidated: dict, max_bytes: int) -> dict:
    database_sources = _load_json_list(job.root / "database" / "database_sources.json")
    packet = {
        "schema_version": 1,
        "job_id": job.job_id,
        "topic": str(context.get("topic") or job.topic)[:500],
        "report_type": str(context.get("report_type") or context.get("reportType") or job.report_type)[:80],
        "selectedModules": context.get("selectedModules", [])[:20] if isinstance(context.get("selectedModules"), list) else [],
        "parameterValues": context.get("parameterValues", {}) if isinstance(context.get("parameterValues"), dict) else {},
        "supplement": str(context.get("supplement") or context.get("freeTextContext") or "")[:3000],
        "database_sources": [
            _compact_record(item, {
                "title": 300, "ch_title": 300, "url": 1000, "data_source_url": 1000,
                "summary": 1000, "website_name": 200, "publish_time": 80,
            }) for item in database_sources[:40]
        ],
        "sources": [
            _compact_record(item, {"url": 1000, "title": 300, "snippet": 600, "engine": 40, "score": 40})
            for item in consolidated.get("sources", [])[:60]
        ],
        "evidence_cards": [
            _compact_record(item, {
                "url": 1000, "title": 300, "category": 80, "credibility_score": 40,
                "credibility_tier": 80, "engine": 40, "content_preview": 900,
            }) for item in consolidated.get("evidence_cards", [])[:50]
        ],
        "key_findings": [
            _compact_record(item, {"source": 1000, "title": 300, "credibility": 80, "finding": 800})
            for item in consolidated.get("key_findings", [])[:60]
        ],
        "verification_needed": consolidated.get("verification_needed", [])[:30],
        "gaps": consolidated.get("gaps", [])[:30],
        "stats": consolidated.get("stats", {}),
        "generated_at": _iso_now(),
    }

    bounded_lists = ["sources", "evidence_cards", "key_findings", "database_sources", "verification_needed", "gaps"]
    while len(json.dumps(packet, ensure_ascii=False).encode("utf-8")) > max_bytes:
        candidates = [key for key in bounded_lists if packet.get(key)]
        if not candidates:
            break
        largest = max(candidates, key=lambda key: len(json.dumps(packet[key], ensure_ascii=False)))
        packet[largest].pop()
    if len(json.dumps(packet, ensure_ascii=False).encode("utf-8")) > max_bytes:
        packet["supplement"] = str(packet.get("supplement", ""))[:500]
        packet["selectedModules"] = []
        packet["parameterValues"] = {}
    return packet


def cmd_orchestrate(args):
    started_at = time.monotonic()
    job_id = args.job_id
    try:
        job = JobManager.load(job_id)
    except FileNotFoundError:
        root = JobManager(topic="", report_type="K报", job_id=job_id).root
        context_path = root / "context.json"
        context = json.loads(context_path.read_text(encoding="utf-8")) if context_path.exists() else {}
        job = JobManager(
            topic=str(context.get("topic") or ""),
            report_type=str(context.get("report_type") or context.get("reportType") or "K报"),
            job_id=job_id,
        )

    context_path = job.root / "context.json"
    if not context_path.exists():
        raise FileNotFoundError(f"Missing backend-prepared context.json for job {job_id}")
    context = json.loads(context_path.read_text(encoding="utf-8"))
    topic = str(context.get("topic") or job.topic).strip()
    report_type = str(context.get("report_type") or context.get("reportType") or job.report_type).strip()
    if not topic:
        raise ValueError("context.json does not contain a report topic")
    job._update_meta(topic=topic, report_type=report_type)

    progress = ProgressRecorder(job.root / "research" / "progress.jsonl", job_id)
    progress.emit("research_harness_start", "started", "资料深度采集编排已启动。")
    plan_args = argparse.Namespace(
        topic=topic, type=report_type, context=str(context_path), queries=None,
        job_id=job_id, max_sources=5, max_fetch=8, fetch_timeout=12,
        output=None, silent=True,
    )
    plan = cmd_plan(plan_args)
    job.save_plan(plan)
    groups = plan.get("groups", {})
    if not groups:
        raise ValueError("Research plan did not produce any active groups")
    for group_id, group in groups.items():
        job.save_group(group_id, group)
    progress.emit("research_planning", "completed", "调研计划与分组已生成。", groups=len(groups))

    results = []
    errors = []
    max_workers = max(1, min(int(args.max_parallel or 3), 3, len(groups)))
    progress.emit("research_groups", "started", "调研分组开始并行采集。", groups=len(groups), parallelism=max_workers)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(cmd_run, argparse.Namespace(
                task=str(job.group_path(group_id)), job_id=job_id, output=None, silent=True,
            )): group_id
            for group_id in groups
        }
        for future in as_completed(futures):
            group_id = futures[future]
            try:
                result = future.result()
                results.append(result)
                stats = result.get("stats", {})
                progress.emit(
                    "research_group", "completed", f"调研分组 {group_id} 已完成。",
                    sources=int(stats.get("sources_found", 0)),
                    evidence=int(stats.get("evidence_cards", 0)),
                )
            except Exception as error:
                errors.append(f"group {group_id}: {type(error).__name__}: {error}")
                progress.emit("research_group", "failed", f"调研分组 {group_id} 执行失败。")

    consolidated = _merge_research(job_id, results, errors)
    needs_gap_supplement = bool(consolidated["gaps"]) and (
        len(consolidated["sources"]) < 8 or len(consolidated["key_findings"]) < 5
    )
    if needs_gap_supplement:
        gap_queries = [
            f"{topic} {str(gap.get('topic') or gap.get('dimension') or '').strip()}".strip()
            for gap in consolidated["gaps"][:3]
        ]
        gap_task = {
            "task_id": "group-gap",
            "dimensions": ["补缺"],
            "queries": list(dict.fromkeys(gap_queries)),
            "subtasks": consolidated["gaps"][:3],
            "max_sources_per_query": 5,
            "max_fetch_urls": 6,
            "fetch_timeout": 12,
        }
        job.save_group("gap", gap_task)
        progress.emit("research_gap_supplement", "started", "一次性信息缺口补充已启动。", queries=len(gap_task["queries"]))
        try:
            results.append(cmd_run(argparse.Namespace(
                task=str(job.group_path("gap")), job_id=job_id, output=None, silent=True,
            )))
            progress.emit("research_gap_supplement", "completed", "一次性信息缺口补充已完成。")
        except Exception as error:
            errors.append(f"gap supplement: {type(error).__name__}: {error}")
            progress.emit("research_gap_supplement", "failed", "一次性信息缺口补充未完成，保留原信息缺口。")
        consolidated = _merge_research(job_id, results, errors)

    consolidated_path = job.root / "research" / "consolidated.json"
    synthesis_path = job.root / "research" / "synthesis_packet.json"
    _write_json_file(consolidated_path, consolidated)
    packet = _build_synthesis_packet(job, context, consolidated, max(16384, min(int(args.max_packet_bytes), 98304)))
    _write_json_file(synthesis_path, packet)

    research_files = sorted(job.root.joinpath("research").glob("research_*.json"))
    required_ok = job.plan_path.exists() and bool(research_files) and consolidated_path.exists() and synthesis_path.exists()
    sources_found = int(consolidated.get("stats", {}).get("sources_found", 0))
    if not required_ok or not results or sources_found <= 0:
        progress.emit("research_harness_done", "failed", "资料深度采集未形成可用证据包。", sources=sources_found)
        raise RuntimeError("Research orchestration completed without usable evidence artifacts")

    duration_ms = round((time.monotonic() - started_at) * 1000)
    job._update_meta(status="researched", research_groups=len(results), research_duration_ms=duration_ms)
    progress.emit(
        "research_harness_done", "completed", "资料深度采集、整合与校验已完成。",
        groups=len(results), sources=sources_found,
        evidence=len(consolidated.get("evidence_cards", [])), durationMs=duration_ms,
    )
    output = {
        "success": True,
        "job_id": job_id,
        "status": consolidated["status"],
        "groups_completed": len(results),
        "groups_failed": len(errors),
        "sources_found": sources_found,
        "evidence_cards": len(consolidated.get("evidence_cards", [])),
        "gaps": len(consolidated.get("gaps", [])),
        "duration_ms": duration_ms,
        "artifacts": ["plan.json", "research/research_*.json", "research/consolidated.json", "research/synthesis_packet.json"],
    }
    _print_json(output, args.output)
    return output


def cmd_status(args):
    job = JobManager.load(args.job_id)
    _print_json(job.load_meta())


def cmd_list(args):
    status = args.status if hasattr(args, "status") else None
    jobs = JobManager.list_jobs(status=status)
    _print_json({"jobs": jobs, "total": len(jobs)})


def main():
    _ensure_utf8()
    parser = argparse.ArgumentParser(prog="harness", description="Research pipeline harness")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("plan", help="Generate research plan")
    p.add_argument("--topic", required=True)
    p.add_argument("--type", default="K报")
    p.add_argument("--context", help="known_context JSON path")
    p.add_argument("--queries", help="Comma-separated queries override")
    p.add_argument("--job-id", help="Job ID from backend (UUID). If omitted, generates new.")
    p.add_argument("--max-sources", type=int, default=5)
    p.add_argument("--max-fetch", type=int, default=8)
    p.add_argument("--fetch-timeout", type=int, default=15)
    p.add_argument("--output", "-o")

    p = sub.add_parser("search", help="Execute parallel search")
    p.add_argument("--queries", required=True, help="JSON array of queries")
    p.add_argument("--max", type=int, default=5)
    p.add_argument("--params", help="JSON params dict")
    p.add_argument("--output", "-o")

    p = sub.add_parser("fetch", help="Execute fetch chain")
    p.add_argument("--urls", required=True, help="JSON array of URLs")
    p.add_argument("--timeout", type=int, default=15)
    p.add_argument("--output", "-o")

    p = sub.add_parser("validate", help="Validate output against schema")
    p.add_argument("--input", required=True)
    p.add_argument("--schema", default="research", choices=["research", "group", "plan"])

    p = sub.add_parser("run", help="Full pipeline for a task group")
    p.add_argument("--task", required=True, help="Task group JSON path")
    p.add_argument("--job-id", help="Job ID for structured storage")
    p.add_argument("--output", "-o")

    p = sub.add_parser("orchestrate", help="Run the deterministic research workflow for one job")
    p.add_argument("--job-id", required=True)
    p.add_argument("--max-parallel", type=int, default=3)
    p.add_argument("--max-packet-bytes", type=int, default=98304)
    p.add_argument("--output", "-o")

    p = sub.add_parser("status", help="Show job status")
    p.add_argument("--job-id", required=True)

    p = sub.add_parser("list", help="List recent jobs")
    p.add_argument("--status", help="Filter by status")

    args = parser.parse_args()
    dispatch = {"plan": cmd_plan, "search": cmd_search, "fetch": cmd_fetch,
                "validate": cmd_validate, "run": cmd_run, "orchestrate": cmd_orchestrate,
                "status": cmd_status, "list": cmd_list}
    try:
        dispatch[args.command](args)
    except Exception as e:
        _print_json({"success": False, "command": args.command, "error": str(e)})
        sys.exit(1)


if __name__ == "__main__":
    main()

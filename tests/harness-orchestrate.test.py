import argparse
import contextlib
import io
import json
import sys
import tempfile
import threading
import time
import types
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "firecrawl" / "web-research-firecrawl" / "scripts"
sys.path.insert(0, str(SCRIPTS))

for module_name, functions in {
    "tavily_client": {"tavily_search": None, "tavily_extract": None},
    "exa_client": {"exa_search": None},
    "firecrawl_client": {"scrape_url": None},
    "web_fetch_client": {"fetch_url": None},
}.items():
    module = types.ModuleType(module_name)
    for function_name in functions:
        setattr(module, function_name, lambda *args, **kwargs: {"success": False, "error": "stubbed"})
    sys.modules[module_name] = module

import harness_cli
import job_manager


def main():
    with tempfile.TemporaryDirectory(prefix="hermes-harness-") as temporary:
        job_manager.RUNS_ROOT = Path(temporary)
        job = job_manager.JobManager("并行调研测试", "K报", "job-orchestrate-test")
        context = {
            "topic": "并行调研测试",
            "report_type": "K报",
            "selectedSearchQueries": ["测试政策", "测试舆情", "测试地方"],
            "selectedModules": [
                {"sectionTitle": "国家政策", "selectedDirections": [{"label": "国家战略"}]},
                {"sectionTitle": "地方动态", "selectedDirections": [{"label": "地方反应"}]},
                {"sectionTitle": "传播态势", "selectedDirections": [{"label": "媒体传播"}]},
            ],
        }
        job.root.joinpath("context.json").write_text(json.dumps(context, ensure_ascii=False), encoding="utf-8")

        lock = threading.Lock()
        active = 0
        max_active = 0
        original_run = harness_cli.cmd_run

        def fake_run(args):
            nonlocal active, max_active
            task = json.loads(Path(args.task).read_text(encoding="utf-8"))
            group_id = task["task_id"].replace("group-", "")
            with lock:
                active += 1
                max_active = max(max_active, active)
            time.sleep(0.05)
            result = {
                "task_id": task["task_id"],
                "sources": [
                    {"url": f"https://example.com/{group_id}/{index}", "title": f"来源 {group_id}-{index}", "engine": "test", "score": 1}
                    for index in range(3)
                ],
                "evidence_cards": [
                    {"url": f"https://example.com/{group_id}/{index}", "title": f"证据 {group_id}-{index}", "content_preview": "有效证据", "credibility_score": 0.9}
                    for index in range(3)
                ],
                "key_findings": [
                    {"source": f"https://example.com/{group_id}/{index}", "title": "发现", "finding": f"事实 {group_id}-{index}"}
                    for index in range(2)
                ],
                "verification_needed": [],
                "gaps": [],
                "documents": [],
                "stats": {"sources_found": 3, "evidence_cards": 3},
            }
            job_manager.JobManager.load(args.job_id).save_research(group_id, result)
            with lock:
                active -= 1
            return result

        harness_cli.cmd_run = fake_run
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                result = harness_cli.cmd_orchestrate(argparse.Namespace(
                    job_id=job.job_id,
                    max_parallel=3,
                    max_packet_bytes=98304,
                    output=None,
                ))
        finally:
            harness_cli.cmd_run = original_run

        assert result["success"] is True
        assert result["groups_completed"] == 3
        assert max_active >= 2
        assert job.root.joinpath("plan.json").exists()
        assert len(list(job.root.joinpath("groups").glob("group_*.json"))) == 3
        assert len(list(job.root.joinpath("research").glob("research_*.json"))) == 3
        consolidated = json.loads(job.root.joinpath("research", "consolidated.json").read_text(encoding="utf-8"))
        assert consolidated["stats"]["sources_found"] == 9
        packet_path = job.root.joinpath("research", "synthesis_packet.json")
        assert packet_path.stat().st_size <= 98304
        progress = [json.loads(line) for line in job.root.joinpath("research", "progress.jsonl").read_text(encoding="utf-8").splitlines()]
        assert progress
        assert all(event["origin"] == "research_harness" for event in progress)
        assert progress[-1]["phase"] == "research_harness_done"
        assert progress[-1]["status"] == "completed"


if __name__ == "__main__":
    main()
    print("harness orchestrate tests passed")

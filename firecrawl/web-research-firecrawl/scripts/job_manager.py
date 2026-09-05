#!/usr/bin/env python3
"""Job Manager — structured job directory management for report pipeline.

Each job gets a unique directory under reports/{job_id}/ with subdirectories
for groups, research, evidence, and final output. Supports concurrent jobs
and preserves full audit trail.
"""

import json
import os
import time
import hashlib
from datetime import datetime
from pathlib import Path
from typing import Optional

RUNS_ROOT = Path(__file__).resolve().parent.parent.parent.parent / "reports"


def _generate_job_id() -> str:
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    rand = hashlib.md5(f"{time.time_ns()}".encode()).hexdigest()[:6]
    return f"{ts}-{rand}"


def _ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def _write_json(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _read_json(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_text(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def _read_text(path: Path) -> Optional[str]:
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


class JobManager:
    """Manages a single report job's directory structure and lifecycle."""

    def __init__(self, topic: str, report_type: str = "K报", job_id: str = None, update_latest: bool = True):
        self.job_id = job_id or _generate_job_id()
        self.root = RUNS_ROOT / self.job_id
        self.topic = topic
        self.report_type = report_type

        for subdir in ["groups", "research", "evidence", "final", "cache"]:
            _ensure_dir(self.root / subdir)

        self._meta_path = self.root / "job.json"
        if not self._meta_path.exists():
            self._write_meta(status="created")

        if update_latest:
            latest_link = RUNS_ROOT / "latest"
            if latest_link.exists() or latest_link.is_symlink():
                latest_link.unlink()
            latest_link.symlink_to(self.root)

    def _write_meta(self, status: str, error: str = None):
        meta = {
            "job_id": self.job_id,
            "topic": self.topic,
            "report_type": self.report_type,
            "status": status,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
        }
        if error:
            meta["error"] = error
        _write_json(self._meta_path, meta)

    def _update_meta(self, **kwargs):
        meta = _read_json(self._meta_path) or {}
        meta.update(kwargs)
        meta["updated_at"] = datetime.now().isoformat()
        _write_json(self._meta_path, meta)

    @property
    def plan_path(self) -> Path:
        return self.root / "plan.json"

    def group_path(self, group_id: str) -> Path:
        return self.root / "groups" / f"group_{group_id}.json"

    def research_path(self, group_id: str) -> Path:
        return self.root / "research" / f"research_{group_id}.json"

    def evidence_path(self, group_id: str) -> Path:
        return self.root / "evidence" / f"evidence_{group_id}.json"

    def supplementary_path(self, group_id: str, round_num: int) -> Path:
        return self.root / "evidence" / f"supp_{group_id}_{round_num}.json"

    @property
    def final_path(self) -> Path:
        return self.root / "final" / "report.md"

    @property
    def summary_path(self) -> Path:
        return self.root / "final" / "summary.json"

    @property
    def cache_dir(self) -> Path:
        return self.root / "cache"

    def save_plan(self, plan: dict):
        _write_json(self.plan_path, plan)
        self._update_meta(status="planned", groups=len(plan.get("groups", [])))

    def save_group(self, group_id: str, group: dict):
        _write_json(self.group_path(group_id), group)

    def save_research(self, group_id: str, research: dict):
        _write_json(self.research_path(group_id), research)

    def save_evidence(self, group_id: str, evidence: dict):
        _write_json(self.evidence_path(group_id), evidence)

    def save_supplementary(self, group_id: str, round_num: int, data: dict):
        _write_json(self.supplementary_path(group_id, round_num), data)

    def save_final(self, report_md: str, summary: dict):
        _write_text(self.final_path, report_md)
        _write_json(self.summary_path, summary)
        self._update_meta(status="completed")

    def mark_failed(self, error: str):
        self._update_meta(status="failed", error=error)

    def load_plan(self) -> Optional[dict]:
        return _read_json(self.plan_path)

    def load_group(self, group_id: str) -> Optional[dict]:
        return _read_json(self.group_path(group_id))

    def load_research(self, group_id: str) -> Optional[dict]:
        return _read_json(self.research_path(group_id))

    def load_evidence(self, group_id: str) -> Optional[dict]:
        return _read_json(self.evidence_path(group_id))

    def load_final_report(self) -> Optional[str]:
        return _read_text(self.final_path)

    def load_final_summary(self) -> Optional[dict]:
        return _read_json(self.summary_path)

    def load_meta(self) -> Optional[dict]:
        return _read_json(self._meta_path)

    def load_all_research(self) -> list[dict]:
        results = []
        research_dir = self.root / "research"
        if research_dir.exists():
            for f in sorted(research_dir.glob("research_*.json")):
                data = _read_json(f)
                if data:
                    results.append(data)
        return results

    def load_all_evidence(self) -> list[dict]:
        results = []
        evidence_dir = self.root / "evidence"
        if evidence_dir.exists():
            for f in sorted(evidence_dir.glob("*.json")):
                data = _read_json(f)
                if data:
                    results.append(data)
        return results

    @classmethod
    def load(cls, job_id: str) -> "JobManager":
        root = RUNS_ROOT / job_id
        meta_path = root / "job.json"
        if not meta_path.exists():
            raise FileNotFoundError(f"Job not found: {job_id}")
        meta = _read_json(meta_path)
        return cls(topic=meta["topic"], report_type=meta.get("report_type", "K报"), job_id=job_id, update_latest=False)

    @classmethod
    def load_latest(cls) -> "JobManager":
        latest = RUNS_ROOT / "latest"
        if not latest.exists():
            raise FileNotFoundError("No jobs found")
        return cls.load(latest.name)

    @classmethod
    def list_jobs(cls, status: str = None, limit: int = 20) -> list[dict]:
        if not RUNS_ROOT.exists():
            return []
        jobs = []
        for d in sorted(RUNS_ROOT.iterdir(), reverse=True):
            if not d.is_dir() or d.name == "latest":
                continue
            meta_path = d / "job.json"
            if meta_path.exists():
                meta = _read_json(meta_path)
                if status is None or meta.get("status") == status:
                    jobs.append(meta)
                if len(jobs) >= limit:
                    break
        return jobs

    def __repr__(self):
        return f"JobManager(id={self.job_id}, topic={self.topic!r}, status={self.load_meta().get('status', '?')})"

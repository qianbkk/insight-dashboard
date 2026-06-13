"""
Worker functions: each one runs a fetcher, writes the latest cache, and persists
a snapshot. All five run in background threads.
"""
import os
import json
import logging
import threading
from datetime import datetime
from typing import Dict, Optional

from registry import TOOLS, call_fetcher

log = logging.getLogger('insight.tasks')

# In-memory task state, keyed by tool id (matches frontend).
_TASK_STATE: Dict[str, Dict] = {
    k: {'status': 'idle', 'started_at': None, 'finished_at': None, 'error': None}
    for k in TOOLS
}
_STATE_LOCK = threading.Lock()


def now_iso() -> str:
    return datetime.utcnow().isoformat() + 'Z'


def get_state() -> Dict[str, Dict]:
    with _STATE_LOCK:
        # Return a snapshot to avoid accidental mutation
        return {k: dict(v) for k, v in _TASK_STATE.items()}


def set_state(tool: str, **kwargs) -> None:
    with _STATE_LOCK:
        _TASK_STATE[tool].update(kwargs)


def save_snapshot(data_dir: str, tool: str, payload: Dict) -> None:
    """Best-effort snapshot save. Never raises."""
    from history_store import save_snapshot as _save
    try:
        path = _save(data_dir, tool, payload)
        log.info(f"snapshot saved: {tool} -> {os.path.basename(os.path.dirname(path))}/{os.path.basename(path)}")
    except Exception as exc:
        log.warning(f"snapshot save failed for {tool}: {exc}")


def _read_latest_data(data_dir: str, tool: str) -> Optional[Dict]:
    """Read the just-written latest cache file (for snapshot enrichment)."""
    path = os.path.join(data_dir, TOOLS[tool]['cache_file'])
    if not os.path.exists(path):
        return None
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def _attach_github_history(data_dir: str, report: Dict) -> Dict:
    """Attach sparkline data points to github (velocity) report."""
    from github_history import update_history
    history_dir = os.path.join(data_dir, 'github_history')
    update_history(report, history_dir)
    # Re-read to attach star_history
    def load(full_name: str):
        path = os.path.join(history_dir, f"{full_name.replace('/', '__')}.jsonl")
        if not os.path.exists(path):
            return []
        pts = []
        try:
            with open(path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    pts.append(json.loads(line))
        except Exception:
            return []
        return pts

    def attach(items):
        for r in (items or []):
            hist = load(r.get('full_name', ''))
            if hist:
                r['star_history'] = [h.get('stars', 0) for h in hist[-14:]]
        return items

    if 'composite_top' in report:
        report['composite_top'] = attach(report['composite_top'])
    for sec, data in report.get('sections', {}).items():
        data['repos'] = attach(data.get('repos', []))
    return report


def run(tool: str, data_dir: str, extra_kwargs: Optional[Dict] = None) -> None:
    """Run the tool's fetcher, save cache, snapshot, update state."""
    set_state(tool, status='running', started_at=now_iso(), finished_at=None, error=None)
    try:
        cache_file = TOOLS[tool]['cache_file']
        if '{date}' in cache_file:
            cache_file = cache_file.format(date=datetime.utcnow().strftime('%Y-%m-%d'))
        cache_path = os.path.join(data_dir, cache_file)

        # Each fetcher has its own kwargs
        kwargs = extra_kwargs or {}
        if tool in ('pulse', 'lab'):
            kwargs['out'] = cache_path
        if tool == 'pulse':
            kwargs['top_n'] = kwargs.get('top_n', 60)
        if tool == 'lab':
            kwargs['max_results'] = kwargs.get('max_results', 40)

        # For tools that don't use 'out' kwarg (e.g. digest), pass directly
        if tool == 'digest':
            report = call_fetcher(tool, out=cache_path)
        else:
            report = call_fetcher(tool, **kwargs)

        # Enrich velocity with star history sparklines
        if tool == 'velocity':
            report = _attach_github_history(data_dir, report)

        # Write/refresh the latest cache from the actual report (some fetchers
        # already save themselves, but we want a canonical single file per tool).
        if tool != 'digest':
            try:
                with open(cache_path, 'w', encoding='utf-8') as f:
                    json.dump(report, f, ensure_ascii=False, indent=2)
            except Exception as exc:
                log.warning(f"could not re-write canonical cache for {tool}: {exc}")

        save_snapshot(data_dir, tool, report)
        set_state(tool, status='success', finished_at=now_iso(), error=None)
    except Exception as exc:
        log.exception(f"{tool} failed")
        set_state(tool, status='error', finished_at=now_iso(), error=str(exc))

"""
GitHub Star 历史快照
- 每次抓取 trending 后，把每个 repo 的 total_stars 追加到 jsonl
- 命名：data/github_history/owner__name.jsonl
- 每行：{"ts": iso, "stars": int, "forks": int}
- 用于 sparkline 展示
"""

import os
import json
import time
from datetime import datetime, timezone
from typing import Dict


def _file_for(history_dir: str, full_name: str) -> str:
    safe = full_name.replace('/', '__')
    return os.path.join(history_dir, f"{safe}.jsonl")


def update_history(report: Dict, history_dir: str) -> None:
    """从 report 中提取所有 repo 的 star 数，写入 jsonl

    策略：每次 fetch 都 append 一个新点（同一天也 append），让 sparkline
    能随时间积累展示趋势。最多保留 90 条。
    """
    os.makedirs(history_dir, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()
    seen = set()

    def write_one(full_name: str, stars: int, forks: int = 0):
        if not full_name or full_name in seen:
            return
        seen.add(full_name)
        path = _file_for(history_dir, full_name)
        existing = []
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                existing = [json.loads(l) for l in f if l.strip()]
        # 如果 last 是同一分钟内（同一fetch周期内），覆盖
        last = existing[-1] if existing else None
        if last:
            try:
                from datetime import datetime as _dt
                last_dt = _dt.fromisoformat(last['ts'].replace('Z', '+00:00'))
                cur_dt = _dt.fromisoformat(now.replace('Z', '+00:00'))
                if (cur_dt - last_dt).total_seconds() < 60:
                    last['stars'] = stars
                    last['forks'] = forks
                    last['ts'] = now
                    with open(path, 'w', encoding='utf-8') as f:
                        for item in existing:
                            f.write(json.dumps(item, ensure_ascii=False) + '\n')
                    return
            except Exception:
                pass
        existing.append({'ts': now, 'stars': stars, 'forks': forks})
        existing = existing[-90:]
        with open(path, 'w', encoding='utf-8') as f:
            for item in existing:
                f.write(json.dumps(item, ensure_ascii=False) + '\n')

    # 遍历所有 sections
    for sec, data in (report.get('sections') or {}).items():
        for r in data.get('repos', []):
            write_one(
                r.get('full_name', ''),
                r.get('total_stars') or r.get('stars') or 0,
                r.get('forks') or 0,
            )
    for r in (report.get('composite_top') or []):
        write_one(
            r.get('full_name', ''),
            r.get('total_stars') or 0,
            0,
        )


def read_history(history_dir: str, full_name: str) -> list:
    path = _file_for(history_dir, full_name)
    if not os.path.exists(path):
        return []
    out = []
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except Exception:
                continue
    return out


if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1:
        h = read_history(HISTORY_DIR if False else 'data/github_history', sys.argv[1])
        for p in h:
            print(p)

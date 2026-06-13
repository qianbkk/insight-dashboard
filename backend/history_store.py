"""
历史快照存储
- 每次 fetch 完成后，把结果保存到 data/history/<type>/<timestamp>.json
- 同时维护一个 data/history/<type>/_index.jsonl 索引
- 提供 list / get 接口
"""

import os
import json
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional, Iterable


def history_dir(data_dir: str) -> str:
    return os.path.join(data_dir, 'history')


def save_snapshot(data_dir: str, kind: str, payload: Dict) -> str:
    """保存一次快照，返回文件路径"""
    hdir = os.path.join(history_dir(data_dir), kind)
    os.makedirs(hdir, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    path = os.path.join(hdir, f"{ts}.json")
    # 元信息
    meta = {
        '_meta': {
            'kind': kind,
            'ts': ts,
            'iso': datetime.now(timezone.utc).isoformat(),
            'size': len(json.dumps(payload, ensure_ascii=False)),
        }
    }
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({**meta, **payload}, f, ensure_ascii=False, indent=2)
    # 索引
    idx_path = os.path.join(hdir, '_index.jsonl')
    with open(idx_path, 'a', encoding='utf-8') as f:
        f.write(json.dumps(meta['_meta'], ensure_ascii=False) + '\n')
    return path


def list_snapshots(data_dir: str, kind: Optional[str] = None) -> List[Dict]:
    """列出所有快照元信息，按时间倒序"""
    hdir = history_dir(data_dir)
    out = []
    if not os.path.exists(hdir):
        return out
    kinds = [kind] if kind else [d for d in os.listdir(hdir) if os.path.isdir(os.path.join(hdir, d))]
    for k in kinds:
        idx_path = os.path.join(hdir, k, '_index.jsonl')
        if not os.path.exists(idx_path):
            continue
        with open(idx_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                    item['kind'] = k
                    out.append(item)
                except Exception:
                    continue
    out.sort(key=lambda x: x.get('iso', ''), reverse=True)
    return out


def get_snapshot(data_dir: str, kind: str, ts: str) -> Optional[Dict]:
    """按 kind + ts 读取快照"""
    path = os.path.join(history_dir(data_dir), kind, f"{ts}.json")
    if not os.path.exists(path):
        return None
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def list_kinds(data_dir: str) -> List[str]:
    hdir = history_dir(data_dir)
    if not os.path.exists(hdir):
        return []
    return sorted([d for d in os.listdir(hdir) if os.path.isdir(os.path.join(hdir, d))])

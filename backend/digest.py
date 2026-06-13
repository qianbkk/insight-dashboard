"""
生成今日 Markdown Digest
- 整合 ai_daily + github + arxiv + hf 四份数据
- 输出一个简洁的 markdown 报告
"""

import os
import json
from datetime import datetime
from typing import Dict, List, Optional


def _load(path: str) -> Optional[Dict]:
    if not os.path.exists(path): return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def generate_digest(data_dir: str, out_path: str) -> str:
    ai = _load(os.path.join(data_dir, 'ai_daily_latest.json')) or {}
    gh = _load(os.path.join(data_dir, 'github_trending_latest.json')) or {}
    arx = _load(os.path.join(data_dir, 'arxiv_latest.json')) or {}
    hf = _load(os.path.join(data_dir, 'hf_latest.json')) or {}

    today = datetime.utcnow().strftime('%Y-%m-%d')
    lines = [
        f"# Insight Digest · {today}",
        '',
        f"*Generated automatically by Insight Dashboard*  ",
        f"AI Pulse · Code Velocity · From the Lab · Open Weights",
        '',
        '---',
        '',
        '## 📡 AI Pulse — Top 10',
        '',
    ]
    items = (ai.get('top_items') or [])[:10]
    for i, it in enumerate(items, 1):
        ago = ''
        if it.get('published'):
            try:
                d = datetime.fromisoformat(it['published'].replace('Z', '+00:00'))
                delta = datetime.utcnow().timestamp() - d.timestamp()
                if delta < 3600: ago = f" ({int(delta//60)}m ago)"
                elif delta < 86400: ago = f" ({int(delta//3600)}h ago)"
                else: ago = f" ({int(delta//86400)}d ago)"
            except Exception: pass
        lines.append(f"{i}. **[{it.get('title', '')}]({it.get('url', '')})**{ago}  ")
        lines.append(f"   *{it.get('source', '')}* · score {it.get('score', 0):.2f}")
        if it.get('summary'):
            lines.append(f"   > {it['summary'][:180]}{'…' if len(it['summary']) > 180 else ''}")
        lines.append('')

    lines += ['---', '', '## ★ Code Velocity — Composite Top 10', '']
    for i, r in enumerate((gh.get('composite_top') or [])[:10], 1):
        ps = r.get('today_stars') or r.get('weekly_stars') or r.get('monthly_stars') or 0
        total = r.get('total_stars') or r.get('stars') or 0
        lang = r.get('language') or ''
        lines.append(
            f"{i}. **[{r.get('full_name', '')}]({r.get('html_url', '')})** — {fmt(total)} ★  "
            f"{'+' + fmt(ps) + ' ' + (r.get('period') or '') if ps else ''}  "
            f"_{lang}_"
        )
        if r.get('description'):
            lines.append(f"   > {r['description'][:180]}{'…' if len(r['description']) > 180 else ''}")
        lines.append('')

    lines += ['---', '', '## 📚 From the Lab — Latest arXiv', '']
    for i, p in enumerate((arx.get('papers') or [])[:8], 1):
        lines.append(
            f"{i}. **[{p.get('title', '')}]({p.get('url', '')})** — `{p.get('primary_category', '')}`"
        )
        if p.get('authors'):
            lines.append(f"   *{', '.join(p['authors'][:3])}{' et al.' if len(p['authors']) > 3 else ''}*")
        if p.get('summary'):
            lines.append(f"   > {p['summary'][:160]}{'…' if len(p['summary']) > 160 else ''}")
        lines.append('')

    lines += ['---', '', '## 🤗 Open Weights — Trending Models', '']
    for i, m in enumerate((hf.get('models') or [])[:8], 1):
        lines.append(
            f"{i}. **[{m.get('id', '')}]({m.get('url', '')})** — {fmt(m.get('downloads', 0))} ↓ · "
            f"{m.get('likes', 0)} ♥"
        )
        if m.get('description'):
            lines.append(f"   > {m['description'][:160]}{'…' if len(m['description']) > 160 else ''}")
        lines.append('')

    lines += [
        '---',
        '',
        f'## Summary',
        f'- **AI sources pulled**: {ai.get("total_sources", 0)}',
        f'- **AI items after dedup**: {ai.get("total_unique", 0)}',
        f'- **GitHub unique repos**: {gh.get("unique_repo_count", 0)}',
        f'- **arXiv papers**: {arx.get("total", 0)}',
        f'- **HF items**: {hf.get("total", 0)}',
        '',
        f'Generated at `{datetime.utcnow().isoformat()}Z` by Insight Dashboard.',
        '',
    ]
    md = '\n'.join(lines)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(md)
    return md


def fmt(n):
    if n is None: return '—'
    n = int(n)
    if n >= 1e9: return f"{n/1e9:.1f}B"
    if n >= 1e6: return f"{n/1e6:.1f}M"
    if n >= 1e3: return f"{n/1e3:.1f}k"
    return str(n)


if __name__ == '__main__':
    out = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data', 'digests', 'test.md'))
    md = generate_digest(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data')), out)
    print(f"Wrote {out} ({len(md)} chars)")

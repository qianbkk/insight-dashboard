"""
arXiv 论文抓取器
- 从 export.arxiv.org 拉取 cs.AI / cs.CL / cs.LG 最近提交
- 解析 Atom XML
- 评分：新鲜度 + 分类权重
"""

import os
import re
import json
import time
import logging
import requests
import hashlib
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Optional
from dataclasses import dataclass, asdict, field
import feedparser

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger('arxiv_fetcher')


@dataclass
class Paper:
    id: str
    title: str
    url: str
    summary: str
    authors: List[str]
    primary_category: str
    categories: List[str]
    published: str
    updated: str = ''
    heat: float = 0.5

    def to_dict(self):
        return asdict(self)


CATEGORIES = ['cs.AI', 'cs.CL', 'cs.LG', 'cs.CV', 'cs.IR']
CATEGORY_WEIGHTS = {c: 1.0 for c in CATEGORIES}
CATEGORY_WEIGHTS['cs.AI'] = 1.2
CATEGORY_WEIGHTS['cs.CL'] = 1.1
CATEGORY_WEIGHTS['cs.LG'] = 1.0


class ArxivFetcher:
    BASE = 'http://export.arxiv.org/api/query'

    def __init__(self, timeout: int = 20):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (compatible; InsightDashboard/1.0; +https://github.com/qianbkk/insight-dashboard)',
        })

    def _build_query(self, max_results: int = 40) -> str:
        cat_q = ' OR '.join([f'cat:{c}' for c in CATEGORIES])
        # arXiv API query
        return (
            f'search_query=({cat_q})'
            f'&sortBy=submittedDate&sortOrder=descending'
            f'&max_results={max_results}'
        )

    def fetch(self, max_results: int = 40) -> List[Paper]:
        url = f"{self.BASE}?{self._build_query(max_results)}"
        try:
            r = self.session.get(url, timeout=self.timeout)
            r.raise_for_status()
        except Exception as e:
            logger.warning(f"arXiv fetch failed: {e}")
            return []
        feed = feedparser.parse(r.content)
        papers = []
        for entry in feed.entries:
            try:
                # arXiv id from id field like "http://arxiv.org/abs/2506.12345v1"
                arxiv_id_raw = entry.get('id', '')
                m = re.search(r'abs/([^v]+?)(?:v\d+)?$', arxiv_id_raw)
                arxiv_id = m.group(1) if m else arxiv_id_raw.rsplit('/', 1)[-1]
                title = re.sub(r'\s+', ' ', entry.get('title', '')).strip()
                summary = re.sub(r'\s+', ' ', entry.get('summary', '')).strip()[:800]
                # arXiv abs link
                abs_url = f"https://arxiv.org/abs/{arxiv_id}"
                pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"
                authors = [a.get('name', '') for a in entry.get('authors', []) if a.get('name')]
                # 分类
                primary_cat = ''
                cats = []
                if 'arxiv_primary_category' in entry:
                    primary_cat = entry['arxiv_primary_category'].get('term', '')
                for tag in entry.get('tags', []):
                    term = tag.get('term', '')
                    if term:
                        cats.append(term)
                if primary_cat and primary_cat not in cats:
                    cats.insert(0, primary_cat)
                # 时间
                published = ''
                if hasattr(entry, 'published_parsed') and entry.published_parsed:
                    published = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc).isoformat()
                # 热度：基于 category weight + 是否新
                heat = CATEGORY_WEIGHTS.get(primary_cat, 0.8)
                if published:
                    age_days = (datetime.now(timezone.utc) - datetime.fromisoformat(published)).total_seconds() / 86400
                    if age_days < 1: heat = min(1.0, heat + 0.2)
                    elif age_days < 3: heat = min(1.0, heat + 0.1)
                papers.append(Paper(
                    id=arxiv_id,
                    title=title[:300],
                    url=abs_url,
                    summary=summary,
                    authors=authors,
                    primary_category=primary_cat or 'cs.AI',
                    categories=cats,
                    published=published,
                    heat=round(heat, 3),
                ))
            except Exception as e:
                logger.debug(f"parse entry: {e}")
        logger.info(f"  ✓ arXiv: {len(papers)} papers")
        return papers

    def build_report(self, max_results: int = 40) -> Dict:
        now = datetime.now(timezone.utc)
        papers = self.fetch(max_results)
        # 分桶
        by_cat = {c: [] for c in CATEGORIES}
        for p in papers:
            for c in (p.categories or []):
                if c in by_cat:
                    by_cat[c].append(p.to_dict())
        latest = papers[0].to_dict() if papers else None
        return {
            'generated_at': now.isoformat(),
            'source': 'export.arxiv.org',
            'total': len(papers),
            'papers': [p.to_dict() for p in papers],
            'by_category': by_cat,
            'latest': latest,
        }


def fetch_and_save(out_path: str = None, max_results: int = 40) -> Dict:
    f = ArxivFetcher()
    report = f.build_report(max_results)
    if out_path:
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, 'w', encoding='utf-8') as f_:
            json.dump(report, f_, ensure_ascii=False, indent=2)
    return report


if __name__ == '__main__':
    out = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data', 'arxiv_latest.json'))
    rep = fetch_and_save(out)
    print(f"arXiv: {rep['total']} papers")
    for i, p in enumerate(rep['papers'][:5], 1):
        print(f"{i}. [{p['primary_category']}] {p['title'][:80]}")

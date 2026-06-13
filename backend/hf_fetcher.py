"""
HuggingFace 热门抓取器
- Trending models (按 downloads 排序)
- Trending datasets (按 downloads 排序)
- Daily papers (HF trending papers)
"""

import os
import json
import time
import logging
import requests
from datetime import datetime, timezone
from typing import List, Dict, Optional
from dataclasses import dataclass, asdict, field

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger('hf_fetcher')


@dataclass
class HFModel:
    id: str
    name: str
    url: str
    downloads: int = 0
    likes: int = 0
    library: str = ''
    language: str = ''
    task: str = ''
    trending_score: float = 0.0
    description: str = ''
    trend: str = 'trending'

    def to_dict(self): return asdict(self)


@dataclass
class HFDataset:
    id: str
    name: str
    url: str
    downloads: int = 0
    likes: int = 0
    task_categories: List[str] = field(default_factory=list)
    trending_score: float = 0.0
    description: str = ''

    def to_dict(self): return asdict(self)


@dataclass
class HFPaper:
    id: str
    title: str
    url: str
    summary: str = ''
    authors: List[str] = field(default_factory=list)
    upvotes: int = 0
    published: str = ''

    def to_dict(self): return asdict(self)


class HFFetcher:
    BASE = 'https://huggingface.co/api'
    BASE_PAPERS = 'https://huggingface.co/papers'

    def __init__(self, timeout: int = 20):
        self.timeout = timeout
        self.session = requests.Session()
        # HuggingFace API 不需要代理, 直连
        self.session.trust_env = False
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (compatible; InsightDashboard/1.0)',
        })

    def _trending_score(self, downloads: int, likes: int) -> float:
        # 简单的对数加权 trending 分
        import math
        return round(math.log1p(downloads or 0) * 0.5 + math.log1p(likes or 0) * 1.5, 2)

    def fetch_models(self, limit: int = 30) -> List[HFModel]:
        """Trending models by downloads"""
        url = f"{self.BASE}/models"
        params = {'sort': 'downloads', 'direction': '-1', 'limit': limit}
        try:
            r = self.session.get(url, params=params, timeout=self.timeout)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            logger.warning(f"HF models fetch failed: {e}")
            return []
        out = []
        for item in data:
            mid = item.get('id') or item.get('modelId') or ''
            if not mid:
                continue
            out.append(HFModel(
                id=mid,
                name=mid.split('/')[-1] if '/' in mid else mid,
                url=f"https://huggingface.co/{mid}",
                downloads=item.get('downloads', 0) or 0,
                likes=item.get('likes', 0) or 0,
                library=item.get('library_name', '') or '',
                language=(item.get('cardData') or {}).get('language', '') if isinstance(item.get('cardData'), dict) else '',
                task=','.join((item.get('pipeline_tag'),) if item.get('pipeline_tag') else ()) or 'model',
                trending_score=self._trending_score(item.get('downloads', 0), item.get('likes', 0)),
                description=((item.get('cardData') or {}).get('description', '') if isinstance(item.get('cardData'), dict) else '') or '',
            ))
        logger.info(f"  ✓ HF models: {len(out)}")
        return out

    def fetch_datasets(self, limit: int = 30) -> List[HFDataset]:
        """Trending datasets by downloads"""
        url = f"{self.BASE}/datasets"
        params = {'sort': 'downloads', 'direction': '-1', 'limit': limit}
        try:
            r = self.session.get(url, params=params, timeout=self.timeout)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            logger.warning(f"HF datasets fetch failed: {e}")
            return []
        out = []
        for item in data:
            did = item.get('id') or ''
            if not did:
                continue
            card = item.get('cardData') or {}
            if not isinstance(card, dict):
                card = {}
            out.append(HFDataset(
                id=did,
                name=did.split('/')[-1] if '/' in did else did,
                url=f"https://huggingface.co/datasets/{did}",
                downloads=item.get('downloads', 0) or 0,
                likes=item.get('likes', 0) or 0,
                task_categories=item.get('task_categories', []) or [],
                trending_score=self._trending_score(item.get('downloads', 0), item.get('likes', 0)),
                description=(card.get('description', '') or '')[:300],
            ))
        logger.info(f"  ✓ HF datasets: {len(out)}")
        return out

    def fetch_papers(self, limit: int = 20) -> List[HFPaper]:
        """HF daily papers"""
        # /api/papers?date=YYYY-MM-DD 给出指定日期的论文
        today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        url = f"{self.BASE}/papers"
        params = {'date': today, 'limit': limit}
        try:
            r = self.session.get(url, params=params, timeout=self.timeout)
            if r.status_code == 404:
                # 没有当天，回退到不带 date
                params = {'limit': limit}
                r = self.session.get(url, params=params, timeout=self.timeout)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            logger.warning(f"HF papers fetch failed: {e}")
            return []
        out = []
        # HF papers API: list of {id, title, summary, authors[], publishedAt, upvotes}
        for item in (data if isinstance(data, list) else data.get('papers', [])):
            pid = item.get('id', '')
            if not pid:
                continue
            arxiv_id = pid.get('arxivId') if isinstance(pid, dict) else None
            paper_id = arxiv_id or (item.get('paper', {}) or {}).get('id') or item.get('id', '')
            paper_url = f"https://huggingface.co/papers/{paper_id}" if paper_id else ''
            out.append(HFPaper(
                id=str(paper_id),
                title=item.get('title', ''),
                url=paper_url,
                summary=(item.get('summary', '') or '')[:400],
                authors=item.get('authors', []) or [],
                upvotes=item.get('upvotes', 0) or 0,
                published=item.get('publishedAt', '') or '',
            ))
        # 兜底：fallback 到 arxiv
        if not out:
            try:
                import feedparser
                f = feedparser.parse(f"https://export.arxiv.org/rss/cs.AI")
                for entry in f.entries[:limit]:
                    out.append(HFPaper(
                        id=entry.get('id', ''),
                        title=entry.get('title', ''),
                        url=entry.get('link', ''),
                        summary=entry.get('summary', '')[:400],
                        authors=[a.get('name', '') for a in entry.get('authors', [])],
                        upvotes=0,
                        published=entry.get('published', ''),
                    ))
            except Exception:
                pass
        logger.info(f"  ✓ HF papers: {len(out)}")
        return out

    def build_report(self) -> Dict:
        now = datetime.now(timezone.utc)
        models = self.fetch_models()
        datasets = self.fetch_datasets()
        papers = self.fetch_papers()
        return {
            'generated_at': now.isoformat(),
            'source': 'huggingface.co/api',
            'total': len(models) + len(datasets) + len(papers),
            'models': [m.to_dict() for m in models],
            'datasets': [d.to_dict() for d in datasets],
            'papers': [p.to_dict() for p in papers],
        }


def fetch_and_save(out_path: str = None) -> Dict:
    f = HFFetcher()
    report = f.build_report()
    if out_path:
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, 'w', encoding='utf-8') as fout:
            json.dump(report, fout, ensure_ascii=False, indent=2)
    return report


if __name__ == '__main__':
    out = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data', 'hf_latest.json'))
    rep = fetch_and_save(out)
    print(f"HF: {rep['total']} items")
    for m in rep['models'][:5]:
        print(f"  model: {m['id']} (↓{m['downloads']}, ♥{m['likes']})")
    for d in rep['datasets'][:3]:
        print(f"  dataset: {d['id']} (↓{d['downloads']})")
    print(f"  papers: {len(rep['papers'])}")

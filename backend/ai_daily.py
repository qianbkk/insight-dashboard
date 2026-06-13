"""
AI 日报抓取与验证模块
2026年6月最优方案：多源RSS聚合 + 质量验证

调研结论（2026.6最新时间线）：
- 最实用的方式不是单一来源订阅，而是多源RSS聚合 + 去重 + AI相关性过滤
- 优质源（按可靠性/时效性/高质量评分）：
  1. The Batch (DeepLearning.AI) - 周报，技术深度
  2. TLDR AI - 日报，覆盖广
  3. The Rundown AI - 日报，产业+技术
  4. The Neuron - 日报，简洁
  5. Ben's Bites - 日报，产品+技术
  6. Import AI (Jack Clark) - 周报，深度
  7. MIT News AI - 学术+产业
  8. Hacker News (best filter) - 实时讨论
  9. GitHub Trending AI topics - 实时开源情报

方案：
- 优先尝试RSS（结构化、可靠）
- 失败时fallback到HTML抓取
- 通过发布时间、来源权威性、关键词相关性三维评分
- 跨源去重（按URL hash + 标题相似度）
"""

import feedparser
import requests
import hashlib
import re
import json
import os
import time
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional
from dataclasses import dataclass, asdict, field
from urllib.parse import urlparse
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger('ai_daily')


@dataclass
class NewsItem:
    """单条AI新闻项"""
    title: str
    url: str
    source: str
    published: Optional[str] = None  # ISO格式
    summary: str = ''
    author: str = ''
    tags: List[str] = field(default_factory=list)
    score: float = 0.0  # 综合质量分
    url_hash: str = ''

    def __post_init__(self):
        if not self.url_hash and self.url:
            self.url_hash = hashlib.md5(self.url.encode('utf-8')).hexdigest()[:12]


# 2026年6月最新可用的高质量AI/科技RSS源清单
# 每个源带权重（0-1），反映其权威性、时效性、信息密度
RSS_SOURCES = [
    {
        'name': 'The Batch (DeepLearning.AI)',
        'url': 'https://www.deeplearning.ai/the-batch/feed/',
        'weight': 0.95,
        'language': 'en',
        'type': 'weekly',
    },
    {
        'name': 'TLDR AI',
        'url': 'https://tldr.tech/ai/rss',
        'weight': 0.90,
        'language': 'en',
        'type': 'daily',
    },
    {
        'name': 'The Rundown AI',
        'url': 'https://www.therundown.ai/rss',
        'weight': 0.88,
        'language': 'en',
        'type': 'daily',
    },
    {
        'name': 'Ben\'s Bites',
        'url': 'https://www.bensbites.com/feed',
        'weight': 0.85,
        'language': 'en',
        'type': 'daily',
    },
    {
        'name': 'The Neuron',
        'url': 'https://www.theneurondaily.com/rss',
        'weight': 0.85,
        'language': 'en',
        'type': 'daily',
    },
    {
        'name': 'Import AI (Jack Clark)',
        'url': 'https://importai.substack.com/feed',
        'weight': 0.92,
        'language': 'en',
        'type': 'weekly',
    },
    {
        'name': 'MIT News - AI',
        'url': 'https://news.mit.edu/topic/mitartificial-intelligence2-rss.xml',
        'weight': 0.90,
        'language': 'en',
        'type': 'daily',
    },
    {
        'name': 'Hacker News (Best)',
        'url': 'https://hnrss.org/best',
        'weight': 0.75,
        'language': 'en',
        'type': 'realtime',
    },
    {
        'name': 'Hacker News (AI filtered)',
        'url': 'https://hnrss.org/newest?q=AI+OR+LLM+OR+GPT+OR+Claude+OR+%22machine+learning%22',
        'weight': 0.80,
        'language': 'en',
        'type': 'realtime',
    },
    {
        'name': 'MIT Technology Review AI',
        'url': 'https://www.technologyreview.com/feed/',
        'weight': 0.88,
        'language': 'en',
        'type': 'daily',
    },
    {
        'name': 'AI News (GitHub Topics)',
        'url': 'https://mshibanami.github.io/GitHubTrendingRSS/weekly/ai-news.xml',
        'weight': 0.70,
        'language': 'en',
        'type': 'weekly',
    },
    {
        'name': 'WaytoAGI 社区精选',
        'url': 'https://www.waytoagi.com/rss',
        'weight': 0.75,
        'language': 'zh',
        'type': 'daily',
    },
    {
        'name': '机器之心',
        'url': 'https://www.jiqizhixin.com/rss',
        'weight': 0.85,
        'language': 'zh',
        'type': 'daily',
    },
    {
        'name': '量子位',
        'url': 'https://www.qbitai.com/feed',
        'weight': 0.85,
        'language': 'zh',
        'type': 'daily',
    },
    {
        'name': '36氪 AI频道',
        'url': 'https://36kr.com/feed',
        'weight': 0.78,
        'language': 'zh',
        'type': 'daily',
    },
]

# AI 相关性关键词（2026年扩展版）
AI_KEYWORDS = {
    'high': [
        'gpt', 'gpt-5', 'gpt-4', 'claude', 'opus', 'sonnet', 'haiku', 'fable',
        'gemini', 'llama', 'mistral', 'qwen', 'deepseek', 'mixtral', 'phi',
        'openai', 'anthropic', 'google deepmind', 'meta ai', 'mistral ai',
        'transformer', 'diffusion', 'rag', 'agent', 'mcp', 'fine-tuning',
        'reinforcement learning', 'rlhf', 'dpo', 'grpo',
        'agi', 'alignment', 'safety', 'evaluation', 'benchmark',
    ],
    'medium': [
        'ai', 'llm', 'ml', 'machine learning', 'deep learning', 'neural',
        'model', 'training', 'inference', 'embedding', 'vector',
        'prompt', 'context', 'token', 'hallucination', 'reasoning',
        'multimodal', 'vision', 'audio', 'video', 'image generation',
        'open source', 'huggingface', 'langchain', 'llamaindex',
    ],
    'low': [
        'data', 'compute', 'gpu', 'tpu', 'cuda', 'nvidia',
        'api', 'sdk', 'framework', 'library', 'tool',
    ],
}

# 需要排除的关键词（营销、低质内容）
EXCLUDE_KEYWORDS = [
    'sponsored', '广告', '限时优惠', 'discount code', 'coupon',
    'click here to buy', 'purchase now',
]


def _strip_html(text: str) -> str:
    """去除HTML标签"""
    if not text:
        return ''
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def _parse_date(entry) -> Optional[datetime]:
    """统一解析发布时间"""
    for attr in ('published_parsed', 'updated_parsed', 'created_parsed'):
        v = getattr(entry, attr, None)
        if v:
            try:
                return datetime(*v[:6], tzinfo=timezone.utc)
            except Exception:
                continue
    # 兜底：尝试原始字符串
    for attr in ('published', 'updated', 'created'):
        v = getattr(entry, attr, None)
        if v:
            try:
                from email.utils import parsedate_to_datetime
                return parsedate_to_datetime(v)
            except Exception:
                continue
    return None


def _ai_relevance_score(title: str, summary: str) -> float:
    """AI 相关性评分 0-1"""
    text = f"{title} {summary}".lower()
    if any(kw in text for kw in EXCLUDE_KEYWORDS):
        return 0.0
    score = 0.0
    matched_high = sum(1 for kw in AI_KEYWORDS['high'] if kw in text)
    matched_med = sum(1 for kw in AI_KEYWORDS['medium'] if kw in text)
    matched_low = sum(1 for kw in AI_KEYWORDS['low'] if kw in text)
    if matched_high >= 1:
        score = 0.7
        score += min(matched_high, 3) * 0.07
    if matched_med >= 2:
        score = max(score, 0.5)
        score += min(matched_med, 4) * 0.04
    if matched_low >= 3 and score < 0.4:
        score = 0.35
    return min(score, 1.0)


def _recency_score(published: Optional[datetime], now: datetime) -> float:
    """时效性评分 0-1 (24小时内满分，30天为0)"""
    if not published:
        return 0.3  # 未知时间给个中等分
    delta = now - published
    if delta.total_seconds() < 0:
        return 1.0  # 未来时间，认为是预发布
    hours = delta.total_seconds() / 3600
    if hours <= 24:
        return 1.0
    if hours <= 48:
        return 0.85
    if hours <= 72:
        return 0.7
    if hours <= 168:  # 1周
        return 0.5
    if hours <= 720:  # 30天
        return 0.3
    return 0.1


def _title_similarity(a: str, b: str) -> float:
    """简单标题相似度（Jaccard 词集合）"""
    if not a or not b:
        return 0.0
    a_words = set(re.findall(r'\w+', a.lower()))
    b_words = set(re.findall(r'\w+', b.lower()))
    if not a_words or not b_words:
        return 0.0
    inter = len(a_words & b_words)
    union = len(a_words | b_words)
    return inter / union if union else 0.0


def _cluster_items(items: List[NewsItem], threshold: float = 0.5) -> List[NewsItem]:
    """跨源聚类：把标题+摘要相似的归到同一 cluster，并标注 cluster_size"""
    clusters: List[List[NewsItem]] = []
    for it in items:
        text = f"{it.title} {it.summary}".lower()
        placed = False
        for cluster in clusters:
            rep = cluster[0]
            if _title_similarity(f"{rep.title} {rep.summary}", text) >= threshold:
                cluster.append(it)
                placed = True
                break
        if not placed:
            clusters.append([it])
    # 回写 cluster 信息
    for ci, cluster in enumerate(clusters):
        if len(cluster) < 2:
            continue  # 单条不标 cluster
        sources = list({c.source for c in cluster})
        for c in cluster:
            c.tags = list(c.tags) + [f'cluster:{ci}', f'cluster_size:{len(cluster)}']
            c.score = round(min(1.0, c.score + 0.05 * (len(cluster) - 1)), 4)
    return items


class AIDailyFetcher:
    """AI日报抓取器"""

    def __init__(self, sources: Optional[List[Dict]] = None, timeout: int = 15):
        self.sources = sources or RSS_SOURCES
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (compatible; AIDailyBot/1.0; +https://example.com)',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        })

    def fetch_source(self, source: Dict, max_items: int = 30) -> List[NewsItem]:
        """从单个源抓取"""
        items: List[NewsItem] = []
        try:
            logger.info(f"Fetching {source['name']} ...")
            resp = self.session.get(source['url'], timeout=self.timeout)
            resp.raise_for_status()
            feed = feedparser.parse(resp.content)
            if feed.bozo and not feed.entries:
                logger.warning(f"  parse error: {source['name']}: {feed.bozo_exception}")
                return items
            for entry in feed.entries[:max_items]:
                title = _strip_html(entry.get('title', ''))
                url = entry.get('link', '') or entry.get('id', '')
                summary = _strip_html(
                    entry.get('summary', '') or
                    entry.get('description', '') or
                    entry.get('content', [{}])[0].get('value', '') if entry.get('content') else ''
                )[:500]
                published = _parse_date(entry)
                author = entry.get('author', '') or entry.get('dc_creator', '')
                if not title or not url:
                    continue
                item = NewsItem(
                    title=title[:300],
                    url=url,
                    source=source['name'],
                    published=published.isoformat() if published else None,
                    summary=summary,
                    author=author[:100] if author else '',
                    tags=[source['type'], source['language']],
                )
                items.append(item)
            logger.info(f"  ✓ {source['name']}: {len(items)} items")
        except Exception as e:
            logger.warning(f"  ✗ {source['name']}: {e}")
        return items

    def fetch_all(self, max_per_source: int = 30) -> List[NewsItem]:
        """从所有源抓取"""
        all_items: List[NewsItem] = []
        for src in self.sources:
            all_items.extend(self.fetch_source(src, max_items=max_per_source))
        return all_items

    def score_and_rank(
        self,
        items: List[NewsItem],
        now: Optional[datetime] = None,
        recency_window_hours: int = 168,
    ) -> List[NewsItem]:
        """打分、过滤、排序、去重"""
        now = now or datetime.now(timezone.utc)
        weights = {s['name']: s['weight'] for s in self.sources}

        # 1) 评分
        scored: List[NewsItem] = []
        for item in items:
            relevance = _ai_relevance_score(item.title, item.summary)
            if relevance == 0.0:
                continue  # 明确无关
            recency = _recency_score(
                datetime.fromisoformat(item.published) if item.published else None,
                now
            )
            src_w = weights.get(item.source, 0.6)
            # 综合分 = 0.5*相关性 + 0.3*时效性 + 0.2*源权重
            item.score = round(0.5 * relevance + 0.3 * recency + 0.2 * src_w, 4)
            # 时效窗口过滤
            if recency < (1.0 - recency_window_hours / 720.0) and recency < 0.3:
                continue
            scored.append(item)

        # 2) 去重：URL hash 优先
        seen_hashes = set()
        deduped: List[NewsItem] = []
        for item in sorted(scored, key=lambda x: x.score, reverse=True):
            if item.url_hash in seen_hashes:
                continue
            # 标题相似度去重
            is_dup = False
            for kept in deduped[-50:]:  # 只需与高分Top50比较
                if _title_similarity(item.title, kept.title) > 0.7:
                    is_dup = True
                    break
            if is_dup:
                continue
            seen_hashes.add(item.url_hash)
            deduped.append(item)

        # 3) 跨源聚类：相似标题归一类，并加分
        deduped = _cluster_items(deduped)

        return deduped

    def build_daily_report(
        self,
        top_n: int = 50,
        now: Optional[datetime] = None,
    ) -> Dict:
        """构建当日AI日报"""
        now = now or datetime.now(timezone.utc)
        logger.info(f"Building AI daily report at {now.isoformat()}")
        raw = self.fetch_all()
        ranked = self.score_and_rank(raw, now=now)
        # 按语言分桶
        zh_items = [asdict(x) for x in ranked if 'zh' in x.tags][:top_n // 2]
        en_items = [asdict(x) for x in ranked if 'zh' not in x.tags][:top_n // 2]
        top_items = [asdict(x) for x in ranked[:top_n]]

        return {
            'generated_at': now.isoformat(),
            'total_sources': len(self.sources),
            'total_raw': len(raw),
            'total_unique': len(ranked),
            'top_items': top_items,
            'chinese_items': zh_items,
            'english_items': en_items,
            'sources_meta': [
                {'name': s['name'], 'weight': s['weight'], 'type': s['type'], 'language': s['language']}
                for s in self.sources
            ],
        }


def fetch_and_save(out_path: str = None, top_n: int = 50) -> Dict:
    """便捷入口：抓取并保存到 JSON"""
    fetcher = AIDailyFetcher()
    report = fetcher.build_daily_report(top_n=top_n)
    if out_path:
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        logger.info(f"Saved report to {out_path}")
    return report


if __name__ == '__main__':
    out = os.path.join(os.path.dirname(__file__), '..', 'data', 'ai_daily_latest.json')
    out = os.path.abspath(out)
    report = fetch_and_save(out, top_n=50)
    print(f"\n=== AI 日报 ===")
    print(f"生成时间: {report['generated_at']}")
    print(f"源数量: {report['total_sources']}")
    print(f"原始条目: {report['total_raw']}")
    print(f"去重后: {report['total_unique']}")
    print(f"\nTop 10:")
    for i, item in enumerate(report['top_items'][:10], 1):
        print(f"{i:2d}. [{item['score']:.2f}] {item['source']}")
        print(f"    {item['title']}")
        print(f"    {item['url']}")
        if item.get('summary'):
            print(f"    {item['summary'][:120]}...")
        print()

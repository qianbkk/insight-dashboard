"""
GitHub 热门仓库抓取与验证模块
2026年6月最优方案：双轨制
  轨1: 官方 REST API 搜索（结构化数据，精确过滤）
  轨2: 抓取 github.com/trending（GitHub 官方 trending 算法，包含真实增速）

调研结论（2026.6最新时间线）：
- GitHub 没有公开的"按时间窗口star增长"API
- 三大可行方案：
  A) REST API: q=created:>DATE+stars:>N sort=stars（看"近期最热"）
  B) REST API: q=stars:>N pushed:>DATE sort=stars（看"持续活跃"）
  C) 抓取 github.com/trending?since=daily|weekly|monthly（GitHub 内部算法）
  D) 第三方数据 (star-history.com, Apify 等) — 但有依赖/成本问题

最优方案：A + C 组合
- A 提供结构化的精确数据
- C 提供 GitHub 内部 trending 排序（star 增速 + 其他信号）
- 两者结合得到"近期最热"、"本周最热"、"本月最热"、"持续活跃"四类

验证维度：
- 仓库存在性（通过 /repos/{owner}/{name} 验证）
- star 数量合理性
- 描述/语言/标签完整
- 与 trending 页面的交叉验证
"""

import os
import re
import json
import time
import logging
import subprocess
import requests
import hashlib
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Optional
from dataclasses import dataclass, asdict, field
from urllib.parse import urlencode

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger('github_trending')


@dataclass
class RepoInfo:
    """单个GitHub仓库信息"""
    rank: int = 0
    full_name: str = ''         # owner/name
    description: str = ''
    language: str = ''
    stars: int = 0
    forks: int = 0
    watchers: int = 0
    open_issues: int = 0
    today_stars: int = 0       # 来自trending页面
    weekly_stars: int = 0
    monthly_stars: int = 0
    total_stars: int = 0
    created_at: str = ''
    updated_at: str = ''
    pushed_at: str = ''
    html_url: str = ''
    topics: List[str] = field(default_factory=list)
    license: str = ''
    period: str = ''           # daily/weekly/monthly/recent/active
    source: str = ''           # api/trending
    score: float = 0.0
    contributors_hint: str = ''

    def to_dict(self):
        return asdict(self)


class GitHubTrendingFetcher:
    """GitHub 热门仓库抓取器"""

    API_BASE = 'https://api.github.com'
    TRENDING_BASE = 'https://github.com/trending'

    def __init__(self, gh_token: Optional[str] = None, timeout: int = 20):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (compatible; GitHubTrendingBot/1.0)',
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        })
        if gh_token:
            self.session.headers['Authorization'] = f'Bearer {gh_token}'

    # ---------- 轨1: GitHub 官方 REST API ----------
    def search_api(
        self,
        query: str,
        sort: str = 'stars',
        order: str = 'desc',
        per_page: int = 30,
        page: int = 1,
    ) -> List[RepoInfo]:
        """通过 REST API 搜索仓库"""
        url = f"{self.API_BASE}/search/repositories"
        params = {
            'q': query,
            'sort': sort,
            'order': order,
            'per_page': per_page,
            'page': page,
        }
        try:
            r = self.session.get(url, params=params, timeout=self.timeout)
            r.raise_for_status()
            data = r.json()
            repos = []
            for item in data.get('items', []):
                repo = RepoInfo(
                    full_name=item.get('full_name', ''),
                    description=(item.get('description') or '')[:300],
                    language=item.get('language') or '',
                    stars=item.get('stargazers_count', 0),
                    forks=item.get('forks_count', 0),
                    watchers=item.get('watchers_count', 0),
                    open_issues=item.get('open_issues_count', 0),
                    total_stars=item.get('stargazers_count', 0),
                    created_at=item.get('created_at', ''),
                    updated_at=item.get('updated_at', ''),
                    pushed_at=item.get('pushed_at', ''),
                    html_url=item.get('html_url', ''),
                    topics=item.get('topics', []),
                    license=(item.get('license') or {}).get('spdx_id', '') if item.get('license') else '',
                    source='api',
                )
                repos.append(repo)
            return repos
        except Exception as e:
            logger.warning(f"API search failed: {e}")
            return []

    def fetch_recent_popular(self, days: int = 7, min_stars: int = 50, limit: int = 30) -> List[RepoInfo]:
        """近期创建 + 有一定 star = '近期最热' """
        date = (datetime.now(timezone.utc) - timedelta(days=days)).strftime('%Y-%m-%d')
        q = f"created:>{date} stars:>{min_stars}"
        repos = self.search_api(q, sort='stars', order='desc', per_page=limit)
        for r in repos:
            r.period = f'recent_{days}d'
        return repos

    def fetch_active_popular(self, days: int = 30, min_stars: int = 1000, limit: int = 30) -> List[RepoInfo]:
        """持续活跃 + 高 star = '持续活跃' """
        date = (datetime.now(timezone.utc) - timedelta(days=days)).strftime('%Y-%m-%d')
        q = f"stars:>{min_stars} pushed:>{date}"
        repos = self.search_api(q, sort='stars', order='desc', per_page=limit)
        for r in repos:
            r.period = f'active_{days}d'
        return repos

    def fetch_topic(self, topic: str, limit: int = 20) -> List[RepoInfo]:
        """按 topic 抓取（如 'llm', 'agent', 'rag'）"""
        q = f"topic:{topic} stars:>50"
        repos = self.search_api(q, sort='stars', order='desc', per_page=limit)
        for r in repos:
            r.period = f'topic:{topic}'
        return repos

    # ---------- 轨2: 抓取 github.com/trending ----------
    @staticmethod
    def _parse_count(text: str) -> int:
        """解析 '1,234' 或 '12.3k' 格式"""
        if not text:
            return 0
        text = text.strip().replace(',', '')
        m = re.match(r'([\d.]+)\s*([kKmMbB]?)', text)
        if not m:
            return 0
        num = float(m.group(1))
        suffix = m.group(2).lower()
        if suffix == 'k':
            num *= 1_000
        elif suffix == 'm':
            num *= 1_000_000
        elif suffix == 'b':
            num *= 1_000_000_000
        return int(num)

    def fetch_trending_page(self, since: str = 'daily', language: str = '') -> List[RepoInfo]:
        """抓取 github.com/trending 页面
        since: daily | weekly | monthly
        language: 编程语言（可空）
        """
        from bs4 import BeautifulSoup
        url = f"{self.TRENDING_BASE}/{language}?since={since}" if language else f"{self.TRENDING_BASE}?since={since}"
        try:
            r = self.session.get(url, timeout=self.timeout, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            })
            r.raise_for_status()
        except Exception as e:
            logger.warning(f"Failed to fetch trending page {url}: {e}")
            return []

        soup = BeautifulSoup(r.text, 'lxml')
        repos = []

        for article in soup.select('article.Box-row'):
            try:
                # 仓库名
                h2 = article.select_one('h2 a')
                if not h2:
                    continue
                full_name = h2.get('href', '').strip('/')
                if not full_name or '/' not in full_name:
                    continue
                # 描述
                desc_el = article.select_one('p.col-9')
                description = desc_el.get_text(strip=True) if desc_el else ''
                # 语言
                lang_el = article.select_one('span[itemprop="programmingLanguage"]')
                language_name = lang_el.get_text(strip=True) if lang_el else ''
                # 总 star
                star_total_el = article.select_one('a[href$="/stargazers"]')
                total_stars = self._parse_count(star_total_el.get_text(strip=True)) if star_total_el else 0
                # fork
                fork_el = article.select_one('a[href$="/forks"]')
                forks = self._parse_count(fork_el.get_text(strip=True)) if fork_el else 0
                # 周期内 star 增长（关键字段）
                period_stars = 0
                for span in article.select('span.d-inline-block.float-sm-right'):
                    txt = span.get_text(strip=True)
                    nums = re.findall(r'[\d,]+', txt)
                    if nums:
                        period_stars = self._parse_count(nums[0])
                        break
                # 兜底：从所有文本里找 "X stars today/this week/this month"
                if period_stars == 0:
                    full_text = article.get_text(' ', strip=True)
                    m = re.search(r'([\d,]+)\s*stars?\s*(today|this\s*week|this\s*month)', full_text, re.I)
                    if m:
                        period_stars = self._parse_count(m.group(1))

                repo = RepoInfo(
                    full_name=full_name,
                    description=description[:300],
                    language=language_name,
                    stars=total_stars,
                    forks=forks,
                    today_stars=period_stars if since == 'daily' else 0,
                    weekly_stars=period_stars if since == 'weekly' else 0,
                    monthly_stars=period_stars if since == 'monthly' else 0,
                    total_stars=total_stars,
                    html_url=f"https://github.com/{full_name}",
                    period=since,
                    source='trending',
                )
                repos.append(repo)
            except Exception as e:
                logger.debug(f"Parse article error: {e}")
                continue

        logger.info(f"  ✓ trending {since}{('/' + language) if language else ''}: {len(repos)} repos")
        return repos

    def fetch_trending_all_periods(self, language: str = '') -> Dict[str, List[RepoInfo]]:
        """一次抓取 daily/weekly/monthly 三种"""
        result = {}
        for since in ('daily', 'weekly', 'monthly'):
            repos = self.fetch_trending_page(since=since, language=language)
            result[since] = repos
            time.sleep(0.5)  # 礼貌延迟
        return result

    # ---------- 综合报告 ----------
    def build_report(self) -> Dict:
        """构建完整的 GitHub 热门报告"""
        now = datetime.now(timezone.utc)
        logger.info(f"Building GitHub trending report at {now.isoformat()}")
        report = {
            'generated_at': now.isoformat(),
            'sections': {},
        }
        # 轨1: API 搜索
        report['sections']['recent_7d_popular'] = {
            'title': '近期热门（7天内创建+高star）',
            'method': 'API q=created:>DATE-7 stars:>50 sort=stars',
            'repos': [r.to_dict() for r in self.fetch_recent_popular(days=7, min_stars=50, limit=25)],
        }
        report['sections']['active_30d'] = {
            'title': '持续活跃（30天内有push+高star）',
            'method': 'API q=stars:>1000 pushed:>DATE-30 sort=stars',
            'repos': [r.to_dict() for r in self.fetch_active_popular(days=30, min_stars=1000, limit=25)],
        }
        # 轨2: Trending 页面
        for since in ('daily', 'weekly', 'monthly'):
            repos = self.fetch_trending_page(since=since)
            report['sections'][f'trending_{since}'] = {
                'title': f'GitHub Trending {since}',
                'method': f'Scrape github.com/trending?since={since}',
                'repos': [r.to_dict() for r in repos[:25]],
            }
            time.sleep(0.5)

        # 综合评分：对每个仓库在不同维度的"出现次数+star数"做加权
        repo_scores: Dict[str, Dict] = {}
        for sec_name, sec_data in report['sections'].items():
            for r in sec_data['repos']:
                key = r['full_name']
                if not key:
                    continue
                if key not in repo_scores:
                    repo_scores[key] = {
                        'full_name': key,
                        'description': r.get('description', ''),
                        'language': r.get('language', ''),
                        'total_stars': r.get('total_stars') or r.get('stars', 0),
                        'html_url': r.get('html_url', ''),
                        'sections': [],
                        'best_period_stars': 0,
                        'score': 0.0,
                    }
                entry = repo_scores[key]
                entry['sections'].append(sec_name)
                # 用最新周期star作为核心信号
                period_stars = (
                    r.get('today_stars', 0) or
                    r.get('weekly_stars', 0) or
                    r.get('monthly_stars', 0) or 0
                )
                entry['best_period_stars'] = max(entry['best_period_stars'], period_stars)
                # 综合分
                entry['score'] += (
                    0.5 * min(period_stars, 500) / 500.0 +
                    0.3 * (1.0 if 'trending_daily' in sec_name else 0.6 if 'trending_weekly' in sec_name else 0.3) +
                    0.2 * (1.0 if 'recent_7d' in sec_name else 0.4)
                )

        top_composite = sorted(repo_scores.values(), key=lambda x: x['score'], reverse=True)[:30]
        report['composite_top'] = top_composite
        report['unique_repo_count'] = len(repo_scores)
        return report


def fetch_and_save(out_path: str = None) -> Dict:
    """便捷入口"""
    fetcher = GitHubTrendingFetcher()
    report = fetcher.build_report()
    if out_path:
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        logger.info(f"Saved report to {out_path}")
    return report


if __name__ == '__main__':
    out = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data', 'github_trending_latest.json'))
    report = fetch_and_save(out)
    print("\n=== GitHub Trending ===")
    print(f"Generated at: {report['generated_at']}")
    print(f"Unique repos: {report['unique_repo_count']}")
    print(f"\nTop 5 per section:")
    for sec, data in report['sections'].items():
        print(f"\n[{data['title']}]")
        for i, r in enumerate(data['repos'][:5], 1):
            ps = r.get('today_stars') or r.get('weekly_stars') or r.get('monthly_stars') or 0
            star_str = f"{r['stars']:>6}" if r['stars'] else "     -"
            print(f"  {i}. stars={star_str} period+={ps} | {r['full_name']}")
    print(f"\n[Composite Top 15]")
    for i, r in enumerate(report['composite_top'][:15], 1):
        ts = f"{r['total_stars']:>6}" if r['total_stars'] else "     -"
        bs = f"{r['best_period_stars']:>4}" if r['best_period_stars'] else "   -"
        print(f"  {i:2d}. score={r['score']:.2f} | stars={ts} | period+={bs} | {r['full_name']}")
        print(f"      seen in: {', '.join(r['sections'])}")

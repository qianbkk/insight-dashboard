# INSIGHT // Operator's Console

> A reading room for machine intelligence & the code that runs it.

A live, multi-source digest of AI news, GitHub trending repos, arXiv papers, and HuggingFace trending models. Four panels, one screen, transparent scoring — no algorithms deciding what you see first.

![GitHub](https://img.shields.io/badge/license-MIT-blue) ![Status](https://img.shields.io/badge/build-2026.06-brightgreen) ![Python](https://img.shields.io/badge/python-3.10%2B-blue) ![No build](https://img.shields.io/badge/frontend-no%20build%20step-lightgrey)

## What's inside

| #  | Panel | Sources | Method |
|----|-------|---------|--------|
| 01 | **AI Pulse** | 15 RSS feeds (MIT Tech Review, TLDR AI, The Neuron, Ben's Bites, 量子位, 36氪, Hacker News, etc.) | RSS aggregation + AI-relevance × recency × source-authority scoring + cross-source clustering |
| 02 | **Code Velocity** | GitHub Trending page + REST search | Two-track: scrape `github.com/trending?since=daily/weekly/monthly` + REST search for recent & active |
| 03 | **From the Lab** | arXiv (cs.AI / cs.CL / cs.LG / cs.CV / cs.IR) | Atom API, sorted by submission date |
| 04 | **Open Weights** | HuggingFace | Trending models, datasets, daily papers |

Plus:
- ⭐ **Star history sparklines** — every GitHub repo shows a 14-day star trajectory
- 🔖 **Bookmarks** — localStorage-backed, exportable to Markdown
- 📰 **Daily digest** — one-shot `/api/digest/generate` writes a complete Markdown briefing to `data/digests/`
- 🔍 **Cross-source clustering** — stories covered by 2+ sources get a "verified by N sources" signal
- ⌨️ **Press `/` to search** — keyboard-first

## Architecture

```
backend/
  app.py                 Flask server + all API endpoints
  ai_daily.py            Multi-source RSS aggregation
  github_trending.py     GitHub Trending + REST search
  github_history.py      Star-count snapshots → JSONL time series
  arxiv_fetcher.py       arXiv Atom API
  hf_fetcher.py          HuggingFace API
  digest.py              Markdown digest generator
frontend/
  index.html             Single-page, no build step
  styles.css             Hand-rolled CSS, IBM Plex + Fraunces
  app.js                 Vanilla JS, bookmarks + sparklines + filters
data/                    Cached JSON + JSONL history + digests
```

## Quick start

```bash
# Install deps (proxy-aware)
pip install -r requirements.txt

# Run
python backend/app.py
# → http://127.0.0.1:5173
```

## API

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/status` | Task state + data file existence |
| `POST` | `/api/ai-daily` | Trigger AI Pulse ingest (30–60s) |
| `GET`  | `/api/ai-daily/data` | Latest AI Pulse JSON |
| `POST` | `/api/github` | Trigger Code Velocity ingest (15–30s) |
| `GET`  | `/api/github/data` | Latest GitHub JSON (with star_history) |
| `POST` | `/api/arxiv` | Trigger arXiv ingest |
| `GET`  | `/api/arxiv/data` | Latest arXiv JSON |
| `POST` | `/api/hf` | Trigger HuggingFace ingest |
| `GET`  | `/api/hf/data` | Latest HuggingFace JSON |
| `POST` | `/api/digest/generate` | Generate today's Markdown digest |
| `GET`  | `/api/digest/latest` | Get most recent digest |

## Methodology

### AI Pulse scoring
```
score = 0.50 × AI-relevance  +  0.30 × recency  +  0.20 × source-authority
```
- **AI-relevance**: keyword matching against a tiered dictionary (high/medium/low)
- **Recency**: linear decay from 1.0 at 24h to 0.3 at 30d
- **Source-authority**: opinionated, per-source weight (e.g. MIT Tech Review 0.95, HN 0.75)

### Code Velocity composite score
```
composite = 0.50 × normalized(period_stars)  +  0.30 × trending-period-weight  +  0.20 × recent-window-bonus
```

### Cross-source clustering
After URL-hash dedup, items with title+summary Jaccard similarity ≥ 0.5 are merged into a "cluster" — a quality signal that the same story was covered by 2+ independent sources.

## License

MIT

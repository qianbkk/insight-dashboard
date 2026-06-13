"""
Central tool/task registry. One source of truth for tool names, file paths,
and fetcher callables. The frontend (app.js) mirrors these names exactly —
so no KIND_MAP is needed.
"""
from typing import Dict


TOOLS = {
    'pulse': {
        'name': 'AI Pulse',
        'category': 'news',
        'cache_file': 'pulse_latest.json',
        'history_dir': 'pulse',
        'fetcher': 'ai_daily:fetch_and_save',
        'latest_endpoint': 'pulse/data',
        'fetch_endpoint': 'pulse',
    },
    'velocity': {
        'name': 'Code Velocity',
        'category': 'code',
        'cache_file': 'velocity_latest.json',
        'history_dir': 'velocity',
        'fetcher': 'github_trending:fetch_and_save',
        'latest_endpoint': 'velocity/data',
        'fetch_endpoint': 'velocity',
    },
    'lab': {
        'name': 'From the Lab',
        'category': 'research',
        'cache_file': 'lab_latest.json',
        'history_dir': 'lab',
        'fetcher': 'arxiv_fetcher:fetch_and_save',
        'latest_endpoint': 'lab/data',
        'fetch_endpoint': 'lab',
    },
    'weights': {
        'name': 'Open Weights',
        'category': 'models',
        'cache_file': 'weights_latest.json',
        'history_dir': 'weights',
        'fetcher': 'hf_fetcher:fetch_and_save',
        'latest_endpoint': 'weights/data',
        'fetch_endpoint': 'weights',
    },
    'digest': {
        'name': 'Daily Digest',
        'category': 'meta',
        'cache_file': 'digests/{date}.md',  # dynamic
        'history_dir': None,  # digest is single-file
        'fetcher': 'digest:generate_digest',
        'latest_endpoint': 'digest/latest',
        'fetch_endpoint': 'digest/generate',
    },
}

TOOL_IDS = list(TOOLS.keys())


def get_tool(kind: str) -> Dict:
    if kind not in TOOLS:
        raise KeyError(f"Unknown tool kind: {kind!r}. Valid: {TOOL_IDS}")
    return TOOLS[kind]


def call_fetcher(kind: str, **kwargs):
    """Call the fetcher for the given tool kind. Returns the report dict."""
    import importlib
    spec = TOOLS[kind]['fetcher']
    mod_name, fn_name = spec.split(':')
    mod = importlib.import_module(mod_name)
    fn = getattr(mod, fn_name)
    return fn(**kwargs)

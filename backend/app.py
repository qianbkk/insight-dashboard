"""
Flask 后端 API
- /api/ai-daily            触发AI日报抓取
- /api/ai-daily/data       获取最近一次AI日报数据
- /api/github              触发GitHub热门抓取（带star历史snapshot）
- /api/github/data         获取最近一次GitHub数据
- /api/arxiv               触发arXiv论文抓取
- /api/arxiv/data          获取最近一次arXiv数据
- /api/hf                  触发HuggingFace抓取
- /api/hf/data             获取最近一次HF数据
- /api/digest              生成今日markdown digest
- /api/digest/latest       获取最近一次digest
- /api/status              任务/数据状态
- /                        主页前端
"""

import os
import json
import threading
import time
from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory, abort
from flask_cors import CORS

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.abspath(os.path.join(BASE_DIR, '..', 'data'))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, '..', 'frontend'))
HISTORY_DIR = os.path.join(DATA_DIR, 'github_history')
DIGEST_DIR = os.path.join(DATA_DIR, 'digests')
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(HISTORY_DIR, exist_ok=True)
os.makedirs(DIGEST_DIR, exist_ok=True)

app = Flask(__name__, static_folder=None)
CORS(app)

TASK_STATE = {
    'ai_daily': {'status': 'idle', 'started_at': None, 'finished_at': None, 'error': None},
    'github': {'status': 'idle', 'started_at': None, 'finished_at': None, 'error': None},
    'arxiv': {'status': 'idle', 'started_at': None, 'finished_at': None, 'error': None},
    'hf': {'status': 'idle', 'started_at': None, 'finished_at': None, 'error': None},
}
STATE_LOCK = threading.Lock()


def _run_ai_daily():
    from ai_daily import fetch_and_save
    out = os.path.join(DATA_DIR, 'ai_daily_latest.json')
    with STATE_LOCK:
        TASK_STATE['ai_daily'] = {
            'status': 'running', 'started_at': datetime.utcnow().isoformat() + 'Z',
            'finished_at': None, 'error': None,
        }
    try:
        report = fetch_and_save(out, top_n=60)
        with STATE_LOCK:
            TASK_STATE['ai_daily'] = {
                'status': 'success', 'started_at': TASK_STATE['ai_daily']['started_at'],
                'finished_at': datetime.utcnow().isoformat() + 'Z', 'error': None,
            }
    except Exception as e:
        with STATE_LOCK:
            TASK_STATE['ai_daily'] = {
                'status': 'error', 'started_at': TASK_STATE['ai_daily']['started_at'],
                'finished_at': datetime.utcnow().isoformat() + 'Z', 'error': str(e),
            }


def _run_github():
    from github_trending import fetch_and_save
    from github_history import update_history
    out = os.path.join(DATA_DIR, 'github_trending_latest.json')
    with STATE_LOCK:
        TASK_STATE['github'] = {
            'status': 'running', 'started_at': datetime.utcnow().isoformat() + 'Z',
            'finished_at': None, 'error': None,
        }
    try:
        report = fetch_and_save(out)
        # 更新 star 历史（snapshot）
        try:
            update_history(report, HISTORY_DIR)
        except Exception as e:
            print(f"[warn] history update failed: {e}")
        # 把 star 历史回填到 report（用于 sparkline）
        try:
            report = _attach_history(report, HISTORY_DIR)
            with open(out, 'w', encoding='utf-8') as f:
                json.dump(report, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[warn] attach history failed: {e}")
        with STATE_LOCK:
            TASK_STATE['github'] = {
                'status': 'success', 'started_at': TASK_STATE['github']['started_at'],
                'finished_at': datetime.utcnow().isoformat() + 'Z', 'error': None,
            }
    except Exception as e:
        with STATE_LOCK:
            TASK_STATE['github'] = {
                'status': 'error', 'started_at': TASK_STATE['github']['started_at'],
                'finished_at': datetime.utcnow().isoformat() + 'Z', 'error': str(e),
            }


def _attach_history(report: dict, history_dir: str) -> dict:
    """从历史文件读取每个repo最近N个star总数, 注入到composite_top和sections的repo项里"""
    import glob
    def load(full_name: str):
        path = os.path.join(history_dir, f"{full_name.replace('/', '__')}.jsonl")
        if not os.path.exists(path):
            return []
        pts = []
        try:
            with open(path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line: continue
                    pts.append(json.loads(line))
        except Exception:
            return []
        return pts

    def attach(items):
        for r in (items or []):
            fn = r.get('full_name', '')
            hist = load(fn)
            if hist:
                r['star_history'] = [h.get('stars', 0) for h in hist[-14:]]
        return items

    if 'composite_top' in report:
        report['composite_top'] = attach(report['composite_top'])
    for sec, data in report.get('sections', {}).items():
        data['repos'] = attach(data.get('repos', []))
    return report


def _run_arxiv():
    from arxiv_fetcher import fetch_and_save
    out = os.path.join(DATA_DIR, 'arxiv_latest.json')
    with STATE_LOCK:
        TASK_STATE['arxiv'] = {
            'status': 'running', 'started_at': datetime.utcnow().isoformat() + 'Z',
            'finished_at': None, 'error': None,
        }
    try:
        fetch_and_save(out, max_results=40)
        with STATE_LOCK:
            TASK_STATE['arxiv'] = {
                'status': 'success', 'started_at': TASK_STATE['arxiv']['started_at'],
                'finished_at': datetime.utcnow().isoformat() + 'Z', 'error': None,
            }
    except Exception as e:
        with STATE_LOCK:
            TASK_STATE['arxiv'] = {
                'status': 'error', 'started_at': TASK_STATE['arxiv']['started_at'],
                'finished_at': datetime.utcnow().isoformat() + 'Z', 'error': str(e),
            }


def _run_hf():
    from hf_fetcher import fetch_and_save
    out = os.path.join(DATA_DIR, 'hf_latest.json')
    with STATE_LOCK:
        TASK_STATE['hf'] = {
            'status': 'running', 'started_at': datetime.utcnow().isoformat() + 'Z',
            'finished_at': None, 'error': None,
        }
    try:
        fetch_and_save(out)
        with STATE_LOCK:
            TASK_STATE['hf'] = {
                'status': 'success', 'started_at': TASK_STATE['hf']['started_at'],
                'finished_at': datetime.utcnow().isoformat() + 'Z', 'error': None,
            }
    except Exception as e:
        with STATE_LOCK:
            TASK_STATE['hf'] = {
                'status': 'error', 'started_at': TASK_STATE['hf']['started_at'],
                'finished_at': datetime.utcnow().isoformat() + 'Z', 'error': str(e),
            }


# ---------- API ----------
@app.route('/api/ai-daily', methods=['POST'])
def api_ai_daily():
    if TASK_STATE['ai_daily']['status'] == 'running':
        return jsonify({'ok': False, 'message': '已在抓取中', 'state': TASK_STATE['ai_daily']}), 409
    threading.Thread(target=_run_ai_daily, daemon=True).start()
    return jsonify({'ok': True, 'message': '已开始抓取AI日报', 'state': TASK_STATE['ai_daily']})


@app.route('/api/ai-daily/data', methods=['GET'])
def api_ai_daily_data():
    path = os.path.join(DATA_DIR, 'ai_daily_latest.json')
    if not os.path.exists(path):
        return jsonify({'ok': False, 'message': '尚无数据', 'state': TASK_STATE['ai_daily']}), 404
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return jsonify({'ok': True, 'state': TASK_STATE['ai_daily'], 'data': data})


@app.route('/api/github', methods=['POST'])
def api_github():
    if TASK_STATE['github']['status'] == 'running':
        return jsonify({'ok': False, 'message': '已在抓取中', 'state': TASK_STATE['github']}), 409
    threading.Thread(target=_run_github, daemon=True).start()
    return jsonify({'ok': True, 'message': '已开始抓取GitHub热门', 'state': TASK_STATE['github']})


@app.route('/api/github/data', methods=['GET'])
def api_github_data():
    path = os.path.join(DATA_DIR, 'github_trending_latest.json')
    if not os.path.exists(path):
        return jsonify({'ok': False, 'message': '尚无数据', 'state': TASK_STATE['github']}), 404
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return jsonify({'ok': True, 'state': TASK_STATE['github'], 'data': data})


@app.route('/api/arxiv', methods=['POST'])
def api_arxiv():
    if TASK_STATE['arxiv']['status'] == 'running':
        return jsonify({'ok': False, 'message': '已在抓取中', 'state': TASK_STATE['arxiv']}), 409
    threading.Thread(target=_run_arxiv, daemon=True).start()
    return jsonify({'ok': True, 'message': '已开始抓取arXiv', 'state': TASK_STATE['arxiv']})


@app.route('/api/arxiv/data', methods=['GET'])
def api_arxiv_data():
    path = os.path.join(DATA_DIR, 'arxiv_latest.json')
    if not os.path.exists(path):
        return jsonify({'ok': False, 'message': '尚无数据', 'state': TASK_STATE['arxiv']}), 404
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return jsonify({'ok': True, 'state': TASK_STATE['arxiv'], 'data': data})


@app.route('/api/hf', methods=['POST'])
def api_hf():
    if TASK_STATE['hf']['status'] == 'running':
        return jsonify({'ok': False, 'message': '已在抓取中', 'state': TASK_STATE['hf']}), 409
    threading.Thread(target=_run_hf, daemon=True).start()
    return jsonify({'ok': True, 'message': '已开始抓取HuggingFace', 'state': TASK_STATE['hf']})


@app.route('/api/hf/data', methods=['GET'])
def api_hf_data():
    path = os.path.join(DATA_DIR, 'hf_latest.json')
    if not os.path.exists(path):
        return jsonify({'ok': False, 'message': '尚无数据', 'state': TASK_STATE['hf']}), 404
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return jsonify({'ok': True, 'state': TASK_STATE['hf'], 'data': data})


@app.route('/api/digest/generate', methods=['POST'])
def api_digest_generate():
    """生成今日 markdown digest"""
    from digest import generate_digest
    today = datetime.utcnow().strftime('%Y-%m-%d')
    out = os.path.join(DIGEST_DIR, f"{today}.md")
    try:
        md = generate_digest(DATA_DIR, out)
        return jsonify({'ok': True, 'message': f'生成 {today} digest', 'path': out, 'preview': md[:600]})
    except Exception as e:
        return jsonify({'ok': False, 'message': str(e)}), 500


@app.route('/api/digest/latest', methods=['GET'])
def api_digest_latest():
    files = sorted([f for f in os.listdir(DIGEST_DIR) if f.endswith('.md')]) if os.path.exists(DIGEST_DIR) else []
    if not files:
        return jsonify({'ok': False, 'message': '尚无 digest'}), 404
    latest = files[-1]
    with open(os.path.join(DIGEST_DIR, latest), 'r', encoding='utf-8') as f:
        content = f.read()
    return jsonify({'ok': True, 'date': latest.replace('.md', ''), 'content': content})


@app.route('/api/status', methods=['GET'])
def api_status():
    return jsonify({
        'ok': True,
        'state': TASK_STATE,
        'data_files': {
            'ai_daily': os.path.exists(os.path.join(DATA_DIR, 'ai_daily_latest.json')),
            'github': os.path.exists(os.path.join(DATA_DIR, 'github_trending_latest.json')),
            'arxiv': os.path.exists(os.path.join(DATA_DIR, 'arxiv_latest.json')),
            'hf': os.path.exists(os.path.join(DATA_DIR, 'hf_latest.json')),
        },
        'now': datetime.utcnow().isoformat() + 'Z',
    })


# ---------- 静态前端 ----------
@app.route('/')
def index():
    return send_from_directory(FRONTEND_DIR, 'index.html')


@app.route('/<path:path>', methods=['GET'])
def static_files(path):
    # 拦截 /api/* 防止 catch-all
    if path.startswith('api/'):
        abort(404)
    full = os.path.join(FRONTEND_DIR, path)
    if not os.path.exists(full):
        abort(404)
    return send_from_directory(FRONTEND_DIR, path)


if __name__ == '__main__':
    print(f"Frontend dir: {FRONTEND_DIR}")
    print(f"Data dir:     {DATA_DIR}")
    app.run(host='127.0.0.1', port=5173, debug=False, threaded=True)

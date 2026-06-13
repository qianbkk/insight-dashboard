"""
Insight Dashboard - Flask API

Endpoints
- POST /api/ai-daily           trigger AI Pulse ingest
- GET  /api/ai-daily/data      latest AI Pulse JSON
- POST /api/github             trigger Code Velocity ingest
- GET  /api/github/data        latest GitHub JSON (with star history)
- POST /api/arxiv              trigger arXiv ingest
- GET  /api/arxiv/data         latest arXiv JSON
- POST /api/hf                 trigger HuggingFace ingest
- GET  /api/hf/data            latest HuggingFace JSON
- POST /api/digest/generate    generate today's Markdown digest
- GET  /api/digest/latest      get most recent digest
- GET  /api/history            list all snapshots (with ?kind= filter)
- GET  /api/history/<k>/<ts>   get specific snapshot
- GET  /api/i18n/<lang>        i18n strings (en, zh-CN)
- GET  /api/status             task state + data file existence
- GET  /                       SPA shell (frontend)
- GET  /<path>                 static assets
"""

import os
import json
import threading
import logging
from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory, abort
from flask_cors import CORS

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.abspath(os.path.join(BASE_DIR, '..', 'data'))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, '..', 'frontend'))
HISTORY_DIR = os.path.join(DATA_DIR, 'history')
DIGEST_DIR = os.path.join(DATA_DIR, 'digests')
GITHUB_HISTORY_DIR = os.path.join(DATA_DIR, 'github_history')
for d in (DATA_DIR, HISTORY_DIR, DIGEST_DIR, GITHUB_HISTORY_DIR):
    os.makedirs(d, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
log = logging.getLogger('insight.api')

app = Flask(__name__, static_folder=None)
CORS(app)

# ---- task state ----
TASK_STATE = {
    'ai_daily': {'status': 'idle', 'started_at': None, 'finished_at': None, 'error': None},
    'github':   {'status': 'idle', 'started_at': None, 'finished_at': None, 'error': None},
    'arxiv':    {'status': 'idle', 'started_at': None, 'finished_at': None, 'error': None},
    'hf':       {'status': 'idle', 'started_at': None, 'finished_at': None, 'error': None},
    'digest':   {'status': 'idle', 'started_at': None, 'finished_at': None, 'error': None},
}
STATE_LOCK = threading.Lock()


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + 'Z'


def _set_state(key: str, **kwargs) -> None:
    with STATE_LOCK:
        TASK_STATE[key].update(kwargs)


def _save_snapshot(kind: str, payload: dict) -> None:
    """Persist a snapshot to history dir (best effort, never blocks)"""
    try:
        from history_store import save_snapshot
        path = save_snapshot(DATA_DIR, kind, payload)
        log.info(f"snapshot saved: {kind} -> {os.path.basename(os.path.dirname(path))}/{os.path.basename(path)}")
    except Exception as e:
        log.warning(f"snapshot save failed: {e}")


# ---- fetcher wrappers ----
def _run_ai_daily():
    from ai_daily import fetch_and_save
    _set_state('ai_daily', status='running', started_at=_now_iso(), finished_at=None, error=None)
    try:
        report = fetch_and_save(os.path.join(DATA_DIR, 'ai_daily_latest.json'), top_n=60)
        _save_snapshot('ai_daily', report)
        _set_state('ai_daily', status='success', finished_at=_now_iso(), error=None)
    except Exception as e:
        log.exception("ai_daily failed")
        _set_state('ai_daily', status='error', finished_at=_now_iso(), error=str(e))


def _run_github():
    from github_trending import fetch_and_save
    from github_history import update_history
    out = os.path.join(DATA_DIR, 'github_trending_latest.json')
    _set_state('github', status='running', started_at=_now_iso(), finished_at=None, error=None)
    try:
        report = fetch_and_save(out)
        try:
            update_history(report, GITHUB_HISTORY_DIR)
            report = _attach_history(report, GITHUB_HISTORY_DIR)
            with open(out, 'w', encoding='utf-8') as f:
                json.dump(report, f, ensure_ascii=False, indent=2)
        except Exception as e:
            log.warning(f"github history attach failed: {e}")
        _save_snapshot('github', report)
        _set_state('github', status='success', finished_at=_now_iso(), error=None)
    except Exception as e:
        log.exception("github failed")
        _set_state('github', status='error', finished_at=_now_iso(), error=str(e))


def _attach_history(report: dict, history_dir: str) -> dict:
    """从历史文件读取每个repo最近N个star总数, 注入到composite_top和sections的repo项里"""
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
    _set_state('arxiv', status='running', started_at=_now_iso(), finished_at=None, error=None)
    try:
        report = fetch_and_save(os.path.join(DATA_DIR, 'arxiv_latest.json'), max_results=40)
        _save_snapshot('arxiv', report)
        _set_state('arxiv', status='success', finished_at=_now_iso(), error=None)
    except Exception as e:
        log.exception("arxiv failed")
        _set_state('arxiv', status='error', finished_at=_now_iso(), error=str(e))


def _run_hf():
    from hf_fetcher import fetch_and_save
    _set_state('hf', status='running', started_at=_now_iso(), finished_at=None, error=None)
    try:
        report = fetch_and_save(os.path.join(DATA_DIR, 'hf_latest.json'))
        _save_snapshot('hf', report)
        _set_state('hf', status='success', finished_at=_now_iso(), error=None)
    except Exception as e:
        log.exception("hf failed")
        _set_state('hf', status='error', finished_at=_now_iso(), error=str(e))


def _run_digest():
    from digest import generate_digest
    _set_state('digest', status='running', started_at=_now_iso(), finished_at=None, error=None)
    try:
        today = datetime.utcnow().strftime('%Y-%m-%d')
        out = os.path.join(DIGEST_DIR, f"{today}.md")
        generate_digest(DATA_DIR, out)
        _set_state('digest', status='success', finished_at=_now_iso(), error=None)
    except Exception as e:
        log.exception("digest failed")
        _set_state('digest', status='error', finished_at=_now_iso(), error=str(e))


# ---- API: ingest triggers ----
def _trigger(key: str, fn):
    if TASK_STATE[key]['status'] == 'running':
        return jsonify({'ok': False, 'message': '已在抓取中', 'state': TASK_STATE[key]}), 409
    threading.Thread(target=fn, daemon=True).start()
    return jsonify({'ok': True, 'message': '已开始', 'state': TASK_STATE[key]})


@app.route('/api/ai-daily', methods=['POST'])
def api_ai_daily(): return _trigger('ai_daily', _run_ai_daily)
@app.route('/api/github', methods=['POST'])
def api_github(): return _trigger('github', _run_github)
@app.route('/api/arxiv', methods=['POST'])
def api_arxiv(): return _trigger('arxiv', _run_arxiv)
@app.route('/api/hf', methods=['POST'])
def api_hf(): return _trigger('hf', _run_hf)
@app.route('/api/digest/generate', methods=['POST'])
def api_digest_generate(): return _trigger('digest', _run_digest)


# ---- API: latest data ----
def _serve_data(filename: str, key: str):
    path = os.path.join(DATA_DIR, filename)
    if not os.path.exists(path):
        return jsonify({'ok': False, 'message': '尚无数据', 'state': TASK_STATE[key]}), 404
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return jsonify({'ok': True, 'state': TASK_STATE[key], 'data': data})


@app.route('/api/ai-daily/data', methods=['GET'])
def api_ai_daily_data(): return _serve_data('ai_daily_latest.json', 'ai_daily')
@app.route('/api/github/data', methods=['GET'])
def api_github_data(): return _serve_data('github_trending_latest.json', 'github')
@app.route('/api/arxiv/data', methods=['GET'])
def api_arxiv_data(): return _serve_data('arxiv_latest.json', 'arxiv')
@app.route('/api/hf/data', methods=['GET'])
def api_hf_data(): return _serve_data('hf_latest.json', 'hf')


# ---- API: digest ----
@app.route('/api/digest/latest', methods=['GET'])
def api_digest_latest():
    if not os.path.exists(DIGEST_DIR):
        return jsonify({'ok': False, 'message': '尚无 digest'}), 404
    files = sorted([f for f in os.listdir(DIGEST_DIR) if f.endswith('.md')])
    if not files:
        return jsonify({'ok': False, 'message': '尚无 digest'}), 404
    latest = files[-1]
    with open(os.path.join(DIGEST_DIR, latest), 'r', encoding='utf-8') as f:
        content = f.read()
    return jsonify({'ok': True, 'date': latest.replace('.md', ''), 'content': content})


# ---- API: history ----
@app.route('/api/history', methods=['GET'])
def api_history_list():
    from history_store import list_snapshots, list_kinds
    kind = request.args.get('kind')
    snaps = list_snapshots(DATA_DIR, kind=kind)
    # 补上每条的 item count
    for s in snaps:
        try:
            full_path = os.path.join(HISTORY_DIR, s['kind'], f"{s['ts']}.json")
            with open(full_path, 'r', encoding='utf-8') as f:
                payload = json.load(f)
            for k in ('top_items', 'papers', 'models', 'composite_top'):
                if k in payload and isinstance(payload[k], list):
                    s['items'] = len(payload[k])
                    break
            else:
                s['items'] = 0
        except Exception:
            s['items'] = 0
    return jsonify({
        'ok': True,
        'kinds': list_kinds(DATA_DIR),
        'snapshots': snaps,
    })


@app.route('/api/history/<kind>/<ts>', methods=['GET'])
def api_history_get(kind: str, ts: str):
    from history_store import get_snapshot
    snap = get_snapshot(DATA_DIR, kind, ts)
    if snap is None:
        return jsonify({'ok': False, 'message': 'not found'}), 404
    return jsonify({'ok': True, 'data': snap})


# ---- API: i18n ----
@app.route('/api/i18n/<lang>', methods=['GET'])
def api_i18n(lang: str):
    from i18n_strings import get
    return jsonify({'ok': True, 'lang': lang, 'strings': get(lang)})


# ---- API: status ----
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
        'now': _now_iso(),
    })


# ---- 静态前端 (SPA shell + assets) ----
@app.route('/')
def index():
    return send_from_directory(FRONTEND_DIR, 'index.html')


@app.route('/<path:path>', methods=['GET'])
def static_files(path: str):
    if path.startswith('api/'):
        abort(404)
    full = os.path.join(FRONTEND_DIR, path)
    if not os.path.exists(full):
        abort(404)
    return send_from_directory(FRONTEND_DIR, path)


if __name__ == '__main__':
    print(f"Frontend dir: {FRONTEND_DIR}")
    print(f"Data dir:     {DATA_DIR}")
    print(f"History dir:  {HISTORY_DIR}")
    app.run(host='127.0.0.1', port=5173, debug=False, threaded=True)

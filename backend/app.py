"""
Insight Dashboard - Flask API
=============================

Endpoints
=========
POST /api/<tool>             Trigger an ingest (async, tool = pulse|velocity|lab|weights|digest)
GET  /api/<tool>/data        Latest cache for a tool
GET  /api/digest/latest      Most recent digest markdown
GET  /api/history            List all snapshots (?kind=<tool> filter)
GET  /api/history/<k>/<ts>   Get a specific snapshot
GET  /api/i18n/<lang>        i18n strings (en, zh-CN)
GET  /api/status             Current state of all tools
GET  /api/registry           Tool manifest (metadata for the SPA)
GET  /                       SPA shell
GET  /<path>                 static assets

Response envelope
=================
Every JSON response is {ok: bool, data?: any, error?: {code, message}}.
"""

import os
import json
import logging
import threading
from datetime import datetime

from flask import Flask, jsonify, request, send_from_directory, abort
from flask_cors import CORS

import registry
from responses import ok, err, conflict, not_found

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


# ---- request id (lightweight) ----
@app.before_request
def _attach_request_id():
    import uuid
    request.environ['req_id'] = uuid.uuid4().hex[:8]


@app.after_request
def _log_request(response):
    log.info(f"{request.environ.get('req_id','-')} {request.method} {request.path} -> {response.status_code}")
    return response


# ---- 404 + 500 envelopes ----
@app.errorhandler(404)
def _not_found(_e):
    return err('not found', code='not_found', status=404)

@app.errorhandler(405)
def _method_not_allowed(_e):
    return err('method not allowed', code='method_not_allowed', status=405)

@app.errorhandler(500)
def _server_error(e):
    log.exception(e)
    return err('internal server error', code='internal', status=500)


# ---- API: tool manifest ----
@app.route('/api/registry', methods=['GET'])
def api_registry():
    """Tool manifest: which tools exist, with endpoints and meta."""
    tools = []
    for k, v in registry.TOOLS.items():
        tools.append({
            'id': k,
            'name': v['name'],
            'category': v['category'],
            'fetch_endpoint': '/api/' + v['fetch_endpoint'],
            'latest_endpoint': '/api/' + v['latest_endpoint'],
        })
    return ok({'tools': tools})


# ---- API: triggers ----
def _trigger(tool: str, **kwargs):
    from tasks import get_state, run
    st = get_state().get(tool, {})
    if st.get('status') == 'running':
        return conflict('already running')
    # Detached background thread
    threading.Thread(
        target=run,
        args=(tool, DATA_DIR),
        kwargs={'extra_kwargs': kwargs},
        daemon=True,
    ).start()
    return ok({'tool': tool, 'state': get_state()[tool]})


@app.route('/api/pulse', methods=['POST'])
def api_pulse(): return _trigger('pulse')

@app.route('/api/velocity', methods=['POST'])
def api_velocity(): return _trigger('velocity')

@app.route('/api/lab', methods=['POST'])
def api_lab(): return _trigger('lab')

@app.route('/api/weights', methods=['POST'])
def api_weights(): return _trigger('weights')

@app.route('/api/digest/generate', methods=['POST'])
def api_digest_generate(): return _trigger('digest')


# ---- API: latest data ----
def _serve_latest(tool: str):
    from tasks import get_state
    cfg = registry.get_tool(tool)
    cache_file = cfg['cache_file']
    if '{date}' in cache_file:
        cache_file = cache_file.format(date=datetime.utcnow().strftime('%Y-%m-%d'))
    path = os.path.join(DATA_DIR, cache_file)
    if not os.path.exists(path):
        return not_found('no data yet')
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return ok(data=data, state=get_state()[tool])


@app.route('/api/pulse/data', methods=['GET'])
def api_pulse_data(): return _serve_latest('pulse')

@app.route('/api/velocity/data', methods=['GET'])
def api_velocity_data(): return _serve_latest('velocity')

@app.route('/api/lab/data', methods=['GET'])
def api_lab_data(): return _serve_latest('lab')

@app.route('/api/weights/data', methods=['GET'])
def api_weights_data(): return _serve_latest('weights')


# ---- API: digest ----
@app.route('/api/digest/latest', methods=['GET'])
def api_digest_latest():
    if not os.path.exists(DIGEST_DIR):
        return not_found('no digests')
    files = sorted([f for f in os.listdir(DIGEST_DIR) if f.endswith('.md')])
    if not files:
        return not_found('no digests yet')
    latest = files[-1]
    with open(os.path.join(DIGEST_DIR, latest), 'r', encoding='utf-8') as f:
        content = f.read()
    return ok({'date': latest.replace('.md', ''), 'content': content})


# ---- API: history ----
@app.route('/api/history', methods=['GET'])
def api_history_list():
    from history_store import list_snapshots, list_kinds
    kind = request.args.get('kind')
    snaps = list_snapshots(DATA_DIR, kind=kind)
    for s in snaps:
        try:
            snap_path = os.path.join(HISTORY_DIR, s['kind'], f"{s['ts']}.json")
            with open(snap_path, 'r', encoding='utf-8') as f:
                payload = json.load(f)
            for k in ('top_items', 'papers', 'models', 'composite_top'):
                if k in payload and isinstance(payload[k], list):
                    s['items'] = len(payload[k])
                    break
            else:
                s['items'] = 0
        except Exception:
            s['items'] = 0
    return ok({'kinds': list_kinds(DATA_DIR), 'snapshots': snaps})


@app.route('/api/history/<kind>/<ts>', methods=['GET'])
def api_history_get(kind: str, ts: str):
    from history_store import get_snapshot
    snap = get_snapshot(DATA_DIR, kind, ts)
    if snap is None:
        return not_found('snapshot not found')
    return ok(snap)


# ---- API: i18n ----
@app.route('/api/i18n/<lang>', methods=['GET'])
def api_i18n(lang: str):
    from i18n_strings import get
    return ok({'lang': lang, 'strings': get(lang)})


# ---- API: status ----
@app.route('/api/status', methods=['GET'])
def api_status():
    from tasks import get_state
    files = {
        k: os.path.exists(os.path.join(DATA_DIR, registry.TOOLS[k]['cache_file'].format(
            date=datetime.utcnow().strftime('%Y-%m-%d')) if '{date}' in registry.TOOLS[k]['cache_file']
            else registry.TOOLS[k]['cache_file']))
        for k in registry.TOOLS
    }
    return ok({'state': get_state(), 'files': files})


# ---- static + SPA shell ----
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


# ===========================================================================
# Backward-compat aliases — older API paths
# ===========================================================================
@app.route('/api/ai-daily', methods=['POST'])
def api_ai_daily_alias(): return _trigger('pulse')

@app.route('/api/ai-daily/data', methods=['GET'])
def api_ai_daily_data_alias(): return _serve_latest('pulse')

@app.route('/api/github', methods=['POST'])
def api_github_alias(): return _trigger('velocity')

@app.route('/api/github/data', methods=['GET'])
def api_github_data_alias(): return _serve_latest('velocity')

@app.route('/api/arxiv', methods=['POST'])
def api_arxiv_alias(): return _trigger('lab')

@app.route('/api/arxiv/data', methods=['GET'])
def api_arxiv_data_alias(): return _serve_latest('lab')

@app.route('/api/hf', methods=['POST'])
def api_hf_alias(): return _trigger('weights')

@app.route('/api/hf/data', methods=['GET'])
def api_hf_data_alias(): return _serve_latest('weights')


if __name__ == '__main__':
    print(f"Frontend dir: {FRONTEND_DIR}")
    print(f"Data dir:     {DATA_DIR}")
    print(f"History dir:  {HISTORY_DIR}")
    print(f"Tools:        {list(registry.TOOLS.keys())}")
    port = int(os.environ.get('INSIGHT_PORT', '8741'))
    print(f"Listening on: http://127.0.0.1:{port}")
    app.run(host='127.0.0.1', port=port, debug=False, threaded=True)

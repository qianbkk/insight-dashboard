"""
Flask 后端 API
- /api/ai-daily            触发AI日报抓取（异步，存到磁盘）
- /api/ai-daily/data       获取最近一次AI日报数据
- /api/github              触发GitHub热门抓取
- /api/github/data         获取最近一次GitHub数据
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

# 让相对路径基于 backend 目录
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.abspath(os.path.join(BASE_DIR, '..', 'data'))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, '..', 'frontend'))
os.makedirs(DATA_DIR, exist_ok=True)

app = Flask(__name__, static_folder=None)
CORS(app)

# 任务状态（线程安全简单实现）
TASK_STATE = {
    'ai_daily': {'status': 'idle', 'started_at': None, 'finished_at': None, 'error': None},
    'github': {'status': 'idle', 'started_at': None, 'finished_at': None, 'error': None},
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
                'finished_at': datetime.utcnow().isoformat() + 'Z',
                'error': None,
            }
    except Exception as e:
        with STATE_LOCK:
            TASK_STATE['ai_daily'] = {
                'status': 'error', 'started_at': TASK_STATE['ai_daily']['started_at'],
                'finished_at': datetime.utcnow().isoformat() + 'Z',
                'error': str(e),
            }


def _run_github():
    from github_trending import fetch_and_save
    out = os.path.join(DATA_DIR, 'github_trending_latest.json')
    with STATE_LOCK:
        TASK_STATE['github'] = {
            'status': 'running', 'started_at': datetime.utcnow().isoformat() + 'Z',
            'finished_at': None, 'error': None,
        }
    try:
        report = fetch_and_save(out)
        with STATE_LOCK:
            TASK_STATE['github'] = {
                'status': 'success', 'started_at': TASK_STATE['github']['started_at'],
                'finished_at': datetime.utcnow().isoformat() + 'Z',
                'error': None,
            }
    except Exception as e:
        with STATE_LOCK:
            TASK_STATE['github'] = {
                'status': 'error', 'started_at': TASK_STATE['github']['started_at'],
                'finished_at': datetime.utcnow().isoformat() + 'Z',
                'error': str(e),
            }


# ---------- API ----------
@app.route('/api/ai-daily', methods=['POST'])
def api_ai_daily():
    if TASK_STATE['ai_daily']['status'] == 'running':
        return jsonify({'ok': False, 'message': '已在抓取中', 'state': TASK_STATE['ai_daily']}), 409
    t = threading.Thread(target=_run_ai_daily, daemon=True)
    t.start()
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
    t = threading.Thread(target=_run_github, daemon=True)
    t.start()
    return jsonify({'ok': True, 'message': '已开始抓取GitHub热门', 'state': TASK_STATE['github']})


@app.route('/api/github/data', methods=['GET'])
def api_github_data():
    path = os.path.join(DATA_DIR, 'github_trending_latest.json')
    if not os.path.exists(path):
        return jsonify({'ok': False, 'message': '尚无数据', 'state': TASK_STATE['github']}), 404
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return jsonify({'ok': True, 'state': TASK_STATE['github'], 'data': data})


@app.route('/api/status', methods=['GET'])
def api_status():
    return jsonify({
        'ok': True,
        'state': TASK_STATE,
        'data_files': {
            'ai_daily': os.path.exists(os.path.join(DATA_DIR, 'ai_daily_latest.json')),
            'github': os.path.exists(os.path.join(DATA_DIR, 'github_trending_latest.json')),
        },
        'now': datetime.utcnow().isoformat() + 'Z',
    })


# ---------- 静态前端 ----------
@app.route('/')
def index():
    return send_from_directory(FRONTEND_DIR, 'index.html')


@app.route('/<path:path>')
def static_files(path):
    full = os.path.join(FRONTEND_DIR, path)
    if not os.path.exists(full):
        abort(404)
    return send_from_directory(FRONTEND_DIR, path)


if __name__ == '__main__':
    print(f"Frontend dir: {FRONTEND_DIR}")
    print(f"Data dir:     {DATA_DIR}")
    app.run(host='127.0.0.1', port=5173, debug=False, threaded=True)

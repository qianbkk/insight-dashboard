"""
Unified response envelope and helpers.
Every JSON response follows: {ok: bool, data?: any, error?: {code, message}}
"""
from typing import Any, Optional, Tuple
from flask import jsonify, Response


def ok(data: Any = None, status: int = 200, **extra) -> Tuple[Response, int]:
    body = {'ok': True, 'data': data}
    body.update(extra)
    return jsonify(body), status


def err(message: str, code: str = 'error', status: int = 400, **extra) -> Tuple[Response, int]:
    body = {'ok': False, 'error': {'code': code, 'message': message}}
    body.update(extra)
    return jsonify(body), status


def conflict(message: str) -> Tuple[Response, int]:
    return err(message, code='conflict', status=409)


def not_found(message: str = 'not found') -> Tuple[Response, int]:
    return err(message, code='not_found', status=404)


def forbidden(message: str = 'forbidden') -> Tuple[Response, int]:
    return err(message, code='forbidden', status=403)


def bad_request(message: str) -> Tuple[Response, int]:
    return err(message, code='bad_request', status=400)

"""
Agentish UI Server (UI-Only)

Supports two modes:

Single-challenge mode (standalone / legacy):
  Set CHALLENGISH_CONFIG_PATH to a challengish.yml file.
  Editor served at /, tools loaded from that one config.

Multi-challenge mode (deployment):
  Set CHALLENGES_DIR to a directory of challenge subdirs, each with challengish.yml.
  Challenge listing at /, editor at /<challenge_id>/.

Routes (multi-challenge):
  GET  /                                   — challenge listing
  GET  /<challenge_id>/                    — visual editor
  GET  /<challenge_id>/config.json         — frontend config
  GET  /<challenge_id>/api/mcp/tools       — MCP tools for challenge
  POST /<challenge_id>/api/bundle/download — download bundle ZIP
  GET  /<challenge_id>/<path>              — static assets
  GET  /api/challenges                     — list all challenges
  GET  /health                             — health check

Routes (single-challenge):
  GET  /                                   — visual editor
  GET  /config.json                        — frontend config
  GET  /api/mcp/tools                      — MCP tools
  POST /api/bundle/download                — download bundle ZIP
  GET  /<path>                             — static assets
  GET  /health                             — health check
"""

from flask import Flask, Blueprint, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
from html import escape as html_escape
import json
import os
import io
from typing import Dict, Any
from uuid import uuid4
import zipfile
import yaml

CHALLENGES_DIR        = os.environ.get("CHALLENGES_DIR", "challenges")
CHALLENGISH_CONFIG    = os.environ.get("CHALLENGISH_CONFIG_PATH", "")
URL_PREFIX            = os.environ.get("URL_PREFIX", "")  # e.g. "/editor" when behind nginx
FRONTEND_DIR          = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'frontend'))

app = Flask(__name__)
CORS(app)


# ---------- Config helpers ----------

def _load_config(path: str) -> Dict[str, Any]:
    try:
        if path and os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return yaml.safe_load(f) or {}
    except Exception as e:
        print(f"Warning: Could not load config from {path}: {e}")
    return {}


def _load_challenge_config(challenge_id: str) -> Dict[str, Any]:
    if not all(c.isalnum() or c in '-_' for c in challenge_id):
        return {}
    path = os.path.join(CHALLENGES_DIR, challenge_id, 'challengish.yml')
    return _load_config(path)


def _get_tools_from_config(config: Dict[str, Any]) -> list:
    all_tools = []
    for server in config.get('mcp_servers', []):
        if not server.get('enabled', True):
            continue
        server_name   = server.get('name', 'unknown')
        internal_host = server.get('internal_host', server_name)
        port          = server.get('port', 8002)
        base_url      = f"http://{internal_host}:{port}"
        for route in server.get('routes', []):
            fn   = route.get('function', 'unknown')
            ep   = route.get('endpoint', f'/mcp/{fn}')
            meth = route.get('method', 'GET').upper()
            all_tools.append({
                "name":          fn,
                "type":          "mcp",
                "description":   route.get('description', f"MCP tool '{fn}' from {server_name}"),
                "arguments":     route.get('arguments', []),
                "return_schema": route.get('return_schema', {"success": "bool"}),
                "mcp_server":    base_url,
                "mcp_method":    f"{meth} {ep}",
                "metadata":      {"server_name": server_name, "endpoint": ep, "method": meth}
            })
    return all_tools


def _get_tools_for_challenge(challenge_id: str) -> list:
    return _get_tools_from_config(_load_challenge_config(challenge_id))


def _list_challenges() -> list:
    challenges = []
    if not os.path.isdir(CHALLENGES_DIR):
        return challenges
    for name in sorted(os.listdir(CHALLENGES_DIR)):
        cfg_path = os.path.join(CHALLENGES_DIR, name, 'challengish.yml')
        if os.path.isfile(cfg_path):
            cfg = _load_config(cfg_path)
            challenges.append({"id": name, "name": cfg.get('challenge_name', name)})
    return challenges


def _is_multi_challenge() -> bool:
    """True if we have a CHALLENGES_DIR with at least one challenge."""
    return len(_list_challenges()) > 0


# ---------- Shared helpers ----------

def _serve_editor(challenge_base: str, challenge_name: str) -> str:
    with open(os.path.join(FRONTEND_DIR, 'index.html'), 'r', encoding='utf-8') as f:
        html = f.read()
    html = html.replace('{{CHALLENGE_BASE}}', html_escape(challenge_base))
    html = html.replace('{{CHALLENGE_NAME}}', html_escape(challenge_name))
    return html


def _make_bundle():
    data = request.json
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    asl_spec = data.get('asl') or data
    layout   = data.get('layout', {})
    bundle_uuid = str(uuid4())[:8]
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("asl.json", json.dumps(asl_spec, indent=2))
        if layout:
            zf.writestr("layout.json", json.dumps(layout, indent=2))
    zip_buffer.seek(0)
    return send_file(
        zip_buffer, mimetype='application/zip',
        as_attachment=True, download_name=f"agentish_bundle_{bundle_uuid}.zip"
    )


# ---------- Global routes ----------

@app.route('/health')
def health():
    mode = 'multi_challenge' if _is_multi_challenge() else 'single_challenge'
    return jsonify({'status': 'healthy', 'mode': mode, 'challenges': len(_list_challenges())})


@app.route('/api/challenges')
def api_challenges():
    return jsonify(_list_challenges())


# =====================================================================
# MODE SELECTION: single-challenge vs multi-challenge
# =====================================================================

_single_config = None  # loaded once at import time if applicable

if CHALLENGISH_CONFIG and os.path.isfile(CHALLENGISH_CONFIG):
    _single_config = _load_config(CHALLENGISH_CONFIG)

def _use_single_mode():
    """Single mode if we have a CHALLENGISH_CONFIG_PATH and no multi-challenge dir."""
    return _single_config is not None and not _is_multi_challenge()


# ---------- Single-challenge routes (legacy / standalone) ----------

single_bp = Blueprint('single', __name__)

@single_bp.route('/')
def single_index():
    name = _single_config.get('challenge_name', 'Agentish')
    return _serve_editor(URL_PREFIX, name)

@single_bp.route('/config.json')
def single_config():
    tools = _get_tools_from_config(_single_config)
    mcp_enabled = len(tools) > 0
    return jsonify({
        'mcp_enabled':        mcp_enabled,
        'mcp_tools_endpoint': f'{URL_PREFIX}/api/mcp/tools' if mcp_enabled else None,
        'mode':               'ui_only'
    })

@single_bp.route('/api/mcp/tools')
def single_mcp_tools():
    tools = _get_tools_from_config(_single_config)
    if not tools:
        return jsonify({'success': False, 'error': 'No MCP tools configured'}), 404
    server_status = {
        s['name']: {"status": "configured", "tools_count": len(s.get('routes', []))}
        for s in _single_config.get('mcp_servers', []) if s.get('enabled', True)
    }
    return jsonify({'success': True, 'tools': tools, 'server_status': server_status})

@single_bp.route('/api/bundle/download', methods=['POST'])
def single_bundle():
    return _make_bundle()

@single_bp.route('/<path:path>')
def single_static(path):
    return send_from_directory(FRONTEND_DIR, path)


# ---------- Multi-challenge routes (deployment) ----------

@app.route('/')
def root():
    if _use_single_mode():
        return single_index()
    return '', 404


challenge_bp = Blueprint('challenge', __name__, url_prefix='/<challenge_id>')

@challenge_bp.route('/')
def index(challenge_id):
    config = _load_challenge_config(challenge_id)
    if not config:
        return 'Challenge not found', 404
    name = config.get('challenge_name', challenge_id)
    return _serve_editor(f'{URL_PREFIX}/{challenge_id}', name)

@challenge_bp.route('/config.json')
def frontend_config(challenge_id):
    tools = _get_tools_for_challenge(challenge_id)
    mcp_enabled = len(tools) > 0
    return jsonify({
        'mcp_enabled':        mcp_enabled,
        'mcp_tools_endpoint': f'{URL_PREFIX}/{challenge_id}/api/mcp/tools' if mcp_enabled else None,
        'mode':               'ui_only'
    })

@challenge_bp.route('/api/mcp/tools')
def list_mcp_tools(challenge_id):
    tools = _get_tools_for_challenge(challenge_id)
    if not tools:
        return jsonify({'success': False, 'error': 'No MCP tools configured'}), 404
    config = _load_challenge_config(challenge_id)
    server_status = {
        s['name']: {"status": "configured", "tools_count": len(s.get('routes', []))}
        for s in config.get('mcp_servers', []) if s.get('enabled', True)
    }
    return jsonify({'success': True, 'tools': tools, 'server_status': server_status})

@challenge_bp.route('/api/bundle/download', methods=['POST'])
def download_bundle(challenge_id):
    return _make_bundle()

@challenge_bp.route('/<path:path>')
def serve_static(challenge_id, path):
    return send_from_directory(FRONTEND_DIR, path)


# ---------- Register blueprints ----------
# Single-challenge routes only registered when in single mode.
# We register at startup after checking the mode.

def _register_blueprints():
    if _use_single_mode():
        app.register_blueprint(single_bp)
        print("Mode: single-challenge")
        print(f"Config: {CHALLENGISH_CONFIG}")
    else:
        app.register_blueprint(challenge_bp)
        print("Mode: multi-challenge")
        print(f"Challenges dir: {CHALLENGES_DIR}")
        for c in _list_challenges():
            print(f"  /{c['id']}/ — {c['name']}")

_register_blueprints()


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description="Agentish UI Server")
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    print(f"Starting Agentish UI Server on port {args.port}")
    app.run(host='0.0.0.0', port=args.port,
            debug=os.environ.get('DEBUG', '').lower() in ('1', 'true'))

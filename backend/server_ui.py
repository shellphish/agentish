"""
Backend API Server for Agentish UI

Provides endpoints for:
- Serving the frontend UI
- MCP tool catalog (from sandbox.yml)
- ASL compilation and validation
- Bundle download (ZIP with ASL spec + state)

This server does NOT execute agents - that's handled by the sandbox container.
"""

from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
import json
import sys
import os
import tempfile
import io
from pathlib import Path
import argparse
from typing import Dict, Any, Optional
from uuid import uuid4
import zipfile

import yaml

# Configuration paths
SANDBOX_CONFIG_PATH = os.environ.get("SANDBOX_CONFIG_PATH", "/config/sandbox.yml")
CHALLENGISH_CONFIG_PATH = os.environ.get("CHALLENGISH_CONFIG_PATH", "/config/challengish.yml")

# Add compiler to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'compiler'))


def _load_config(path: str) -> Dict[str, Any]:
    """Load configuration from YAML file"""
    try:
        if path and os.path.exists(path):
            with open(path, "r", encoding="utf-8") as handle:
                return yaml.safe_load(handle) or {}
    except Exception as e:
        print(f"Warning: Could not load config from {path}: {e}")
    return {}


def _get_tools_from_config() -> list:
    """
    Parse challengish.yml to extract MCP tool definitions.
    This doesn't require connectivity to MCP servers.
    """
    config = _load_config(CHALLENGISH_CONFIG_PATH)
    mcp_servers = config.get('mcp_servers', [])

    all_tools = []
    for server in mcp_servers:
        if not server.get('enabled', True):
            continue

        server_name = server.get('name', 'unknown')
        internal_host = server.get('internal_host', server_name)
        port = server.get('port', 8002)
        base_url = f"http://{internal_host}:{port}"

        routes = server.get('routes', [])
        for route in routes:
            function_name = route.get('function', 'unknown')
            endpoint = route.get('endpoint', f'/mcp/{function_name}')
            method = route.get('method', 'GET').upper()

            tool = {
                "name": function_name,
                "type": "mcp",
                "description": route.get('description', f"MCP tool '{function_name}' from {server_name}"),
                "arguments": route.get('arguments', []),
                "return_schema": route.get('return_schema', {"success": "bool"}),
                "mcp_server": base_url,
                "mcp_method": f"{method} {endpoint}",
                "metadata": {
                    "server_name": server_name,
                    "endpoint": endpoint,
                    "method": method
                }
            }
            all_tools.append(tool)

    return all_tools


# Initialize Flask app
app = Flask(__name__, static_folder='../frontend')
CORS(app)

# Load tools from config at startup
MCP_TOOLS = _get_tools_from_config()
print(f"✅ Loaded {len(MCP_TOOLS)} MCP tool(s) from configuration")


@app.route('/')
def index():
    """Serve the main GUI"""
    return send_from_directory('../frontend', 'index.html')


@app.route('/<path:path>')
def serve_static(path):
    """Serve static files"""
    return send_from_directory('../frontend', path)


@app.route('/config.json', methods=['GET'])
def frontend_config():
    """Expose runtime configuration flags to the frontend."""
    mcp_enabled = len(MCP_TOOLS) > 0

    return jsonify({
        'mcp_enabled': mcp_enabled,
        'mcp_tools_endpoint': '/api/mcp/tools' if mcp_enabled else None,
        'mode': 'ui_only'  # Indicates this is the UI-only server
    })


@app.route('/api/mcp/tools', methods=['GET'])
def list_mcp_tools():
    """Return MCP tool definitions parsed from sandbox.yml."""

    if not MCP_TOOLS:
        return jsonify({
            'success': False,
            'error': 'No MCP tools configured'
        }), 404

    # Since we're parsing config directly, all servers are "available" from config perspective
    server_status = {}
    config = _load_config(CHALLENGISH_CONFIG_PATH)
    for server in config.get('mcp_servers', []):
        if server.get('enabled', True):
            server_name = server.get('name', 'unknown')
            server_status[server_name] = {
                "status": "configured",
                "tools_count": len(server.get('routes', [])),
                "note": "Health check performed at execution time"
            }

    return jsonify({
        'success': True,
        'tools': MCP_TOOLS,
        'server_status': server_status,
        'mcp_manager_enabled': True
    })


@app.route('/compile', methods=['POST'])
def compile_agent():
    """
    Compile ASL specification to LangGraph code

    Request body:
        JSON ASL specification

    Returns:
        {
            "success": bool,
            "code": str (if successful),
            "error": str (if failed)
        }
    """
    try:
        from compiler import compile_asl

        spec = request.json
        if not spec:
            return jsonify({'success': False, 'error': 'No specification provided'}), 400

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(spec, f)
            temp_path = Path(f.name)

        try:
            output_dir = Path(__file__).resolve().parents[1] / "output"
            success, generated_code = compile_asl(str(temp_path), output_dir=str(output_dir))

            if not success:
                return jsonify({'success': False, 'error': 'Compilation failed'}), 500

            if not generated_code:
                return jsonify({'success': False, 'error': 'No code generated by compiler'}), 500

            return jsonify({'success': True, 'code': generated_code})
        finally:
            if temp_path.exists():
                temp_path.unlink()

    except Exception as exc:
        return jsonify({'success': False, 'error': str(exc)}), 500


@app.route('/validate_tool_syntax', methods=['POST'])
def validate_tool_syntax():
    """
    Validate Python syntax of tool implementation code

    Request body:
        {
            "code": str - Python code to validate
        }

    Returns:
        {
            "valid": bool,
            "error": str (if invalid)
        }
    """
    try:
        import ast

        code = request.json.get('code', '')

        if not code:
            return jsonify({
                'valid': False,
                'error': 'No code provided'
            }), 400

        try:
            ast.parse(code)
            return jsonify({'valid': True})
        except SyntaxError as e:
            return jsonify({
                'valid': False,
                'error': f'Line {e.lineno}: {e.msg}'
            })
    except Exception as e:
        return jsonify({
            'valid': False,
            'error': str(e)
        }), 500


@app.route('/submission/download', methods=['POST'])
def download_submission():
    """
    Compile and validate an agent, then return it as a downloadable file.
    This is for previewing the generated code.
    """
    from compiler import compile_asl

    spec = request.json
    if not spec:
        return jsonify({'error': 'No specification provided'}), 400

    try:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(spec, f)
            temp_path = Path(f.name)

        try:
            output_dir = Path(__file__).resolve().parents[1] / "output"
            success, code = compile_asl(str(temp_path), output_dir=str(output_dir))

            if not success or not code:
                return jsonify({'error': 'Compilation failed'}), 500

            # Validate syntax
            compile(code, "<submitted_agent>", "exec")

        finally:
            if temp_path.exists():
                temp_path.unlink()

    except SyntaxError as exc:
        return jsonify({'error': f"Syntax error: {exc}"}), 400
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500

    buffer = io.BytesIO(code.encode('utf-8'))
    buffer.seek(0)
    filename = f"asl_agent_{uuid4().hex}.py"
    return send_file(
        buffer,
        mimetype='text/x-python',
        as_attachment=True,
        download_name=filename
    )


@app.route('/api/bundle/download', methods=['POST'])
def download_bundle():
    """
    Create and download a bundle ZIP containing:
    - {uuid}.asl.ish: The ASL specification (JSON)
    - state.json: Initial state configuration

    Request body:
        JSON ASL specification

    Returns:
        ZIP file download
    """
    spec = request.json
    if not spec:
        return jsonify({'error': 'No specification provided'}), 400

    # Create bundle
    bundle_uuid = str(uuid4())

    # Extract state schema from spec to create initial state
    graph_data = spec.get('graph', {})
    state_config = graph_data.get('state', {})
    schema = state_config.get('schema', {})

    # Build initial state values from schema
    initial_values = {}
    for field_name, field_type in schema.items():
        if 'int' in field_type.lower():
            initial_values[field_name] = 0
        elif 'list' in field_type.lower() or 'List' in field_type:
            initial_values[field_name] = []
        elif 'str' in field_type.lower():
            initial_values[field_name] = ""
        elif 'bool' in field_type.lower():
            initial_values[field_name] = False
        elif 'dict' in field_type.lower():
            initial_values[field_name] = {}
        else:
            initial_values[field_name] = None

    state_json = {
        "initial_values": initial_values,
        "schema": schema
    }

    # Create ZIP in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        # Add ASL spec
        asl_filename = f"{bundle_uuid}.asl.ish"
        zf.writestr(asl_filename, json.dumps(spec, indent=2))

        # Add state.json
        zf.writestr("state.json", json.dumps(state_json, indent=2))

    zip_buffer.seek(0)

    return send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name=f"bundle_{bundle_uuid[:8]}.zip"
    )


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'mode': 'ui_only',
        'mcp_tools_count': len(MCP_TOOLS)
    })


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Agentish UI Server")
    parser.add_argument('--port', type=int, default=8000, help='Port to run the server on (default: 8000)')
    args = parser.parse_args()

    print("🚀 Starting Agentish UI Server")
    print(f"📊 Frontend available at: http://localhost:{args.port}")
    print(f"🔧 API available at: http://localhost:{args.port}/compile")
    print(f"📦 Bundle download at: http://localhost:{args.port}/api/bundle/download")
    print()

    app.run(
        host='0.0.0.0',
        port=args.port,
        debug=True
    )

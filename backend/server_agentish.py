"""
Agentish UI Server (UI-Only)

This is the minimal server for the Agentish visual workflow editor.
It provides:
- Frontend serving (index.html, asl_editor.js, etc.)
- MCP tool catalog from challengish.yml
- Bundle download (ZIP with layout.json + asl.json)

This server does NOT compile or execute agents - that functionality
is handled by the agentish-ctf execution environment.
"""

from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
import json
import os
import io
from typing import Dict, Any
from uuid import uuid4
import zipfile

import yaml

# Configuration paths
CHALLENGISH_CONFIG_PATH = os.environ.get("CHALLENGISH_CONFIG_PATH", "challengish.yml")


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
if MCP_TOOLS:
    print(f"Loaded {len(MCP_TOOLS)} MCP tool(s) from configuration")
else:
    print("No MCP tools configured (set CHALLENGISH_CONFIG_PATH to load tools)")


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
        'mode': 'ui_only'
    })


@app.route('/api/mcp/tools', methods=['GET'])
def list_mcp_tools():
    """Return MCP tool definitions parsed from challengish.yml."""

    if not MCP_TOOLS:
        return jsonify({
            'success': False,
            'error': 'No MCP tools configured'
        }), 404

    # Since we're parsing config directly, all servers are "configured"
    server_status = {}
    config = _load_config(CHALLENGISH_CONFIG_PATH)
    for server in config.get('mcp_servers', []):
        if server.get('enabled', True):
            server_name = server.get('name', 'unknown')
            server_status[server_name] = {
                "status": "configured",
                "tools_count": len(server.get('routes', [])),
                "note": "Execution handled by agentish-ctf"
            }

    return jsonify({
        'success': True,
        'tools': MCP_TOOLS,
        'server_status': server_status,
        'mcp_manager_enabled': True
    })


@app.route('/api/bundle/download', methods=['POST'])
def download_bundle():
    """
    Create and download a bundle ZIP containing:
    - asl.json: The ASL specification
    - layout.json: The visual layout of the graph

    Request body:
        {
            "asl": {...},      // ASL specification
            "layout": {...}    // Visual layout (optional)
        }

    Returns:
        ZIP file download
    """
    data = request.json
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    asl_spec = data.get('asl') or data  # Support both formats
    layout = data.get('layout', {})

    # Create bundle
    bundle_uuid = str(uuid4())[:8]

    # Create ZIP in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        # Add ASL spec
        zf.writestr("asl.json", json.dumps(asl_spec, indent=2))

        # Add layout if provided
        if layout:
            zf.writestr("layout.json", json.dumps(layout, indent=2))

    zip_buffer.seek(0)

    return send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name=f"agentish_bundle_{bundle_uuid}.zip"
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
    import argparse

    parser = argparse.ArgumentParser(description="Agentish UI Server")
    parser.add_argument('--port', type=int, default=8000, help='Port to run the server on (default: 8000)')
    args = parser.parse_args()

    print("Starting Agentish UI Server")
    print(f"Frontend available at: http://localhost:{args.port}")
    print(f"MCP Tools endpoint: http://localhost:{args.port}/api/mcp/tools")
    print(f"Bundle download: http://localhost:{args.port}/api/bundle/download")
    print()

    app.run(
        host='0.0.0.0',
        port=args.port,
        debug=True
    )

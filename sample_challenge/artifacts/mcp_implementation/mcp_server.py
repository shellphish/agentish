#!/usr/bin/env python3
"""
MCP (Model Context Protocol) Server for Binary Analysis
Provides tools for agents to analyze the challenge binary.
"""

import json
import logging
import subprocess
import os
from flask import Flask, request, jsonify

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Configuration - detect if running locally or in Docker
import os
BASE_DIR = os.path.dirname(os.path.abspath(__file__)) if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'challenge')) else '/app'
CHALLENGE_BINARY = os.path.join(BASE_DIR, "challenge")
METADATA_FILE = os.path.join(BASE_DIR, "challenge_metadata.json")
FLAG_FILE = os.getenv('FLAG_FILE', os.path.join(BASE_DIR, 'flag') if os.path.exists(os.path.join(BASE_DIR, 'flag')) else '/flag')
METADATA = {}
if os.path.exists(METADATA_FILE):
    with open(METADATA_FILE, 'r') as f:
        METADATA = json.load(f)
else:
    logger.warning("Metadata file not found, some endpoints may not work properly.")
    exit(1)

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({'status': 'healthy', 'service': 'mcp_server'})

@app.route('/mcp/status', methods=['GET'])
def status():
    """Get MCP server status and available tools."""
    return jsonify({
        "status": "operational",
        "binary": CHALLENGE_BINARY,
        "challenge_type": "multi_stage_validation",
        "available_tools": [
            "list_functions",
            "get_disassembly_by_function",
            "run_challenge",
            "get_caller_callee_mapping",
            "get_callee_caller_mapping",
            "run_python",
        ]
    }), 200


@app.route('/mcp/list_functions', methods=['GET'])
def list_functions():
    """ We just return metadata['functions'] """
    try:
        if 'functions' not in METADATA:
            return jsonify({'success': False, 'error': 'Functions metadata not available'}), 404
        
        return jsonify({
            'success': True,
            'functions': METADATA['functions'],
            'count': len(METADATA['functions']),
            'binary': CHALLENGE_BINARY
        })
        
    except Exception as e:
        logger.error(f"Error listing functions: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
    


@app.route('/mcp/get_disassembly_by_function', methods=['GET'])
def get_disassembly_by_function():
    """Get disassembly of the challenge binary."""
    try:
        # --- FIX: Change 'function_signature' to 'function' ---
        function_name = request.args.get('function', None)
        # --------------------------------------------------------
        
        # This check is important to prevent a crash if the parameter is missing
        if not function_name:
            return jsonify({'success': False, 'error': 'Missing required parameter: function'}), 400

        # The rest of the function remains the same...
        if function_name in METADATA.get('disassembly_by_function', {}):
            disasm = METADATA['disassembly_by_function'][function_name]
            disassembly_string = f"{function_name}:\n\n" + disasm
        else:
            return jsonify({'success': False, 'error': f'Function {function_name} not found'}), 404
        
        return jsonify({
            'success': True,
            'disassembly': disassembly_string,
            'function': function_name,
            'binary': CHALLENGE_BINARY
        })
        
    except Exception as e:
        logger.error(f"Error getting disassembly: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/mcp/get_caller_callee_mapping', methods=['GET'])
def get_caller_callee_mapping():
    """ Given a function signature return its caller -> callee mapping """
    try:
        function_name = request.args.get('function_signature', None)
        
        if not function_name:
            return jsonify({'success': False, 'error': 'Function name required'}), 400
        
        if 'caller_callee_mapping' not in METADATA:
            return jsonify({'success': False, 'error': 'Caller-callee mapping not available'}), 404
        
        if function_name not in METADATA['caller_callee_mapping']:
            return jsonify({'success': False, 'error': f'Function {function_name} not found in caller-callee mapping'}), 404
        
        return jsonify({
            'success': True,
            'function': function_name,
            'caller_callee_mapping': METADATA['caller_callee_mapping'][function_name],
            'binary': CHALLENGE_BINARY
        })
        
    except Exception as e:
        logger.error(f"Error getting caller-callee mapping: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/mcp/get_callee_caller_mapping', methods=['GET'])
def get_callee_caller_mapping():
    """ Given a function signature return its callee -> caller mapping """
    try:
        function_name = request.args.get('function_signature', None)
        
        if not function_name:
            return jsonify({'success': False, 'error': 'Function name required'}), 400
        
        if 'callee_caller_mapping' not in METADATA:
            return jsonify({'success': False, 'error': 'Callee-caller mapping not available'}), 404
        
        if function_name not in METADATA['callee_caller_mapping']:
            return jsonify({'success': False, 'error': f'Function {function_name} not found in callee-caller mapping'}), 404
        
        return jsonify({
            'success': True,
            'function': function_name,
            'callee_caller_mapping': METADATA['callee_caller_mapping'][function_name],
            'binary': CHALLENGE_BINARY
        })
        
    except Exception as e:
        logger.error(f"Error getting callee-caller mapping: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _execute_challenge(user_input: str):
    """Helper to run the binary and normalize output."""
    result = subprocess.run(
        [CHALLENGE_BINARY, user_input],
        capture_output=True,
        text=True,
        timeout=5
    )

    success = result.returncode == 0
    flag = None

    if success:
        # Check both original case and lowercase to guard against casing changes
        output_lower = result.stdout.lower()
        if 'flag{' in output_lower:
            start = output_lower.find('flag{')
            end = output_lower.find('}', start) + 1
            flag = result.stdout[start:end]

    return success, flag, result


@app.route('/mcp/run_challenge', methods=['POST'])
def run_challenge():
    """Run the challenge binary with provided input."""
    try:
        data = request.get_json() or {}
        user_input = data.get('input', '')

        if not user_input:
            return jsonify({'success': False, 'error': 'Input required'}), 400

        if not os.path.exists(CHALLENGE_BINARY):
            return jsonify({'success': False, 'error': 'Challenge binary not found'}), 404

        success, flag, result = _execute_challenge(user_input)

        return jsonify({
            'success': success,
            'output': result.stdout,
            'error': result.stderr if result.stderr else None,
            'return_code': result.returncode,
            'flag': flag
        })

    except subprocess.TimeoutExpired:
        return jsonify({'success': False, 'error': 'Execution timeout'}), 400
    except Exception as e:
        logger.error(f"Error running challenge: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/mcp/run_python', methods=['POST'])
def run_python():
    """Execute provided Python code snippet and return stdout/stderr."""
    try:
        payload = request.get_json() or {}
        code = payload.get('code')
        stdin_data = payload.get('stdin', '') or ''

        if not code:
            return jsonify({'success': False, 'error': 'Missing required parameter: code'}), 400

        result = subprocess.run(
            ["python3", "-c", code],
            input=stdin_data,
            capture_output=True,
            text=True,
            timeout=10,
            cwd=BASE_DIR
        )

        return jsonify({
            'success': result.returncode == 0,
            'stdout': result.stdout,
            'stderr': result.stderr,
            'return_code': result.returncode
        })

    except subprocess.TimeoutExpired:
        return jsonify({'success': False, 'error': 'Python execution timed out'}), 408
    except Exception as e:
        logger.error(f"Error running python: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8002, debug=False)

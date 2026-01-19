"""
Backend API Server for Agentish Sandbox

Provides endpoints for:
- Accepting bundle uploads (ZIP with ASL spec)
- Compiling ASL to Python
- Executing agents in a sandbox
- Downloading results (generated code, final state)

This server handles execution and requires access to MCP containers.
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
from datetime import datetime
import threading
import subprocess
import shutil
import zipfile

import yaml

# Configuration paths
SANDBOX_CONFIG_PATH = os.environ.get("SANDBOX_CONFIG_PATH", "/config/sandbox.yml")
CHALLENGISH_CONFIG_PATH = os.environ.get("CHALLENGISH_CONFIG_PATH", "/config/challengish.yml")
SUBMISSION_OUTPUT_DIR = os.environ.get("SUBMISSION_OUTPUT_DIR", "/workspace/submissions")
SUBMISSION_LOG_DIR = os.environ.get("SUBMISSION_LOG_DIR", "/workspace/logs")

# Add compiler to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'compiler'))


def _load_sandbox_config() -> Dict[str, Any]:
    """Load sandbox configuration from YAML file (contains both model and MCP config)"""
    try:
        if SANDBOX_CONFIG_PATH and os.path.exists(SANDBOX_CONFIG_PATH):
            with open(SANDBOX_CONFIG_PATH, "r", encoding="utf-8") as handle:
                return yaml.safe_load(handle) or {}
    except Exception as e:
        print(f"Warning: Could not load sandbox config: {e}")
    return {}


SANDBOX_CONFIG = _load_sandbox_config()
LANGFUSE_SECTION = SANDBOX_CONFIG.get("langfuse") or {}


def _get_langfuse_value(env_var: str, config_key: str) -> str:
    """Get Langfuse configuration value from env or config"""
    env_value = os.environ.get(env_var)
    if env_value:
        return env_value

    if not isinstance(LANGFUSE_SECTION, dict):
        return None

    candidate_keys = [config_key, config_key.upper()]
    if config_key == "host":
        candidate_keys.extend(["base_url", "BASE_URL", "url", "URL", "endpoint", "ENDPOINT"])
    elif config_key == "public_key":
        candidate_keys.extend(["LANGFUSE_PUBLIC_KEY", "PUBLIC_KEY"])
    elif config_key == "secret_key":
        candidate_keys.extend(["LANGFUSE_SECRET_KEY", "SECRET_KEY"])

    for key in candidate_keys:
        value = LANGFUSE_SECTION.get(key)
        if value:
            return value
    return None


LANGFUSE_HOST = _get_langfuse_value("LANGFUSE_HOST", "host")
LANGFUSE_PUBLIC_KEY = _get_langfuse_value("LANGFUSE_PUBLIC_KEY", "public_key")
LANGFUSE_SECRET_KEY = _get_langfuse_value("LANGFUSE_SECRET_KEY", "secret_key")
LANGFUSE_ENABLED = all([LANGFUSE_HOST, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY])


# Initialize Flask app
app = Flask(__name__, static_folder='../frontend')
CORS(app)

# Job storage
JOBS: Dict[str, Dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()

# Sandbox runner script
SANDBOX_RUNNER_SCRIPT = """\
import importlib.util
import json
import sys

agent_path = sys.argv[1]

spec = importlib.util.spec_from_file_location("submitted_agent", agent_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

result = module.run({})
print("===FINAL_STATE_START===")
print(json.dumps(result, default=str))
print("===FINAL_STATE_END===")
"""


def _ensure_dir(path: str) -> Path:
    """Ensure directory exists and return Path"""
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def _init_job(job_id: str) -> Dict[str, Any]:
    """Initialize a new job"""
    return {
        "id": job_id,
        "status": "pending",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "asl_filename": None,
        "compile": {"status": "pending", "details": ""},
        "syntax": {"status": "pending", "details": ""},
        "execution": {
            "status": "pending",
            "details": "",
            "stdout": "",
            "stderr": "",
            "final_state": None
        },
        "code": None,
        "error": None,
        "langfuse_url": None
    }


def _get_langfuse_project_url() -> Optional[str]:
    """
    Get the Langfuse project URL by querying the Langfuse API.
    
    Returns the full URL like: http://host/project/project-id/
    Returns None if Langfuse is not configured or if the request fails.
    """
    if not LANGFUSE_ENABLED:
        return None
    
    try:
        import requests
        
        # Check health endpoint
        health_url = f"{LANGFUSE_HOST}/api/public/health"
        health_response = requests.get(health_url, timeout=5)
        if not health_response.ok:
            print(f"Langfuse health check failed: {health_response.status_code}")
            return None
        
        # Get projects
        projects_url = f"{LANGFUSE_HOST}/api/public/projects"
        auth = (LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY)
        projects_response = requests.get(projects_url, auth=auth, timeout=5)
        
        if not projects_response.ok:
            print(f"Langfuse projects API failed: {projects_response.status_code}")
            return None
        
        projects_data = projects_response.json()
        if not projects_data.get('data') or len(projects_data['data']) == 0:
            print("No Langfuse projects found")
            return None
        
        # Get the first project ID
        project_id = projects_data['data'][0]['id']
        return f"{LANGFUSE_HOST}/project/{project_id}/"
        
    except Exception as e:
        print(f"Failed to get Langfuse project URL: {e}")
        return None


def _update_job(job_id: str, updates: Dict[str, Any]) -> None:
    """Update job with new data"""
    with JOBS_LOCK:
        if job_id in JOBS:
            for key, value in updates.items():
                if isinstance(value, dict) and key in JOBS[job_id] and isinstance(JOBS[job_id][key], dict):
                    JOBS[job_id][key].update(value)
                else:
                    JOBS[job_id][key] = value


def _get_job(job_id: str) -> Optional[Dict[str, Any]]:
    """Get a copy of job data"""
    with JOBS_LOCK:
        if job_id in JOBS:
            return json.loads(json.dumps(JOBS[job_id]))
    return None


def _compile_asl(spec: Dict[str, Any]) -> tuple:
    """
    Compile ASL spec to Python code.
    Returns (success: bool, code: str, error: str)
    """
    from compiler import compile_asl

    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(spec, f)
        temp_path = Path(f.name)

    try:
        output_dir = _ensure_dir(SUBMISSION_OUTPUT_DIR)
        success, code = compile_asl(str(temp_path), output_dir=str(output_dir))

        if not success or not code:
            return False, None, "Compilation failed"

        return True, code, None
    except Exception as e:
        return False, None, str(e)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def _execute_in_sandbox(job_id: str, code: str, initial_state: Dict[str, Any]) -> Dict[str, Any]:
    """
    Execute agent code in sandbox subprocess.
    Returns execution result dict.
    """
    result = {
        "success": False,
        "stdout": "",
        "stderr": "",
        "final_state": None,
        "error": None
    }

    try:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)

            # Write agent code
            agent_path = tmp_path / "agent.py"
            agent_path.write_text(code, encoding='utf-8')

            # Write runner script
            runner_path = tmp_path / "runner.py"
            runner_path.write_text(SANDBOX_RUNNER_SCRIPT, encoding='utf-8')

            # Copy config files if available
            if SANDBOX_CONFIG_PATH and os.path.exists(SANDBOX_CONFIG_PATH):
                shutil.copy(SANDBOX_CONFIG_PATH, tmp_path / "sandbox.yml")
            if CHALLENGISH_CONFIG_PATH and os.path.exists(CHALLENGISH_CONFIG_PATH):
                shutil.copy(CHALLENGISH_CONFIG_PATH, tmp_path / "challengish.yml")

            # Set up environment
            env = os.environ.copy()
            env.setdefault("PYTHONUNBUFFERED", "1")
            env["SANDBOX_CONFIG_PATH"] = str(tmp_path / "sandbox.yml")
            env["CHALLENGISH_CONFIG_PATH"] = str(tmp_path / "challengish.yml")
            # Also set MODEL_CONFIG_PATH for backward compatibility with compiled code
            env["MODEL_CONFIG_PATH"] = str(tmp_path / "sandbox.yml")

            # Run agent
            process = subprocess.run(
                ["python3", str(runner_path), str(agent_path)],
                capture_output=True,
                text=True,
                timeout=600,  # 10 minute timeout
                env=env,
                cwd=str(tmp_path)
            )

            result["stdout"] = process.stdout
            result["stderr"] = process.stderr

            # Extract final state from output
            stdout = process.stdout
            if "===FINAL_STATE_START===" in stdout and "===FINAL_STATE_END===" in stdout:
                start = stdout.index("===FINAL_STATE_START===") + len("===FINAL_STATE_START===")
                end = stdout.index("===FINAL_STATE_END===")
                state_json = stdout[start:end].strip()
                try:
                    result["final_state"] = json.loads(state_json)
                except json.JSONDecodeError:
                    result["final_state"] = {"raw": state_json}

            if process.returncode == 0:
                result["success"] = True
            else:
                result["error"] = f"Process exited with code {process.returncode}"

    except subprocess.TimeoutExpired as e:
        result["stdout"] = e.stdout or ""
        result["stderr"] = e.stderr or ""
        result["error"] = "Execution timed out (10 minutes)"

    except Exception as e:
        result["error"] = str(e)

    return result


def _run_job(job_id: str, spec: Dict[str, Any], initial_state: Dict[str, Any]) -> None:
    """Run the full compilation and execution pipeline"""
    _update_job(job_id, {"status": "running"})

    # Step 1: Compile
    _update_job(job_id, {"compile": {"status": "in_progress", "details": "Compiling ASL to Python..."}})
    success, code, error = _compile_asl(spec)

    if not success:
        _update_job(job_id, {
            "status": "error",
            "compile": {"status": "error", "details": error},
            "error": f"Compilation failed: {error}"
        })
        return

    _update_job(job_id, {
        "compile": {"status": "success", "details": f"Generated {len(code.splitlines())} lines"},
        "code": code
    })

    # Save generated code
    try:
        output_dir = _ensure_dir(SUBMISSION_OUTPUT_DIR)
        code_path = output_dir / f"{job_id}.py"
        code_path.write_text(code, encoding='utf-8')
    except Exception:
        pass

    # Step 2: Syntax check
    _update_job(job_id, {"syntax": {"status": "in_progress", "details": "Validating Python syntax..."}})
    try:
        compile(code, "<submitted_agent>", "exec")
        _update_job(job_id, {"syntax": {"status": "success", "details": "Syntax valid"}})
    except SyntaxError as e:
        _update_job(job_id, {
            "status": "error",
            "syntax": {"status": "error", "details": str(e)},
            "error": f"Syntax error: {e}"
        })
        return

    # Step 3: Execute
    _update_job(job_id, {"execution": {"status": "in_progress", "details": "Executing agent..."}})
    exec_result = _execute_in_sandbox(job_id, code, initial_state)

    # Save logs
    try:
        log_dir = _ensure_dir(SUBMISSION_LOG_DIR)
        log_path = log_dir / f"{job_id}.log"
        log_content = f"=== STDOUT ===\n{exec_result['stdout']}\n\n=== STDERR ===\n{exec_result['stderr']}"
        if exec_result.get('error'):
            log_content += f"\n\n=== ERROR ===\n{exec_result['error']}"
        log_path.write_text(log_content, encoding='utf-8')
    except Exception:
        pass

    # Save final state
    if exec_result.get('final_state'):
        try:
            output_dir = _ensure_dir(SUBMISSION_OUTPUT_DIR)
            state_path = output_dir / f"{job_id}_final_state.json"
            state_path.write_text(json.dumps(exec_result['final_state'], indent=2), encoding='utf-8')
        except Exception:
            pass

    if exec_result['success']:
        _update_job(job_id, {
            "status": "success",
            "execution": {
                "status": "success",
                "details": "Execution completed",
                "stdout": exec_result['stdout'],
                "stderr": exec_result['stderr'],
                "final_state": exec_result['final_state']
            }
        })
    else:
        _update_job(job_id, {
            "status": "error",
            "execution": {
                "status": "error",
                "details": exec_result.get('error', 'Unknown error'),
                "stdout": exec_result['stdout'],
                "stderr": exec_result['stderr'],
                "final_state": exec_result.get('final_state')
            },
            "error": exec_result.get('error')
        })


@app.route('/')
def index():
    """Serve the sandbox UI"""
    return send_from_directory('../frontend', 'sandbox.html')


@app.route('/<path:path>')
def serve_static(path):
    """Serve static files"""
    return send_from_directory('../frontend', path)


@app.route('/api/upload', methods=['POST'])
def upload_bundle():
    """
    Accept a bundle ZIP file and start execution.

    Expects multipart form data with 'bundle' file field.

    Returns:
        {
            "success": bool,
            "job_id": str,
            "error": str (if failed)
        }
    """
    if 'bundle' not in request.files:
        return jsonify({'success': False, 'error': 'No bundle file provided'}), 400

    bundle_file = request.files['bundle']
    if bundle_file.filename == '':
        return jsonify({'success': False, 'error': 'No file selected'}), 400

    try:
        # Read and extract ZIP
        zip_data = io.BytesIO(bundle_file.read())
        with zipfile.ZipFile(zip_data, 'r') as zf:
            file_list = zf.namelist()

            # Find ASL file
            asl_file = None
            for f in file_list:
                if f.endswith('.asl.ish'):
                    asl_file = f
                    break

            if not asl_file:
                return jsonify({'success': False, 'error': 'No .asl.ish file found in bundle'}), 400

            # Read ASL spec
            asl_content = zf.read(asl_file).decode('utf-8')
            spec = json.loads(asl_content)

            # Read state.json if present
            initial_state = {}
            if 'state.json' in file_list:
                state_content = zf.read('state.json').decode('utf-8')
                state_data = json.loads(state_content)
                initial_state = state_data.get('initial_values', {})

    except zipfile.BadZipFile:
        return jsonify({'success': False, 'error': 'Invalid ZIP file'}), 400
    except json.JSONDecodeError as e:
        return jsonify({'success': False, 'error': f'Invalid JSON in bundle: {e}'}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': f'Error processing bundle: {e}'}), 500

    # Create job
    job_id = str(uuid4())
    job = _init_job(job_id)
    job['asl_filename'] = asl_file
    
    # Get Langfuse project URL if available
    langfuse_url = _get_langfuse_project_url()
    if langfuse_url:
        job['langfuse_url'] = langfuse_url

    with JOBS_LOCK:
        JOBS[job_id] = job

    # Save ASL spec
    try:
        output_dir = _ensure_dir(SUBMISSION_OUTPUT_DIR)
        asl_path = output_dir / f"{job_id}.asl.json"
        asl_path.write_text(json.dumps(spec, indent=2), encoding='utf-8')
    except Exception:
        pass

    # Start execution in background
    worker = threading.Thread(target=_run_job, args=(job_id, spec, initial_state), daemon=True)
    worker.start()

    return jsonify({
        'success': True,
        'job_id': job_id
    })


@app.route('/api/status/<job_id>', methods=['GET'])
def get_status(job_id: str):
    """Get job status and execution results"""
    job = _get_job(job_id)
    if not job:
        return jsonify({'success': False, 'error': 'Job not found'}), 404

    return jsonify({
        'success': True,
        'job': job
    })


@app.route('/api/download/<job_id>/code', methods=['GET'])
def download_code(job_id: str):
    """Download generated Python code"""
    job = _get_job(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404

    code = job.get('code')
    if not code:
        # Try to read from file
        try:
            output_dir = Path(SUBMISSION_OUTPUT_DIR)
            code_path = output_dir / f"{job_id}.py"
            if code_path.exists():
                code = code_path.read_text(encoding='utf-8')
        except Exception:
            pass

    if not code:
        return jsonify({'error': 'Generated code not available'}), 404

    buffer = io.BytesIO(code.encode('utf-8'))
    buffer.seek(0)
    return send_file(
        buffer,
        mimetype='text/x-python',
        as_attachment=True,
        download_name=f"agent_{job_id[:8]}.py"
    )


@app.route('/api/download/<job_id>/state', methods=['GET'])
def download_state(job_id: str):
    """Download final state JSON"""
    job = _get_job(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404

    final_state = job.get('execution', {}).get('final_state')
    if not final_state:
        # Try to read from file
        try:
            output_dir = Path(SUBMISSION_OUTPUT_DIR)
            state_path = output_dir / f"{job_id}_final_state.json"
            if state_path.exists():
                final_state = json.loads(state_path.read_text(encoding='utf-8'))
        except Exception:
            pass

    if not final_state:
        return jsonify({'error': 'Final state not available'}), 404

    buffer = io.BytesIO(json.dumps(final_state, indent=2).encode('utf-8'))
    buffer.seek(0)
    return send_file(
        buffer,
        mimetype='application/json',
        as_attachment=True,
        download_name=f"final_state_{job_id[:8]}.json"
    )


@app.route('/api/download/<job_id>/logs', methods=['GET'])
def download_logs(job_id: str):
    """Download execution logs"""
    job = _get_job(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404

    stdout = job.get('execution', {}).get('stdout', '')
    stderr = job.get('execution', {}).get('stderr', '')

    if not stdout and not stderr:
        # Try to read from file
        try:
            log_dir = Path(SUBMISSION_LOG_DIR)
            log_path = log_dir / f"{job_id}.log"
            if log_path.exists():
                log_content = log_path.read_text(encoding='utf-8')
                buffer = io.BytesIO(log_content.encode('utf-8'))
                buffer.seek(0)
                return send_file(
                    buffer,
                    mimetype='text/plain',
                    as_attachment=True,
                    download_name=f"logs_{job_id[:8]}.txt"
                )
        except Exception:
            pass
        return jsonify({'error': 'Logs not available'}), 404

    log_content = f"=== STDOUT ===\n{stdout}\n\n=== STDERR ===\n{stderr}"
    buffer = io.BytesIO(log_content.encode('utf-8'))
    buffer.seek(0)
    return send_file(
        buffer,
        mimetype='text/plain',
        as_attachment=True,
        download_name=f"logs_{job_id[:8]}.txt"
    )


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'mode': 'sandbox',
        'langfuse_enabled': LANGFUSE_ENABLED
    })


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Agentish Sandbox Server")
    parser.add_argument('--port', type=int, default=8001, help='Port to run the server on (default: 8001)')
    args = parser.parse_args()

    print("🚀 Starting Agentish Sandbox Server")
    print(f"📊 Sandbox UI at: http://localhost:{args.port}")
    print(f"📤 Upload endpoint: http://localhost:{args.port}/api/upload")
    print(f"🔍 Langfuse enabled: {LANGFUSE_ENABLED}")
    print()

    app.run(
        host='0.0.0.0',
        port=args.port,
        debug=True
    )

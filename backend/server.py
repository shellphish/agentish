"""
Backend API Server for ASL Lang Graph

Provides endpoints for:
- Compiling ASL to LangGraph
- Serving the frontend
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
from typing import Dict, Any, List, Optional
from uuid import uuid4
from datetime import datetime
import threading
import subprocess
import shutil

import requests
import yaml

MODEL_CONFIG_PATH = os.environ.get("MODEL_CONFIG_PATH", "model_config.yaml")


def _load_model_config():
    try:
        if MODEL_CONFIG_PATH and os.path.exists(MODEL_CONFIG_PATH):
            with open(MODEL_CONFIG_PATH, "r", encoding="utf-8") as handle:
                return yaml.safe_load(handle) or {}
    except Exception:
        pass
    return {}


MODEL_CONFIG = _load_model_config()
LANGFUSE_SECTION = MODEL_CONFIG.get("langfuse") or {}


def _get_langfuse_value(env_var: str, config_key: str) -> str:
    env_value = os.environ.get(env_var)
    if env_value:
        return env_value

    if not isinstance(LANGFUSE_SECTION, dict):
        return None

    candidate_keys = [config_key, config_key.upper()]
    if config_key == "host":
        candidate_keys.extend([
            "base_url",
            "BASE_URL",
            "url",
            "URL",
            "endpoint",
            "ENDPOINT",
            "LANGFUSE_BASE_URL",
        ])
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

# Add compiler to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'compiler'))
from compiler import compile_asl
from config_parser import ConfigParser
from config_validator import ConfigValidator

# Import MCP manager
from mcp_manager import MCPManager

app = Flask(__name__, static_folder='../frontend')
CORS(app)

# Initialize configuration
try:
    CONFIG_PARSER = ConfigParser(MODEL_CONFIG_PATH)
    CONFIG_VALIDATOR = ConfigValidator(CONFIG_PARSER)

    # Validate configuration at startup (without connectivity check for now)
    # Connectivity will be checked when MCP tools are requested
    CONFIG_VALIDATOR.validate_all(check_connectivity=False)
    print("✅ Configuration loaded successfully")

    # Initialize MCP Manager
    MCP_MANAGER = MCPManager(CONFIG_PARSER)
    if MCP_MANAGER.has_servers():
        print(f"✅ MCP Manager initialized with {len(MCP_MANAGER.servers)} server(s)")
    else:
        print("ℹ️  No MCP servers configured")

except Exception as e:
    print(f"⚠️  Configuration warning: {e}")
    print("   Some features may not be available")
    CONFIG_PARSER = None
    MCP_MANAGER = None

SUBMISSION_JOBS: Dict[str, Dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()
SUBMISSION_LOG_DIR = os.environ.get("SUBMISSION_LOG_DIR")
SUBMISSION_OUTPUT_DIR = os.environ.get("SUBMISSION_OUTPUT_DIR", "/workspace/submissions")

SANDBOX_RUNNER_SCRIPT = """\
import importlib.util
import json
import sys

agent_path = sys.argv[1]

spec = importlib.util.spec_from_file_location("submitted_agent", agent_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

result = module.run({})
print(json.dumps(result, default=str))
"""


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
    mcp_enabled = MCP_MANAGER and MCP_MANAGER.has_servers()

    return jsonify({
        'mcp_enabled': mcp_enabled,
        'mcp_tools_endpoint': '/api/mcp/tools' if mcp_enabled else None
    })


@app.route('/api/mcp/tools', methods=['GET'])
def list_mcp_tools():
    """Return MCP tool definitions from configured MCP servers."""

    if not MCP_MANAGER or not MCP_MANAGER.has_servers():
        return jsonify({
            'success': False,
            'error': 'MCP integration is not configured'
        }), 404

    try:
        result = MCP_MANAGER.get_tools_with_health()

        return jsonify({
            'success': True,
            'tools': result['tools'],
            'server_status': result['server_status'],
            'mcp_manager_enabled': True
        })

    except Exception as exc:
        return jsonify({
            'success': False,
            'error': f'Failed to load MCP tools: {exc}',
            'server_status': {}
        }), 500



class SandboxExecutionError(RuntimeError):
    def __init__(self, message: str, stdout: str = "", stderr: str = "", trace_url: str = None):
        super().__init__(message)
        self.stdout = stdout
        self.stderr = stderr
        self.trace_url = trace_url


def _init_submission_job(job_id: str) -> Dict[str, Any]:
    timestamp = datetime.utcnow().isoformat() + "Z"
    return {
        "id": job_id,
        "status": "pending",
        "created_at": timestamp,
        "steps": {
            "compile": {"status": "pending", "details": ""},
            "syntax": {"status": "pending", "details": ""},
            "execution": {
                "status": "pending",
                "details": "",
                "trace_url": None,
                "stdout": "",
                "stderr": "",
                "substeps": {
                    "prepare": {"status": "pending", "details": ""},
                    "run": {"status": "pending", "details": ""},
                    "langfuse": {"status": "pending", "details": ""},
                },
            },
        },
    }


def _job_snapshot(job_id: str) -> Dict[str, Any]:
    with JOBS_LOCK:
        job = SUBMISSION_JOBS.get(job_id)
        if not job:
            return None
        return json.loads(json.dumps(job))


def _ensure_log_dir() -> Path:
    if not SUBMISSION_LOG_DIR:
        return None
    path = Path(SUBMISSION_LOG_DIR)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _ensure_submission_dir() -> Path:
    if not SUBMISSION_OUTPUT_DIR:
        return None
    path = Path(SUBMISSION_OUTPUT_DIR)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _artifact_path(job_id: str, suffix: str) -> Path:
    # Route to appropriate directory based on file type
    if suffix == "log":
        base_dir = _ensure_log_dir()
    else:  # For .asl.json, .py, and other artifacts
        base_dir = _ensure_submission_dir()
    
    if not base_dir:
        return None
    return base_dir / f"{job_id}.{suffix}"


def _write_artifact(job_id: str, suffix: str, contents: str) -> Optional[Path]:
    path = _artifact_path(job_id, suffix)
    if not path:
        return None
    try:
        path.write_text(contents, encoding='utf-8')
        return path
    except Exception:
        return None


def _persist_sandbox_logs(
    job_id: str,
    stdout: str,
    stderr: str,
    trace_url: str,
    status: str,
    error_message: str = None,
    langfuse_status: str = None,
    langfuse_details: str = None,
) -> None:
    if not SUBMISSION_LOG_DIR:
        return
    try:
        log_dir = _ensure_log_dir()
        if not log_dir:
            return
        timestamp = datetime.utcnow().isoformat() + "Z"
        log_path = log_dir / f"{job_id}.log"
        lines = [
            f"timestamp: {timestamp}",
            f"job_id: {job_id}",
            f"status: {status}",
        ]
        if error_message:
            lines.append(f"error: {error_message}")
        if trace_url:
            lines.append(f"trace_url: {trace_url}")
        if langfuse_status:
            lines.append(f"langfuse_status: {langfuse_status}")
        if langfuse_details:
            lines.append(f"langfuse_details: {langfuse_details}")
        lines.append("stdout:")
        lines.append(stdout or "")
        lines.append("stderr:")
        lines.append(stderr or "")
        lines.append("--- end ---")
        log_path.write_text("\n".join(lines), encoding="utf-8")
    except Exception:
        pass


def _update_step(job_id: str, path: tuple, status: str = None, details: str = None, extra: Dict[str, Any] = None) -> None:
    with JOBS_LOCK:
        job = SUBMISSION_JOBS.get(job_id)
        if not job:
            return
        target = job
        for key in path:
            if isinstance(target, dict):
                target = target.get(key)
            else:
                return
        if not isinstance(target, dict):
            return
        if status:
            target["status"] = status
        if details is not None:
            target["details"] = details
        if extra:
            target.update(extra)


def _set_job_status(job_id: str, status: str) -> None:
    with JOBS_LOCK:
        job = SUBMISSION_JOBS.get(job_id)
        if job:
            job["status"] = status


def _compile_spec(spec: Dict[str, Any]) -> str:
    if not spec:
        raise ValueError("No specification provided")

    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(spec, f)
        temp_path = Path(f.name)

    try:
        output_dir = Path(__file__).resolve().parents[1] / "output"
        success, generated_code = compile_asl(str(temp_path), output_dir=str(output_dir))
        
        if not success:
            raise RuntimeError("Compilation failed")
        
        if not generated_code:
            raise RuntimeError("No code generated by compiler")
        
        return generated_code
    finally:
        if temp_path.exists():
            temp_path.unlink()


def run_agent_in_sandbox(job_id: str, code_text: str) -> Dict[str, Any]:
    stdout = ""
    stderr = ""
    trace_url = None
    error_message = None
    run_status = "success"
    langfuse_status = "disabled"
    langfuse_details = "Langfuse disabled"

    if LANGFUSE_ENABLED:
        langfuse_status = "callback_only"
        langfuse_details = "Langfuse tracing delegated to agent CallbackHandler"
        _update_step(
            job_id,
            ("steps", "execution", "substeps", "langfuse"),
            "success",
            langfuse_details,
        )
    else:
        missing = []
        if not LANGFUSE_HOST:
            missing.append("host")
        if not LANGFUSE_PUBLIC_KEY:
            missing.append("public_key")
        if not LANGFUSE_SECRET_KEY:
            missing.append("secret_key")
        langfuse_details = "Langfuse disabled"
        if missing:
            langfuse_details += f" (missing {', '.join(missing)})"
        _update_step(
            job_id,
            ("steps", "execution", "substeps", "langfuse"),
            "success",
            langfuse_details,
        )

    try:
        _update_step(job_id, ("steps", "execution", "substeps", "prepare"), "in_progress", "Creating sandbox workspace")
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            agent_path = tmp_path / "agent.py"
            agent_path.write_text(code_text, encoding='utf-8')
            runner_path = tmp_path / "runner.py"
            runner_path.write_text(SANDBOX_RUNNER_SCRIPT, encoding='utf-8')

            config_src = os.environ.get("MODEL_CONFIG_PATH")
            sandbox_config = None
            if config_src and os.path.exists(config_src):
                sandbox_config = tmp_path / "model_config.yaml"
                shutil.copy(config_src, sandbox_config)

            env = os.environ.copy()
            env.setdefault("PYTHONUNBUFFERED", "1")
            if sandbox_config:
                env["MODEL_CONFIG_PATH"] = str(sandbox_config)

            _update_step(job_id, ("steps", "execution", "substeps", "prepare"), "success", "Sandbox ready")
            _update_step(job_id, ("steps", "execution", "substeps", "run"), "in_progress", "Executing compiled agent")

            process = subprocess.run(
                ["python3", str(runner_path), str(agent_path)],
                capture_output=True,
                text=True,
                timeout=360,
                env=env,
            )
            stdout = process.stdout
            stderr = process.stderr

            if process.returncode != 0:
                _update_step(job_id, ("steps", "execution", "substeps", "run"), "error", f"Agent exited with code {process.returncode}")
                error_message = f"Agent exited with code {process.returncode}"
                run_status = f"error_exit_{process.returncode}"
            else:
                _update_step(job_id, ("steps", "execution", "substeps", "run"), "success", "Agent executed successfully")

    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout or ""
        stderr = exc.stderr or ""
        _update_step(job_id, ("steps", "execution", "substeps", "run"), "error", "Execution timed out")
        error_message = "Agent execution timed out"
        run_status = "timeout"

    _persist_sandbox_logs(
        job_id,
        stdout,
        stderr,
        trace_url,
        run_status,
        error_message,
        langfuse_status=langfuse_status,
        langfuse_details=langfuse_details,
    )

    if error_message:
        raise SandboxExecutionError(error_message, stdout=stdout, stderr=stderr, trace_url=trace_url)

    return {"stdout": stdout, "stderr": stderr, "trace_url": trace_url}


def _run_submission_job(job_id: str, spec: Dict[str, Any]) -> None:
    if spec:
        try:
            _write_artifact(job_id, "asl.json", json.dumps(spec, indent=2))
        except Exception:
            pass
    try:
        _set_job_status(job_id, "running")
        _update_step(job_id, ("steps", "compile"), "in_progress", "Generating LangGraph code")
        code = _compile_spec(spec)
        _write_artifact(job_id, "py", code)
        line_count = len(code.splitlines())
        _update_step(job_id, ("steps", "compile"), "success", f"Generated {line_count} lines of code")
    except Exception as exc:
        _update_step(job_id, ("steps", "compile"), "error", str(exc))
        _set_job_status(job_id, "error")
        return

    try:
        _update_step(job_id, ("steps", "syntax"), "in_progress", "Validating syntax")
        compile(code, "<submitted_agent>", "exec")
        _update_step(job_id, ("steps", "syntax"), "success", "Syntax validation passed")
    except Exception as exc:
        _update_step(job_id, ("steps", "syntax"), "error", str(exc))
        _set_job_status(job_id, "error")
        return

    try:
        _update_step(job_id, ("steps", "execution"), "in_progress", "Starting sandbox execution")
        result = run_agent_in_sandbox(job_id, code)
        _update_step(
            job_id,
            ("steps", "execution"),
            "success",
            "Sandbox execution completed",
            extra={
                "trace_url": result.get("trace_url"),
                "stdout": result.get("stdout"),
                "stderr": result.get("stderr"),
            },
        )
        _set_job_status(job_id, "success")
    except SandboxExecutionError as exc:
        _update_step(
            job_id,
            ("steps", "execution"),
            "error",
            str(exc),
            extra={
                "trace_url": exc.trace_url,
                "stdout": exc.stdout,
                "stderr": exc.stderr,
            },
        )
        _set_job_status(job_id, "error")
    except Exception as exc:
        _update_step(job_id, ("steps", "execution"), "error", str(exc))
        _set_job_status(job_id, "error")

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
        code = _compile_spec(request.json)
        return jsonify({'success': True, 'code': code})
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc)}), 400
    except Exception as exc:
        return jsonify({'success': False, 'error': str(exc)}), 500


@app.route('/submission/download', methods=['POST'])
def download_submission():
    """Compile and validate an agent, then return it as a downloadable file."""
    spec = request.json
    if not spec:
        return jsonify({'error': 'No specification provided'}), 400
    try:
        code = _compile_spec(spec)
        compile(code, "<submitted_agent>", "exec")
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
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


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'healthy'})


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


@app.route('/submit', methods=['POST'])
def submit_agent_job():
    """Start a submission job that compiles, validates, and executes the graph."""
    spec = request.json
    if not spec:
        return jsonify({'error': 'No specification provided'}), 400

    job_id = str(uuid4())
    job = _init_submission_job(job_id)
    with JOBS_LOCK:
        SUBMISSION_JOBS[job_id] = job

    worker = threading.Thread(target=_run_submission_job, args=(job_id, spec), daemon=True)
    worker.start()

    return jsonify({
        'job_id': job_id,
        'job': _job_snapshot(job_id)
    })


@app.route('/submit/status/<job_id>', methods=['GET'])
def submission_status(job_id: str):
    """Fetch the latest status for a submission job."""
    snapshot = _job_snapshot(job_id)
    if snapshot is None:
        return jsonify({'error': 'Job not found'}), 404
    return jsonify(snapshot)


if __name__ == '__main__':
    # Parse command-line arguments
    parser = argparse.ArgumentParser(description="ASL Lang Graph Backend Server")
    parser.add_argument('--port', type=int, default=8000, help='Port to run the server on (default: 8000)')
    args = parser.parse_args()

    print("🚀 Starting ASL Lang Graph Backend Server")
    print(f"📊 Frontend available at: http://localhost:{args.port}")
    print(f"🔧 API available at: http://localhost:{args.port}/compile")
    print()

    app.run(
        host='0.0.0.0',
        port=args.port,
        debug=True
    )

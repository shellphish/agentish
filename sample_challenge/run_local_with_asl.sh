#!/bin/bash
set -euo pipefail

# Helper for consistent log output
log() {
    printf '[run-local] %s\n' "$*"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEFAULT_ASL_DIR=""
if [ -d "$REPO_ROOT/asl_lang_graph" ]; then
    DEFAULT_ASL_DIR="$REPO_ROOT/asl_lang_graph"
elif cd "$SCRIPT_DIR/../../iCTF-2025-Agents/asl_lang_graph" >/dev/null 2>&1; then
    DEFAULT_ASL_DIR="$(pwd)"
    cd - >/dev/null 2>&1
fi

MODEL_CONFIG_PATH="${MODEL_CONFIG_PATH:-$SCRIPT_DIR/model_config.yaml}"
if [[ ! -f "$MODEL_CONFIG_PATH" ]]; then
    echo "[run-local] ERROR: model_config.yaml not found at $MODEL_CONFIG_PATH" >&2
    exit 1
fi

read_langfuse_value() {
    local key="$1"
    python3 - "$MODEL_CONFIG_PATH" "$key" <<'PY'
import sys

path, target = sys.argv[1:3]
aliases = {
    "host": ["host", "HOST", "base_url", "BASE_URL", "url", "URL", "endpoint", "ENDPOINT", "LANGFUSE_BASE_URL"],
    "public_key": ["public_key", "PUBLIC_KEY", "langfuse_public_key", "LANGFUSE_PUBLIC_KEY"],
    "secret_key": ["secret_key", "SECRET_KEY", "langfuse_secret_key", "LANGFUSE_SECRET_KEY"],
}
values = {}
in_section = False
indent_level = None
try:
    with open(path, "r", encoding="utf-8") as handle:
        for raw in handle:
            stripped = raw.strip()
            if not stripped or stripped.startswith("#"):
                continue
            leading_ws = len(raw) - len(raw.lstrip(" "))
            if leading_ws == 0 and stripped.startswith("langfuse"):
                in_section = True
                indent_level = None
                continue
            if in_section and leading_ws == 0:
                break
            if not in_section:
                continue
            if indent_level is None:
                indent_level = leading_ws
            if leading_ws < indent_level:
                in_section = False
                break
            if ":" in stripped:
                key, value = stripped.split(":", 1)
            elif "=" in stripped:
                key, value = stripped.split("=", 1)
            else:
                continue
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key:
                values[key] = value
except FileNotFoundError:
    pass

result = ""
for candidate in aliases.get(target, [target]):
    value = values.get(candidate)
    if value:
        result = value
        break

print(result)
PY
}

LANGFUSE_HOST_VALUE="${LANGFUSE_HOST:-$(read_langfuse_value host)}"
LANGFUSE_PUBLIC_KEY_VALUE="${LANGFUSE_PUBLIC_KEY:-$(read_langfuse_value public_key)}"
LANGFUSE_SECRET_KEY_VALUE="${LANGFUSE_SECRET_KEY:-$(read_langfuse_value secret_key)}"

HOST_GATEWAY_REQUIRED=0
HOST_GATEWAY_ENTRIES=()

add_host_gateway_entry() {
    local entry="$1"
    [[ -z "$entry" ]] && return
    for existing in "${HOST_GATEWAY_ENTRIES[@]:-}"; do
        if [[ "$existing" == "$entry" ]]; then
            return
        fi
    done
    HOST_GATEWAY_ENTRIES+=("$entry")
}

LANGFUSE_HOSTNAME=""
if [[ -n "$LANGFUSE_HOST_VALUE" ]]; then
    LANGFUSE_HOSTNAME="$(python3 - "$LANGFUSE_HOST_VALUE" <<'PY'
import sys, urllib.parse
value = sys.argv[1]
parsed = urllib.parse.urlparse(value)
host = parsed.hostname
if not host:
    # handle bare host[:port] strings
    if "://" not in value:
        host = value.split("/")[0].split(":")[0]
    else:
        host = urllib.parse.urlparse("http://" + value.split("://", 1)[-1]).hostname
print(host or "")
PY
)"
fi

if [[ "$LANGFUSE_HOSTNAME" == "localhost" || "$LANGFUSE_HOSTNAME" == "127.0.0.1" ]]; then
    rewritten="${LANGFUSE_HOST_VALUE/localhost/host.docker.internal}"
    rewritten="${rewritten/127.0.0.1/host.docker.internal}"
    if [[ "$rewritten" != "$LANGFUSE_HOST_VALUE" ]]; then
        log "Langfuse host '${LANGFUSE_HOST_VALUE}' not reachable from containers; rewriting to '${rewritten}' via host-gateway."
        LANGFUSE_HOST_VALUE="$rewritten"
    fi
    HOST_GATEWAY_REQUIRED=1
    add_host_gateway_entry "host.docker.internal:host-gateway"
elif [[ "$LANGFUSE_HOSTNAME" == "langfuse-langfuse-web-1" ]]; then
    HOST_GATEWAY_REQUIRED=1
    add_host_gateway_entry "langfuse-langfuse-web-1:host-gateway"
fi

langfuse_env=()
if [[ -n "$LANGFUSE_HOST_VALUE" ]]; then
    langfuse_env+=(-e "LANGFUSE_HOST=$LANGFUSE_HOST_VALUE")
fi
if [[ -n "$LANGFUSE_PUBLIC_KEY_VALUE" ]]; then
    langfuse_env+=(-e "LANGFUSE_PUBLIC_KEY=$LANGFUSE_PUBLIC_KEY_VALUE")
fi
if [[ -n "$LANGFUSE_SECRET_KEY_VALUE" ]]; then
    langfuse_env+=(-e "LANGFUSE_SECRET_KEY=$LANGFUSE_SECRET_KEY_VALUE")
fi

host_gateway_args=()
if [[ "${LANGFUSE_FORCE_HOST_GATEWAY:-0}" -eq 1 ]]; then
    HOST_GATEWAY_REQUIRED=1
fi
if [[ "${LANGFUSE_FORCE_HOST_GATEWAY:-0}" -eq 1 || "$HOST_GATEWAY_REQUIRED" -eq 1 ]]; then
    if [[ ${#HOST_GATEWAY_ENTRIES[@]} -eq 0 ]]; then
        HOST_GATEWAY_ENTRIES=("host.docker.internal:host-gateway")
    fi
    for entry in "${HOST_GATEWAY_ENTRIES[@]}"; do
        host_gateway_args+=(--add-host "$entry")
    done
fi

ASL_DIR="${ASL_DIR:-$DEFAULT_ASL_DIR}"
ASL_IMAGE="${ASL_IMAGE:-asl-builder-local}"
CHALLENGE_IMAGE="${CHALLENGE_IMAGE:-binary-challenge-local}"
ASL_CONTAINER="${ASL_CONTAINER:-asl_builder_local}"
CHALLENGE_CONTAINER="${CHALLENGE_CONTAINER:-binary_challenge_local}"
NETWORK="${NETWORK:-asl_challenge_net}"
ASL_PORT="${ASL_PORT:-8800}"
SUBMISSION_PORT="${SUBMISSION_PORT:-8801}"
MCP_PORT="${MCP_PORT:-8802}"
ASL_INTERNAL_PORT=8000

if [[ -z "$ASL_DIR" || ! -d "$ASL_DIR" ]]; then
    echo "[run-local] ERROR: Unable to locate ASL repository. Set ASL_DIR to the asl_lang_graph path." >&2
    exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
    echo "[run-local] ERROR: docker is required but not found in PATH." >&2
    exit 1
fi

SHARED_BASE="$SCRIPT_DIR/local_shared"
ASL_OUTPUT_DIR="$SHARED_BASE/asl_output"
SUBMISSIONS_DIR="$SHARED_BASE/submissions"
LOGS_DIR="$SHARED_BASE/logs"
mkdir -p "$ASL_OUTPUT_DIR" "$SUBMISSIONS_DIR" "$LOGS_DIR"

log "Using ASL sources from: $ASL_DIR"
log "Building images ($CHALLENGE_IMAGE, $ASL_IMAGE)"

docker build -t "$CHALLENGE_IMAGE" "$SCRIPT_DIR"

log "Building ASL builder image"
docker build -t "$ASL_IMAGE" -f - "$ASL_DIR" <<'__ASL_BUILDER_DOCKERFILE__'
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /workspace
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install -r requirements.txt
COPY . .
RUN chmod +x start_server.sh
EXPOSE 8000
CMD ["python3", "backend/server.py", "--port", "8000"]
__ASL_BUILDER_DOCKERFILE__

log "Ensuring docker network $NETWORK exists"
if ! docker network ls --format '{{.Name}}' | grep -q "^${NETWORK}$"; then
    docker network create "$NETWORK"
fi

stop_and_remove() {
    local name="$1"
    local existing
    existing=$(docker ps -aq -f "name=^${name}$") || true
    if [[ -n "$existing" ]]; then
        log "Stopping existing container $name"
        docker rm -f "$existing" >/dev/null
    fi
}

stop_and_remove "$ASL_CONTAINER"
stop_and_remove "$CHALLENGE_CONTAINER"

log "Starting binary challenge container"
challenge_run_cmd=(
    docker run -d
    --name "$CHALLENGE_CONTAINER"
    --network "$NETWORK"
    "${host_gateway_args[@]}"
    -p "${SUBMISSION_PORT}:8001"
    -p "${MCP_PORT}:8002"
    -e FLAG_FILE=/flag
    -e MODEL_CONFIG_PATH=/config/model_config.yaml
    -e SUBMISSION_LOG_DIR=/app/logs
)
challenge_run_cmd+=("${langfuse_env[@]}")
challenge_run_cmd+=(
    -v "$SUBMISSIONS_DIR":/app/submissions
    -v "$LOGS_DIR":/app/logs
    -v "$ASL_OUTPUT_DIR":/shared/asl_output
    -v "$MODEL_CONFIG_PATH":/config/model_config.yaml:ro
    "$CHALLENGE_IMAGE"
)
"${challenge_run_cmd[@]}" >/dev/null

log "Starting ASL builder container"
asl_run_cmd=(
    docker run -d
    --name "$ASL_CONTAINER"
    --network "$NETWORK"
    "${host_gateway_args[@]}"
    -p "${ASL_PORT}:8000"
    -e MCP_BASE_URL="http://${CHALLENGE_CONTAINER}:8002"
    -e MODEL_CONFIG_PATH=/workspace/model_config.yaml
    -e SUBMISSION_LOG_DIR=/workspace/logs
)
asl_run_cmd+=("${langfuse_env[@]}")
asl_run_cmd+=(
    -v "$ASL_OUTPUT_DIR":/workspace/output
    -v "$LOGS_DIR":/workspace/logs
    -v "$MODEL_CONFIG_PATH":/workspace/model_config.yaml:ro
    "$ASL_IMAGE"
)
"${asl_run_cmd[@]}" >/dev/null

cat <<INFO

=================================================================
Local environment is ready.

- ASL Builder UI:        http://localhost:${ASL_PORT}
- Agent Submission API:  http://localhost:${SUBMISSION_PORT}
- MCP endpoint (internal): http://${CHALLENGE_CONTAINER}:8002
- Shared agent output dir: $ASL_OUTPUT_DIR

Containers:
  * ${CHALLENGE_CONTAINER} (image: ${CHALLENGE_IMAGE})
  * ${ASL_CONTAINER} (image: ${ASL_IMAGE})
Network: ${NETWORK}

Use 'docker logs <container>' to inspect service logs.
Use 'docker rm -f ${CHALLENGE_CONTAINER} ${ASL_CONTAINER}' to stop everything.
=================================================================
INFO

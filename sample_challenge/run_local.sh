#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 Agentish Challenge Deployment"
echo "================================="
echo ""

# Check config exists
if [[ ! -f "model_config.yaml" ]]; then
    echo "❌ ERROR: model_config.yaml not found in $SCRIPT_DIR"
    echo ""
    echo "Please create model_config.yaml with the following required configuration:"
    echo "  - LiteLLM endpoint and API key"
    echo "  - Langfuse host and credentials"
    echo "  - MCP servers (optional)"
    echo ""
    exit 1
fi

# Check Docker installed
if ! command -v docker &> /dev/null; then
    echo "❌ ERROR: Docker is not installed"
    echo "Please install Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check docker-compose installed
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null 2>&1; then
    echo "❌ ERROR: docker-compose is not installed"
    echo "Please install docker-compose: https://docs.docker.com/compose/install/"
    exit 1
fi

# Validate configuration before starting
echo "📋 Validating configuration..."
if ! python3 scripts/validate_config.py model_config.yaml; then
    echo ""
    echo "❌ Configuration validation failed"
    echo "Please fix the configuration errors above and try again"
    exit 1
fi

echo ""
echo "✅ Configuration validated successfully"
echo ""

# Create shared directories
echo "📁 Creating shared directories..."
mkdir -p local_shared/asl_output
mkdir -p local_shared/submissions  
mkdir -p local_shared/logs

# Determine docker-compose command
if docker compose version &> /dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

# Start services
echo ""
echo "🐳 Starting Docker services..."
echo ""
$COMPOSE_CMD up --build

# Cleanup on exit
trap '$COMPOSE_CMD down' EXIT

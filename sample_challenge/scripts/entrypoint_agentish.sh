#!/bin/bash
set -e

echo "🚀 Starting Agentish..."
echo ""

# Validate configuration
echo "Validating configuration..."
python3 /workspace/scripts/validate_config.py /config/model_config.yaml

echo ""
echo "✅ Configuration validated"
echo "Starting backend server..."
echo ""

# Execute the command passed to the container
exec "$@"

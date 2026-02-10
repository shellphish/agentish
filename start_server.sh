#!/bin/bash
# Start the ASL Lang Graph Backend Server

cd "$(dirname "$0")"

echo "🚀 Starting ASL Lang Graph Server..."
echo ""

# Check if Flask is installed
if ! python3 -c "import flask" 2>/dev/null; then
    echo "⚠️  Flask not found. Installing dependencies..."
    pip install -r requirements.txt
fi

# Start the backend server
python3 backend/server_agentish.py

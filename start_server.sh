#!/bin/bash
# Start the ASL Lang Graph Backend Server

# Get the directory where the script is located
cd "$(dirname "$0")"

echo "🚀 Starting ASL Lang Graph Server..."
echo ""

# Use 'python' instead of 'python3' to respect the active Conda env
# Or better yet, use 'which python' to confirm the path
PYTHON_EXE=$(which python)

echo "Using Python from: $PYTHON_EXE"

# Check if Flask is installed in THIS specific python
if ! $PYTHON_EXE -c "import flask" 2>/dev/null; then
    echo "⚠️  Flask not found in $PYTHON_EXE. Installing dependencies..."
    $PYTHON_EXE -m pip install -r requirements.txt
fi

# Start the backend server using the same executable
$PYTHON_EXE backend/server_agentish.py
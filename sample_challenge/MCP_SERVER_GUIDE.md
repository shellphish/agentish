# MCP Server Development Guide

## Overview

Model Context Protocol (MCP) servers provide tools and capabilities that agents can use during execution. This guide explains how to create custom MCP servers for Agentish challenges.

## MCP Server Structure

### Basic Template

```python
#!/usr/bin/env python3
"""
MCP Server for [Your Challenge Name]
Provides tools for agents to [describe purpose].
"""

import json
import logging
from flask import Flask, request, jsonify

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Configuration
BASE_DIR = "/app"
PORT = 8002

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint - REQUIRED"""
    return jsonify({'status': 'healthy', 'service': 'mcp_server'})

@app.route('/mcp/status', methods=['GET'])
def status():
    """
    Status endpoint - REQUIRED
    Returns available tools for this MCP server
    """
    return jsonify({
        "status": "operational",
        "available_tools": [
            "your_function_1",
            "your_function_2",
        ]
    }), 200

@app.route('/mcp/your_function_1', methods=['GET'])
def your_function_1():
    """Example GET endpoint"""
    try:
        # Get query parameters
        param = request.args.get('param_name')
        
        if not param:
            return jsonify({
                'success': False,
                'error': 'Missing required parameter: param_name'
            }), 400
        
        # Your logic here
        result = do_something(param)
        
        return jsonify({
            'success': True,
            'data': result
        })
    
    except Exception as e:
        logger.error(f"Error in your_function_1: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/mcp/your_function_2', methods=['POST'])
def your_function_2():
    """Example POST endpoint"""
    try:
        # Get JSON body
        data = request.get_json() or {}
        input_value = data.get('input')
        
        if not input_value:
            return jsonify({
                'success': False,
                'error': 'Missing required field: input'
            }), 400
        
        # Your logic here
        result = process_data(input_value)
        
        return jsonify({
            'success': True,
            'output': result
        })
    
    except Exception as e:
        logger.error(f"Error in your_function_2: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=PORT, debug=False)
```

## Configuration in model_config.yaml

After creating your MCP server, register it in `model_config.yaml`:

```yaml
mcp_servers:
  - name: "your_server_name"
    port: 8002
    internal_host: "mcp_your_service"  # Docker service name
    service_file: "artifacts/your_mcp_server.py"
    enabled: true
    routes:
      - function: "your_function_1"
        endpoint: "/mcp/your_function_1"
        method: "GET"
        description: "Description of what this function does"
        arguments:
          - name: "param_name"
            type: "str"
            required: true
            description: "What this parameter is for"
        return_schema:
          success: "bool"
          data: "any"
      
      - function: "your_function_2"
        endpoint: "/mcp/your_function_2"
        method: "POST"
        description: "Another function description"
        arguments:
          - name: "input"
            type: "str"
            required: true
            description: "Input data"
        return_schema:
          success: "bool"
          output: "str"
```

## Docker Integration

### Add to docker-compose.yml

```yaml
services:
  mcp_your_service:
    build:
      context: ./artifacts
      dockerfile: ../Dockerfile.mcp
      args:
        - MCP_SERVER_FILE=your_mcp_server.py
    container_name: mcp_your_service
    environment:
      - MCP_PORT=8002
      - PYTHONUNBUFFERED=1
    expose:
      - "8002"
    networks:
      - agentish_internal
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8002/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped
```

### Update Dependencies

If your MCP server needs additional Python packages, update `Dockerfile.mcp`:

```dockerfile
# Install Python requirements for MCP server
RUN pip install --no-cache-dir flask requests pyyaml your-package-here
```

## Best Practices

### Error Handling

Always return proper HTTP status codes and error messages:

```python
@app.route('/mcp/risky_operation', methods=['POST'])
def risky_operation():
    try:
        # Validate input
        data = request.get_json() or {}
        if 'required_field' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing required field: required_field'
            }), 400  # Bad Request
        
        # Perform operation
        result = perform_operation(data)
        
        # Success response
        return jsonify({
            'success': True,
            'result': result
        }), 200
    
    except ValueError as e:
        # Client error
        return jsonify({
            'success': False,
            'error': f'Invalid input: {str(e)}'
        }), 400
    
    except Exception as e:
        # Server error
        logger.error(f"Unexpected error: {e}", exc_info=True)
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500
```

### Timeouts

For long-running operations, add timeouts:

```python
import subprocess

@app.route('/mcp/run_command', methods=['POST'])
def run_command():
    try:
        cmd = request.get_json().get('command')
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30  # 30 second timeout
        )
        
        return jsonify({
            'success': result.returncode == 0,
            'stdout': result.stdout,
            'stderr': result.stderr
        })
    
    except subprocess.TimeoutExpired:
        return jsonify({
            'success': False,
            'error': 'Command timed out after 30 seconds'
        }), 408
```

### Logging

Use proper logging levels:

```python
logger.debug("Detailed debugging info")
logger.info("General information")
logger.warning("Warning messages")
logger.error("Error messages")
logger.critical("Critical errors")
```

### Input Validation

Always validate and sanitize input:

```python
@app.route('/mcp/safe_function', methods=['POST'])
def safe_function():
    data = request.get_json() or {}
    
    # Validate required fields
    required_fields = ['field1', 'field2']
    missing = [f for f in required_fields if f not in data]
    if missing:
        return jsonify({
            'success': False,
            'error': f'Missing required fields: {", ".join(missing)}'
        }), 400
    
    # Type validation
    if not isinstance(data['field1'], str):
        return jsonify({
            'success': False,
            'error': 'field1 must be a string'
        }), 400
    
    # Range validation
    if not (0 <= data['field2'] <= 100):
        return jsonify({
            'success': False,
            'error': 'field2 must be between 0 and 100'
        }), 400
    
    # Process validated data
    ...
```

## Testing Your MCP Server

### Local Testing

```bash
# Build and run
cd sample_challenge/artifacts
docker build -f ../Dockerfile.mcp -t test-mcp .
docker run -p 8002:8002 test-mcp

# Test health endpoint
curl http://localhost:8002/health

# Test status endpoint
curl http://localhost:8002/mcp/status

# Test function (GET)
curl "http://localhost:8002/mcp/your_function?param=value"

# Test function (POST)
curl -X POST http://localhost:8002/mcp/your_function \
  -H "Content-Type: application/json" \
  -d '{"input": "test"}'
```

### Integration Testing

After adding to docker-compose:

```bash
# Start services
./run_local.sh

# Check MCP server is running
docker ps | grep mcp

# Check logs
docker logs mcp_your_service

# Test from agentish container
docker exec -it agentish_ui bash
curl http://mcp_your_service:8002/health
```

## Example: Binary Analysis MCP Server

See `artifacts/mcp_server.py` for a complete example that provides:

- Function listing
- Disassembly retrieval
- Call graph analysis
- Binary execution
- Python code execution

This server demonstrates:
- Multiple endpoint types (GET/POST)
- File I/O operations
- Subprocess execution
- JSON metadata loading
- Proper error handling

## Debugging

### Check if Server is Accessible

From agentish container:

```bash
docker exec -it agentish_ui bash
curl http://mcp_your_service:8002/mcp/status
```

### View MCP Server Logs

```bash
docker logs mcp_your_service -f
```

### Test Tool Loading in UI

1. Open Agentish UI: `http://localhost:8000`
2. Check browser console for MCP tool loading messages
3. Look for tools in the function catalog

## Multiple MCP Servers

You can run multiple MCP servers simultaneously:

```yaml
mcp_servers:
  - name: "binary_analysis"
    port: 8002
    internal_host: "mcp_binary"
    # ...
  
  - name: "network_tools"
    port: 8003
    internal_host: "mcp_network"
    # ...
```

Each server should:
- Use a unique port
- Have a unique service name in docker-compose
- Provide different tools (no function name conflicts)

## Security Considerations

1. **Input Validation**: Always validate all inputs
2. **Sandboxing**: Run dangerous operations in isolated environments
3. **Rate Limiting**: Add rate limiting for expensive operations
4. **Logging**: Log all operations for audit trails
5. **Secrets**: Don't hardcode secrets, use environment variables
6. **File Access**: Restrict file system access to specific directories

## Common Patterns

### Database Access

```python
import sqlite3

@app.route('/mcp/query_db', methods=['POST'])
def query_db():
    query = request.get_json().get('query')
    
    conn = sqlite3.connect('/app/data.db')
    cursor = conn.cursor()
    cursor.execute(query)
    results = cursor.fetchall()
    conn.close()
    
    return jsonify({
        'success': True,
        'results': results
    })
```

### File Operations

```python
import os

@app.route('/mcp/list_files', methods=['GET'])
def list_files():
    directory = request.args.get('dir', '/app/data')
    
    if not directory.startswith('/app/data'):
        return jsonify({
            'success': False,
            'error': 'Access denied'
        }), 403
    
    files = os.listdir(directory)
    
    return jsonify({
        'success': True,
        'files': files
    })
```

### External API Calls

```python
import requests

@app.route('/mcp/fetch_data', methods=['GET'])
def fetch_data():
    url = request.args.get('url')
    
    try:
        response = requests.get(url, timeout=10)
        return jsonify({
            'success': True,
            'status_code': response.status_code,
            'data': response.text
        })
    except requests.Timeout:
        return jsonify({
            'success': False,
            'error': 'Request timed out'
        }), 408
```

## Resources

- [Flask Documentation](https://flask.palletsprojects.com/)
- [Docker Documentation](https://docs.docker.com/)
- Sample MCP Server: `sample_challenge/artifacts/mcp_server.py`
- Agentish Repository: [GitHub](https://github.com/shellphish/agentish)

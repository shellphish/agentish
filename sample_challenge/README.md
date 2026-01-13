# Binary Challenge - Multi-Stage Reverse Engineering

This challenge tests your ability to create agents that can perform static analysis on a binary to extract the correct input.

## Quick Start

```bash
cd sample_challenge
./run_local.sh
```

Then open `http://localhost:8000` in your browser to access the Agentish UI.

For detailed deployment instructions, see [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).

For creating custom MCP servers, see [MCP_SERVER_GUIDE.md](MCP_SERVER_GUIDE.md).

## Architecture

The challenge environment includes:

1. **Agentish UI** (Port 8000) - Visual agent builder and execution environment (EXTERNAL)
2. **MCP Server** (Port 8002) - Provides binary analysis tools to agents (INTERNAL ONLY)
3. **Challenge Binary** - A multi-stage validation binary that checks input

**Key Change**: We now use the Agentish visual UI instead of direct agent file submission. Only the UI port (8000) is exposed externally. The MCP Server is internal only.

## Challenge Overview

The challenge consists of three main services:

1. **Agent Submission Service** (Port 8001) - Validates and executes LangGraph agents (EXTERNAL)
2. **MCP Server** (Port 8002) - Provides binary analysis tools to agents (INTERNAL ONLY)
3. **Challenge Binary** - A multi-stage validation binary that checks input

**Important**: Only the Agent Submission Service is accessible from outside the container. The MCP Server is an internal service that can only be accessed by agents running within the container.

## Challenge Workflow

1. **Submit an Agent**: Upload a Python file containing a LangGraph agent that can analyze the binary
2. **Analyze Binary**: Your agent should use the MCP server tools to:
   - Get disassembly of the binary
   - View the call graph
   - Understand the validation logic
3. **Extract Password**: Deduce the correct input from static analysis
4. **Verify Password**: Run the binary with the extracted password to get the flag

## Challenge Design

The binary has **3 validation stages**:
- **Stage 1**: XOR-based validation with a randomized key (changes on each build)
- **Stage 2**: Mathematical transformation check
- **Stage 3**: Character position validation

All three stages must pass with a **single input string**. The randomization in Stage 1 ensures participants cannot hardcode solutions.

## Services

### Agent Submission Service (Port 8001)
- **POST /submit** - Upload and execute a LangGraph agent
- **GET /submissions** - List submitted agents
- **GET /health** - Health check

**Requirements for submitted agents:**
- Must be valid Python syntax
- Must import LangGraph or LangChain components
- Will be executed as a non-privileged user
- Execution timeout: 60 seconds

### MCP Server (Port 8002) - INTERNAL ONLY

**Available Tools:**

1. **GET /mcp/get_disassembly** - Get disassembly of the challenge binary
   ```json
   {
     "function": "main"  // optional, specific function name
   }
   ```

2. **GET /mcp/get_call_graph** - Get the call graph of the binary
   ```json
   {
     // Returns JSON representation of function calls
   }
   ```

3. **POST /mcp/run_challenge** - Run the challenge binary with input
   ```json
   {
     "input": "your_password_here"
   }
   ```
   Returns success/failure and flag if correct.

4. **GET /mcp/get_sections** - Get binary sections information

5. **GET /mcp/get_symbols** - Get symbol table

6. **GET /mcp/status** - Get server status

**Access**: Only accessible from within the container at `http://127.0.0.1:8002`

## Solution Approach

Your agent should:
1. Get the disassembly and analyze the validation functions
2. Extract the XOR key from Stage 1 (randomized per build)
3. Understand the mathematical constraints in Stage 2
4. Identify the character position checks in Stage 3
5. Compute the valid password that satisfies all stages
6. Submit the password to get the flag

## Example Tools Usage

```python
import requests

# Get disassembly
response = requests.get("http://127.0.0.1:8002/mcp/get_disassembly")
disasm = response.json()

# Get call graph
response = requests.get("http://127.0.0.1:8002/mcp/get_call_graph")
call_graph = response.json()

# Run challenge with computed password
response = requests.post(
    "http://127.0.0.1:8002/mcp/run_challenge",
    json={"input": "computed_password"}
)
result = response.json()
if result['success']:
    print(f"Flag: {result['flag']}")
```

## Building the Challenge

```bash
./build.sh
```

This will:
1. Generate a random XOR key for Stage 1
2. Compile the C++ binary with the randomized key
3. Generate disassembly database
4. Generate call graph database
5. Build the Docker container

## Running the Challenge

```bash
docker build -t binary_challenge .
docker run -p 8001:8001 binary_challenge
```

## Files

- `challenge.cpp` - The multi-stage validation binary (with randomization)
- `mcp_server.py` - MCP server providing binary analysis tools
- `agent_submission_service.py` - Agent submission and execution service
- `build.sh` - Build script that randomizes and compiles the challenge
- `solution_agent.py` - Example LangGraph agent that solves the challenge
- `Dockerfile` - Container configuration
- `requirements.txt` - Python dependencies

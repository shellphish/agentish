# Agentish Sample Challenge

This directory contains the configuration and Docker setup for running an Agentish challenge.

## Architecture

The challenge runs in 3 containers:

```
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────┐
│   agentish_ui   │    │  agentish_sandbox   │───▶│  mcp_container  │
│   (Port 8000)   │    │    (Port 8001)      │    │  (Internal)     │
│                 │    │                     │    │                 │
│ - Visual Editor │    │ - Compiler          │    │ - Binary tools  │
│ - MCP tool list │    │ - Python sandbox    │    │ - Custom tools  │
│ - Download ZIP  │    │ - Execution logs    │    │                 │
└─────────────────┘    └─────────────────────┘    └─────────────────┘
```

## Quick Start

1. **Start all containers:**
   ```bash
   docker-compose up --build
   ```

2. **Access the UI:** Open http://localhost:8000

3. **Design your agent workflow** using the visual editor

4. **Download the bundle** by clicking "Download Bundle"

5. **Execute in sandbox:**
   - Open http://localhost:8001
   - Upload the bundle.zip
   - Click "Execute Agent"
   - Download results when complete

## Configuration Files

| File | Description |
|------|-------------|
| `sandbox.yml` | Combined configuration for sandbox execution (model settings + MCP servers) |
| `challenge.yml` | CTFd-compatible challenge definition |
| `challengish.yml` | Agentish-specific challenge metadata |

### sandbox.yml

This is the main configuration file containing:
- **Model Configuration**: LLM provider settings (llamacpp, litellm, openai)
- **Langfuse Configuration**: Observability and tracing settings
- **MCP Servers**: Tool server definitions and their routes

### challenge.yml

CTFd-compatible challenge format for import/export:
- Challenge name, description, category
- Point value and difficulty
- Flags and hints

### challengish.yml

Agentish-specific metadata:
- Detailed challenge description
- Recommended model
- Success criteria
- Hints for participants

## Ports

| Service | Port | Description |
|---------|------|-------------|
| agentish_ui | 8000 | Workflow editor UI |
| agentish_sandbox | 8001 | Execution sandbox UI |
| mcp_binary | 8002 (internal) | MCP tool server |

## Environment Variables

You can customize ports using environment variables:

```bash
UI_PORT=8000 SANDBOX_PORT=8001 docker-compose up
```

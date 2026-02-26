# Sample Challenge — Agentish Setup Guide

This directory contains a working example of how to configure and run the
**Agentish** visual workflow editor with MCP tools defined.

---

## Files

| File | Purpose |
|------|---------|
| `challengish.yml` | Defines MCP tools that appear in the UI's Function Catalog |
| `docker-compose.yml` | Runs the Agentish UI server |
| `Dockerfile.agentish` | Builds the Agentish container |

---

## Quick Start

```bash
cd sample_challenge/
docker compose up --build
```

Open `http://localhost:8000` — the 6 tools from `challengish.yml` appear in
the **Function Catalog** sidebar. Drag nodes onto the canvas, assign tools,
and **Download Bundle** to export your workflow.

---

## How `challengish.yml` Works

### What it does

`challengish.yml` tells the Agentish UI what MCP tools exist. The backend
reads it at startup (via `CHALLENGISH_CONFIG_PATH` env var) and serves the
tool definitions to the frontend at `GET /api/mcp/tools`. The UI populates
the Function Catalog sidebar from this.

**The Agentish UI never contacts the MCP server.** It only reads the YML.
The MCP server is only needed later at execution time when the compiled
agent runs in a sandbox.

### Data flow

```
challengish.yml
       │
       ▼  (read at startup)
server_agentish.py ──► GET /api/mcp/tools ──► Frontend Function Catalog
                                                      │
                                                      ▼  (user builds workflow)
                                               Download Bundle (ZIP)
                                                 ├── asl.json    ← workflow + tool defs
                                                 └── layout.json ← visual positions
```

### Schema

```yaml
mcp_servers:
  - name: "server_name"          # Unique identifier
    port: 8002                   # MCP server port (used in compiled code)
    internal_host: "hostname"    # Docker hostname (used in compiled code)
    enabled: true                # Set false to hide from UI

    routes:
      - function: "tool_name"    # Tool name (valid Python identifier)
        endpoint: "/mcp/path"    # HTTP path on MCP server
        method: "GET"            # GET or POST
        description: "..."       # Shown in UI
        arguments:               # Tool parameters
          - name: "param"
            type: "str"
            required: true
            description: "..."
        return_schema:           # Documents response shape
          success: "bool"
```

### Key points

- **GET tools** → arguments become query params in compiled code
- **POST tools** → arguments become JSON body in compiled code
- **`internal_host:port`** → becomes `http://internal_host:port` in the compiled agent's HTTP calls
- **`function`** → becomes the `@tool` function name in generated Python

---

## Running Without Docker

```bash
# From the agentish project root
CHALLENGISH_CONFIG_PATH=sample_challenge/challengish.yml python backend/server_agentish.py --port 8000
```

---

## Creating Your Own Challenge

1. Copy `challengish.yml` as your template
2. Change `internal_host` / `port` to match your MCP server
3. Define your own `routes` with the tools your MCP server exposes
4. Mount the YML into the agentish container via docker-compose

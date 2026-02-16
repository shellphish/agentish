# Agentish

A visual workflow editor for creating LangGraph agents through an intuitive drag-and-drop UI.

## Overview

Agentish is the frontend UI for building AI agent workflows. It provides:

- **Visual Graph Editor** - Drag-and-drop interface for creating agent workflows
- **Node Types** - LLM nodes, Router nodes, Worker nodes, Entry points
- **MCP Tool Integration** - Load available tools from `challengish.yml`
- **Bundle Export** - Download your workflow as a bundle (ZIP with asl.json + layout.json)

## Components

### Frontend
- `frontend/index.html` - Main visual editor UI
- `frontend/js/` - Modular editor logic (ES modules)
  - `main.js` - Entry point & editor bootstrap
  - `constants.js` - Configuration, node forms, type maps
  - `state.js` - Shared mutable state (graph, canvas, tools)
  - `utils.js` - Toast notifications, schema helpers, graph summary
  - `nodes.js` - Node type definitions & registration
  - `inspector.js` - Property inspector panel rendering
  - `serialization.js` - ASL import/export & layout I/O
  - `tools.js` - Tool registry, function catalog, MCP hydration
  - `ui.js` - Event bindings (keyboard, menus, modals, imports)
  - `litegraph-patches.js` - Custom rendering patches for LiteGraph
- `frontend/styles.css` - Styling
- `frontend/litegraph.css` + `litegraph.min.js` - Graph visualization library

### Backend (Minimal)
- `backend/server_agentish.py` - Serves frontend and MCP tool catalog

## Usage

### Prerequisites
- Python 3.11+
- Flask, Flask-CORS, PyYAML

### Quick Start

1. Install dependencies:
   ```bash
   pip install flask flask-cors pyyaml
   ```

2. (Optional) Create a `challengish.yml` to define MCP tools:
   ```yaml
   mcp_servers:
     - name: "my_server"
       port: 8002
       internal_host: "mcp_server"
       routes:
         - function: "my_tool"
           endpoint: "/mcp/my_tool"
           method: "GET"
           description: "My tool description"
   ```

3. Run the server:
   ```bash
   CHALLENGISH_CONFIG_PATH=challengish.yml python backend/server_agentish.py --port 8000
   ```

4. Open http://localhost:8000 in your browser

### Building Workflows

1. **Add Nodes** - Right-click on the canvas to add nodes
2. **Connect Nodes** - Drag from output to input slots
3. **Configure Nodes** - Click on a node to edit its properties
4. **Export Bundle** - Click "Download Bundle" to get a ZIP file

### Bundle Format

The exported bundle contains:
- `asl.json` - The ASL (Agent Specification Language) workflow definition
- `layout.json` - Visual layout information for the graph

## Execution

**Agentish does NOT execute agents.** It only creates workflow definitions.

To execute your agent, use the [agentish-ctf](../agentish-ctf) execution environment:
1. Export your bundle from Agentish
2. Upload the bundle to agentish-ctf sandbox
3. The sandbox compiles and executes your agent with access to MCP tools

## API Endpoints

- `GET /` - Serve the visual editor UI
- `GET /config.json` - Frontend configuration
- `GET /api/mcp/tools` - List available MCP tools from challengish.yml
- `POST /api/bundle/download` - Create and download a bundle ZIP
- `GET /health` - Health check

## Configuration

### Environment Variables

- `CHALLENGISH_CONFIG_PATH` - Path to challengish.yml (default: `challengish.yml`)

### challengish.yml

Defines available MCP tools that will be shown in the editor:

```yaml
challenge_name: "My Challenge"
challenge_id: "my-challenge-001"

mcp_servers:
  - name: "binary_analysis"
    port: 8002
    internal_host: "mcp_binary"
    enabled: true
    routes:
      - function: "list_functions"
        endpoint: "/mcp/list_functions"
        method: "GET"
        description: "List all functions in the binary"
        arguments: []
        return_schema:
          success: "bool"
          functions: "list"
```

## Related Projects

- **agentish-ctf** - Execution environment for compiling and running agent bundles
- **agentish-challenges** - CTF challenges using the Agentish framework

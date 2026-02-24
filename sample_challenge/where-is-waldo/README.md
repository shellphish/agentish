# Where is Waldo? — Agentish Challenge

**Challenge ID:** `where-is-waldo`

---

## Challenge Description

Waldo is hiding in a famous US city! Your task is to figure out which US state
he's in by querying landmarks near his location.

### Available Tools

This challenge provides two MCP servers with the following tools:

| Tool | Server | Description |
|------|--------|-------------|
| `waldo_landmarks` | mcp_landmarks:7001 | Returns three landmarks near Waldo's location |
| `guess_state` | mcp_flag:7002 | Submit your state guess to get the flag |

### Your Mission

1. Call `waldo_landmarks` to get a list of three landmarks
2. Use reasoning to determine which US state contains those landmarks
3. Call `guess_state` with the state name to retrieve the flag

---

## Running the Challenge UI

```bash
cd sample_challenge/where-is-waldo/
docker compose up --build
```

Open `http://localhost:8000` in your browser. The Agentish visual workflow
editor will load with the two challenge tools available in the Function Catalog.

---

## Challenge Structure

```
where-is-waldo/
├── challengish.yml       # MCP tool definitions for Agentish
├── docker-compose.yml    # Runs the Agentish UI server
├── Dockerfile.agentish   # Container for the UI
└── README.md            # This file
```

---

## Tool Details

### `waldo_landmarks`

- **Method:** GET
- **Arguments:** None
- **Returns:**
  ```json
  {
    "success": true,
    "landmarks": ["Landmark 1", "Landmark 2", "Landmark 3"],
    "message": "Found three landmarks near Waldo"
  }
  ```

### `guess_state`

- **Method:** POST
- **Arguments:**
  - `state` (string, required): Full name of US state (e.g., "California")
- **Returns:**
  ```json
  {
    "success": true,
    "flag": "ictf{...}",
    "message": "Correct!"
  }
  ```
  or
  ```json
  {
    "success": false,
    "flag": "",
    "message": "Wrong state, try again"
  }
  ```

---

## Building a Solution Workflow

A typical workflow might look like:

1. **Start Node** → LLM Agent
2. **LLM Agent** (with `waldo_landmarks` tool):
   - Calls the tool to get landmarks
   - Analyzes which state those landmarks are in
3. **LLM Agent** (with `guess_state` tool):
   - Submits the state guess
   - Receives the flag if correct

**Download Bundle** to export your workflow as `asl.json` + `layout.json`.

---

## Notes

- The MCP servers defined in `challengish.yml` don't need to be running for
  the UI to work. The UI only reads the YAML configuration.
- The actual MCP servers are only contacted when the compiled agent executes
  in the CTF environment.
- State names should be full names (e.g., "New York" not "NY").

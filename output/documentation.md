# Agentish Framework - Complete Technical Documentation

**Version:** 2.0  
**Last Updated:** January 5, 2026  
**Architecture:** Single Global State with Command Pattern

---

## Table of Contents

1. [Introduction](#introduction)
2. [High-Level Overview](#high-level-overview)
3. [Core Concepts](#core-concepts)
4. [Running Example: Email Classification System](#running-example-email-classification-system)
5. [Detailed Component Guide](#detailed-component-guide)
6. [Implementation Deep Dive](#implementation-deep-dive)
7. [ASL JSON Format](#asl-json-format)
8. [Compiler Architecture](#compiler-architecture)
9. [Best Practices](#best-practices)
10. [Troubleshooting](#troubleshooting)

---

## Introduction

**Agentish** is a visual workflow compiler that transforms Agent Specification Language (ASL) JSON definitions into executable LangGraph Python code. It enables developers to build complex agentic workflows through a declarative configuration format, automatically generating production-ready code with proper state management, routing logic, and tool integration.

### Key Features

- **Visual-First Design**: Define workflows in JSON, get executable Python
- **Single Global State**: Unified state management with per-node tracking
- **Command Pattern**: Nodes control their own routing and state updates
- **Tool Integration**: Native support for LangChain tools with iteration limits
- **Smart Routing**: LLM-powered conditional routing with structured outputs
- **Multi-LLM Support**: OpenAI, Anthropic Claude, and Ollama

---

## High-Level Overview

Agentish workflows consist of interconnected nodes that process data through a shared global state. Each node type serves a specific purpose:

```
┌─────────────────────────────────────────────────────────────┐
│                      AGENTISH WORKFLOW                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────┐      ┌──────────┐      ┌──────────┐          │
│  │  Entry   │─────▶│   LLM    │─────▶│  Router  │          │
│  │  Point   │      │   Node   │      │   Node   │          │
│  └──────────┘      └────┬─────┘      └────┬─────┘          │
│                          │                  │                 │
│                          ▼                  ├──────┬──────┐  │
│                    ┌──────────┐            ▼      ▼      ▼  │
│                    │   Tool   │         LLM1   LLM2   LLM3  │
│                    │   Node   │          │      │      │    │
│                    └────┬─────┘          └──────┴──────┘    │
│                          │                       ▼           │
│                          └─────────────────▶  Final         │
│                                              Output          │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           GLOBAL STATE (Single Source of Truth)      │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  • count: Execution counter                          │   │
│  │  • messages: Global conversation history             │   │
│  │  • node_X_messages: Per-node local history          │   │
│  │  • node_X_llm_calls: Per-node call counter          │   │
│  │  • node_X_tool_iteration_count: Tool usage tracking │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Core Principles

1. **Single Global State**: All state lives in one TypedDict, with namespaced fields for per-node tracking
2. **Command-Based Routing**: Nodes return `Command` objects that update state AND specify the next node
3. **Declarative Configuration**: Workflows defined in ASL JSON, compiled to Python
4. **LangGraph Foundation**: Built on LangGraph's StateGraph for reliable execution

---

## Core Concepts

### 1. Global State
The single source of truth for all workflow data. Contains:
- **Shared fields**: `count`, `messages` (global conversation)
- **Per-node fields**: `node_2_messages`, `node_2_llm_calls`, `node_2_tool_iteration_count`

### 2. LLM Node
An agent that uses a Language Model to process input and generate responses. Can optionally use tools.

### 3. Router Node
A decision-making node that analyzes conversation history and routes to the appropriate next node using structured LLM output.

### 4. Worker Node
A specialized tool-based agent that performs subtasks delegated by LLM nodes. Workers are compiled as `@tool` decorated functions (not graph nodes) and have a fixed output format: `{"result": str, "success": bool}`. The result is returned to the calling LLM node as a ToolMessage, allowing the LLM to decide how to use the information. Workers do NOT update global state directly.

### 5. Tool Node
Executes function calls requested by LLM nodes, with iteration tracking and limits.

### 6. Edges
Define the flow between nodes:
- **Normal Edge**: Direct connection (A → B)
- **Conditional Edge**: Router-based branching (Router → A or B or C)
- **Tool Edge**: LLM ↔ Tool circular flow

### 7. Command Pattern
Nodes return `Command` objects that encapsulate:
- `update`: Dict of state changes
- `goto`: Next node to execute (or "END")

---

## Running Example: Email Classification System

Throughout this documentation, we'll build an email triage system that:
1. Receives an email
2. Analyzes its content and sentiment
3. Routes to appropriate department (Sales, Support, or Spam)
4. Processes the email with department-specific logic
5. Generates a response

### ASL Configuration

```json
{
  "meta": {
    "version": "2025.10"
  },
  "graph": {
    "entrypoint": "1",
    "state": {
      "schema": {
        "count": "int",
        "messages": "Annotated[List[BaseMessage], lambda x, y: x + y]"
      }
    },
    "nodes": [
      {
        "id": "1",
        "type": "EntryPoint",
        "label": "Start",
        "config": {
          "title": "Email Input"
        }
      },
      {
        "id": "2",
        "type": "LLMNode",
        "label": "Analyzer",
        "config": {
          "title": "Email Analyzer",
          "system_prompt": "You are an email classification expert. Analyze emails for content, tone, and intent.",
          "human_prompt": "Analyze this email: {email_content}",
          "selected_tools": ["extract_metadata", "check_sentiment"],
          "max_tool_iterations": 5
        }
      },
      {
        "id": "3",
        "type": "RouterBlock",
        "label": "Router",
        "config": {
          "title": "Department Router",
          "system_prompt": "Route emails to the appropriate department based on analysis."
        }
      },
      {
        "id": "4",
        "type": "LLMNode",
        "label": "Sales",
        "config": {
          "title": "Sales Agent",
          "system_prompt": "You handle sales inquiries professionally."
        }
      },
      {
        "id": "5",
        "type": "LLMNode",
        "label": "Support",
        "config": {
          "title": "Support Agent",
          "system_prompt": "You provide technical support."
        }
      },
      {
        "id": "6",
        "type": "LLMNode",
        "label": "Spam",
        "config": {
          "title": "Spam Handler",
          "system_prompt": "You handle spam with automated responses."
        }
      },
      {
        "id": "7",
        "type": "LLMNode",
        "label": "Final",
        "config": {
          "title": "Response Generator",
          "system_prompt": "Generate final email response."
        }
      }
    ],
    "edges": [
      {"from": "1", "to": "2", "type": "NormalEdge"},
      {"from": "2", "to": "3", "type": "NormalEdge"},
      {"from": "3", "to": "4", "type": "ConditionalEdge"},
      {"from": "3", "to": "5", "type": "ConditionalEdge"},
      {"from": "3", "to": "6", "type": "ConditionalEdge"},
      {"from": "4", "to": "7", "type": "NormalEdge"},
      {"from": "5", "to": "7", "type": "NormalEdge"},
      {"from": "6", "to": "7", "type": "NormalEdge"}
    ],
    "tools": {
      "extract_metadata": {
        "type": "custom",
        "description": "Extract sender, subject, keywords from email",
        "implementation": "..."
      },
      "check_sentiment": {
        "type": "custom",
        "description": "Analyze email sentiment (positive/negative/neutral)",
        "implementation": "..."
      }
    }
  }
}
```

### Execution Flow

```
1. User Input (email) → Entry Point
2. Email Analyzer (LLM Node 2)
   ├─ Uses tool: extract_metadata
   ├─ Uses tool: check_sentiment
   └─ Generates analysis
3. Department Router (Router Node 3)
   └─ Decides: Sales | Support | Spam
4. Department Handler (LLM Node 4/5/6)
   └─ Processes with department logic
5. Response Generator (LLM Node 7)
   └─ Creates final response
```

---

## Detailed Component Guide

### 1. Global State

**Purpose**: Single source of truth for all workflow data.

**Structure**:
```python
class GlobalState(TypedDict):
    """Global state shared across all nodes in the workflow."""
    # Shared fields with reducers
    count: Annotated[int, operator.add]  # Reducer: accumulates increments
    messages: Annotated[List[BaseMessage], lambda x, y: x + y]
    
    # Per-node tracking (automatically generated)
    node_2_messages: Annotated[List[BaseMessage], lambda x, y: x + y]
    node_2_llm_calls: Annotated[int, operator.add]  # Reducer: accumulates increments
    node_2_tool_iteration_count: int  # Direct set, no accumulation
    
    node_4_messages: Annotated[List[BaseMessage], lambda x, y: x + y]
    node_4_llm_calls: Annotated[int, operator.add]  # Reducer: accumulates increments
    node_4_tool_iteration_count: int  # Direct set, no accumulation
    # ... for each LLM/Worker node
    
    # Router tracking
    routing_reason: Optional[str]
```

**Key Features**:

1. **Namespaced Fields**: Each node gets `node_{id}_messages`, `node_{id}_llm_calls`, `node_{id}_tool_iteration_count`
2. **Reducer Functions**: Fields with `Annotated[type, reducer_function]` automatically merge updates:
   - `operator.add` for counters: accumulates increments (e.g., `count: 1` + `count: 1` = `count: 2`)
   - `lambda x, y: x + y` for message lists: appends new messages to existing list
3. **Direct Set Fields**: `tool_iteration_count` uses plain `int` - last write wins (used for tracking, not accumulation)
4. **Type Safety**: TypedDict provides IDE autocomplete and type checking

**Example Usage in Email System**:

```python
# Initial state
{
    "count": 0,
    "messages": [],
    "node_2_messages": [],
    "node_2_llm_calls": 0,
    "node_2_tool_iteration_count": 0,
    # ... other nodes
    "routing_reason": None
}

# After Email Analyzer (Node 2) executes with tools
{
    "count": 3,  # Accumulated: LLM call (1) + Tool call (1) + Final LLM call (1)
    "messages": [
        AIMessage(content="Analyzing email..."),
        ToolMessage(content="Metadata: sender=john@sales.com"),
        ToolMessage(content="Sentiment: Positive, interested in pricing"),
        AIMessage(content="This appears to be a sales inquiry...")
    ],
    "node_2_messages": [
        AIMessage(content="Analyzing email..."),
        ToolMessage(content="Metadata: sender=john@sales.com"),
        ToolMessage(content="Sentiment: Positive, interested in pricing"),
        AIMessage(content="This appears to be a sales inquiry...")
    ],
    "node_2_llm_calls": 2,  # Accumulated: First call (1) + After tools (1)
    "node_2_tool_iteration_count": 2,  # Direct set: incremented each tool execution
    # ... other nodes unchanged
}
```

### 2. LLM Node

**Purpose**: Execute Language Model calls to process input and generate responses.

**Configuration**:
```json
{
  "id": "2",
  "type": "LLMNode",
  "config": {
    "title": "Email Analyzer",
    "system_prompt": "You are an email classification expert.",
    "human_prompt": "Analyze this email: {email_content}",
    "structured_output_enabled": false,
    "structured_output_schema": {},
    "selected_tools": ["extract_metadata", "check_sentiment"],
    "max_tool_iterations": 5,
    "iteration_warning_message": "Tool limit approaching, finalize analysis."
  }
}
```

**Generated Code**:
```python
def llm_2_node(global_state: GlobalState) -> Command:
    """LLM Node 2: Email Analyzer
    
    Uses two-phase execution pattern:
    1. First call: Invoke without structured output (allows tool use)
    2. Check for tool calls -> route to tool node if present
    3. On return from tools (current_iteration > 0): Apply structured output
    4. If no tools: Apply structured output directly
    """
    
    # Initialize model with tools (NO structured output binding yet)
    model = init_chat_model(tools=[extract_metadata, check_sentiment])
    
    # Build message list
    messages = []
    
    # Add system prompt
    system_prompt_rendered = render_template(
        "You are an email classification expert.",
        global_state
    )
    if system_prompt_rendered:
        messages.append(SystemMessage(content=system_prompt_rendered))
    
    # Add node-specific conversation history
    messages.extend(global_state.get("node_2_messages", []))
    
    # Add human prompt (with template variables)
    human_prompt_rendered = render_template(
        "Analyze this email: {email_content}",
        global_state
    )
    if human_prompt_rendered:
        messages.append(HumanMessage(content=human_prompt_rendered))
    
    # Get current iteration count
    current_iteration = global_state.get("node_2_tool_iteration_count", 0)
    
    # TWO-PHASE EXECUTION:
    # If returning from tool execution (iteration > 0), apply structured output
    if current_iteration > 0:
        # Phase 2: Apply structured output to final response
        if False:  # structured_output_enabled from config
            model_with_output = model.with_structured_output(OutputSchema_2)
            response = model_with_output.invoke(messages)
        else:
            response = model.invoke(messages)
        
        # Go to next node with final response
        return Command(
            update={
                "count": 1,
                "messages": [response],
                "node_2_messages": [response],
                "node_2_llm_calls": 1,
                "node_2_tool_iteration_count": 0  # Reset counter
            },
            goto="router_3_node"
        )
    
    # Phase 1: Invoke WITHOUT structured output (allows tool calls)
    response = model.invoke(messages)
    
    # Check for tool calls
    if hasattr(response, 'tool_calls') and response.tool_calls:
        # Continue to tool node (iteration limit checked there)
        return Command(
            update={
                "count": 1,
                "messages": [response],
                "node_2_messages": [response],
                "node_2_llm_calls": 1
            },
            goto="tool_2_node"
        )
    
    # No tool calls - apply structured output if enabled
    if False:  # structured_output_enabled from config
        model_with_output = model.with_structured_output(OutputSchema_2)
        response = model_with_output.invoke(messages)
    
    # Go to next node
    return Command(
        update={
            "count": 1,
            "messages": [response],
            "node_2_messages": [response],
            "node_2_llm_calls": 1
        },
        goto="router_3_node"
    )
```

**Key Implementation Details**:

1. **Two-Phase Execution Pattern**: Critical for supporting both tool calling AND structured output:
   - **Phase 1** (first invocation): Model invoked WITHOUT `.with_structured_output()` - this allows tool calls
   - **Check iteration count**: `current_iteration > 0` indicates returning from tool execution
   - **Phase 2** (after tools): Apply `.with_structured_output()` for final response formatting
   - **Optimization**: Checking iteration count first avoids unnecessary double LLM calls
2. **Model Initialization**: Created inside function (not global) for flexibility
3. **Template Rendering**: `{email_content}` replaced with actual state values using `render_template()`
4. **Dual Message Updates**: Both `messages` (global) and `node_2_messages` (local) are updated
5. **Tool Call Detection**: Checks `response.tool_calls` to decide routing (iteration limit checked in tool node)
6. **Command Return**: Encapsulates state updates AND next node

**Template Variables**:
Prompts can reference state fields using `{field_name}`:
```python
# In ASL
"human_prompt": "Process email from {sender} with subject: {subject}"

# Gets rendered to
"Process email from john@sales.com with subject: Pricing inquiry"
```

### 3. Tool Node

**Purpose**: Execute function calls requested by LLM nodes with iteration tracking.

**Generated Code**:
```python
def tool_2_node(global_state: GlobalState) -> Command:
    """Tool node for LLM node 2 - performs tool calls with iteration tracking."""
    
    # Get node-specific messages
    messages = global_state.get("node_2_messages", [])
    if not messages:
        return Command(update={}, goto="llm_2_node")
    
    last_message = messages[-1]
    if not hasattr(last_message, "tool_calls") or not last_message.tool_calls:
        return Command(update={}, goto="llm_2_node")
    
    # Get iteration tracking from global state
    current_iteration = global_state.get("node_2_tool_iteration_count", 0)
    max_iterations = 5
    remaining = max_iterations - current_iteration
    
    # Process each tool call
    result = []
    for tool_call in last_message.tool_calls:
        tool = tools_by_name_for_node_2.get(tool_call["name"])
        if tool:
            observation = tool.invoke(tool_call["args"])
            result.append(ToolMessage(
                content=str(observation),
                tool_call_id=tool_call["id"]
            ))
        else:
            result.append(ToolMessage(
                content=f"Error: Tool '{tool_call['name']}' not found",
                tool_call_id=tool_call["id"]
            ))
    
    # Add warning if approaching limit
    if remaining <= 5 and remaining > 0:
        warning_msg = HumanMessage(
            content="Tool limit approaching, finalize analysis."
        )
        result.append(warning_msg)
    
    # Return to LLM node with results
    return Command(
        update={
            "messages": result,                           # Global
            "node_2_messages": result,                    # Local
            "node_2_tool_iteration_count": current_iteration + 1
        },
        goto="llm_2_node"
    )
```

**Execution Flow**:
```
LLM Node → (detects tool_calls) → Tool Node
          ↑                            │
          └────────────────────────────┘
             (returns tool results)
```

**Example in Email System**:

1. **LLM Response with Tool Call**:
```python
AIMessage(
    content="I need to extract metadata",
    tool_calls=[
        {
            "name": "extract_metadata",
            "args": {"email": "From: john@sales.com\nSubject: Pricing..."},
            "id": "call_123"
        }
    ]
)
```

2. **Tool Execution**:
```python
# Tool invoked
result = extract_metadata(email="From: john@sales.com...")
# Returns: {"sender": "john@sales.com", "subject": "Pricing inquiry"}

# Tool message created
ToolMessage(
    content='{"sender": "john@sales.com", "subject": "Pricing inquiry"}',
    tool_call_id="call_123"
)
```

3. **Back to LLM**:
LLM receives tool result and can make another tool call or provide final answer.

**Iteration Limit Protection**:

Tool iteration limits are enforced **in the tool node**, not the LLM node. This ensures proper tracking and prevents runaway tool usage.

**Implementation Flow**:

1. **LLM Node** - Check for tool calls, NO iteration limit check (delegated to tool node):
```python
def llm_2_node(global_state: GlobalState) -> Command:
    # Two-phase execution: first call without structured output
    current_iteration = global_state.get("node_2_tool_iteration_count", 0)
    
    if current_iteration > 0:
        # Returning from tools - apply structured output if needed
        response = model.invoke(messages)  # or with_structured_output
        return Command(
            update={"count": 1, "messages": [response], "node_2_tool_iteration_count": 0},
            goto="router_3_node"
        )
    
    response = model.invoke(messages)  # Phase 1: no structured output
    
    # Check for tool calls (iteration limit enforced in tool node)
    if hasattr(response, 'tool_calls') and response.tool_calls:
        return Command(
            update={
                "count": 1,
                "node_2_llm_calls": 1,
                "messages": [response]
            },
            goto="tool_2_node"  # Let tool node check limit
        )
```

2. **Tool Node** - Enforce limit BEFORE processing:
```python
def tool_2_node(global_state: GlobalState) -> Command:
    current_iteration = global_state.get("node_2_tool_iteration_count", 0)
    max_iterations = 5
    
    # Check iteration limit BEFORE processing
    if current_iteration >= max_iterations:
        # Hit limit - return to LLM without processing tools
        warning_msg = HumanMessage(
            content="Tool iteration limit reached. Please provide a final response without using more tools."
        )
        return Command(
            update={
                "messages": [warning_msg],
                "node_2_messages": [warning_msg]
            },
            goto="llm_2_node"
        )
    
    # Process tools...
    # Increment counter
    return Command(
        update={
            "messages": result,
            "node_2_tool_iteration_count": current_iteration + 1
        },
        goto="llm_2_node"
    )
```

3. **Warning System** - Alert when approaching limit:
```python
remaining = max_iterations - current_iteration
if remaining <= 5 and remaining > 0:
    warning_msg = HumanMessage(
        content="You are close to the tool iteration limit. Wrap up soon without more tool calls."
    )
    result.append(warning_msg)
```

**Key Design Decisions**:
- **Enforcement Location**: Tool node (not LLM node) - ensures limit is checked before executing expensive tool calls
- **Counter Type**: Plain `int` with direct set - `node_X_tool_iteration_count` is set to `current + 1`, not accumulated
- **Graceful Degradation**: Warning at threshold, hard stop at max, informative message to LLM

### 4. Router Node

**Purpose**: Analyze conversation and route to appropriate next node using LLM-powered decisions with structured output.

**Configuration**:
```json
{
  "id": "3",
  "type": "RouterBlock",
  "config": {
    "title": "Department Router",
    "system_prompt": "Route emails to the appropriate department based on analysis."
  }
}
```

**Generated Code**:
```python
def router_3_node(global_state: GlobalState) -> Command:
    """Router Node 3: Department Router
    
    Decides which node to route to based on LLM analysis with structured output.
    """
    
    # Define routing decision schema (Pydantic model)
    class RouterDecision(BaseModel):
        next_node: str = Field(description="ID of next node to route to")
        reason: str = Field(description="Reasoning for routing decision")
    
    # Initialize model
    model = init_chat_model()
    
    # Build messages
    messages = []
    
    # System prompt
    system_prompt_rendered = render_template(
        "Route emails to the appropriate department based on analysis.",
        global_state
    )
    if system_prompt_rendered:
        messages.append(SystemMessage(content=system_prompt_rendered))
    
    # Add conversation history from GLOBAL state
    messages.extend(global_state.get("messages", []))
    
    # Build routing options
    routing_options = {
        "llm_4_node": {"title": "Sales Agent", "type": "LLMNode"},
        "llm_5_node": {"title": "Support Agent", "type": "LLMNode"},
        "llm_6_node": {"title": "Spam Handler", "type": "LLMNode"},
    }
    
    options_text = "Available routing options:\n"
    for func_name, node_info in routing_options.items():
        options_text += f"- {func_name}: {node_info.get('title', 'Unknown')}\n"
    
    routing_prompt = f"""Based on the conversation so far, choose the most appropriate next node to handle the request.

{options_text}

Choose the node function name from the options above."""
    
    messages.append(HumanMessage(content=routing_prompt))
    
    # Use structured output (Pydantic model)
    router_model = model.with_structured_output(RouterDecision)
    decision = router_model.invoke(messages)
    
    # Validate decision
    if decision.next_node not in routing_options:
        decision.next_node = list(routing_options.keys())[0]  # Fallback
    
    # Create AI message documenting the routing decision
    routing_message = AIMessage(
        content=f"Routing to {decision.next_node}: {decision.reason}"
    )
    
    # Return Command with routing
    return Command(
        update={
            "count": global_state.get("count", 0) + 1,
            "messages": [routing_message],
            "routing_reason": decision.reason
        },
        goto=decision.next_node
    )
```

**Structured Output Example**:

Instead of parsing JSON from text:
```python
# OLD WAY (fragile)
response = model.invoke(messages)
json_text = extract_json(response.content)  # Regex parsing
decision = json.loads(json_text)  # Can fail

# NEW WAY (reliable)
router_model = model.with_structured_output(RouterDecision)
decision = router_model.invoke(messages)  # Returns RouterDecision object
# decision.next_node = "llm_4_node"
# decision.reason = "Email contains pricing inquiry keywords"
```

**Email System Example**:

Given conversation:
```
AIMessage: "This appears to be a sales inquiry from john@sales.com about pricing. Sentiment is positive and interested."
```

Router analyzes and decides:
```python
RouterDecision(
    next_node="llm_4_node",  # Sales Agent
    reason="Email contains pricing inquiry keywords and positive sentiment, indicating sales interest"
)
```

State update:
```python
{
    "count": 2,
    "messages": [
        # ... previous messages ...
        AIMessage(content="Routing to llm_4_node: Email contains pricing inquiry keywords...")
    ],
    "routing_reason": "Email contains pricing inquiry keywords and positive sentiment..."
}
```

**Routing Options**:
- Determined from ASL edges (all ConditionalEdge targets from router)
- Compiled into `routing_options` dict with metadata
- LLM chooses best match
- Validation ensures valid selection

### 5. Worker Node

**Purpose**: Execute subtasks for LLM nodes, then return results back to the calling node.

**Difference from LLM Node**:
- LLM Node: Routes to next workflow node
- Worker Node: Routes BACK to calling LLM node

**Configuration**:
```json
{
  "id": "8",
  "type": "WorkerNode",
  "config": {
    "title": "Email Parser",
    "system_prompt": "Extract structured data from email text.",
    "selected_tools": ["parse_headers", "extract_body"]
  }
}
```

**Generated Code**:
```python
def worker_8_node(global_state: GlobalState) -> Command:
    """Worker Node 8: Email Parser
    
    Worker node that processes tasks assigned by LLM nodes.
    """
    
    # Initialize model with tools
    model = init_chat_model(tools=[parse_headers, extract_body])
    
    # Build messages
    messages = []
    
    # System prompt
    system_prompt_rendered = render_template(
        "Extract structured data from email text.",
        global_state
    )
    if system_prompt_rendered:
        messages.append(SystemMessage(content=system_prompt_rendered))
    
    # Add worker's own conversation history
    messages.extend(global_state.get("node_8_messages", []))
    
    # Get task from global state (last message from calling LLM)
    global_messages = global_state.get("messages", [])
    if global_messages:
        last_global_message = global_messages[-1]
        if hasattr(last_global_message, 'content'):
            messages.append(HumanMessage(content=last_global_message.content))
    
    # Invoke model
    response = model.invoke(messages)
    
    # Check for tool calls (workers also use two-phase pattern)
    current_iteration = global_state.get("node_8_tool_iteration_count", 0)
    
    if current_iteration > 0:
        # Returning from tools - go back to caller
        return Command(
            update={
                "count": 1,
                "messages": [response],
                "node_8_messages": [response],
                "node_8_llm_calls": 1,
                "node_8_tool_iteration_count": 0
            },
            goto="llm_2_node"  # Returns to caller
        )
    
    if hasattr(response, 'tool_calls') and response.tool_calls:
        # Continue to worker's tool node
        return Command(
            update={
                "count": 1,
                "messages": [response],
                "node_8_messages": [response],
                "node_8_llm_calls": 1
            },
            goto="tool_worker_8_node"
        )
    else:
        # Done - route back to calling LLM node
        return Command(
            update={
                "count": 1,
                "messages": [response],
                "node_8_messages": [response],
                "node_8_llm_calls": 1
            },
            goto="llm_2_node"  # Returns to caller (determined by edge)
        )
```

**Worker Tool Functions** (decorated with `@tool` for worker nodes):
```python
@tool
def worker_8_tool(task: str, state: dict = None) -> str:
    """Worker node as a tool - uses elif chain for tool lookup."""
    
    # Extract tool call from state
    tool_name = extract_tool_name(task)
    
    # Use ELIF CHAIN (not break statements) for tool lookup
    tool_func = None
    if tool_name == "parse_headers":
        tool_func = parse_headers
    elif tool_name == "extract_body":  # ELIF, not if+break
        tool_func = extract_body
    elif tool_name == "another_tool":
        tool_func = another_tool
    
    if tool_func:
        return tool_func.invoke(task)
    return f"Unknown tool: {tool_name}"
```

**Usage Pattern**:

```
LLM Node (Email Analyzer)
    │
    ├─ "Parse this email and extract headers"
    ▼
Worker Node (Email Parser)
    │
    ├─ Uses tools: parse_headers, extract_body
    ├─ Returns: {"headers": {...}, "body": "..."}
    ▼
LLM Node (Email Analyzer)
    │
    └─ Uses parsed data to continue analysis
```

**Key Difference**:
```python
# LLM Node - routes to NEXT node in workflow
goto="router_3_node"  

# Worker Node - routes BACK to calling node
goto="llm_2_node"  
```

### 6. Edges

**Purpose**: Define the flow of execution between nodes.

**Types**:

1. **Normal Edge** (`NormalEdge`)
```json
{"from": "2", "to": "3", "type": "NormalEdge"}
```
Direct connection: Node 2 always goes to Node 3

2. **Conditional Edge** (`ConditionalEdge`)
```json
{"from": "3", "to": "4", "type": "ConditionalEdge", "condition": "out"}
{"from": "3", "to": "5", "type": "ConditionalEdge", "condition": "out"}
{"from": "3", "to": "6", "type": "ConditionalEdge", "condition": "out"}
```
Router decides which path: Node 3 can go to 4, 5, OR 6

**Edge Resolution in Compiler**:

The compiler processes edges to determine `next_node` for each node:

```python
# For LLM Node 2 with edge to Node 3
def determine_next_node(node_id: str, edges: List[Dict]) -> str:
    for edge in edges:
        if edge["from"] == node_id and edge["type"] == "NormalEdge":
            return f"llm_{edge['to']}_node"
    return "END"

# Result: next_node = "router_3_node"
```

**Email System Flow**:
```
Entry (1) ──Normal──▶ Analyzer (2) ──Normal──▶ Router (3)
                                                    │
                                           Conditional
                                                    │
                        ┌───────────────────────────┼───────────────┐
                        ▼                           ▼               ▼
                    Sales (4)                  Support (5)      Spam (6)
                        │                           │               │
                        └──────────Normal───────────┴───────────────┘
                                                    ▼
                                               Final (7)
```

### 7. Command Pattern

**Purpose**: Encapsulate state updates AND routing in a single object.

**Structure**:
```python
from langgraph.types import Command

Command(
    update={
        # State fields to update
        "count": 1,
        "messages": [AIMessage(...)],
        "node_2_messages": [AIMessage(...)]
    },
    goto="next_node_name"  # or "END"
)
```

**Benefits**:

1. **Atomic Operations**: State update + routing in one action
2. **Type Safety**: LangGraph validates Command structure
3. **No Manual Edges**: Nodes specify their own routing
4. **Cleaner Code**: No separate conditional edge functions

**Traditional vs Command Pattern**:

```python
# TRADITIONAL (Old Way)
def llm_2_node(state):
    response = model.invoke(...)
    return {"messages": [response]}  # Just state update

def should_continue_2(state):
    if state["messages"][-1].tool_calls:
        return "tool_2_node"
    return "router_3_node"

graph.add_conditional_edges("llm_2_node", should_continue_2, {...})

# COMMAND PATTERN (New Way with Reducers)
def llm_2_node(state):
    response = model.invoke(...)
    
    if response.tool_calls:
        return Command(
            update={
                "count": 1,  # Just the increment! Reducer accumulates it
                "messages": [response],
                "node_2_llm_calls": 1  # Just the increment!
            },
            goto="tool_2_node"  # Routing included!
        )
    return Command(
        update={
            "count": 1,
            "messages": [response],
            "node_2_llm_calls": 1
        },
        goto="router_3_node"
    )

# No conditional edges needed - node handles routing!
# Counters automatically accumulate via operator.add reducer!
```

---

## Implementation Deep Dive

### State Management Architecture

**Single Global State Philosophy**:

Prior architectures often used both global and local states, leading to synchronization issues. Agentish v2.0 uses a single global state with namespaced per-node fields.

**Implementation**:

1. **State Generation** (`compiler/nodes/state_node.py`):
```python
def create_global_state(
    state_schema: Dict[str, str],
    llm_node_ids: List[str] = None,
    worker_node_ids: List[str] = None
) -> str:
    """Generate GlobalState TypedDict with per-node tracking."""
    
    llm_node_ids = llm_node_ids or []
    worker_node_ids = worker_node_ids or []
    
    # Load Jinja2 template
    template = Template(global_state_template)
    
    # Render with node IDs
    return template.render(
        state_schema=state_schema,
        llm_node_ids=llm_node_ids,
        worker_node_ids=worker_node_ids
    )
```

2. **Template** (`compiler/nodes/code_artifacts/global_state.j2`):
```jinja
class GlobalState(TypedDict):
    """Global state shared across all nodes in the workflow."""
    {%- for field_name, field_type in state_schema.items() %}
    {%- if field_name == "count" %}
    {{ field_name }}: Annotated[int, operator.add]  # Reducer: accumulate increments
    {%- else %}
    {{ field_name }}: {{ field_type }}
    {%- endif %}
    {%- endfor %}
    
    {%- for node_id in llm_node_ids %}
    # Node {{ node_id }} tracking
    node_{{ node_id }}_messages: Annotated[List[BaseMessage], lambda x, y: x + y]
    node_{{ node_id }}_llm_calls: Annotated[int, operator.add]  # Reducer: accumulate increments
    node_{{ node_id }}_tool_iteration_count: int  # Direct set, no accumulation
    {%- endfor %}
    
    {%- for node_id in worker_node_ids %}
    # Worker Node {{ node_id }} tracking
    node_{{ node_id }}_messages: Annotated[List[BaseMessage], lambda x, y: x + y]
    node_{{ node_id }}_llm_calls: Annotated[int, operator.add]  # Reducer: accumulate increments
    node_{{ node_id }}_tool_iteration_count: int  # Direct set, no accumulation
    {%- endfor %}
    
    # Router tracking
    routing_reason: Optional[str]
```

**Result**:
```python
class GlobalState(TypedDict):
    count: Annotated[int, operator.add]  # Reducer: accumulates increments
    messages: Annotated[List[BaseMessage], lambda x, y: x + y]
    node_2_messages: Annotated[List[BaseMessage], lambda x, y: x + y]
    node_2_llm_calls: Annotated[int, operator.add]  # Reducer: accumulates increments
    node_2_tool_iteration_count: int  # Direct set, no accumulation
    # ... etc for all nodes
```

**Critical: Reducer Pattern for Counters**

The use of `Annotated[int, operator.add]` for counter fields is essential to avoid the "last write wins" bug:

```python
# ❌ WRONG (without reducer):
class GlobalState(TypedDict):
    count: int  # Last write wins!

# Node 1 returns: {"count": 0 + 1} = {"count": 1}
# Node 2 returns: {"count": 0 + 1} = {"count": 1}  # Should be 2!
# Final state: count = 1  # ❌ Lost Node 1's increment

# ✓ CORRECT (with reducer):
class GlobalState(TypedDict):
    count: Annotated[int, operator.add]  # Accumulates!

# Node 1 returns: {"count": 1}  # Just the increment
# Node 2 returns: {"count": 1}  # Just the increment
# LangGraph applies operator.add: 1 + 1 = 2
# Final state: count = 2  # ✓ Correct!
```

Nodes should return **increments** (the value `1`), not **totals** (`old_value + 1`).

### Template System

Agentish uses Jinja2 templates for code generation, ensuring consistency and maintainability.

**Template Location**: `compiler/nodes/code_artifacts/`

**Key Templates**:

1. **`llm_node.j2`**: LLM node function
2. **`tool_node.j2`**: Tool execution node
3. **`router_node.j2`**: Router decision node
4. **`worker_node.j2`**: Worker subtask node
5. **`global_state.j2`**: State class definition
6. **`graph_construction.j2`**: LangGraph setup
7. **`helper_functions.j2`**: Utility functions
8. **`model_init.j2`**: LLM initialization

**Template Variables**:
```python
template.render(
    node_id="2",
    title="Email Analyzer",
    system_prompt="You are an email classifier...",
    human_prompt="Analyze this email: {email_content}",
    has_tools=True,
    selected_tools=["extract_metadata", "check_sentiment"],
    next_node="router_3_node",
    max_tool_iterations=5,
    iteration_warning_message="Tool limit approaching..."
)
```

### Compiler Pipeline

**Flow**: `ASL JSON → Compiler → Python Code`

**Steps**:

1. **Parse ASL** (`new_compiler.py:compile_asl()`):
```python
def compile_asl(input_path: Path, output_path: Path) -> bool:
    # 1. Read and validate JSON
    asl_dict = json.loads(asl_content)
    
    # 2. Sort data by node types
    sorted_data = data_sorter(asl_dict)
    
    # 3. Build mappings
    function_name_mapping = build_function_name_mapping(sorted_data)
    edge_mapping = build_edge_mapping(sorted_data)
    function_edge_mapping = build_function_edge_mapping(
        edge_mapping,
        function_name_mapping
    )
    
    # 4. Generate code sections
    code = assemble_final_code(sorted_data)
    
    # 5. Write output
    output_path.write_text(code)
```

2. **Build Mappings**:
```python
# Node ID → Function Name
{
    "1": "START",
    "2": "llm_2_node",
    "3": "router_3_node",
    "4": "llm_4_node"
}

# Function → Next Function
{
    "llm_2_node": "router_3_node",
    "llm_4_node": "llm_7_node"
}

# Router → Conditional Targets
{
    "router_3_node": ["llm_4_node", "llm_5_node", "llm_6_node"]
}
```

3. **Generate Nodes**:
```python
for node in sorted_data["llm_nodes"]:
    node_id = str(node["id"])
    next_node = determine_next_node(node_id, edges)
    
    code = compile_llm_node(
        node_id=node_id,
        config=node["config"],
        next_node=next_node,
        has_tools=len(node["config"]["selected_tools"]) > 0,
        max_tool_iterations=node["config"]["max_tool_iterations"]
    )
```

4. **Assemble Code** (`new_compiler.py:assemble_final_code()`):
```python
# CRITICAL: Code generation order matters!
# Workers must be defined BEFORE models that reference them
sections = [
    generate_imports(),
    generate_helpers(),
    generate_model_init(),
    generate_states(sorted_data),           # Pydantic schemas & TypedDict
    generate_tool_functions(sorted_data["tools"]),  # Tool implementations
    generate_worker_tools(sorted_data),     # Worker @tool decorators (BEFORE models)
    generate_models(sorted_data),           # Model instances (reference workers)
    generate_tool_groups(sorted_data),      # tools_by_name_for_node_X dicts
    generate_llm_nodes(),                   # LLM node functions
    generate_tool_nodes(),                  # Tool execution nodes
    generate_router_nodes(),                # Router decision nodes
    generate_worker_nodes(),                # Worker subtask nodes
    generate_graph_construction(),          # StateGraph setup
    generate_main()                         # Entry point
]

return "\n".join(sections)
```

**Why Order Matters**:
- **Workers before Models**: Model initialization may reference worker tools (e.g., `model.bind_tools([worker_8_tool])`)
- **Schemas before Functions**: Node functions reference Pydantic output schemas
- **Tool Groups before Nodes**: Tool nodes need `tools_by_name_for_node_X` dictionaries

### Model Initialization

**Multi-LLM Support**:

```python
def init_chat_model(
    model_name: str = None,
    temperature: float = None,
    max_tokens: int = None,
    tools: list = None
):
    """Initialize chat model with optional tool binding."""
    
    model_name = model_name or ENV_CONFIG["llm_model_name"]
    
    # Detect provider from model name
    if model_name.startswith("gpt-") or model_name.startswith("o1-"):
        model = ChatOpenAI(
            model=model_name,
            temperature=temperature,
            max_tokens=max_tokens,
            api_key=ENV_CONFIG["llm_api_key"]
        )
    elif model_name.startswith("claude-"):
        model = ChatAnthropic(
            model=model_name,
            temperature=temperature,
            max_tokens=max_tokens,
            api_key=ENV_CONFIG["llm_api_key"]
        )
    else:
        # Default to Ollama for local models
        model = ChatOllama(
            model=model_name,
            temperature=temperature,
            num_ctx=ENV_CONFIG["llm_context_window"]
        )
    
    # Bind tools if provided
    if tools:
        model = model.bind_tools(tools)
    
    return model
```

**Environment Configuration**:
```bash
# .env file
LLM_MODEL_NAME=gpt-4
LLM_TEMPERATURE=0.0
LLM_MAX_OUTPUT_TOKENS=4096
LLM_API_KEY=sk-...

# For Claude
LLM_MODEL_NAME=claude-3-sonnet-20240229

# For local Ollama
LLM_MODEL_NAME=llama3.1:latest
```

### Tool Integration

**Tool Definition in ASL**:
```json
{
  "tools": {
    "extract_metadata": {
      "type": "custom",
      "description": "Extract sender, subject, keywords from email",
      "arguments": [
        {"name": "email_text", "type": "str", "required": true}
      ],
      "return_schema": {
        "sender": "str",
        "subject": "str",
        "keywords": "List[str]"
      },
      "implementation": "def tool_implementation(email_text: str, state: dict = None) -> dict:\n    # Parse email\n    headers = parse_email_headers(email_text)\n    return {\n        'sender': headers.get('from'),\n        'subject': headers.get('subject'),\n        'keywords': extract_keywords(email_text)\n    }"
    }
  }
}
```

**Generated Code**:
```python
@tool
def extract_metadata(email_text: str, state: dict = None) -> dict:
    """Extract sender, subject, keywords from email"""
    # Parse email
    headers = parse_email_headers(email_text)
    return {
        'sender': headers.get('from'),
        'subject': headers.get('subject'),
        'keywords': extract_keywords(email_text)
    }

# Tool registry
tools_for_node_2 = [extract_metadata, check_sentiment]
tools_by_name_for_node_2 = {
    "extract_metadata": extract_metadata,
    "check_sentiment": check_sentiment
}
```

### Graph Construction

**Simplified with Command Pattern**:

```python
# Build the state graph
graph_builder = StateGraph(GlobalState)

# Add all nodes
graph_builder.add_node("llm_2_node", llm_2_node)
graph_builder.add_node("tool_2_node", tool_2_node)
graph_builder.add_node("router_3_node", router_3_node)
graph_builder.add_node("llm_4_node", llm_4_node)
graph_builder.add_node("llm_5_node", llm_5_node)
graph_builder.add_node("llm_6_node", llm_6_node)
graph_builder.add_node("llm_7_node", llm_7_node)

# Set entry point
graph_builder.set_entry_point("llm_2_node")

# Compile (Command pattern handles routing)
compiled_graph = graph_builder.compile()
```

**No manual edges needed!** Nodes specify routing via `Command.goto`.

---

## ASL JSON Format

### Complete Specification

```json
{
  "meta": {
    "version": "2025.10",
    "exported_at": "2026-01-05T06:13:24.290Z"
  },
  "graph": {
    "version": 2,
    "entrypoint": "1",
    "state": {
      "schema": {
        "count": "int",
        "messages": "Annotated[List[BaseMessage], lambda x, y: x + y]",
        "custom_field": "str"
      }
    },
    "nodes": [
      {
        "id": "1",
        "type": "EntryPoint",
        "label": "Start",
        "config": {
          "title": "Entry Point",
          "description": "Initialize agent state",
          "initial_state": {}
        }
      },
      {
        "id": "2",
        "type": "LLMNode",
        "label": "Agent",
        "config": {
          "title": "Email Analyzer",
          "output_key": "analysis",
          "system_prompt": "You are an expert email classifier.",
          "human_prompt": "Analyze: {email_content}",
          "structured_output_enabled": false,
          "structured_output_schema": {},
          "selected_tools": ["tool1", "tool2"],
          "max_tool_iterations": 30,
          "iteration_warning_message": "Approaching tool limit..."
        }
      },
      {
        "id": "3",
        "type": "RouterBlock",
        "label": "Router",
        "config": {
          "title": "Department Router",
          "system_prompt": "Route to appropriate department."
        }
      },
      {
        "id": "4",
        "type": "WorkerNode",
        "label": "Parser",
        "config": {
          "title": "Email Parser",
          "system_prompt": "Parse email structure.",
          "selected_tools": ["parse_tool"],
          "max_tool_iterations": 10
        }
      }
    ],
    "edges": [
      {
        "from": "1",
        "to": "2",
        "target_slot": 0,
        "type": "NormalEdge"
      },
      {
        "from": "2",
        "to": "3",
        "target_slot": 0,
        "type": "NormalEdge"
      },
      {
        "from": "3",
        "to": "4",
        "target_slot": 0,
        "type": "ConditionalEdge",
        "condition": "out"
      }
    ],
    "tools": {
      "tool1": {
        "type": "custom",
        "description": "Tool description",
        "arguments": [
          {
            "name": "arg1",
            "type": "str",
            "required": true,
            "description": "Argument description"
          }
        ],
        "return_schema": {
          "field": "type"
        },
        "implementation": "def tool_implementation(arg1: str) -> dict:\n    return {'result': arg1}"
      }
    }
  }
}
```

### Field Reference

**Meta Section**:
- `version`: ASL format version
- `exported_at`: Export timestamp

**Graph Section**:
- `version`: Graph schema version
- `entrypoint`: Starting node ID
- `state.schema`: Global state field definitions

**Node Types**:
- `EntryPoint`: Workflow start
- `LLMNode`: LLM agent
- `RouterBlock`: Conditional router
- `WorkerNode`: Subtask worker

**Edge Types**:
- `NormalEdge`: Direct connection
- `ConditionalEdge`: Router output

**Tool Configuration**:
- `type`: "custom" | "mcp"
- `description`: Human-readable description
- `arguments`: Function parameters
- `return_schema`: Expected return type
- `implementation`: Python function code

---

## Compiler Architecture

### Directory Structure

```
compiler/
├── new_compiler.py          # Main compiler entry point
├── compiler.py              # Legacy compiler (deprecated)
├── utils.py                 # Utility functions
├── env_loader.py           # Environment configuration
└── nodes/
    ├── __init__.py         # Node compiler registry
    ├── llm_node.py         # LLM node compiler
    ├── router.py           # Router node compiler
    ├── worker_node.py      # Worker node compiler
    ├── tool_node.py        # Tool node compiler
    ├── state_node.py       # State generator
    └── code_artifacts/     # Jinja2 templates
        ├── llm_node.j2
        ├── tool_node.j2
        ├── router_node.j2
        ├── worker_node.j2
        ├── global_state.j2
        ├── graph_construction.j2
        ├── helper_functions.j2
        ├── model_init.j2
        └── imports.j2
```

### Compiler Entry Point

```bash
# Basic usage
python compiler/new_compiler.py examples/email_system.json output/email_system.py

# With validation only
python compiler/new_compiler.py examples/email_system.json output/email_system.py --validate-only
```

### Extension Points

**Adding New Node Types**:

1. Create compiler in `compiler/nodes/my_node.py`:
```python
def compile_node(
    node_id: str,
    safe_id: str,
    config: Dict[str, Any],
    label: str,
    **kwargs
) -> List[str]:
    """Compile MyNode type."""
    template = Template(my_node_template)
    code = template.render(
        node_id=node_id,
        config=config
    )
    return [code]
```

2. Create template `compiler/nodes/code_artifacts/my_node.j2`:
```jinja
def my_{{ node_id }}_node(global_state: GlobalState) -> Command:
    # Implementation
    pass
```

3. Register in `compiler/nodes/__init__.py`:
```python
NODE_COMPILERS = {
    "LLMNode": llm_node.compile_node,
    "RouterBlock": router.compile_node,
    "WorkerNode": worker_node.compile_node,
    "MyNode": my_node.compile_node,  # Add here
}
```

---

## Best Practices

### 1. State Design

**✅ DO**:
```python
# Use descriptive field names
{
  "state": {
    "schema": {
      "count": "int",
      "messages": "Annotated[List[BaseMessage], lambda x, y: x + y]",
      "email_content": "str",
      "classification": "str",
      "confidence_score": "float"
    }
  }
}
```

**❌ DON'T**:
```python
# Avoid generic names
{
  "state": {
    "schema": {
      "data": "Any",  # Too generic
      "temp": "str",  # Unclear purpose
      "x": "int"      # Not descriptive
    }
  }
}
```

### 2. Prompt Engineering

**✅ DO**:
```json
{
  "system_prompt": "You are an expert email classifier. Analyze emails for:\n1. Intent (sales, support, spam)\n2. Sentiment (positive, negative, neutral)\n3. Urgency (high, medium, low)\n\nProvide detailed reasoning for classifications.",
  "human_prompt": "Classify this email:\n\nFrom: {sender}\nSubject: {subject}\nBody: {body}\n\nPrevious context: {previous_analysis}"
}
```

**❌ DON'T**:
```json
{
  "system_prompt": "Classify emails",
  "human_prompt": "{email}"
}
```

### 3. Tool Design

**✅ DO**:
```python
@tool
def extract_email_metadata(email_text: str) -> dict:
    """
    Extract structured metadata from email.
    
    Returns:
        {
            "sender": "email@domain.com",
            "recipient": "user@company.com",
            "subject": "Email subject",
            "timestamp": "2026-01-05T10:30:00",
            "headers": {...},
            "attachments": [...]
        }
    """
    # Clear, focused implementation
    return parse_email(email_text)
```

**❌ DON'T**:
```python
@tool
def process_email(email: str, do_parse: bool, do_classify: bool) -> Any:
    """Does stuff with email."""  # Vague
    # Multiple responsibilities
    if do_parse:
        result = parse(email)
    if do_classify:
        result = classify(email)
    return result
```

### 4. Router Logic

**✅ DO**:
```json
{
  "system_prompt": "You are a routing specialist. Based on email analysis:\n\n- Route to SALES if: pricing inquiry, product questions, purchase intent\n- Route to SUPPORT if: technical issues, how-to questions, bug reports\n- Route to SPAM if: unsolicited ads, phishing attempts, irrelevant content\n\nConsider sentiment, keywords, and sender reputation."
}
```

**❌ DON'T**:
```json
{
  "system_prompt": "Pick the right department"
}
```

### 5. Error Handling

**Tool Implementation**:
```python
@tool
def risky_operation(input_data: str) -> dict:
    """Operation that might fail."""
    try:
        result = process(input_data)
        return {
            "success": True,
            "result": result,
            "error": None
        }
    except ValueError as e:
        return {
            "success": False,
            "result": None,
            "error": f"Invalid input: {str(e)}"
        }
    except Exception as e:
        return {
            "success": False,
            "result": None,
            "error": f"Unexpected error: {str(e)}"
        }
```

### 6. Two-Phase Execution Pattern

**Why It Exists**:
LangChain's `.with_structured_output()` disables tool calling. The two-phase pattern solves this:

**✅ DO** (Two-Phase Pattern):
```python
def llm_node(state):
    current_iteration = state.get("node_X_tool_iteration_count", 0)
    
    # Phase 2: Returning from tools - apply structured output
    if current_iteration > 0:
        if structured_output_enabled:
            model_with_output = model.with_structured_output(Schema)
            response = model_with_output.invoke(messages)
        else:
            response = model.invoke(messages)
        return Command(update={"node_X_tool_iteration_count": 0}, goto="next")
    
    # Phase 1: First call - NO structured output (allows tools)
    response = model.invoke(messages)
    
    if response.tool_calls:
        return Command(update={...}, goto="tool_node")
    
    # No tools - apply structured output if needed
    if structured_output_enabled:
        model_with_output = model.with_structured_output(Schema)
        response = model_with_output.invoke(messages)
    
    return Command(update={...}, goto="next")
```

**❌ DON'T** (Breaks Tool Calling):
```python
def llm_node(state):
    # Applying structured output immediately blocks tool calls!
    model_with_output = model.with_structured_output(Schema)
    response = model_with_output.invoke(messages)
    
    # This will NEVER be true - structured output disabled tools
    if response.tool_calls:  # Never happens!
        return Command(goto="tool_node")
```

**Key Points**:
- Check `current_iteration > 0` FIRST to detect return from tools
- Only apply `.with_structured_output()` when NOT expecting tool calls
- This pattern allows both tool use AND structured outputs in the same node

### 7. Testing Workflows

**Unit Test Generated Code**:
```python
def test_email_analyzer():
    """Test email analyzer node."""
    state = {
        "count": 0,
        "messages": [],
        "node_2_messages": [],
        "node_2_llm_calls": 0,
        "node_2_tool_iteration_count": 0,
        "email_content": "Dear Sales, I'm interested in pricing..."
    }
    
    result = llm_2_node(state)
    
    assert isinstance(result, Command)
    assert result.update["count"] == 1
    assert len(result.update["messages"]) > 0
    assert result.goto in ["tool_2_node", "router_3_node"]
```

---

## Troubleshooting

### Common Issues

#### 1. Tool Not Found

**Error**:
```
ToolMessage(content="Error: Tool 'extract_metadata' not found")
```

**Solution**:
- Verify tool is defined in ASL `tools` section
- Check tool name matches exactly (case-sensitive)
- Ensure tool is in `selected_tools` list for the node

#### 2. Invalid Routing Decision

**Error**:
```
Warning: Invalid node 'llm_99_node', using first option
```

**Solution**:
- Router decided on non-existent node
- Check ConditionalEdge targets match available nodes
- Improve router system prompt to guide better decisions

#### 3. Template Variable Not Found

**Error**:
```
KeyError: 'email_content'
```

**Solution**:
```python
# Ensure field exists in state schema
{
  "state": {
    "schema": {
      "email_content": "str"  # Add missing field
    }
  }
}

# Or use safe formatting (returns placeholder if missing)
render_template("Process {email_content}", state)
# If email_content missing: "Process {email_content}"
```

#### 4. Tool Iteration Limit Reached

**Symptom**:
```
HumanMessage(content="You are out of tool calls. Now, based on everything you have analyzed, return the final output.")
```

**Solution**:
- Increase `max_tool_iterations` in node config
- Optimize tool usage (fewer, more focused calls)
- Improve prompts to guide LLM to conclude faster

#### 5. State Type Mismatch

**Error**:
```
TypeError: 'int' object is not iterable
```

**Solution**:
```python
# Check state schema matches usage
{
  "state": {
    "schema": {
      "keywords": "List[str]"  # Not "str"
    }
  }
}
```

### Debugging Tips

**1. Enable Verbose Logging**:
```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

**2. Inspect State at Each Step**:
```python
def llm_2_node(global_state: GlobalState) -> Command:
    print(f"[DEBUG] Node 2 state: {global_state}")
    # ... rest of function
```

**3. Validate ASL Before Compiling**:
```bash
python compiler/new_compiler.py examples/workflow.json output.py --validate-only
```

**4. Test Individual Nodes**:
```python
# Isolated test
state = create_test_state()
result = llm_2_node(state)
print(result.update)
print(result.goto)
```

---

## Appendix

### A. Environment Variables

```bash
# LLM Configuration
LLM_MODEL_NAME=gpt-4                    # Model to use
LLM_TEMPERATURE=0.0                     # Creativity (0-2)
LLM_MAX_OUTPUT_TOKENS=4096             # Max response length
LLM_CONTEXT_WINDOW=8192                # Max context size
LLM_API_KEY=sk-...                     # API key

# Langfuse Tracing (Optional)
LANGFUSE_API_KEY=lf-...
LANGFUSE_HOST=https://cloud.langfuse.com
LANGFUSE_PROJECT_NAME=email-classifier
```

### B. Code Generation Example

**Input ASL** (simplified):
```json
{
  "nodes": [{
    "id": "2",
    "type": "LLMNode",
    "config": {
      "title": "Analyzer",
      "system_prompt": "Classify emails",
      "selected_tools": ["extract_metadata"]
    }
  }],
  "edges": [{"from": "2", "to": "3", "type": "NormalEdge"}]
}
```

**Generated Python**:
```python
def llm_2_node(global_state: GlobalState) -> Command:
    """LLM Node 2: Analyzer"""
    
    model = init_chat_model(tools=[extract_metadata])
    
    messages = []
    messages.append(SystemMessage(content="Classify emails"))
    messages.extend(global_state.get("node_2_messages", []))
    
    response = model.invoke(messages)
    
    tool_call_count = global_state.get("node_2_tool_iteration_count", 0)
    max_iterations = 30
    
    if hasattr(response, 'tool_calls') and response.tool_calls and tool_call_count < max_iterations:
        return Command(
            update={
                "count": global_state.get("count", 0) + 1,
                "messages": [response],
                "node_2_messages": [response],
                "node_2_llm_calls": global_state.get("node_2_llm_calls", 0) + 1
            },
            goto="tool_2_node"
        )
    else:
        return Command(
            update={
                "count": global_state.get("count", 0) + 1,
                "messages": [response],
                "node_2_messages": [response],
                "node_2_llm_calls": global_state.get("node_2_llm_calls", 0) + 1,
                "node_2_tool_iteration_count": 0
            },
            goto="llm_3_node"
        )
```

### C. Complete Email System Code

See `examples/email_classifier.json` and compiled output `output/email_classifier.py` for full implementation.

---

## Conclusion

Agentish provides a powerful, declarative approach to building agentic workflows. By combining:
- Single global state architecture
- Command-based routing
- Structured LLM outputs
- Template-driven code generation

You can create complex, maintainable AI agents with minimal code.

**Next Steps**:
1. Review `examples/` directory for more patterns
2. Build your first workflow
3. Experiment with different LLM providers
4. Extend with custom node types

**Resources**:
- GitHub: [agentish repository]
- Docs: [online documentation]
- Community: [Discord/Slack]

---

*Documentation generated for Agentish v2.0 - January 5, 2026*

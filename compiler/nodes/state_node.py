"""Compiler for State nodes - both Global and Local (per LLM node)."""

import json
from typing import Any, Dict, List
from jinja2 import Template

try:
    from ..utils import py_str
except ImportError:
    from utils import py_str


def create_global_state(state_schema: Dict[str, str], llm_node_ids: List[str] = None, worker_node_ids: List[str] = None) -> str:
    """
    Generate the GlobalState TypedDict class from the graph state schema.
    Now includes per-node tracking fields.
    
    Example schema:
    {
        "count": "int",
        "messages": "Annotated[List[BaseMessage], lambda x, y: x + y]"
    }
    
    Args:
        state_schema: Base state schema from ASL
        llm_node_ids: List of LLM node IDs to generate tracking fields for
        worker_node_ids: List of Worker node IDs to generate tracking fields for
    """
    from pathlib import Path
    
    llm_node_ids = llm_node_ids or []
    worker_node_ids = worker_node_ids or []
    
    # Load template from file
    template_path = Path(__file__).parent / "code_artifacts" / "global_state.j2"
    with open(template_path, "r") as f:
        template_str = f.read()
    
    template = Template(template_str)
    return template.render(
        state_schema=state_schema,
        llm_node_ids=llm_node_ids,
        worker_node_ids=worker_node_ids
    )


def create_local_state(node_id: str, max_tool_iterations: int = 30, custom_state_fields: Dict[str, str] = None, state_prefix: str = "LLMState") -> str:
    """
    DEPRECATED: Local states are no longer used in single global state architecture.
    This function now returns an empty string for backward compatibility.
    
    Args:
        node_id: Node identifier (unused)
        max_tool_iterations: Maximum tool iterations (unused)
        custom_state_fields: Custom fields to add (unused)
        state_prefix: Prefix for state class name (unused)
    """
    # Return empty string - local states no longer needed
    return ""


def create_state_node(state_schema: Dict[str, str]) -> str:
    """
    Legacy function for backward compatibility.
    Use create_global_state instead.
    """
    return create_global_state(state_schema)


def compile_node(
    node_id: str,
    safe_id: str,
    config: Dict[str, Any],
    label: str,
    **kwargs,
) -> List[str]:
    """
    Compile EntryPoint node to initialize state.
    
    The EntryPoint node:
    - Initializes the global state
    - Sets up initial values
    """
    initial_state = config.get("initial_state", {})
    
    lines = [
        f"def entry_{safe_id}(state: GlobalState) -> dict:",
        f"    \"\"\"Entry Point: {label}\"\"\"",
        "    return {",
    ]
    
    # Add initial state values
    for key, value in initial_state.items():
        value_str = json.dumps(value, default=str)
        lines.append(f"        {py_str(key)}: {value_str},")
    
    lines.append("    }")
    
    return ["\n".join(lines)]
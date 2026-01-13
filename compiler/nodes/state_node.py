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




def compile_node(
    node_id: str,
    safe_id: str,
    config: Dict[str, Any],
    label: str,
    **kwargs,
) -> List[str]:
    """
    Compile EntryPoint node - simple pass-through.
    
    The EntryPoint node just passes control to the next node.
    State is initialized from the global schema, not initial_state.
    """
    # EntryPoint is a simple pass-through - no initialization needed
    # State comes from global schema definition
    return []  # Return empty - EntryPoint doesn't need a function
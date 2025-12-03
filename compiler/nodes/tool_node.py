"""Compiler for ToolNode."""

from typing import Any, Dict, List

try:
    from ..utils import py_str, sanitize_identifier
except ImportError:
    from utils import py_str, sanitize_identifier


def compile_node(
    node_id: str,
    safe_id: str,
    config: Dict[str, Any],
    label: str,
    **kwargs,
) -> List[str]:
    """
    Compile ToolNode to a LangGraph ToolNode with selected tools.
    
    The ToolNode:
    - Contains a collection of selected function calls
    - Compiles to ToolNode([tool1, tool2, ...])
    - Tools are selected from the global tool registry
    - Automatically invoked when LLM makes tool calls
    - Automatically returns to the calling LLM node after execution
    - No explicit input/output edges needed in the graph
    """
    selected_tools = [sanitize_identifier(name) for name in (config.get("selected_tools", []) or []) if name]

    if not selected_tools:
        # Empty tool node - shouldn't happen in valid graphs but handle gracefully
        lines = [
            f"# Tool Node: {label} (no tools selected)",
            f"tool_node_{safe_id} = ToolNode([])"
        ]
    else:
        # Build list of tool references
        tool_refs = ", ".join(selected_tools)
        lines = [
            f"# Tool Node: {label}",
            f"tool_node_{safe_id} = ToolNode([{tool_refs}])"
        ]
    
    return ["\n".join(lines)]

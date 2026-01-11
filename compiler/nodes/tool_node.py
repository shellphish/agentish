"""Compiler for ToolNode - with iteration tracking and warnings."""

from typing import Any, Dict, List
from jinja2 import Template
from pathlib import Path

try:
    from ..utils import py_str, sanitize_identifier
except ImportError:
    from utils import py_str, sanitize_identifier


def compile_node(
    node_id: str,
    safe_id: str,
    config: Dict[str, Any],
    label: str,
    max_tool_iterations: int = 30,
    iteration_warning_message: str = "",
    llm_node_id: str = None,
    llm_function_name: str = None,
    **kwargs,
) -> List[str]:
    """
    Compile ToolNode with iteration tracking and warnings.
    
    The ToolNode:
    - Performs tool calls from the LLM
    - Tracks iteration count in local state
    - Warns when approaching max iterations
    - Stops tool calls when max is reached
    - Returns results as ToolMessage objects
    - Uses Command pattern for routing
    """
    selected_tools = [sanitize_identifier(name) for name in (config.get("selected_tools", []) or []) if name]
    
    # Use provided values or get from config
    if not iteration_warning_message:
        iteration_warning_message = config.get("iteration_warning_message", 
                                              "You are close to the tool iteration limit. Wrap up soon without more tool calls.")
    
    # The tool node is associated with an LLM node
    # Use llm_node_id if provided, otherwise use node_id
    associated_llm_id = llm_node_id or node_id
    
    # Determine LLM function name for routing back
    if not llm_function_name:
        llm_function_name = f"llm_{associated_llm_id}_node"
    
    if not selected_tools:
        # No tools selected - shouldn't happen but handle gracefully
        lines = [
            f"# Tool Node for LLM {associated_llm_id}: {label} (no tools selected)",
            f"def tool_{associated_llm_id}_node(global_state: GlobalState, local_state: LLMState_{associated_llm_id}) -> Command:",
            "    \"\"\"Empty tool node - no tools configured.\"\"\"",
            f"    return Command(update={{}}, goto=\"{llm_function_name}\")"
        ]
        return ["\n".join(lines)]
    
    # Load the Jinja2 template
    template_path = Path(__file__).parent / "code_artifacts" / "tool_node.j2"
    with open(template_path, "r") as f:
        template_str = f.read()
    
    template = Template(template_str)
    
    code = template.render(
        node_id=associated_llm_id,
        max_tool_iterations=max_tool_iterations,
        iteration_warning_message=iteration_warning_message,
        llm_function_name=llm_function_name
    )
    
    return [code]


def generate_tool_group(node_id: str, selected_tools: List[str]) -> str:
    """
    Generate tool group code for a specific node.
    
    Returns code like:
    tools_for_node_2 = [addition, subtraction]
    tools_by_name_for_node_2 = {tool.name: tool for tool in tools_for_node_2}
    """
    template_path = Path(__file__).parent / "code_artifacts" / "tool_group.j2"
    with open(template_path, "r") as f:
        template_str = f.read()
    
    template = Template(template_str)
    return template.render(
        node_id=node_id,
        tool_names=selected_tools
    )

"""
Worker node compiler - Similar to LLM node but human message comes from previous LLM.

Worker nodes are similar to LLM nodes but:
- Only has system_prompt in config (human message comes from calling LLM)
- Can have tools and tool iteration tracking
- Has its own local state (WorkerState_{node_id})
- Returns analysis output to the calling LLM node
"""

from typing import Any, Dict, List
from jinja2 import Template
from pathlib import Path

try:
    from ..utils import py_str
except ImportError:
    from utils import py_str


def compile_node(
    node_id: str,
    safe_id: str,
    config: Dict[str, Any],
    label: str,
    return_node: str = "END",
    has_tools: bool = False,
    max_tool_iterations: int = 30,
    iteration_warning_message: str = "",
    **kwargs,
) -> List[str]:
    """
    Compile Worker Node.
    
    Args:
        node_id: The worker node's ID
        safe_id: Sanitized identifier
        config: Node configuration
        label: Node label
        return_node: Function name to return to after completion
        has_tools: Whether the worker has tools
        max_tool_iterations: Maximum tool call iterations
        iteration_warning_message: Warning message when close to limit
    
    Returns:
        List containing the worker function code
    """
    title = config.get("title", label)
    system_prompt = config.get("system_prompt", "")
    structured_output_enabled = config.get("structured_output_enabled", False)
    structured_output_schema = config.get("structured_output_schema", {})
    selected_tools = config.get("selected_tools", []) or []
    
    # Load the Jinja2 template
    template_path = Path(__file__).parent / "code_artifacts" / "worker_node.j2"
    with open(template_path, "r") as f:
        template_str = f.read()
    
    template = Template(template_str)
    
    # Generate structured output schema class name if needed
    structured_output_schema_class = ""
    if structured_output_enabled and structured_output_schema:
        structured_output_schema_class = f"WorkerOutputSchema_{node_id}"
    
    code = template.render(
        node_id=node_id,
        title=title,
        system_prompt=system_prompt,
        return_node=return_node,
        has_tools=has_tools,
        selected_tools=selected_tools,
        max_tool_iterations=max_tool_iterations,
        iteration_warning_message=iteration_warning_message,
        structured_output_enabled=structured_output_enabled,
        structured_output_schema_class=structured_output_schema_class
    )
    
    return [code]


def generate_worker_model(node_id: str, selected_tools: List[str]) -> str:
    """
    Generate model initialization for a worker node.
    
    Returns code like:
    model_worker_8 = init_chat_model(tools=[tool1, tool2])
    """
    if selected_tools:
        tools_str = "[" + ", ".join(selected_tools) + "]"
        return f"model_worker_{node_id} = init_chat_model(tools={tools_str})"
    else:
        return f"model_worker_{node_id} = init_chat_model()"


def generate_worker_should_continue(node_id: str) -> str:
    """
    Generate should_continue function for worker nodes with tools.
    
    This function determines whether to continue to tool node or end.
    """
    template_path = Path(__file__).parent / "code_artifacts" / "should_continue_worker.j2"
    with open(template_path, "r") as f:
        template_str = f.read()
    
    template = Template(template_str)
    return template.render(node_id=node_id)

"""
Worker node compiler - Workers are tools bound to LLM nodes, not graph nodes.

Worker nodes are similar to LLM nodes but:
- They are NOT added to the graph as nodes
- They are bound as @tool decorated functions to LLMs
- Only has system_prompt in config (task comes as argument)
- Can have tools and tool iteration tracking
- Returns {"result": "...", "success": True/False}
"""

from typing import Any, Dict, List
from jinja2 import Template
from pathlib import Path

try:
    from ..utils import py_str, sanitize_label
except ImportError:
    from utils import py_str, sanitize_label


def generate_worker_tool(
    node_id: str,
    config: Dict[str, Any],
    label: str,
    **kwargs,
) -> str:
    """
    Generate a worker as a @tool decorated function.
    
    Args:
        node_id: The worker node's ID
        config: Node configuration
        label: Node label
    
    Returns:
        String containing the @tool decorated worker function
    """
    title = config.get("title", label)
    description = config.get("description", "Worker node")
    system_prompt = config.get("system_prompt", "")
    selected_tools = config.get("selected_tools", []) or []
    max_tool_iterations = config.get("max_tool_iterations", 10)  # Default to 10
    iteration_warning_message = config.get("iteration_warning_message", 
                                          "You are close to the tool iteration limit. Wrap up soon without more tool calls.")
    
    # Sanitize label for function naming
    sanitized_label = sanitize_label(label)
    
    # Load the Jinja2 template
    template_path = Path(__file__).parent / "code_artifacts" / "worker_tool.j2"
    with open(template_path, "r") as f:
        template_str = f.read()
    
    template = Template(template_str)
    
    code = template.render(
        node_id=node_id,
        sanitized_label=sanitized_label,
        title=title,
        description=description,
        system_prompt=system_prompt,
        selected_tools=selected_tools,
        max_tool_iterations=max_tool_iterations,
        iteration_warning_message=iteration_warning_message,
        has_tools=len(selected_tools) > 0
    )
    
    return code


def generate_worker_model(node_id: str, selected_tools: List[str]) -> str:
    """
    Generate model initialization for a worker node.
    
    Returns code like:
    model_worker_6 = init_chat_model(tools=[tool1, tool2])
    """
    if selected_tools:
        tools_str = "[" + ", ".join(selected_tools) + "]"
        return f"model_worker_{node_id} = init_chat_model(tools={tools_str})"
    else:
        return f"model_worker_{node_id} = init_chat_model()"



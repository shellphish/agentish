"""Compiler for LLMNode - uses Jinja2 templates with local state support."""

from typing import Any, Dict, List
from jinja2 import Template
from pathlib import Path

try:
    from ..utils import py_str, sanitize_label
except ImportError:
    from utils import py_str, sanitize_label


def compile_node(
    node_id: str,
    safe_id: str,
    config: Dict[str, Any],
    label: str,
    next_node: str = "END",
    has_tools: bool = False,
    max_tool_iterations: int = 30,
    iteration_warning_message: str = "",
    **kwargs,
) -> List[str]:
    """
    Compile LLM Node using Jinja2 template.
    
    The LLM node:
    - Has its own local state (LLMState_{node_id})
    - Can have system_prompt and human_prompt
    - Can have tools bound to it
    - ALWAYS has structured output enabled
    - Tracks LLM calls and tool iterations in local state
    - Uses Command pattern for routing
    """
    title = config.get("title", label)
    system_prompt = config.get("system_prompt", "")
    human_prompt = config.get("human_prompt", "")
    structured_output_schema = config.get("structured_output_schema", [])
    selected_tools = config.get("selected_tools", []) or []
    input_state_keys = config.get("input_state_keys", []) or []
    output_state_keys = config.get("output_state_keys", []) or []
    
    # Sanitize label for function naming
    sanitized_label = sanitize_label(label)
    
    # Load the Jinja2 template
    template_path = Path(__file__).parent / "code_artifacts" / "llm_node.j2"
    with open(template_path, "r") as f:
        template_str = f.read()
    
    template = Template(template_str)
    
    # Always generate structured output schema class
    structured_output_schema_class = f"OutputSchema_{node_id}"
    
    code = template.render(
        node_id=node_id,
        sanitized_label=sanitized_label,
        title=title,
        system_prompt=system_prompt,
        human_prompt=human_prompt,
        has_tools=has_tools,
        selected_tools=selected_tools,
        next_node=next_node,
        max_tool_iterations=max_tool_iterations,
        iteration_warning_message=iteration_warning_message,
        structured_output_schema=structured_output_schema,
        structured_output_schema_class=structured_output_schema_class,
        input_state_keys=input_state_keys,
        output_state_keys=output_state_keys
    )
    
    return [code]


def generate_model_instance(node_id: str, selected_tools: List[str]) -> str:
    """
    Generate model initialization code for an LLM node.
    
    Returns code like:
    model_2 = init_chat_model(tools=[addition, subtraction])
    """
    if selected_tools:
        tools_str = "[" + ", ".join(selected_tools) + "]"
        return f"model_{node_id} = init_chat_model(tools={tools_str})"
    else:
        return f"model_{node_id} = init_chat_model()"



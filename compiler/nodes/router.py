"""
Router node compiler - Routes to next node based on LLM decision.

The job of router node is to decide which node to handle transfer to.
The node itself is an LLM agent.
The LLM agent is given a system prompt (generic), and a human message. 
Within the human message, we append all output nodes that can be chosen.

The router uses router_values from config to determine routing options.
Each router_value has a node label and description.
The LLM responds with the label, which is then mapped to the function name.
"""

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
    router_values: List[Dict[str, str]] = None,
    label_to_function_map: Dict[str, str] = None,
    **kwargs,
) -> List[str]:
    """
    Compile Router Node.
    
    Args:
        node_id: The router node's ID
        safe_id: Sanitized identifier
        config: Node configuration with system_prompt
        label: Node label
        router_values: List of {"node": "Label", "description": "..."} from config
        label_to_function_map: Dict mapping label -> function_name
    
    Returns:
        List containing the router function code
    """
    title = config.get("title", label)
    system_prompt = config.get("system_prompt", "")
    input_state_keys = config.get("input_state_keys", []) or []
    router_values = router_values or config.get("router_values", [])
    label_to_function_map = label_to_function_map or {}
    
    # Sanitize label for function naming
    sanitized_label = sanitize_label(label)
    
    # Load the Jinja2 template
    template_path = Path(__file__).parent / "code_artifacts" / "router_node.j2"
    with open(template_path, "r") as f:
        template_str = f.read()
    
    template = Template(template_str)
    
    code = template.render(
        node_id=node_id,
        sanitized_label=sanitized_label,
        title=title,
        system_prompt=system_prompt,
        input_state_keys=input_state_keys,
        router_values=router_values,
        label_to_function_map=label_to_function_map
    )
    
    return [code]


def generate_router_model(node_id: str) -> str:
    """
    Generate model initialization for a router node.
    
    Returns code like:
    model_router_3 = init_chat_model()
    """
    return f"model_router_{node_id} = init_chat_model()"



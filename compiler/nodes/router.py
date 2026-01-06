"""
Router node compiler - Routes to next node based on LLM decision.

The job of router node is to decide which node to handle transfer to.
The node itself is an LLM agent.
The LLM agent is given a system prompt (generic), and a human message. 
Within the human message, we append all output nodes that can be chosen.

Think of it as a switch condition. 
For example, if we have 3 output nodes: A, B, C. The human message would be something like:
"Based on the following options, choose the most appropriate one to handle the next step:
1. A: [description of node A]
2. B: [description of node B]
3. C: [description of node C]

The LLM must only output the name of the chosen node. 
We then process it to handle the transfer.
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
    outgoing_nodes: Dict[str, Dict[str, str]] = None,
    **kwargs,
) -> List[str]:
    """
    Compile Router Node.
    
    Args:
        node_id: The router node's ID
        safe_id: Sanitized identifier
        config: Node configuration with system_prompt
        label: Node label
        outgoing_nodes: Dict mapping function_name -> {"title": "...", "type": "..."}
    
    Returns:
        List containing the router function code
    """
    title = config.get("title", label)
    system_prompt = config.get("system_prompt", "")
    outgoing_nodes = outgoing_nodes or {}
    
    # Load the Jinja2 template
    template_path = Path(__file__).parent / "code_artifacts" / "router_node.j2"
    with open(template_path, "r") as f:
        template_str = f.read()
    
    template = Template(template_str)
    
    code = template.render(
        node_id=node_id,
        title=title,
        system_prompt=system_prompt,
        outgoing_nodes=outgoing_nodes
    )
    
    return [code]


def generate_router_model(node_id: str) -> str:
    """
    Generate model initialization for a router node.
    
    Returns code like:
    model_router_3 = init_chat_model()
    """
    return f"model_router_{node_id} = init_chat_model()"



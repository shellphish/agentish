"""Compiler for EntryPoint node."""

import json
from typing import Any, Dict, List

try:
    from ..utils import py_str
except ImportError:
    from utils import py_str


def compile_node(
    node_id: str,
    safe_id: str,
    config: Dict[str, Any],
    label: str,
    **kwargs,
) -> List[str]:
    """
    Compile EntryPoint node to initialize state with count and messages.
    
    The EntryPoint node:
    - Has only outgoing edges (no incoming)
    - Initializes count to 0
    - Initializes messages with optional SystemMessage
    - Sets any additional initial state fields
    """
    initial_state = config.get("initial_state", {})
    
    lines = [
        f"def entry_{safe_id}(_: AgentState) -> dict:",
        f"    \"\"\"Entry Point: {label}\"\"\"",
        "    return {",
        "        'count': 0,",
    ]
    
    messages = initial_state.get("messages")
    if messages is None:
        lines.append("        'messages': [],")
    else:
        lines.append(f"        'messages': {json.dumps(messages, default=str)},")
    
    # Add any additional initial state
    for key, value in initial_state.items():
        if key not in ['count', 'messages']:
            value_str = json.dumps(value, default=str)
            lines.append(f"        {py_str(key)}: {value_str},")
    
    lines.append("    }")
    
    return ["\n".join(lines)]

"""Compiler for LLMNode - simplified to work with state messages."""

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
    Compile LLM Node to invoke model with state messages.
    """
    output_key = config.get("output_key", f"llm_{node_id}_output")
    system_prompt = config.get("system_prompt") or ""
    user_prompt = config.get("human_prompt") or config.get("prompt") or ""
    
    lines = [
        f"def call_model_{safe_id}(state: AgentState) -> dict:",
        f"    \"\"\"LLM Node: {label}\"\"\"",
        # 1. Get existing history
        "    current_messages = list(state.get('messages', []))", 
        "    messages = current_messages",
    ]
    
    # 2. Prepend System Prompt (FIXED)
    if system_prompt:
        lines.extend([
            f"    node_system_prompt = render_template({py_str(system_prompt)}, state)",
            "    if node_system_prompt:",
            "        messages = [SystemMessage(content=node_system_prompt)] + current_messages",
        ])
    
    # 3. Append User Prompt (if exists)
    if user_prompt:
        lines.extend([
            f"    node_user_prompt = render_template({py_str(user_prompt)}, state)",
            "    if node_user_prompt:",
            "        messages.append(HumanMessage(content=node_user_prompt))",
        ])
    
    lines.extend([
        f"    response = model_{safe_id}.invoke(messages)",
        "    return {",
        "        'messages': [response],",
        "        'count': state.get('count', 0) + 1,",
    ])
    
    if output_key and output_key != "messages":
        lines.append(f"        {py_str(output_key)}: response,")
    
    lines.append("    }")
    
    return ["\n".join(lines)]
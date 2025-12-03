"""Compiler for ConditionalBlock."""

from typing import Any, Dict, List, Optional

try:
    from ..utils import py_str
except ImportError:
    from utils import py_str


DEFAULT_ITERATION_WARNING = "You are close to the tool iteration limit. Please wrap up soon without more tool calls."


def compile_router(
    node_id: str,
    safe_id: str,
    config: Dict[str, Any],
    iteration_config: Optional[Dict[str, Any]] = None,
    **kwargs,
) -> List[str]:
    """
    Compile ConditionalBlock to a router function.
    
    The ConditionalBlock:
    - Is control flow, not a node
    - Has exactly one incoming edge (from LLM Node)
    - Has exactly two outgoing edges (true/false)
    - Returns "true" or "false" string
    
    Two modes:
    1. "tool_detection" - checks if last message has tool_calls
    2. Expression - evaluates Python expression
    """
    condition = config.get("condition", "")
    iteration_config = iteration_config or {}
    max_iterations = iteration_config.get("max_iterations")
    warning_message = iteration_config.get("warning_message") or DEFAULT_ITERATION_WARNING
    
    lines = [
        f"def route_{safe_id}(state: AgentState) -> str:",
        f"    \"\"\"Conditional router\"\"\"",
    ]
    
    # Check if this is tool detection mode
    if condition == "tool_detection":
        lines.append("    messages = state.get('messages') or []")

        if max_iterations:
            lines.extend([
                "    tool_calls_count = 0",
                "    for msg in reversed(messages):",
                "        if isinstance(msg, (HumanMessage, SystemMessage)):",
                "            break",
                "        if isinstance(msg, AIMessage) and getattr(msg, 'tool_calls', None):",
                "            tool_calls_count += 1",
                f"    if tool_calls_count >= {int(max_iterations)}:",
                f"        warning_content = render_template({py_str(warning_message)}, state)",
                "        if warning_content:",
                "            warning_msg = HumanMessage(content=warning_content)",
                "            existing_messages = state.get('messages')",
                "            if isinstance(existing_messages, list):",
                "                existing_messages.append(warning_msg)",
                "            else:",
                "                state['messages'] = [warning_msg]",
                f"        print('[router:{safe_id}] Tool iteration limit reached ({int(max_iterations)}). Forcing false branch.')",
                "        return 'false'",
            ])

        lines.extend([
            "    for msg in reversed(messages):",
            "        if isinstance(msg, AIMessage):",
            "            return 'true' if getattr(msg, 'tool_calls', None) else 'false'",
            "    return 'false'"
        ])
    else:
        # Expression mode - evaluate the condition
        lines.extend([
            "    try:",
            f"        condition = eval({py_str(condition)}, {{'state': state, 'AIMessage': AIMessage, 'isinstance': isinstance, 'getattr': getattr}})",
            "        return 'true' if condition else 'false'",
            "    except Exception as e:",
            f"        print(f'[router] Error evaluating condition: {{e}}')",
            "        return 'false'  # Safe fallback"
        ])
    
    return ["\n".join(lines)]


def compile_node(
    node_id: str,
    safe_id: str,
    config: Dict[str, Any],
    label: str,
    **kwargs,
) -> List[str]:
    """
    ConditionalBlock doesn't compile to a node, only a router.
    This is here for consistency but returns empty.
    """
    return []

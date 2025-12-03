"""Node compiler registry and dispatcher."""

from . import (
    conditional_block,
    entry_point_node,
    llm_node,
    tool_node,
)

NODE_COMPILERS = {
    "EntryPoint": entry_point_node.compile_node,
    "LLMNode": llm_node.compile_node,
    "ConditionalBlock": conditional_block.compile_node,
    "ToolNode": tool_node.compile_node,
}

ROUTER_COMPILERS = {
    "ConditionalBlock": conditional_block.compile_router,
}

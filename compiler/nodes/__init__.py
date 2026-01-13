"""Node compiler registry and dispatcher."""

from . import (
    conditional_block,
    llm_node,
    state_node,
    tool_node,
    router,
)

NODE_COMPILERS = {
    "EntryPoint": state_node.compile_node,
    "LLMNode": llm_node.compile_node,
    "ConditionalBlock": conditional_block.compile_node,
    "ToolNode": tool_node.compile_node,
    "RouterBlock": router.compile_node,
    # Note: WorkerNode is not compiled as a graph node; it's processed separately as a tool
}

ROUTER_COMPILERS = {
    "ConditionalBlock": conditional_block.compile_router,
}

// =====================================================
// ASL Editor — Constants & Configuration
// =====================================================

export const ASL_DEBUG = false;

export const DEFAULT_SCHEMA = {
    count: "int",
    messages: "Annotated[List[BaseMessage], lambda x, y: x + y]"
};

export const DEFAULT_LLM_CONFIG = {
    model: "llama3.1:latest",
    temperature: 0.0
};

export const DEFAULT_TOOL_MAX_ITERATIONS = 30;
export const DEFAULT_TOOL_LIMIT_WARNING =
    "You are close to the tool iteration limit. Wrap up soon without more tool calls.";

export const TOOL_TEMPLATE_ADDITION = `def tool_implementation(a: int, b: int, state: dict = None) -> dict:
    """
    Add two numbers together.
    
    Args:
        a: First number
        b: Second number
        state: Agent state (optional, read-only access)
    
    Returns:
        dict with result and success flag
    """
    try:
        result = a + b
        return {
            "result": result,
            "success": True
        }
    except Exception as e:
        return {
            "result": None,
            "success": False,
            "error": str(e)
        }`;

export const NODE_FORMS = {
    "asl/entry": [
        { key: "title", label: "Display name", type: "text", placeholder: "Entry Node" },
        {
            key: "initial_state",
            label: "Initial State Variables",
            type: "initial_state_table",
            description: "Define additional state variables (count and messages are automatic)."
        }
    ],
    "asl/llm": [
        { key: "title", label: "Node title", type: "text", placeholder: "LLM Node", description: "⚠️ Please ensure each node has a unique title name" },
        {
            key: "input_state_keys",
            label: "Input State",
            type: "state_checkboxes",
            description: "Input State to provide in context"
        },
        {
            key: "output_state_keys",
            label: "Global state to update",
            type: "state_checkboxes",
            description: "Select which state variables to update with LLM output"
        },
        {
            key: "system_prompt",
            label: "System prompt",
            type: "textarea",
            rows: 4,
            description: "Prepended system instruction specific to this LLM node."
        },
        {
            key: "human_prompt",
            label: "Human prompt",
            type: "textarea",
            rows: 4,
            description: "Optional human message template evaluated before invoking the LLM."
        },
        {
            key: "structured_output_schema",
            label: "Output Schema",
            type: "output_schema_table",
            description: "Define the structure for LLM output"
        },
        {
            key: "selected_tools",
            label: "Selected tools",
            type: "tool_drop_list",
            description: "Drag tools from the Function Catalog to add them"
        },
        {
            key: "max_tool_iterations",
            label: "Max tool iterations",
            type: "number",
            placeholder: "30",
            description: "Maximum number of tool calls allowed (only shown when tools are selected)",
            min: 1,
            step: 1,
            conditional: { field: "selected_tools", hasItems: true }
        },
        {
            key: "iteration_warning_message",
            label: "Iteration warning message",
            type: "textarea",
            rows: 3,
            description: "Warning message when approaching tool iteration limit (only shown when tools are selected)",
            conditional: { field: "selected_tools", hasItems: true }
        }
    ],
    "asl/worker": [
        { key: "title", label: "Node title", type: "text", placeholder: "Worker Node", description: "⚠️ Please ensure each node has a unique title name" },
        {
            key: "description",
            label: "Description",
            type: "textarea",
            rows: 2,
            description: "Brief description of this worker's purpose. Workers return a fixed format: {result: str, success: bool}"
        },
        {
            key: "system_prompt",
            label: "System prompt",
            type: "textarea",
            rows: 4,
            description: "System instruction for this worker node."
        },
        {
            key: "selected_tools",
            label: "Selected tools",
            type: "tool_drop_list",
            description: "Drag tools from the Function Catalog to add them"
        },
        {
            key: "max_tool_iterations",
            label: "Max tool iterations",
            type: "number",
            placeholder: "30",
            description: "Maximum number of tool calls allowed (only shown when tools are selected)",
            min: 1,
            step: 1,
            conditional: { field: "selected_tools", hasItems: true }
        },
        {
            key: "iteration_warning_message",
            label: "Iteration warning message",
            type: "textarea",
            rows: 3,
            description: "Warning message when approaching tool iteration limit (only shown when tools are selected)",
            conditional: { field: "selected_tools", hasItems: true }
        }
    ],
    "asl/router": [
        { key: "title", label: "Node title", type: "text", placeholder: "Router Block", description: "⚠️ Please ensure each node has a unique title name" },
        {
            key: "input_state_keys",
            label: "Input State",
            type: "state_checkboxes",
            description: "Input State to provide in context"
        },
        {
            key: "system_prompt",
            label: "System prompt",
            type: "textarea",
            rows: 4,
            description: "System instruction for routing decisions."
        },
        {
            key: "router_values",
            label: "Router Values",
            type: "router_values_table",
            description: "Define descriptions for each routing option"
        }
    ]
};

export const NODE_FORM_KEYS = Object.fromEntries(
    Object.entries(NODE_FORMS).map(([type, defs]) => [
        type,
        new Set(defs.map((def) => def.key))
    ])
);

export const NODE_TYPE_MAP = {
    entry: "asl/entry",
    llm: "asl/llm",
    router: "asl/router",
    worker: "asl/worker"
};

export const EXPORT_TYPE_MAP = {
    "asl/entry": "EntryPoint",
    "asl/llm": "LLMNode",
    "asl/router": "RouterBlock",
    "asl/worker": "WorkerNode"
};

export const IMPORT_TYPE_MAP = Object.fromEntries(
    Object.entries(EXPORT_TYPE_MAP).map(([litegraphType, exportType]) => [exportType, litegraphType])
);

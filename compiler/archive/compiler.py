"""
LangGraph compiler for the ASL visual editor.

This module ingests an ASL JSON document and generates a runnable Python module
that wires the flow into a LangGraph ``StateGraph``. It mirrors the block
semantics implemented in the LiteGraph frontend (Start, LLM, Worker, Tool,
Memory, Transform, Router, Output).
"""

from __future__ import annotations

import importlib
import importlib.util
import json
import os
import sys
import tempfile
import textwrap
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Set, Tuple
from env_loader import load_dotenv

try:
    from .nodes import NODE_COMPILERS, ROUTER_COMPILERS
    from .utils import (
        ensure_unique_identifier,
        py_str,
        sanitize_identifier,
    )
except ImportError:
    # Fallback for when compiler is added to sys.path directly
    from nodes import NODE_COMPILERS, ROUTER_COMPILERS
    from utils import (
        ensure_unique_identifier,
        py_str,
        sanitize_identifier,
    )


load_dotenv = load_dotenv()


PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_CANDIDATES = [
    PROJECT_ROOT / ".env",
    PROJECT_ROOT / "agentish/.env",
    Path(__file__).resolve().parents[1] / ".env",
]

for candidate in ENV_CANDIDATES:
    if candidate.exists():
        load_dotenv(candidate)
        break


END_SENTINEL = object()


def generate_state_typing(schema: Dict[str, Any]) -> str:
    """Generate AgentState TypedDict with messages append reducer."""
    lines = [
        "class AgentState(TypedDict):",
        "    count: int",
        "    messages: Annotated[List[BaseMessage], lambda x, y: x + y]"
    ]
    
    # Add other user-defined fields
    for field, hint in schema.items():
        if field not in ['count', 'messages']:
            type_hint = "Any"
            comment = f"  # {hint}" if hint else ""
            lines.append(f"    {field}: {type_hint}{comment}")
    
    return "\n".join(lines) + "\n"


def build_profile_registry(meta: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    registry = {**DEFAULT_LLM_PROFILES}
    for profile in meta.get("llm_profiles", []) or []:
        profile_id = profile.get("id")
        config = profile.get("config")
        if profile_id and isinstance(config, dict):
            registry[profile_id] = config
    return registry


def build_tool_registry(graph_data: Dict[str, Any]) -> Dict[str, Any]:
    tools = graph_data.get("tools")
    if isinstance(tools, dict):
        return tools

    registry: Dict[str, Any] = {}
    for node in graph_data.get("nodes", []):
        if node.get("type") != "ToolNode":
            continue
        config = node.get("config", {})
        name = config.get("tool_name")
        if not name:
            continue
        registry[name] = {
            "description": config.get("description", ""),
            "arguments": config.get("arguments", []),
            "return_schema": config.get("return_schema", {}),
            "pass_state_keys": config.get("pass_state_keys", []),
        }
    return registry


def generate_custom_tool_implementations(tool_registry: Dict[str, Any]) -> str:
    """Generate Python functions for custom tools."""
    lines = [
        "# ==========================================",
        "# CUSTOM TOOL IMPLEMENTATIONS",
        "# ==========================================",
        ""
    ]
    
    has_custom_tools = False
    for tool_name, tool_def in tool_registry.items():
        if tool_def.get('type') != 'custom':
            continue
        
        has_custom_tools = True
        implementation = tool_def.get('implementation', '')
        
        if not implementation:
            continue
        
        # Add the custom implementation code directly
        lines.append(f"# Custom tool: {tool_name}")
        lines.append(implementation)
        lines.append("")
    
    if not has_custom_tools:
        return ""
    
    return "\n".join(lines)


def generate_tool_decorators(tool_registry: Dict[str, Any]) -> str:
    """Generate @tool decorated functions for LangChain."""
    lines = [
        "# ==========================================",
        "# TOOL REGISTRY",
        "# ==========================================",
        ""
    ]
    
    for tool_name, tool_def in tool_registry.items():
        tool_type = tool_def.get('type', 'mcp')
        description = tool_def.get('description', '')
        args = tool_def.get('arguments', [])
        metadata = tool_def.get('metadata', {}) or {}
        mcp_method = tool_def.get('mcp_method', '')
        base_url = tool_def.get('mcp_server') or metadata.get('server') or metadata.get('mcp_server') or ""

        method = metadata.get('method')
        endpoint = metadata.get('endpoint')
        if mcp_method:
            parts = mcp_method.split()
            if len(parts) >= 1:
                method = method or parts[0]
            if len(parts) >= 2:
                endpoint = endpoint or " ".join(parts[1:])
        method = (method or "GET").upper()
        endpoint = endpoint or "/"

        safe_name = sanitize_identifier(tool_name)

        lines.append("@tool")
        signature = []
        for arg in args:
            arg_name = arg["name"]
            arg_type = arg.get("type", "Any")
            required = arg.get("required", True)
            if required:
                signature.append(f"    {arg_name}: {arg_type}")
            else:
                signature.append(f"    {arg_name}: {arg_type} = None")
        if signature:
            lines.append(f"def {safe_name}(")
            lines.append(",\n".join(signature))
            lines.append(") -> dict:")
        else:
            lines.append(f"def {safe_name}() -> dict:")
        lines.append(f'    """{description}"""')

        if tool_type == "custom":
            implementation = tool_def.get("implementation", "")
            impl_name = "tool_implementation"
            if implementation:
                import re

                match = re.search(r"def\\s+(\\w+)\\s*\\(", implementation)
                if match:
                    impl_name = match.group(1)
            arg_names = [arg["name"] for arg in args]
            arg_list = ", ".join([f"{name}={name}" for name in arg_names])
            lines.append(f"    return {impl_name}({arg_list})")
            lines.append("")
            continue

        lines.append(f"    base_url = {py_str(base_url)}")
        lines.append(f"    endpoint = {py_str(endpoint)}")
        lines.append("    if not base_url or not endpoint:")
        lines.append("        return {")
        lines.append(f'            "tool_name": "{tool_name}",')
        lines.append('            "status": "error",')
        lines.append('            "message": "MCP server or endpoint not configured"')
        lines.append("        }")
        lines.append("    if endpoint.startswith('http'):")
        lines.append("        url = endpoint")
        lines.append("    else:")
        lines.append("        base = base_url.rstrip('/')")
        lines.append("        url = base + (endpoint if endpoint.startswith('/') else '/' + endpoint)")

        payload_lines = ", ".join([f'"{arg["name"]}": {arg["name"]}' for arg in args])
        lines.append(f"    payload = {{{payload_lines}}}" if payload_lines else "    payload = {}")
        lines.append("    payload = {k: v for k, v in payload.items() if v is not None}")
        lines.append("    try:")
        if method == "GET":
            lines.append("        response = requests.get(url, params=payload or None, timeout=15)")
        else:
            lines.append(
                f'        response = requests.request("{method}", url, json=payload or None, timeout=15)'
            )
        lines.append("        response.raise_for_status()")
        lines.append("        content_type = response.headers.get('content-type', '').lower()")
        lines.append("        if 'application/json' in content_type:")
        lines.append("            return response.json()")
        lines.append("        return {")
        lines.append(f'            "tool_name": "{tool_name}",')
        lines.append('            "status": "success",')
        lines.append('            "data": response.text')
        lines.append("        }")
        lines.append("    except Exception as exc:")
        lines.append("        return {")
        lines.append(f'            "tool_name": "{tool_name}",')
        lines.append('            "status": "error",')
        lines.append('            "message": str(exc)')
        lines.append("        }")
        lines.append("")

    lines.append("# Tool registry for LLM binding")
    lines.append("TOOL_REGISTRY = {")
    for tool_name in tool_registry.keys():
        safe_name = sanitize_identifier(tool_name)
        lines.append(f'    "{tool_name}": {safe_name},')
    lines.append("}")
    lines.append("")

    return "\n".join(lines)


def collect_edges(
    edges: Iterable[Dict[str, Any]],
    nodes: List[Dict[str, Any]],
    node_lookup: Dict[str, Dict[str, Any]],
) -> Tuple[Dict[str, List[str]], Dict[str, Dict[str, str]], Dict[str, str]]:
    """
    Collect and categorize edges from the ASL graph.
    Also infers implicit tool node return paths.
    
    Returns:
        Tuple of (normal_edges, conditional_edges)
    """
    normal_edges: Dict[str, List[str]] = defaultdict(list)
    conditional_edges: Dict[str, Dict[str, str]] = defaultdict(dict)
    conditional_parents: Dict[str, str] = {}

    for edge in edges:
        source = str(edge.get("from"))
        target = str(edge.get("to"))
        edge_type = edge.get("type", "NormalEdge")
        
        # Skip implicit edges (they're auto-generated, we'll re-infer them)
        if edge.get("implicit"):
            continue
            
        if edge_type == "ConditionalEdge":
            label = str(edge.get("condition") or "true")
            conditional_edges[source][label] = target
            continue

        target_node = node_lookup.get(target)
        if target_node and target_node.get("type") == "ConditionalBlock":
            conditional_parents[target] = source
            continue

        normal_edges[source].append(target)

    # Infer tool node return paths
    # Pattern: Conditional --true--> ToolNode
    # Infer: ToolNode --> LLM (that connects to the conditional)
    _infer_tool_returns(node_lookup, normal_edges, conditional_edges, conditional_parents)

    return normal_edges, conditional_edges, conditional_parents


def _infer_tool_returns(
    node_lookup: Dict[str, Dict[str, Any]],
    normal_edges: Dict[str, List[str]],
    conditional_edges: Dict[str, Dict[str, str]],
    conditional_parents: Dict[str, str],
) -> None:
    """
    Automatically infer and add tool node return paths.
    
    When a Conditional Block's "true" branch points to a Tool Node,
    we infer that the Tool Node should return to the LLM that feeds the Conditional.
    """
    tool_nodes = {nid for nid, node in node_lookup.items() if node.get("type") == "ToolNode"}
    
    for tool_node_id in tool_nodes:
        # Find which conditional leads to this tool node
        conditional_id = next(
            (cond_id for cond_id, mapping in conditional_edges.items() if mapping.get("true") == tool_node_id),
            None,
        )
    
        if not conditional_id:
            # Tool node not connected via conditional, skip
            continue

        # Find which LLM connects to this conditional
        llm_id = conditional_parents.get(conditional_id)
        if llm_id:
            # Add the return edge: ToolNode -> LLM
            if tool_node_id not in normal_edges:
                normal_edges[tool_node_id] = []
            if llm_id not in normal_edges[tool_node_id]:
                normal_edges[tool_node_id].append(llm_id)
                print(f"  ✓ Inferred tool return: {tool_node_id} → {llm_id}")


def _map_llm_tool_bindings(
    node_lookup: Dict[str, Dict[str, Any]],
    conditional_edges: Dict[str, Dict[str, str]],
    conditional_parents: Dict[str, str],
) -> Dict[str, List[str]]:
    """Map each LLM node to the tool functions available via downstream tool nodes."""
    tool_nodes = {nid for nid, node in node_lookup.items() if node.get("type") == "ToolNode"}
    bindings: Dict[str, List[str]] = defaultdict(list)

    for tool_node_id in tool_nodes:
        tool_config = node_lookup[tool_node_id].get("config", {})
        selected_tools = [
            sanitize_identifier(name)
            for name in tool_config.get("selected_tools", []) or []
            if name
        ]
        if not selected_tools:
            continue

        conditional_id = next(
            (cond_id for cond_id, mapping in conditional_edges.items() if mapping.get("true") == tool_node_id),
            None,
        )
        if not conditional_id:
            continue

        llm_id = conditional_parents.get(conditional_id)
        if not llm_id or node_lookup.get(llm_id, {}).get("type") != "LLMNode":
            continue

        existing = set(bindings[llm_id])
        for tool in selected_tools:
            if tool not in existing:
                bindings[llm_id].append(tool)
                existing.add(tool)

    return bindings


def _map_tool_iteration_settings(
    node_lookup: Dict[str, Dict[str, Any]],
    conditional_edges: Dict[str, Dict[str, str]],
) -> Dict[str, Dict[str, Any]]:
    """Map conditional blocks to the iteration constraints configured on their tool nodes."""
    settings: Dict[str, Dict[str, Any]] = {}

    for conditional_id, mapping in conditional_edges.items():
        tool_node_id = mapping.get("true")
        if not tool_node_id:
            continue
        tool_node = node_lookup.get(tool_node_id)
        if not tool_node or tool_node.get("type") != "ToolNode":
            continue
        tool_config = tool_node.get("config", {})
        limit = tool_config.get("max_tool_iterations")
        warning = tool_config.get("iteration_warning_message")
        try:
            limit_val = int(limit)
        except (TypeError, ValueError):
            continue
        if limit_val <= 0:
            continue
        if not isinstance(warning, str):
            warning = ""
        settings[conditional_id] = {
            "max_iterations": limit_val,
            "warning_message": warning.strip(),
        }

    return settings


def compile_asl(asl_file_path: str, output_dir: str = None) -> None:
    """
    Compile an ASL specification to Python code.
    
    Args:
        asl_file_path: Path to the ASL JSON file
        output_dir: Optional output directory path. If not provided, defaults to 
                   {asl_file_parent}/../output for regular files, or a temp dir for temp files.
    """
    with open(asl_file_path, "r", encoding="utf-8") as handle:
        asl_data = json.load(handle)

    meta = asl_data.get("meta", {})
    graph_data = asl_data.get("graph", {})
    entrypoint_id = graph_data.get("entrypoint")
    nodes = graph_data.get("nodes", [])
    edges = graph_data.get("edges", [])
    state_schema = graph_data.get("state", {}).get("schema", {})

    if entrypoint_id is None:
        raise ValueError("ASL graph requires an entrypoint node.")

    profile_registry = build_profile_registry(meta)
    tool_registry = build_tool_registry(graph_data)

    node_lookup: Dict[str, Dict[str, Any]] = {str(node["id"]): node for node in nodes}
    normal_edges, conditional_edges, conditional_parents = collect_edges(edges, nodes, node_lookup)

    used_identifiers: Set[str] = set()
    safe_id_map: Dict[str, str] = {}
    for raw_id in node_lookup.keys():
        base = sanitize_identifier(raw_id)
        safe_id_map[raw_id] = ensure_unique_identifier(base, used_identifiers)

    state_typing = generate_state_typing(state_schema)

    profile_registry_literal = json.dumps(profile_registry, indent=2)
    
    header = textwrap.dedent(
        f"""\
# Auto-generated by the ASL compiler. Edit with care.


load_dotenv()

class _SafeFormat(dict):
    def __missing__(self, key):
        return "{{" + key + "}}"


def render_template(template: str, state: Dict[str, Any]) -> str:
    if not template:
        return ""
    try:
        format_map = _SafeFormat({{**state, "state": state}})
        return template.format_map(format_map)
    except Exception:
        return template
"""
    ).strip()

    model_helper = textwrap.dedent(
        """\
MODEL_CONFIG_PATH = os.environ.get("MODEL_CONFIG_PATH", "model_config.yaml")


def _load_model_config() -> Dict[str, Any]:
    try:
        if os.path.exists(MODEL_CONFIG_PATH):
            with open(MODEL_CONFIG_PATH, "r", encoding="utf-8") as handle:
                data = yaml.safe_load(handle) or {}
                return data
    except Exception:
        pass
    return {}


MODEL_CONFIG = _load_model_config()

LANGFUSE_SECTION = MODEL_CONFIG.get("langfuse") or {}
USE_TRACING = bool(MODEL_CONFIG.get("use_tracing"))


def _coerce_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


DEFAULT_RECURSION_LIMIT = _coerce_int(MODEL_CONFIG.get("recursion_limit", 50), 50)


def _generate_session_id() -> str:
    return uuid.uuid4().hex


def _create_langfuse_handler():
    if not USE_TRACING or CallbackHandler is None:
        return None
    host = LANGFUSE_SECTION.get("host") or os.environ.get("LANGFUSE_HOST")
    public_key = LANGFUSE_SECTION.get("public_key") or os.environ.get("LANGFUSE_PUBLIC_KEY")
    secret_key = LANGFUSE_SECTION.get("secret_key") or os.environ.get("LANGFUSE_SECRET_KEY")

    if not (host and public_key and secret_key):
        return None

    os.environ["LANGFUSE_HOST"] = host
    os.environ["LANGFUSE_PUBLIC_KEY"] = public_key
    os.environ["LANGFUSE_SECRET_KEY"] = secret_key

    try:
        return CallbackHandler()
    except Exception:
        return None


def create_model_client():
    provider = (MODEL_CONFIG.get("provider") or "ollama").lower()
    model_name = MODEL_CONFIG.get("model") or "llama3.1:latest"
    temperature = MODEL_CONFIG.get("temperature", 0.0)
    endpoint = MODEL_CONFIG.get("litellm_endpoint")
    api_key = MODEL_CONFIG.get("litellm_team_key") or os.environ.get("LITELLM_TEAM_KEY")

    if provider == "openai":
        return ChatOpenAI(
            model=model_name,
            temperature=temperature,
            base_url=endpoint,
            api_key=api_key,
        )

    if provider == "claude":
        return ChatAnthropic(
            model=model_name,
            temperature=temperature,
            api_key=api_key,
        )

    kwargs = {"model": model_name, "temperature": temperature}
    if endpoint:
        kwargs["base_url"] = endpoint
    return ChatOllama(**kwargs)


def create_model_instance(*tool_funcs):
    client = create_model_client()
    if tool_funcs:
        return client.bind_tools(list(tool_funcs))
    return client
"""
    ).strip()

    node_functions: List[str] = []
    router_functions: List[str] = []
    model_instances: List[str] = []  # LLM model instances
    tool_node_instances: List[str] = []  # Tool node instances
    pydantic_schemas: List[str] = []  # Pydantic output schemas
    graph_setup: List[str] = ["workflow = StateGraph(AgentState)"]
    exposed_outputs: List[str] = []
    
    # Collect tools that need to be bound to LLM nodes
    llm_tool_bindings: Dict[str, List[str]] = _map_llm_tool_bindings(
        node_lookup, conditional_edges, conditional_parents
    )
    tool_iteration_settings = _map_tool_iteration_settings(node_lookup, conditional_edges)

    for node_id, node in node_lookup.items():
        safe_id = safe_id_map[node_id]
        node_type = node.get("type")
        config = node.get("config", {})
        label = node.get("label", node_type)

        compiler_func = NODE_COMPILERS.get(node_type)
        if not compiler_func:
            raise ValueError(f"Unsupported node type: {node_type}")

        # Special handling for LLM nodes - create model instance
        if node_type == "LLMNode":
            sanitized_tools = llm_tool_bindings.get(node_id, [])
            if sanitized_tools:
                tool_args = ", ".join(sanitized_tools)
                model_instances.append(f"model_{safe_id} = create_model_instance({tool_args})")
            else:
                model_instances.append(f"model_{safe_id} = create_model_instance()")
        
        # Special handling for Tool nodes - they become ToolNode instances
        if node_type == "ToolNode":
            tool_node_instances.extend(
                compiler_func(
                    node_id=node_id,
                    safe_id=safe_id,
                    config=config,
                    label=label,
                )
            )
        else:
            compiled_output = compiler_func(
                node_id=node_id,
                safe_id=safe_id,
                config=config,
                label=label,
            )
            # Separate Pydantic schemas from node functions
            # LLM and Worker nodes may return [schema, function]
            for item in compiled_output:
                if item.strip().startswith("class") and "BaseModel" in item:
                    pydantic_schemas.append(item)
                else:
                    node_functions.append(item)

        router_compiler = ROUTER_COMPILERS.get(node_type)
        if router_compiler:
            router_functions.extend(
                router_compiler(
                    node_id=node_id,
                    safe_id=safe_id,
                    config=config,
                    iteration_config=tool_iteration_settings.get(node_id),
                )
            )

        # Add node to graph (special handling for Tool nodes)
        if node_type == "ToolNode":
            graph_setup.append(f"workflow.add_node({py_str(node_id)}, tool_node_{safe_id})")
        elif node_type == "EntryPoint":
            graph_setup.append(f"workflow.add_node({py_str(node_id)}, entry_{safe_id})")
        elif node_type == "LLMNode":
            graph_setup.append(f"workflow.add_node({py_str(node_id)}, call_model_{safe_id})")
        # ConditionalBlock doesn't get added as a node

    graph_setup.append(f"workflow.set_entry_point({py_str(str(entrypoint_id))})")

    nodes_with_outgoing: Set[str] = set()

    for source, targets in normal_edges.items():
        for target in targets:
            graph_setup.append(f"workflow.add_edge({py_str(source)}, {py_str(target)})")
            nodes_with_outgoing.add(source)

    for source, mapping in conditional_edges.items():
        safe_id = safe_id_map.get(source)
        if not safe_id:
            continue
        parent_id = conditional_parents.get(source)
        if not parent_id:
            raise ValueError(f"Conditional block {source} is missing an upstream LLM node")

        branch_map: Dict[str, Any] = dict(mapping)
        cond_config = node_lookup.get(source, {}).get("config", {})
        configured_false_label = (cond_config.get("false_label") or "false").strip()
        if (
            configured_false_label
            and configured_false_label.lower() == "false"
            and configured_false_label not in branch_map
        ):
            branch_map[configured_false_label] = END_SENTINEL

        mapping_entries: List[str] = []
        for label, dest in branch_map.items():
            if dest is END_SENTINEL:
                mapping_entries.append(f"{py_str(label)}: END")
            else:
                mapping_entries.append(f"{py_str(label)}: {py_str(dest)}")

        mapping_literal = "{" + ", ".join(mapping_entries) + "}"
        router_name = f"route_{safe_id}"

        graph_setup.append(
            f"workflow.add_conditional_edges({py_str(parent_id)}, {router_name}, {mapping_literal})"
        )
        nodes_with_outgoing.add(parent_id)

    terminal_nodes = [
        node_id
        for node_id, node in node_lookup.items()
        if node_id not in nodes_with_outgoing and node.get("type") != "ConditionalBlock"
    ]
    for node_id in terminal_nodes:
        graph_setup.append(f"workflow.add_edge({py_str(node_id)}, END)")

    graph_setup.append("return workflow.compile()")

    runtime_helpers = []
    if exposed_outputs:
        exposed_literal = json.dumps(exposed_outputs)
        runtime_helpers.append(
            textwrap.dedent(
                f"""
                EXPOSED_OUTPUT_KEYS: List[str] = json.loads({py_str(exposed_literal)})


                def extract_exposed_outputs(state: Dict[str, Any]) -> Dict[str, Any]:
                    return {{key: state.get(key) for key in EXPOSED_OUTPUT_KEYS}}
                """
            )
        )

    runtime = textwrap.dedent(
        """\
def build_agent():
    return create_workflow()


def run(initial_state: Dict[str, Any] = None, session_id: Optional[str] = None) -> Dict[str, Any]:
    \"\"\"Run the agent workflow.\"\"\"
    agent = build_agent()
    if initial_state is None:
        initial_state = {}

    config: Dict[str, Any] = {"recursion_limit": DEFAULT_RECURSION_LIMIT}

    if USE_TRACING:
        handler = _create_langfuse_handler()
        if handler:
            session_value = session_id or (initial_state.get("session_id") if isinstance(initial_state, dict) else None)
            if not session_value:
                session_value = _generate_session_id()
            config["configurable"] = {"thread_id": session_value}
            config["metadata"] = {"session_id": session_value}
            config["callbacks"] = [handler]

    final_state = agent.invoke(initial_state, config=config)
    return final_state


def main() -> None:
    \"\"\"Example run - add HumanMessage to initial state.\"\"\"
    import sys

    if len(sys.argv) > 1:
        user_input = " ".join(sys.argv[1:])
    else:
        user_input = input("You: ")

    initial_state = {"messages": [HumanMessage(content=user_input)]}
    final_state = run(initial_state)

    print("\\n--- Conversation ---")
    for msg in final_state.get("messages", []):
        msg_type = type(msg).__name__
        content = getattr(msg, "content", str(msg))
        print(f"{msg_type}: {content}")

    print(f"\\nFinal count: {final_state.get('count', 0)}")


if __name__ == "__main__":
    main()
"""
    )

    create_workflow_fn = "def create_workflow() -> Any:\n" + textwrap.indent(
        "\n\n".join(graph_setup), "    "
    )

    # Generate tool implementations and decorators
    custom_tools = generate_custom_tool_implementations(tool_registry)
    tool_decorators = generate_tool_decorators(tool_registry)

    segments = [
        header,
        model_helper,
        state_typing,
        custom_tools,
        tool_decorators,
        "\n# ==========================================",
        "# PYDANTIC OUTPUT SCHEMAS",
        "# ==========================================\n",
        "\n".join(pydantic_schemas) if pydantic_schemas else "# No output schemas",
        "\n# ==========================================",
        "# MODEL INSTANCES",
        "# ==========================================\n",
        "\n".join(model_instances) if model_instances else "# No models",
        "\n# ==========================================",
        "# TOOL NODE INSTANCES",
        "# ==========================================\n",
        "\n".join(tool_node_instances) if tool_node_instances else "# No tool nodes",
        "\n# ==========================================",
        "# NODE FUNCTIONS",
        "# ==========================================\n",
        "\n".join(node_functions),
        "\n# ==========================================",
        "# ROUTER FUNCTIONS",
        "# ==========================================\n",
        "\n".join(router_functions) if router_functions else "# No routers",
        create_workflow_fn,
        "\n".join(runtime_helpers),
        runtime,
    ]

    # Determine output directory
    if output_dir:
        output_path = Path(output_dir)
    else:
        # Check if this is a temp file (in /tmp or system temp directory)
        asl_path = Path(asl_file_path).resolve()
        temp_dir = Path(tempfile.gettempdir()).resolve()
        
        if str(asl_path).startswith(str(temp_dir)):
            # For temp files, use the compiler's output directory
            output_path = Path(__file__).resolve().parent.parent / "output"
        else:
            # For regular files, use parent.parent/output
            output_path = asl_path.parent.parent / "output"
    
    output_path.mkdir(exist_ok=True, parents=True)
    (output_path / "__init__.py").touch()
    module_name = Path(asl_file_path).stem
    output_file = output_path / f"compiled_{module_name}.py"

    with open(output_file, "w", encoding="utf-8") as handle:
        handle.write("\n\n".join(filter(None, segments)))

    print(f"Compiled {asl_file_path} to {output_file}")


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python compiler.py <path_to_asl_file.json>")
        sys.exit(1)
    asl_file_path = sys.argv[1]
    compile_asl(asl_file_path)


if __name__ == "__main__":
    main()

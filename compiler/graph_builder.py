"""
Graph builder module - handles all graph construction and code generation.

Extracted from compiler.py to make the codebase more modular and maintainable.
"""

from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List
from jinja2 import Template

try:
    from nodes.state_node import create_global_state
    from nodes.llm_node import generate_model_instance
    from nodes.tool_node import generate_tool_group
    from nodes.worker_node import generate_worker_tool, generate_worker_model
    from nodes import NODE_COMPILERS
    from utils import sanitize_identifier, sanitize_label, generate_pydantic_model_from_schema
except ImportError:
    from compiler.nodes.state_node import create_global_state
    from compiler.nodes.llm_node import generate_model_instance
    from compiler.nodes.tool_node import generate_tool_group
    from compiler.nodes.worker_node import generate_worker_tool, generate_worker_model
    from compiler.nodes import NODE_COMPILERS
    from compiler.utils import sanitize_identifier, sanitize_label, generate_pydantic_model_from_schema


def build_function_name_mapping(sorted_data: Dict[str, Any]) -> Dict[str, str]:
    """
    Build mapping of node_id -> function_name using sanitized labels.
    
    Example:
        "3" -> "orchestrator_3_node"
        "5" -> "phone_5_node"
        "1" -> "START"
    
    Returns:
        Dict[node_id, function_name]
    """
    mapping = {}
    
    # Entry point maps to START
    entry_id = sorted_data.get("entry_node")
    if entry_id:
        mapping[str(entry_id)] = "START"
    
    # LLM nodes - use sanitized label
    for node in sorted_data["llm_nodes"]:
        node_id = str(node["id"])
        label = node.get("label", "llmnode")
        sanitized = sanitize_label(label)
        mapping[node_id] = f"{sanitized}_{node_id}_node"
    
    # Router nodes - use sanitized label
    for node in sorted_data["router_nodes"]:
        node_id = str(node["id"])
        label = node.get("label", "routerblock")
        sanitized = sanitize_label(label)
        mapping[node_id] = f"{sanitized}_{node_id}_node"
    
    # Worker nodes are NOT in the graph (they're tools)
    # But we still map them for reference
    for node in sorted_data["worker_nodes"]:
        node_id = str(node["id"])
        label = node.get("label", "workernode")
        sanitized = sanitize_label(label)
        mapping[node_id] = f"worker_{sanitized}_{node_id}_tool"
    
    return mapping


def categorize_edges_for_llm(
    llm_node_id: str,
    edges: List[Dict[str, Any]],
    nodes_by_id: Dict[str, Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Categorize edges from an LLM node into workers (tools) and next_node.
    
    Returns:
        {
            "worker_ids": [node_id, ...],  # Bind as tools
            "next_node_id": node_id or None  # Regular next node
        }
    """
    worker_ids = []
    next_node_id = None
    
    for edge in edges:
        if str(edge["from"]) != llm_node_id:
            continue
        
        to_id = str(edge["to"])
        if to_id not in nodes_by_id:
            continue
        
        target_node = nodes_by_id[to_id]
        
        if target_node["type"] == "WorkerNode":
            worker_ids.append(to_id)
        else:
            # First non-worker edge becomes next_node
            if next_node_id is None:
                next_node_id = to_id
    
    return {
        "worker_ids": worker_ids,
        "next_node_id": next_node_id
    }


def build_nodes_by_id(sorted_data: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Build a dictionary mapping node_id -> node_dict."""
    nodes_by_id = {}
    
    all_nodes = (
        sorted_data["llm_nodes"] +
        sorted_data["router_nodes"] +
        sorted_data["worker_nodes"]
    )
    
    for node in all_nodes:
        nodes_by_id[str(node["id"])] = node
    
    return nodes_by_id


def build_router_label_to_function_map(
    router_node: Dict[str, Any],
    sorted_data: Dict[str, Any],
    function_name_mapping: Dict[str, str]
) -> Dict[str, str]:
    """
    Build label -> function_name mapping for a router.
    
    Example:
        router_values = [
            {"node": "Phone", "description": "..."},
            {"node": "Customer", "description": "..."}
        ]
        
        Returns: {"Phone": "phone_5_node", "Customer": "customer_2_node"}
    """
    router_values = router_node.get("config", {}).get("router_values", [])
    label_to_func = {}
    
    all_nodes = sorted_data["llm_nodes"] + sorted_data["router_nodes"]
    
    for rv in router_values:
        target_label = rv["node"]
        
        # Find node with this label
        for node in all_nodes:
            if node.get("label") == target_label:
                node_id = str(node["id"])
                func_name = function_name_mapping.get(node_id)
                if func_name:
                    label_to_func[target_label] = func_name
                break
    
    return label_to_func


def generate_pydantic_schemas(sorted_data: Dict[str, Any]) -> str:
    """
    Generate all Pydantic schema classes at module level.
    
    Returns string containing all OutputSchema_X classes.
    """
    schemas = []
    schemas.append("# ==========================================")
    schemas.append("# PYDANTIC OUTPUT SCHEMAS")
    schemas.append("# ==========================================\n")
    
    for node in sorted_data["llm_nodes"]:
        node_id = str(node["id"])
        config = node.get("config", {})
        structured_output_schema = config.get("structured_output_schema", [])
        
        if structured_output_schema:
            class_name = f"OutputSchema_{node_id}"
            label = node.get("label", "LLMNode")
            docstring = f"Structured output for {label} (node {node_id})"
            
            schema_code = generate_pydantic_model_from_schema(
                class_name,
                structured_output_schema,
                docstring
            )
            schemas.append(schema_code)
            schemas.append("")
    
    return "\n".join(schemas)


def generate_worker_tools_code(sorted_data: Dict[str, Any]) -> str:
    """
    Generate all worker @tool decorated functions.
    
    Returns string containing all worker tool definitions.
    """
    if not sorted_data["worker_nodes"]:
        return "# No worker nodes\n"
    
    workers = []
    workers.append("# ==========================================")
    workers.append("# WORKER TOOL FUNCTIONS")
    workers.append("# ==========================================\n")
    
    for node in sorted_data["worker_nodes"]:
        node_id = str(node["id"])
        config = node.get("config", {})
        label = node.get("label", "WorkerNode")
        
        worker_code = generate_worker_tool(
            node_id=node_id,
            config=config,
            label=label
        )
        workers.append(worker_code)
        workers.append("")
    
    return "\n".join(workers)


def generate_tool_groups(
    sorted_data: Dict[str, Any],
    nodes_by_id: Dict[str, Dict[str, Any]]
) -> str:
    """
    Generate tool group dictionaries for LLM nodes with tools.
    
    Returns code like:
    tools_for_node_3 = [addition, worker_workernode_6_tool]
    tools_by_name_for_node_3 = {tool.name: tool for tool in tools_for_node_3}
    """
    tool_groups = []
    tool_groups.append("# ==========================================")
    tool_groups.append("# TOOL GROUPS")
    tool_groups.append("# ==========================================\n")
    
    edges = sorted_data["edges"]
    has_any_tool_group = False
    
    for node in sorted_data["llm_nodes"]:
        node_id = str(node["id"])
        config = node.get("config", {})
        selected_tools = config.get("selected_tools", []) or []
        
        # Categorize edges to find workers
        edge_info = categorize_edges_for_llm(node_id, edges, nodes_by_id)
        worker_ids = edge_info["worker_ids"]
        
        # Build tool list: regular tools + worker tools
        all_tools = [sanitize_identifier(t) for t in selected_tools]
        for worker_id in worker_ids:
            worker_node = nodes_by_id[worker_id]
            worker_label = worker_node.get("label", "workernode")
            worker_tool_name = f"worker_{sanitize_label(worker_label)}_{worker_id}_tool"
            all_tools.append(worker_tool_name)
        
        if all_tools:
            has_any_tool_group = True
            tools_str = "[" + ", ".join(all_tools) + "]"
            tool_groups.append(f"tools_for_node_{node_id} = {tools_str}")
            tool_groups.append(f"tools_by_name_for_node_{node_id} = {{tool.name: tool for tool in tools_for_node_{node_id}}}")
            tool_groups.append("")
    
    if not has_any_tool_group:
        return ""
    
    return "\n".join(tool_groups)


def generate_model_instances(
    sorted_data: Dict[str, Any],
    function_name_mapping: Dict[str, str],
    nodes_by_id: Dict[str, Dict[str, Any]]
) -> str:
    """
    Generate model initialization instances for each LLM node.
    Workers get their own models. Routers get models.
    LLMs get models with tools (including worker tools).
    """
    models = []
    models.append("# ==========================================")
    models.append("# MODEL INSTANCES (initialized once)")
    models.append("# ==========================================\n")
    
    edges = sorted_data["edges"]
    
    # Generate models for LLM nodes (with worker tools bound)
    for node in sorted_data["llm_nodes"]:
        node_id = str(node["id"])
        config = node.get("config", {})
        selected_tools = config.get("selected_tools", []) or []
        
        # Categorize edges to find workers
        edge_info = categorize_edges_for_llm(node_id, edges, nodes_by_id)
        worker_ids = edge_info["worker_ids"]
        
        # Build tool list: regular tools + worker tools
        all_tools = [sanitize_identifier(t) for t in selected_tools]
        for worker_id in worker_ids:
            worker_node = nodes_by_id[worker_id]
            worker_label = worker_node.get("label", "workernode")
            worker_tool_name = f"worker_{sanitize_label(worker_label)}_{worker_id}_tool"
            all_tools.append(worker_tool_name)
        
        if all_tools:
            tools_str = "[" + ", ".join(all_tools) + "]"
            models.append(f"# Model for LLM node {node_id} (with tools)")
            models.append(f"model_{node_id} = init_chat_model(tools={tools_str})")
        else:
            models.append(f"# Model for LLM node {node_id} (no tools)")
            models.append(f"model_{node_id} = init_chat_model()")
        models.append("")
    
    # Generate models for router nodes
    for node in sorted_data["router_nodes"]:
        node_id = str(node["id"])
        models.append(f"# Model for router node {node_id}")
        models.append(f"model_router_{node_id} = init_chat_model()")
        models.append("")
    
    # Generate models for worker nodes
    for node in sorted_data["worker_nodes"]:
        node_id = str(node["id"])
        config = node.get("config", {})
        selected_tools = config.get("selected_tools", []) or []
        
        sanitized_tools = [sanitize_identifier(t) for t in selected_tools]
        
        if sanitized_tools:
            tools_str = "[" + ", ".join(sanitized_tools) + "]"
            models.append(f"# Model for worker node {node_id} (with tools)")
            models.append(f"model_worker_{node_id} = init_chat_model(tools={tools_str})")
        else:
            models.append(f"# Model for worker node {node_id} (no tools)")
            models.append(f"model_worker_{node_id} = init_chat_model()")
        models.append("")
    
    return "\n".join(models)


def generate_llm_and_router_nodes(
    sorted_data: Dict[str, Any],
    function_name_mapping: Dict[str, str],
    nodes_by_id: Dict[str, Dict[str, Any]]
) -> str:
    """Generate LLM, Tool, and Router node function code."""
    from nodes.llm_node import compile_node as compile_llm_node
    from nodes.router import compile_node as compile_router_node
    from nodes.tool_node import compile_node as compile_tool_node
    
    sections = []
    edges = sorted_data["edges"]
    
    # Generate LLM nodes
    if sorted_data["llm_nodes"]:
        sections.append("# ==========================================")
        sections.append("# LLM NODE FUNCTIONS")
        sections.append("# ==========================================\n")
        
        for node in sorted_data["llm_nodes"]:
            node_id = str(node["id"])
            config = node.get("config", {})
            label = node.get("label", "LLMNode")
            
            # Categorize edges
            edge_info = categorize_edges_for_llm(node_id, edges, nodes_by_id)
            next_node_id = edge_info["next_node_id"]
            
            # Map to function name
            next_node = function_name_mapping.get(next_node_id, "END") if next_node_id else "END"
            
            # Check if has tools (excluding workers)
            selected_tools = config.get("selected_tools", []) or []
            has_tools = len(selected_tools) > 0 or len(edge_info["worker_ids"]) > 0
            
            code = compile_llm_node(
                node_id=node_id,
                safe_id=node_id,
                config=config,
                label=label,
                next_node=next_node,
                has_tools=has_tools,
                max_tool_iterations=config.get("max_tool_iterations", 30),
                iteration_warning_message=config.get("iteration_warning_message", "")
            )
            sections.extend(code)
            sections.append("")
    
    # Generate Tool nodes for LLM nodes with tools
    tool_nodes_generated = False
    for node in sorted_data["llm_nodes"]:
        node_id = str(node["id"])
        config = node.get("config", {})
        label = node.get("label", "LLMNode")
        selected_tools = config.get("selected_tools", []) or []
        
        # Categorize edges to check for workers
        edge_info = categorize_edges_for_llm(node_id, edges, nodes_by_id)
        worker_ids = edge_info["worker_ids"]
        
        # Generate tool node if this LLM has tools
        if selected_tools or worker_ids:
            if not tool_nodes_generated:
                sections.append("# ==========================================")
                sections.append("# TOOL NODE FUNCTIONS")
                sections.append("# ==========================================\n")
                tool_nodes_generated = True
            
            # Get the LLM function name for routing back
            llm_function_name = function_name_mapping.get(node_id, f"llm_{node_id}_node")
            
            tool_code = compile_tool_node(
                node_id=node_id,
                safe_id=node_id,
                config=config,
                label=label,
                max_tool_iterations=config.get("max_tool_iterations", 30),
                iteration_warning_message=config.get("iteration_warning_message", ""),
                llm_node_id=node_id,
                llm_function_name=llm_function_name
            )
            sections.extend(tool_code)
            sections.append("")
    
    # Generate Router nodes
    if sorted_data["router_nodes"]:
        sections.append("# ==========================================")
        sections.append("# ROUTER NODE FUNCTIONS")
        sections.append("# ==========================================\n")
        
        for node in sorted_data["router_nodes"]:
            node_id = str(node["id"])
            config = node.get("config", {})
            label = node.get("label", "RouterBlock")
            
            # Build label to function map
            label_to_func_map = build_router_label_to_function_map(
                node, sorted_data, function_name_mapping
            )
            
            code = compile_router_node(
                node_id=node_id,
                safe_id=node_id,
                config=config,
                label=label,
                router_values=config.get("router_values", []),
                label_to_function_map=label_to_func_map
            )
            sections.extend(code)
            sections.append("")
    
    return "\n".join(sections)


def generate_graph_construction(
    sorted_data: Dict[str, Any],
    function_name_mapping: Dict[str, str],
    nodes_by_id: Dict[str, Dict[str, Any]]
) -> str:
    """
    Generate graph construction code.
    Workers are NOT added as nodes (they're tools).
    Tool nodes ARE added for LLM nodes with tools.
    """
    template_path = Path(__file__).parent / "nodes" / "code_artifacts" / "graph_construction.j2"
    with open(template_path, "r") as f:
        template_str = f.read()
    
    # Collect all non-worker node functions
    all_node_functions = []
    
    for node_id, func_name in function_name_mapping.items():
        if func_name != "START" and not func_name.startswith("worker_"):
            all_node_functions.append(func_name)
    
    # Add tool nodes for LLM nodes with tools
    edges = sorted_data["edges"]
    for node in sorted_data["llm_nodes"]:
        node_id = str(node["id"])
        config = node.get("config", {})
        selected_tools = config.get("selected_tools", []) or []
        
        # Categorize edges to check for workers
        edge_info = categorize_edges_for_llm(node_id, edges, nodes_by_id)
        worker_ids = edge_info["worker_ids"]
        
        # Add tool node if this LLM has tools
        if selected_tools or worker_ids:
            tool_node_name = f"tool_{node_id}_node"
            if tool_node_name not in all_node_functions:
                all_node_functions.append(tool_node_name)
    
    # Find entry point
    entry_id = sorted_data.get("entry_node")
    entry_point = None
    
    if entry_id:
        # Find first edge from entry
        for edge in sorted_data["edges"]:
            if str(edge["from"]) == str(entry_id):
                to_id = str(edge["to"])
                entry_point = function_name_mapping.get(to_id)
                break
    
    template = Template(template_str)
    return template.render(
        all_node_functions=all_node_functions,
        entry_point=entry_point
    )


def build_and_generate_graph(sorted_data: Dict[str, Any]) -> str:
    """
    Main function to build graph and generate all code.
    
    Args:
        sorted_data: Categorized ASL data from data_sorter()
    
    Returns:
        String containing the generated code (excluding imports, helpers, tools)
    """
    sections = []
    
    # Build mappings
    function_name_mapping = build_function_name_mapping(sorted_data)
    nodes_by_id = build_nodes_by_id(sorted_data)
    
    # Generate state
    sections.append("# ==========================================")
    sections.append("# STATE DEFINITIONS")
    sections.append("# ==========================================\n")
    
    llm_node_ids = [str(node["id"]) for node in sorted_data["llm_nodes"]]
    # Workers are not tracked in global state since they're tools
    
    global_state_schema = sorted_data["global_state"]
    if not global_state_schema:
        global_state_schema = {
            "count": "int",
            "messages": "Annotated[List[BaseMessage], lambda x, y: x + y]"
        }
    
    global_state_code = create_global_state(
        global_state_schema,
        llm_node_ids=llm_node_ids,
        worker_node_ids=[]  # Workers don't need state tracking
    )
    sections.append(global_state_code)
    sections.append("")
    
    # Generate Pydantic schemas
    sections.append(generate_pydantic_schemas(sorted_data))
    sections.append("")
    
    # Generate worker tools BEFORE model instances (models reference workers)
    sections.append(generate_worker_tools_code(sorted_data))
    sections.append("")
    
    # Generate model instances AFTER worker tools are defined
    sections.append(generate_model_instances(sorted_data, function_name_mapping, nodes_by_id))
    sections.append("")
    
    # Generate tool groups for LLM nodes (after models, before LLM nodes)
    tool_groups_code = generate_tool_groups(sorted_data, nodes_by_id)
    if tool_groups_code:
        sections.append(tool_groups_code)
        sections.append("")
    
    # Generate LLM and Router nodes
    sections.append(generate_llm_and_router_nodes(sorted_data, function_name_mapping, nodes_by_id))
    sections.append("")
    
    # Generate graph construction
    sections.append("# ==========================================")
    sections.append("# GRAPH CONSTRUCTION")
    sections.append("# ==========================================\n")
    sections.append(generate_graph_construction(sorted_data, function_name_mapping, nodes_by_id))
    sections.append("")
    
    return "\n".join(sections)

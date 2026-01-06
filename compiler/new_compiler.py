"""
The main compiler module that takes in ASL as input, and produces 
syntactically and semantically correct Python code as output.

This compiler follows a template-based approach using Jinja2 templates
for consistent and maintainable code generation.
"""

import json
import os
import sys
import argparse
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Set
from jinja2 import Template

# Import node compilers
try:
    from nodes.state_node import create_global_state, create_local_state
    from nodes.llm_node import generate_model_instance, generate_should_continue
    from nodes.tool_node import generate_tool_group
    from nodes import NODE_COMPILERS
    from utils import sanitize_identifier
except ImportError:
    # Fallback for direct execution
    from compiler.nodes.state_node import create_global_state, create_local_state
    from compiler.nodes.llm_node import generate_model_instance, generate_should_continue
    from compiler.nodes.tool_node import generate_tool_group
    from compiler.nodes import NODE_COMPILERS
    from compiler.utils import sanitize_identifier


# ==========================================
# ARGUMENT PARSING
# ==========================================

def parse_arguments():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="ASL Compiler - Convert ASL JSON to Python code")
    parser.add_argument("input_file", type=str, help="Path to the ASL input file")
    parser.add_argument("output_file", type=str, help="Path to the output Python file")
    parser.add_argument("--validate-only", action="store_true", 
                       help="Only validate JSON without generating code")
    return parser.parse_args()


# ==========================================
# JSON VALIDATION
# ==========================================

def check_valid_json(input_str: str) -> bool:
    """Check if the input string is valid JSON."""
    try:
        json.loads(input_str)
        return True
    except json.JSONDecodeError as e:
        print(f"JSON Validation Error: {e}")
        return False


def validate_asl_structure(asl_dict: Dict[str, Any]) -> bool:
    """Validate that the ASL has required structure."""
    if "graph" not in asl_dict:
        print("Error: ASL must contain 'graph' key")
        return False
    
    graph = asl_dict["graph"]
    
    if "entrypoint" not in graph:
        print("Error: Graph must contain 'entrypoint'")
        return False
    
    if "nodes" not in graph or not isinstance(graph["nodes"], list):
        print("Error: Graph must contain 'nodes' list")
        return False
    
    return True


# ==========================================
# DATA EXTRACTION AND SORTING
# ==========================================

def data_sorter(asl_dict: Dict[str, Any]) -> Dict[str, Any]:
    """
    Sort the ASL dict into different categories of nodes.
    
    Returns:
        Dictionary with categorized data:
        - global_state: Global state schema
        - entry_node: Entry point node ID
        - llm_nodes: List of LLM nodes
        - router_nodes: List of router nodes
        - worker_nodes: List of worker nodes
        - edges: List of edges
        - tools: Dictionary of tool definitions
    """
    graph = asl_dict["graph"]
    nodes = graph.get("nodes", [])
    
    sorted_data = {
        "global_state": graph.get("state", {}).get("schema", {}),
        "entry_node": graph.get("entrypoint", None),
        "llm_nodes": [node for node in nodes if node["type"] == "LLMNode"],
        "router_nodes": [node for node in nodes if node["type"] == "RouterBlock"],
        "worker_nodes": [node for node in nodes if node["type"] == "WorkerNode"],
        "edges": graph.get("edges", []),
        "tools": graph.get("tools", {}),
    }
    
    return sorted_data


# ==========================================
# TOOL GENERATION
# ==========================================

def generate_tool_functions(tools: Dict[str, Any]) -> str:
    """
    Generate @tool decorated functions for all custom tools.
    
    Args:
        tools: Dictionary of tool definitions from the ASL
        
    Returns:
        String containing all tool function definitions
    """
    if not tools:
        return "# No custom tools defined\n"
    
    tool_functions = []
    tool_functions.append("# ==========================================")
    tool_functions.append("# TOOL FUNCTION DEFINITIONS")
    tool_functions.append("# ==========================================\n")
    
    for tool_name, tool_def in tools.items():
        tool_type = tool_def.get("type", "custom")
        
        if tool_type != "custom":
            # Skip non-custom tools for now
            continue
        
        description = tool_def.get("description", "")
        implementation = tool_def.get("implementation", "")
        
        if not implementation:
            # Create a placeholder implementation
            safe_name = sanitize_identifier(tool_name)
            tool_functions.append(f"@tool")
            tool_functions.append(f"def {safe_name}(**kwargs) -> dict:")
            tool_functions.append(f'    """{description}"""')
            tool_functions.append(f'    return {{"error": "Tool not implemented"}}')
            tool_functions.append("")
        else:
            # Use the provided implementation
            # Rename the function to match the tool name
            import re
            safe_name = sanitize_identifier(tool_name)
            
            # Find the function definition and replace with correct name
            impl_lines = implementation.split('\n')
            new_impl_lines = []
            for line in impl_lines:
                # Match function definition line
                if re.match(r'\s*def\s+\w+\s*\(', line):
                    # Replace function name
                    line = re.sub(r'(def\s+)\w+(\s*\()', rf'\1{safe_name}\2', line)
                new_impl_lines.append(line)
            
            implementation = '\n'.join(new_impl_lines)
            
            # Add @tool decorator if not present
            if "@tool" not in implementation:
                tool_functions.append("@tool")
            tool_functions.append(implementation)
            tool_functions.append("")
    
    return "\n".join(tool_functions)


def collect_tools_per_node(nodes: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    """
    Collect which tools are used by which nodes.
    
    Returns:
        Dictionary mapping node_id -> list of sanitized tool names
    """
    tools_by_node = {}
    
    for node in nodes:
        node_id = str(node["id"])
        config = node.get("config", {})
        selected_tools = config.get("selected_tools", []) or []
        
        if selected_tools:
            sanitized_tools = [sanitize_identifier(tool) for tool in selected_tools]
            tools_by_node[node_id] = sanitized_tools
    
    return tools_by_node


def build_node_registry(sorted_data: Dict[str, Any], tools_by_node: Dict[str, List[str]]) -> Dict[str, Dict[str, Any]]:
    """
    Build a registry mapping node IDs to their function names and metadata.
    
    Returns:
        Dictionary mapping node_id -> {
            "function_name": str,
            "type": str,
            "has_tools": bool,
            "title": str
        }
    """
    registry = {}
    
    # EntryPoint becomes START
    if sorted_data.get("entrypoint"):
        entrypoint_id = sorted_data["entrypoint"]
        registry[entrypoint_id] = {
            "function_name": "START",
            "type": "EntryPoint",
            "has_tools": False,
            "title": "Entry Point"
        }
    
    # LLM nodes
    for node in sorted_data["llm_nodes"]:
        node_id = str(node["id"])
        config = node.get("config", {})
        registry[node_id] = {
            "function_name": f"llm_{node_id}_node",
            "type": "LLMNode",
            "has_tools": node_id in tools_by_node,
            "title": config.get("title", "LLM Node")
        }
    
    # Router nodes
    for node in sorted_data["router_nodes"]:
        node_id = str(node["id"])
        config = node.get("config", {})
        registry[node_id] = {
            "function_name": f"router_{node_id}_node",
            "type": "RouterBlock",
            "has_tools": False,
            "title": config.get("title", "Router Block")
        }
    
    # Worker nodes
    for node in sorted_data["worker_nodes"]:
        node_id = str(node["id"])
        config = node.get("config", {})
        registry[node_id] = {
            "function_name": f"worker_{node_id}_node",
            "type": "WorkerNode",
            "has_tools": node_id in tools_by_node,
            "title": config.get("title", "Worker Node")
        }
    
    return registry


def extract_and_organize_edges(sorted_data: Dict[str, Any], node_registry: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """
    Extract edges from sorted_data and organize them for graph construction.
    
    Returns:
        Dictionary with:
        - normal_edges: List of (from_func, to_func) for direct edges
        - router_edges: Dict mapping router_func -> list of target funcs
        - tool_enabled_edges: Dict mapping llm/worker_func -> next_func (or None if END)
    """
    edges = sorted_data.get("edges", [])
    
    normal_edges = []
    router_conditionals = {}  # router_func_name -> [target_func_names]
    tool_enabled_next = {}  # llm/worker_func_name -> next_func_name
    
    # Group edges by source
    edges_by_source = {}
    for edge in edges:
        from_id = str(edge["from"])
        if from_id not in edges_by_source:
            edges_by_source[from_id] = []
        edges_by_source[from_id].append(edge)
    
    # Process each edge
    for edge in edges:
        from_id = str(edge["from"])
        to_id = str(edge["to"])
        edge_type = edge.get("type", "NormalEdge")
        
        if from_id not in node_registry or to_id not in node_registry:
            continue
        
        from_node = node_registry[from_id]
        to_node = node_registry[to_id]
        from_func = from_node["function_name"]
        to_func = to_node["function_name"]
        
        # Handle based on source node type
        if from_node["type"] == "RouterBlock":
            # Router conditional edges
            if edge_type == "ConditionalEdge":
                if from_func not in router_conditionals:
                    router_conditionals[from_func] = []
                if to_func not in router_conditionals[from_func]:
                    router_conditionals[from_func].append(to_func)
        
        elif from_node["has_tools"]:
            # LLM/Worker node with tools - store the next target
            # Only store if not already stored (handle duplicate edges)
            if from_func not in tool_enabled_next:
                tool_enabled_next[from_func] = to_func
        
        else:
            # Normal edge from non-tool node
            edge_tuple = (from_func, to_func)
            if edge_tuple not in normal_edges:
                normal_edges.append(edge_tuple)
    
    return {
        "normal_edges": normal_edges,
        "router_conditionals": router_conditionals,
        "tool_enabled_next": tool_enabled_next
    }


def get_router_outgoing_nodes(router_id: str, sorted_data: Dict[str, Any], node_registry: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, str]]:
    """
    Get outgoing nodes for a router to populate routing_options.
    
    Returns:
        Dictionary mapping function_name -> {"title": str, "type": str}
    """
    outgoing = {}
    edges = sorted_data.get("edges", [])
    
    for edge in edges:
        if str(edge["from"]) == router_id and edge.get("type") == "ConditionalEdge":
            to_id = str(edge["to"])
            if to_id in node_registry:
                node_info = node_registry[to_id]
                func_name = node_info["function_name"]
                outgoing[func_name] = {
                    "title": node_info["title"],
                    "type": node_info["type"]
                }
    
    return outgoing


# ==========================================
# CODE GENERATION
# ==========================================

def load_template(template_name: str) -> str:
    """Load a Jinja2 template from code_artifacts."""
    template_path = Path(__file__).parent / "nodes" / "code_artifacts" / template_name
    with open(template_path, "r") as f:
        return f.read()


def generate_imports() -> str:
    """Generate import statements."""
    return load_template("imports.j2")


def generate_helpers() -> str:
    """Generate helper functions."""
    return load_template("helper_functions.j2")


def generate_model_init() -> str:
    """Generate model initialization code."""
    return load_template("model_init.j2")


def generate_states(sorted_data: Dict[str, Any]) -> str:
    """
    Generate single global state class with per-node tracking fields.
    No local states in the new architecture.
    
    Returns:
        String containing global state class definition
    """
    state_code = []
    state_code.append("# ==========================================")
    state_code.append("# STATE DEFINITIONS")
    state_code.append("# ==========================================\n")
    
    # Collect node IDs for state field generation
    llm_node_ids = [str(node["id"]) for node in sorted_data["llm_nodes"]]
    worker_node_ids = [str(node["id"]) for node in sorted_data["worker_nodes"]]
    
    # Generate global state with per-node fields
    global_state_schema = sorted_data["global_state"]
    if not global_state_schema:
        # Default global state
        global_state_schema = {
            "count": "int",
            "messages": "Annotated[List[BaseMessage], lambda x, y: x + y]"
        }
    
    global_state_code = create_global_state(
        global_state_schema,
        llm_node_ids=llm_node_ids,
        worker_node_ids=worker_node_ids
    )
    state_code.append(global_state_code)
    state_code.append("")
    
    # No local states anymore - all state is global
    
    return "\n".join(state_code)
    return "\n".join(state_code)


def generate_node_code(sorted_data: Dict[str, Any], node_registry: Dict[str, Dict[str, Any]]) -> Dict[str, List[str]]:
    """
    Generate code for all nodes.
    
    Args:
        sorted_data: Sorted ASL data
        node_registry: Node ID to function name mapping
    
    Returns:
        Dictionary with categorized generated code:
        - llm_nodes: LLM node function definitions
        - tool_nodes: Tool node function definitions
        - should_continue: Should continue function definitions
        - router_nodes: Router node function definitions
        - worker_nodes: Worker node function definitions
    """
    generated = {
        "llm_nodes": [],
        "tool_nodes": [],
        "should_continue": [],
        "router_nodes": [],
        "worker_nodes": [],
    }
    
    # Generate LLM nodes and their associated tool nodes
    for llm_node in sorted_data["llm_nodes"]:
        node_id = str(llm_node["id"])
        safe_id = sanitize_identifier(node_id)
        config = llm_node.get("config", {})
        label = llm_node.get("label", "LLMNode")
        
        # Get the compiler for LLM nodes
        compiler = NODE_COMPILERS.get("LLMNode")
        if compiler:
            llm_code = compiler(
                node_id=node_id,
                safe_id=safe_id,
                config=config,
                label=label
            )
            generated["llm_nodes"].extend(llm_code)
        
        # If this LLM node has tools, generate tool node and should_continue
        selected_tools = config.get("selected_tools", []) or []
        if selected_tools:
            # Generate tool node
            tool_compiler = NODE_COMPILERS.get("ToolNode")
            if tool_compiler:
                tool_code = tool_compiler(
                    node_id=node_id,
                    safe_id=safe_id,
                    config=config,
                    label=f"Tool Node for {label}",
                    llm_node_id=node_id
                )
                generated["tool_nodes"].extend(tool_code)
            
            # Generate should_continue function
            should_continue_code = generate_should_continue(node_id)
            generated["should_continue"].append(should_continue_code)
    
    # Generate router nodes
    for router_node in sorted_data["router_nodes"]:
        node_id = str(router_node["id"])
        safe_id = sanitize_identifier(node_id)
        config = router_node.get("config", {})
        label = router_node.get("label", "RouterBlock")
        
        # Get outgoing nodes for this router
        outgoing_nodes = get_router_outgoing_nodes(node_id, sorted_data, node_registry)
        
        compiler = NODE_COMPILERS.get("RouterBlock")
        if compiler:
            router_code = compiler(
                node_id=node_id,
                safe_id=safe_id,
                config=config,
                label=label,
                outgoing_nodes=outgoing_nodes
            )
            generated["router_nodes"].extend(router_code)
    
    # Generate worker nodes
    for worker_node in sorted_data["worker_nodes"]:
        node_id = str(worker_node["id"])
        safe_id = sanitize_identifier(node_id)
        config = worker_node.get("config", {})
        label = worker_node.get("label", "WorkerNode")
        
        compiler = NODE_COMPILERS.get("WorkerNode")
        if compiler:
            worker_code = compiler(
                node_id=node_id,
                safe_id=safe_id,
                config=config,
                label=label
            )
            generated["worker_nodes"].extend(worker_code)
        
        # If this worker node has tools, generate tool node and should_continue
        selected_tools = config.get("selected_tools", []) or []
        if selected_tools:
            # Generate tool node for worker
            tool_compiler = NODE_COMPILERS.get("ToolNode")
            if tool_compiler:
                tool_code = tool_compiler(
                    node_id=node_id,
                    safe_id=safe_id,
                    config=config,
                    label=f"Tool Node for Worker {label}",
                    llm_node_id=node_id
                )
                generated["tool_nodes"].extend(tool_code)
            
            # Generate should_continue function for worker
            from .nodes.worker_node import generate_worker_should_continue
            should_continue_code = generate_worker_should_continue(node_id)
            generated["should_continue"].append(should_continue_code)
    
    return generated


def generate_model_instances(sorted_data: Dict[str, Any], tools_by_node: Dict[str, List[str]]) -> str:
    """Generate model initialization instances for each LLM and Worker node."""
    model_code = []
    model_code.append("# ==========================================")
    model_code.append("# MODEL INSTANCES")
    model_code.append("# ==========================================\n")
    
    for llm_node in sorted_data["llm_nodes"]:
        node_id = str(llm_node["id"])
        selected_tools = tools_by_node.get(node_id, [])
        
        instance_code = generate_model_instance(node_id, selected_tools)
        model_code.append(instance_code)
    
    # Generate router models
    for router_node in sorted_data["router_nodes"]:
        node_id = str(router_node["id"])
        from .nodes.router import generate_router_model
        instance_code = generate_router_model(node_id)
        model_code.append(instance_code)
    
    # Generate worker models
    for worker_node in sorted_data["worker_nodes"]:
        node_id = str(worker_node["id"])
        selected_tools = tools_by_node.get(node_id, [])
        
        from .nodes.worker_node import generate_worker_model
        instance_code = generate_worker_model(node_id, selected_tools)
        model_code.append(instance_code)
    
    return "\n".join(model_code)


def generate_tool_groups(sorted_data: Dict[str, Any], tools_by_node: Dict[str, List[str]]) -> str:
    """
    Generate tool groups for nodes that use tools.
    
    Args:
        sorted_data: Sorted ASL data
        tools_by_node: Dictionary mapping node_id -> list of tool names
        
    Returns:
        String containing all tool group definitions
    """
    if not tools_by_node:
        return "# No tool groups needed\n"
    
    groups = []
    groups.append("# ==========================================")
    groups.append("# TOOL GROUPS")
    groups.append("# ==========================================\n")
    
    for node_id, tool_names in tools_by_node.items():
        if tool_names:
            group_code = generate_tool_group(node_id, tool_names)
            groups.append(group_code)
    
    return "\n".join(groups)


def generate_model_instances(sorted_data: Dict[str, Any], tools_by_node: Dict[str, List[str]]) -> str:
    """
    Generate module-level model instances for all nodes.
    Creates models once at module load time instead of inside each node function.
    
    Args:
        sorted_data: Sorted ASL data
        tools_by_node: Dictionary mapping node_id -> list of tool names
        
    Returns:
        String containing all model instance definitions
    """
    models = []
    models.append("# ==========================================")
    models.append("# MODEL INSTANCES (initialized once)")
    models.append("# ==========================================\n")
    
    # Generate models for LLM nodes
    for node in sorted_data["llm_nodes"]:
        node_id = str(node["id"])
        config = node.get("config", {})
        selected_tools = config.get("selected_tools", []) or []
        
        if selected_tools:
            tools_str = "[" + ", ".join(selected_tools) + "]"
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
        
        if selected_tools:
            tools_str = "[" + ", ".join(selected_tools) + "]"
            models.append(f"# Model for worker node {node_id} (with tools)")
            models.append(f"model_{node_id} = init_chat_model(tools={tools_str})")
        else:
            models.append(f"# Model for worker node {node_id} (no tools)")
            models.append(f"model_{node_id} = init_chat_model()")
        models.append("")
    
    return "\n".join(models)


def generate_tool_groups(sorted_data: Dict[str, Any], tools_by_node: Dict[str, List[str]]) -> str:
    """Generate tool groups for each node that has tools."""
    tool_group_code = []
    tool_group_code.append("# ==========================================")
    tool_group_code.append("# TOOL GROUPS")
    tool_group_code.append("# ==========================================\n")
    
    for node_id, tools in tools_by_node.items():
        if tools:
            group_code = generate_tool_group(node_id, tools)
            tool_group_code.append(group_code)
            tool_group_code.append("")
    
    return "\n".join(tool_group_code)


def generate_graph_construction(node_registry: Dict[str, Dict[str, Any]], edges: Dict[str, Any]) -> str:
    """
    Generate graph construction code with all edges.
    
    Args:
        node_registry: Mapping of node IDs to function names and metadata
        edges: Organized edge data from extract_and_organize_edges()
    
    Returns:
        String containing graph construction code
    """
    from jinja2 import Template
    
    # Find the START edge (from EntryPoint)
    start_edge = None
    for node_id, node_info in node_registry.items():
        if node_info["function_name"] == "START":
            # Look for edge from this node in normal_edges
            for from_func, to_func in edges["normal_edges"]:
                if from_func == "START":
                    start_edge = to_func
                    break
            break
    
    template_path = Path(__file__).parent / "nodes" / "code_artifacts" / "graph_construction.j2"
    with open(template_path, "r") as f:
        template_str = f.read()
    
    template = Template(template_str)
    return template.render(
        node_registry=node_registry,
        edges=edges,
        start_edge=start_edge
    )


# ==========================================
# NEW HELPER FUNCTIONS FOR EDGE MAPPING
# ==========================================

def build_function_name_mapping(sorted_data: Dict[str, Any]) -> Dict[str, str]:
    """
    Build mapping of node_id -> function_name.
    
    Example:
        "2" -> "llm_2_node"
        "3" -> "router_3_node"
        "7" -> "llm_7_node"
        "1" -> "START"
    
    Returns:
        Dict[node_id, function_name]
    """
    mapping = {}
    
    # Entry point maps to START
    entry_id = sorted_data.get("entry_node")
    if entry_id:
        mapping[str(entry_id)] = "START"
    
    # LLM nodes
    for node in sorted_data["llm_nodes"]:
        node_id = str(node["id"])
        mapping[node_id] = f"llm_{node_id}_node"
    
    # Router nodes
    for node in sorted_data["router_nodes"]:
        node_id = str(node["id"])
        mapping[node_id] = f"router_{node_id}_node"
    
    # Worker nodes
    for node in sorted_data["worker_nodes"]:
        node_id = str(node["id"])
        mapping[node_id] = f"worker_{node_id}_node"
    
    return mapping


def build_edge_mapping(sorted_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build edge mappings:
    - normal_edges: {from_node_id: to_node_id} for NormalEdge
    - conditional_edges: {from_node_id: [to_node_id1, to_node_id2, ...]} for ConditionalEdge
    
    Returns:
        {
            "normal_edges": Dict[str, str],
            "conditional_edges": Dict[str, List[str]]
        }
    """
    normal_edges = {}
    conditional_edges = defaultdict(list)
    
    for edge in sorted_data["edges"]:
        from_id = str(edge.get("from"))
        to_id = str(edge.get("to"))
        edge_type = edge.get("type", "NormalEdge")
        
        if edge_type == "NormalEdge":
            normal_edges[from_id] = to_id
        elif edge_type == "ConditionalEdge":
            if to_id not in conditional_edges[from_id]:
                conditional_edges[from_id].append(to_id)
    
    return {
        "normal_edges": normal_edges,
        "conditional_edges": dict(conditional_edges)
    }


def build_function_edge_mapping(
    edge_mapping: Dict[str, Any],
    function_name_mapping: Dict[str, str]
) -> Dict[str, Any]:
    """
    Convert node_id edge mapping to function_name edge mapping.
    
    Example:
        normal_edges: {"2": "3"} -> {"llm_2_node": "router_3_node"}
        conditional_edges: {"3": ["4", "5", "6"]} -> {"router_3_node": ["llm_4_node", "llm_5_node", "llm_6_node"]}
    
    Returns:
        {
            "normal_edges": Dict[str, str],
            "conditional_edges": Dict[str, List[str]]
        }
    """
    function_edges = {
        "normal_edges": {},
        "conditional_edges": {}
    }
    
    # Convert normal edges
    for from_id, to_id in edge_mapping["normal_edges"].items():
        from_func = function_name_mapping.get(from_id)
        to_func = function_name_mapping.get(to_id, "END")
        if from_func:
            function_edges["normal_edges"][from_func] = to_func
    
    # Convert conditional edges
    for from_id, to_ids in edge_mapping["conditional_edges"].items():
        from_func = function_name_mapping.get(from_id)
        to_funcs = [function_name_mapping.get(tid, "END") for tid in to_ids]
        if from_func:
            function_edges["conditional_edges"][from_func] = to_funcs
    
    return function_edges


def determine_next_node(node_id: str, function_edge_mapping: Dict[str, Any], function_name_mapping: Dict[str, str]) -> str:
    """
    Determine the next node function name for a given node.
    
    Args:
        node_id: The current node's ID
        function_edge_mapping: Mapping of function edges
        function_name_mapping: Mapping of node_id to function_name
    
    Returns:
        Function name of next node or "END"
    """
    current_func = function_name_mapping.get(node_id)
    if not current_func:
        return "END"
    
    # Check normal edges first
    next_func = function_edge_mapping["normal_edges"].get(current_func)
    if next_func:
        return next_func
    
    # If no normal edge, return END
    return "END"


def get_outgoing_nodes_for_router(
    node_id: str,
    function_edge_mapping: Dict[str, Any],
    function_name_mapping: Dict[str, str],
    sorted_data: Dict[str, Any]
) -> Dict[str, Dict[str, str]]:
    """
    Get all outgoing nodes for a router node.
    
    Returns:
        Dict mapping function_name -> {title, type}
        Example: {
            "llm_4_node": {"title": "LLM Node", "type": "LLMNode"},
            "llm_5_node": {"title": "LLM Node", "type": "LLMNode"}
        }
    """
    current_func = function_name_mapping.get(node_id)
    if not current_func:
        return {}
    
    outgoing_funcs = function_edge_mapping["conditional_edges"].get(current_func, [])
    
    result = {}
    all_nodes = sorted_data["llm_nodes"] + sorted_data["router_nodes"] + sorted_data["worker_nodes"]
    
    for func_name in outgoing_funcs:
        # Find the node info for this function
        for node in all_nodes:
            if function_name_mapping.get(str(node["id"])) == func_name:
                result[func_name] = {
                    "title": node.get("config", {}).get("title", node.get("label", "Unknown")),
                    "type": node.get("type", "Unknown")
                }
                break
    
    return result


def generate_node_code_with_edges(
    sorted_data: Dict[str, Any],
    function_name_mapping: Dict[str, str],
    function_edge_mapping: Dict[str, Any],
    tools_by_node: Dict[str, List[str]]
) -> Dict[str, List[str]]:
    """
    Generate all node function code with edge information.
    
    Returns:
        {
            "llm_nodes": [...],
            "tool_nodes": [...],
            "router_nodes": [...],
            "worker_nodes": [...]
        }
    """
    try:
        from nodes.llm_node import compile_node as compile_llm_node
        from nodes.router import compile_node as compile_router_node
        from nodes.worker_node import compile_node as compile_worker_node
        from nodes.tool_node import compile_node as compile_tool_node
    except ImportError:
        from compiler.nodes.llm_node import compile_node as compile_llm_node
        from compiler.nodes.router import compile_node as compile_router_node
        from compiler.nodes.worker_node import compile_node as compile_worker_node
        from compiler.nodes.tool_node import compile_node as compile_tool_node
    
    result = {
        "llm_nodes": [],
        "tool_nodes": [],
        "router_nodes": [],
        "worker_nodes": []
    }
    
    # Generate LLM nodes
    for node in sorted_data["llm_nodes"]:
        node_id = str(node["id"])
        config = node.get("config", {})
        label = node.get("label", "LLMNode")
        
        next_node = determine_next_node(node_id, function_edge_mapping, function_name_mapping)
        selected_tools = config.get("selected_tools", []) or []
        has_tools = len(selected_tools) > 0
        
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
        result["llm_nodes"].extend(code)
        
        # Generate tool node if has tools
        if has_tools:
            tool_code = compile_tool_node(
                node_id=node_id,
                safe_id=node_id,
                config=config,
                label=label,
                max_tool_iterations=config.get("max_tool_iterations", 30),
                iteration_warning_message=config.get("iteration_warning_message", "")
            )
            result["tool_nodes"].extend(tool_code)
    
    # Generate Router nodes
    for node in sorted_data["router_nodes"]:
        node_id = str(node["id"])
        config = node.get("config", {})
        label = node.get("label", "RouterBlock")
        
        outgoing_nodes = get_outgoing_nodes_for_router(
            node_id,
            function_edge_mapping,
            function_name_mapping,
            sorted_data
        )
        
        code = compile_router_node(
            node_id=node_id,
            safe_id=node_id,
            config=config,
            label=label,
            outgoing_nodes=outgoing_nodes
        )
        result["router_nodes"].extend(code)
    
    # Generate Worker nodes
    for node in sorted_data["worker_nodes"]:
        node_id = str(node["id"])
        config = node.get("config", {})
        label = node.get("label", "WorkerNode")
        
        return_node = determine_next_node(node_id, function_edge_mapping, function_name_mapping)
        selected_tools = config.get("selected_tools", []) or []
        has_tools = len(selected_tools) > 0
        
        code = compile_worker_node(
            node_id=node_id,
            safe_id=node_id,
            config=config,
            label=label,
            return_node=return_node,
            has_tools=has_tools,
            max_tool_iterations=config.get("max_tool_iterations", 30),
            iteration_warning_message=config.get("iteration_warning_message", "")
        )
        result["worker_nodes"].extend(code)
        
        # Generate tool node if has tools
        if has_tools:
            tool_code = compile_tool_node(
                node_id=f"worker_{node_id}",
                safe_id=f"worker_{node_id}",
                config=config,
                label=label,
                max_tool_iterations=config.get("max_tool_iterations", 30),
                iteration_warning_message=config.get("iteration_warning_message", "")
            )
            result["tool_nodes"].extend(tool_code)
    
    return result


def generate_graph_construction_simple(
    function_name_mapping: Dict[str, str],
    function_edge_mapping: Dict[str, Any],
    tools_by_node: Dict[str, List[str]]
) -> str:
    """
    Generate simplified graph construction code.
    With Command pattern, nodes handle routing themselves.
    """
    from jinja2 import Template
    
    # Collect all node functions (except START)
    all_node_functions = []
    for node_id, func_name in function_name_mapping.items():
        if func_name != "START":
            all_node_functions.append(func_name)
    
    # Add tool nodes for nodes that have tools
    for node_id in tools_by_node:
        if tools_by_node[node_id]:
            all_node_functions.append(f"tool_{node_id}_node")
    
    # Find entry point
    entry_point = None
    start_edge = function_edge_mapping["normal_edges"].get("START")
    if start_edge:
        entry_point = start_edge
    
    template_path = Path(__file__).parent / "nodes" / "code_artifacts" / "graph_construction.j2"
    with open(template_path, "r") as f:
        template_str = f.read()
    
    template = Template(template_str)
    return template.render(
        all_node_functions=all_node_functions,
        entry_point=entry_point
    )


def assemble_final_code(sorted_data: Dict[str, Any]) -> str:
    """
    Assemble all generated code into final Python module.
    
    Structure:
    1. Imports
    2. Helper functions
    3. Model initialization
    4. State definitions
    5. Tool function definitions
    6. Tool groups
    7. LLM/Router/Worker node functions
    8. Tool node functions
    9. Graph construction
    10. Main execution
    """
    sections = []
    
    # Step 1: Build all mappings FIRST
    function_name_mapping = build_function_name_mapping(sorted_data)
    edge_mapping = build_edge_mapping(sorted_data)
    function_edge_mapping = build_function_edge_mapping(edge_mapping, function_name_mapping)
    
    # Step 2: Collect tools per node
    tools_by_node_llm = collect_tools_per_node(sorted_data["llm_nodes"])
    tools_by_node_worker = collect_tools_per_node(sorted_data["worker_nodes"])
    tools_by_node = {**tools_by_node_llm, **tools_by_node_worker}
    
    # Step 3: Generate code sections
    sections.append(generate_imports())
    sections.append("")
    sections.append(generate_helpers())
    sections.append("")
    sections.append(generate_model_init())
    sections.append("")
    sections.append(generate_states(sorted_data))
    sections.append("")
    sections.append(generate_tool_functions(sorted_data["tools"]))
    sections.append("")
    sections.append(generate_tool_groups(sorted_data, tools_by_node))
    sections.append("")
    sections.append(generate_model_instances(sorted_data, tools_by_node))
    sections.append("")
    
    # Step 4: Generate node functions (passing edge information)
    node_code = generate_node_code_with_edges(
        sorted_data,
        function_name_mapping,
        function_edge_mapping,
        tools_by_node
    )
    
    sections.append("# ==========================================")
    sections.append("# LLM NODE FUNCTIONS")
    sections.append("# ==========================================\n")
    sections.append("\n\n".join(node_code["llm_nodes"]))
    sections.append("")
    
    if node_code["tool_nodes"]:
        sections.append("# ==========================================")
        sections.append("# TOOL NODE FUNCTIONS")
        sections.append("# ==========================================\n")
        sections.append("\n\n".join(node_code["tool_nodes"]))
        sections.append("")
    
    if node_code["router_nodes"]:
        sections.append("# ==========================================")
        sections.append("# ROUTER NODE FUNCTIONS")
        sections.append("# ==========================================\n")
        sections.append("\n\n".join(node_code["router_nodes"]))
        sections.append("")
    
    if node_code["worker_nodes"]:
        sections.append("# ==========================================")
        sections.append("# WORKER NODE FUNCTIONS")
        sections.append("# ==========================================\n")
        sections.append("\n\n".join(node_code["worker_nodes"]))
        sections.append("")
    
    # Step 5: Graph construction
    sections.append("# ==========================================")
    sections.append("# GRAPH CONSTRUCTION")
    sections.append("# ==========================================\n")
    sections.append(generate_graph_construction_simple(function_name_mapping, function_edge_mapping, tools_by_node))
    sections.append("")
    
    # Step 6: Main execution
    sections.append("# ==========================================")
    sections.append("# MAIN EXECUTION")
    sections.append("# ==========================================")
    sections.append("")
    sections.append("if __name__ == \"__main__\":")
    sections.append("    print(\"Compiled ASL code - ready to execute\")")
    sections.append("")
    
    return "\n".join(sections)


# ==========================================
# MAIN COMPILER FUNCTION
# ==========================================

def compile_asl(input_path: Path, output_path: Path, validate_only: bool = False) -> bool:
    """
    Main compiler function.
    
    Args:
        input_path: Path to ASL JSON file
        output_path: Path to output Python file
        validate_only: If True, only validate without generating code
        
    Returns:
        True if successful, False otherwise
    """
    # Read input file
    try:
        with open(input_path, "r") as f:
            asl_content = f.read()
    except Exception as e:
        print(f"Error reading input file: {e}")
        return False
    
    # Validate JSON
    if not check_valid_json(asl_content):
        print(f"Error: The input file {input_path} is not a valid JSON file.")
        return False
    
    # Parse JSON
    asl_dict = json.loads(asl_content)
    
    # Validate ASL structure
    if not validate_asl_structure(asl_dict):
        return False
    
    print(f"✓ JSON validation passed")
    
    if validate_only:
        print(f"✓ ASL structure validation passed")
        return True
    
    # Sort and extract data
    sorted_data = data_sorter(asl_dict)
    print(f"✓ Extracted {len(sorted_data['llm_nodes'])} LLM nodes")
    print(f"✓ Extracted {len(sorted_data['router_nodes'])} router nodes")
    print(f"✓ Extracted {len(sorted_data['worker_nodes'])} worker nodes")
    print(f"✓ Extracted {len(sorted_data['tools'])} tools")
    
    # Generate code
    try:
        final_code = assemble_final_code(sorted_data)
    except Exception as e:
        print(f"Error generating code: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    # Write output
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            f.write(final_code)
        print(f"✓ Successfully compiled to {output_path}")
        return True
    except Exception as e:
        print(f"Error writing output file: {e}")
        return False


def main():
    """Main entry point."""
    args = parse_arguments()
    input_path = Path(args.input_file)
    output_path = Path(args.output_file)
    
    if not input_path.exists():
        print(f"Error: Input file {input_path} does not exist")
        sys.exit(1)
    
    success = compile_asl(input_path, output_path, args.validate_only)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()



    


    



    

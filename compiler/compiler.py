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
from pathlib import Path
from typing import Any, Dict, List
from jinja2 import Template

# Import utilities and graph builder
try:
    from utils import sanitize_identifier
    from graph_builder import build_and_generate_graph
except ImportError:
    from compiler.utils import sanitize_identifier
    from compiler.graph_builder import build_and_generate_graph


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


# ==========================================
# CODE GENERATION HELPERS
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


def assemble_final_code(sorted_data: Dict[str, Any]) -> str:
    """
    Assemble all generated code into final Python module.
    
    Structure:
    1. Imports
    2. Helper functions
    3. Model initialization
    4. State definitions (from graph_builder)
    5. Pydantic schemas (from graph_builder)
    6. Tool function definitions
    7. Worker tools (from graph_builder)
    8. Model instances (from graph_builder)
    9. LLM/Router node functions (from graph_builder)
    10. Graph construction (from graph_builder)
    11. Main execution
    """
    sections = []
    
    # Step 1: Imports
    sections.append(generate_imports())
    sections.append("")
    
    # Step 2: Helpers
    sections.append(generate_helpers())
    sections.append("")
    
    # Step 3: Model init
    sections.append(generate_model_init())
    sections.append("")
    
    # Step 4: Tool function definitions (custom tools from ASL)
    sections.append(generate_tool_functions(sorted_data["tools"]))
    sections.append("")
    
    # Step 5: Everything else from graph_builder
    # This includes: state, pydantic schemas, worker tools, models, nodes, graph
    graph_code = build_and_generate_graph(sorted_data)
    sections.append(graph_code)
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



    


    



    

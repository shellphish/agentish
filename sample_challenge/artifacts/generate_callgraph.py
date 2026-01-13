#!/usr/bin/env python3
"""
Generate call graph from binary using objdump and nm
"""
import sys
import subprocess
import json
import re

def get_functions(binary):
    """Extract function names from the binary"""
    try:
        result = subprocess.run(['nm', '-C', binary], capture_output=True, text=True)
        functions = []
        for line in result.stdout.split('\n'):
            if ' T ' in line:  # Text (code) section
                parts = line.split()
                if len(parts) >= 3:
                    func_name = ' '.join(parts[2:])
                    functions.append(func_name)
        return functions
    except Exception as e:
        print(f"Error getting functions: {e}", file=sys.stderr)
        return []


def get_disassembly(binary):
    """Get disassembly of the binary"""
    try:
        result = subprocess.run(['objdump', '-d', '-C', binary], capture_output=True, text=True)
    except Exception as e:
        print(f"Error getting disassembly: {e}", file=sys.stderr)
        return ""
    disassembly_by_function = {}
    # We want to split disassembly by function
    current_function = None
    disasm_lines = []
    for line in result.stdout.split('\n'):
        func_match = re.match(r'^[0-9a-f]+ <(.+?)>:', line)
        if func_match:
            if current_function:
                disassembly_by_function[current_function] = '\n'.join(disasm_lines)
            current_function = func_match.group(1)
            disasm_lines = [line]
        else:
            if current_function:
                disasm_lines.append(line)
    if current_function:
        disassembly_by_function[current_function] = '\n'.join(disasm_lines)
    return disassembly_by_function, result.stdout



def parse_calls(disasm):
    """Parse function calls from disassembly"""
    call_graph = {}
    all_functions = set()
    current_function = None
    # We want caller -> callee mapping, and xrefs which is callee -> caller mapping

    
    for line in disasm.split('\n'):
        # Detect function start
        func_match = re.match(r'^[0-9a-f]+ <(.+?)>:', line)
        if func_match:
            current_function = func_match.group(1)
            all_functions.add(current_function)
            if current_function not in call_graph:
                call_graph[current_function] = []
        
        # Detect call instructions
        if current_function and 'call' in line:
            call_match = re.search(r'call.+?<(.+?)>', line)
            if call_match:
                called_func = call_match.group(1)
                if called_func not in call_graph[current_function]:
                    call_graph[current_function].append(called_func)
                all_functions.add(called_func)
    
    caller_callee_mapping = {}
    callee_caller_mapping = {func: [] for func in all_functions}
    for caller, callees in call_graph.items():
        caller_callee_mapping[caller] = callees
        for callee in callees:
            if callee not in callee_caller_mapping:
                callee_caller_mapping[callee] = []
            if caller not in callee_caller_mapping[callee]:
                callee_caller_mapping[callee].append(caller)
    for func in all_functions:
        caller_callee_mapping.setdefault(func, [])
    return caller_callee_mapping, callee_caller_mapping


def main():
    if len(sys.argv) != 2:
        print("Usage: generate_callgraph.py <binary>", file=sys.stderr)
        sys.exit(1)
    
    binary = sys.argv[1]
    
    # Get functions
    #functions = get_functions(binary)
    
    # Get disassembly
    disassembly_by_function, raw_dump = get_disassembly(binary)
    functions = list(disassembly_by_function.keys())
    
    # Parse calls
    caller_callee_mapping, callee_caller_mapping = parse_calls(raw_dump)
    # import IPython; IPython.embed(); assert False
    # Create structured output
    output = {
        "binary": binary,
        "functions": functions,
        "callee_caller_mapping": callee_caller_mapping,
        "caller_callee_mapping": caller_callee_mapping,
        "disassembly_by_function": disassembly_by_function,
        # "important_functions": [
        #     "validate_password",
        #     "validate_stage1", 
        #     "validate_stage2",
        #     "validate_stage3",
        #     "main"
        # ]
    }
    
    json_file = binary + "_metadata.json"
    with open(json_file, 'w') as f:
        json.dump(output, f, indent=4)

if __name__ == "__main__":
    main()

"""Shared utilities for the ASL compiler."""

import json
import textwrap
from typing import Dict, List


def py_str(value: str) -> str:
    """Return a safe Python string literal."""
    return json.dumps(value, ensure_ascii=False)


def indent(code: str, depth: int = 1) -> str:
    """Indent code by a given number of levels."""
    return textwrap.indent(code, "    " * depth)


def sanitize_identifier(raw: str) -> str:
    """Clean a raw string to be a valid Python identifier."""
    cleaned = "".join(ch if ch.isalnum() else "_" for ch in str(raw))
    if not cleaned:
        cleaned = "node"
    if cleaned[0].isdigit():
        cleaned = f"n_{cleaned}"
    return cleaned


def sanitize_label(label: str) -> str:
    """Convert label to valid Python identifier: lowercase, spaces to underscores.
    
    Examples:
        "Orchestrator" → "orchestrator"
        "Phone Node" → "phone_node"
        "Worker-Node" → "worker_node"
        "RouterBlock" → "routerblock"
    """
    # Lowercase and replace non-alphanumeric with underscore
    result = label.lower()
    result = ''.join(c if c.isalnum() else '_' for c in result)
    # Remove leading/trailing underscores and collapse multiple
    result = '_'.join(filter(None, result.split('_')))
    return result if result else "node"


def generate_pydantic_model_from_schema(
    class_name: str, 
    schema_array: List[Dict[str, str]],
    docstring: str = ""
) -> str:
    """Generate Pydantic BaseModel class from schema array.
    
    Args:
        class_name: Name for the class (e.g., "OutputSchema_3")
        schema_array: List of {"name": "...", "type": "...", "description": "..."}
        docstring: Optional class docstring
    
    Returns:
        String containing complete class definition
    
    Example:
        schema = [
            {"name": "flag", "type": "str", "description": "final flag"},
            {"name": "count", "type": "int", "description": "count value"}
        ]
        
        Returns:
        class OutputSchema_3(BaseModel):
            flag: str = Field(description="final flag")
            count: int = Field(description="count value")
    """
    lines = [f"class {class_name}(BaseModel):"]
    
    if docstring:
        lines.append(f'    """{docstring}"""')
    
    if not schema_array:
        lines.append('    pass')
    else:
        for field in schema_array:
            name = field["name"]
            type_str = field["type"]
            desc = field.get("description", "")
            lines.append(f'    {name}: {type_str} = Field(description={json.dumps(desc)})')
    
    return "\n".join(lines)


def ensure_unique_identifier(base: str, used: set[str]) -> str:
    """Generate a unique identifier by appending a counter if needed."""
    candidate = base
    counter = 1
    while candidate in used:
        candidate = f"{base}_{counter}"
        counter += 1
    used.add(candidate)
    return candidate

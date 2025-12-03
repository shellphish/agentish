"""Shared utilities for the ASL compiler."""

import json
import textwrap


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


def ensure_unique_identifier(base: str, used: set[str]) -> str:
    """Generate a unique identifier by appending a counter if needed."""
    candidate = base
    counter = 1
    while candidate in used:
        candidate = f"{base}_{counter}"
        counter += 1
    used.add(candidate)
    return candidate

"""Utility functions."""

import json
from typing import TypeVar
from uuid import uuid4

T = TypeVar("T")


def generate_uuid() -> str:
    """Generate a new UUID string."""
    return str(uuid4())


def safe_json_parse(text: str, fallback: T) -> T:
    """Safely parse JSON string, returning fallback on error."""
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return fallback

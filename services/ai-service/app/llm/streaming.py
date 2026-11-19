"""
app/llm/streaming.py
====================
Server-Sent Events (SSE) formatting and stream processing helpers.
Produces standardized SSE events:
  - event: token      data: {"delta": "..."}
  - event: citations  data: [{"index": 1, ...}]
  - event: usage      data: {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
  - event: error      data: {"code": "...", "message": "..."}
  - event: done       data: {}
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional
from pydantic import BaseModel, Field


class StreamUsage(BaseModel):
    """Token usage metrics."""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


def format_sse(event: str, data: Any) -> str:
    """
    Format a standard SSE event message according to W3C specification:
    event: <event_name>\n
    data: <json_string>\n\n
    """
    if isinstance(data, (dict, list)):
        payload = json.dumps(data, ensure_ascii=False)
    elif isinstance(data, str):
        payload = data
    else:
        payload = json.dumps(data, ensure_ascii=False)

    return f"event: {event}\ndata: {payload}\n\n"


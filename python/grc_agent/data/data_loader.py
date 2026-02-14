from __future__ import annotations

import json
from typing import Any

import anyio


async def load_json(path: str) -> Any:
    """Read and parse a JSON file."""
    raw = await anyio.Path(path).read_text(encoding="utf-8")
    return json.loads(raw)

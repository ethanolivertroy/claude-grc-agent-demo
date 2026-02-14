from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .data_loader import load_json

# Resolve data directory relative to this file's location in the repo structure
# python/grc_agent/data/framework_data.py -> .../python/grc_agent/data -> ... -> repo_root
_data_dir = os.path.join(Path(__file__).parents[3], "data")


async def load_framework_data(file_name: str) -> dict[str, Any]:
    """Load a framework JSON file from the data/ directory."""
    return await load_json(os.path.join(_data_dir, file_name))

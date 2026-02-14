from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from ..data.data_loader import load_json

_mappings_path = os.path.join(Path(__file__).parents[3], "data", "framework-mappings.json")


async def load_framework_mappings() -> dict[str, Any]:
    """Load the cross-framework control mappings file."""
    return await load_json(_mappings_path)

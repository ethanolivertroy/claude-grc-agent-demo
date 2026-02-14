from __future__ import annotations

import glob as glob_mod
import re
from pathlib import Path

import anyio


# Thin wrapper over anyio's file I/O — used by _load_evidence for consistent error handling
async def read_file(path: str, encoding: str = "utf-8") -> str:
    """Read a file and return its contents as a string."""
    return await anyio.Path(path).read_text(encoding=encoding)


# Expand glob patterns to absolute file paths
async def glob_files(patterns: list[str], root: str | None = None) -> list[str]:
    """Expand glob patterns and return matching file paths."""
    base = root or str(Path.cwd())
    results: list[str] = []
    for pattern in patterns:
        matches = glob_mod.glob(pattern, root_dir=base, recursive=True)
        for match in matches:
            full = str(Path(base) / match)
            if full not in results:
                results.append(full)
    return results


# Case-insensitive line filter — used for quick keyword searches in evidence files
def grep_lines(content: str, query: str) -> list[str]:
    """Return lines containing *query* (case-insensitive)."""
    lower_query = query.lower()
    return [line for line in content.splitlines() if lower_query in line.lower()]

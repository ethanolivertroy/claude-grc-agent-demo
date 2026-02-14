import { readFile as readFileRaw } from "node:fs/promises";
import fg from "fast-glob";

type ReadFileOptions = {
  encoding?: BufferEncoding;
};

type GlobOptions = {
  cwd?: string;
  onlyFiles?: boolean;
  absolute?: boolean;
};

// Thin wrapper over Node's fs — used by loadEvidence for consistent error handling
export async function readFile(path: string, options: ReadFileOptions = {}): Promise<string> {
  const encoding = options.encoding ?? "utf8";
  return readFileRaw(path, encoding);
}

// Expand glob patterns to absolute file paths via fast-glob
export async function glob(patterns: string[], options: GlobOptions = {}): Promise<string[]> {
  return fg(patterns, {
    cwd: options.cwd,
    onlyFiles: options.onlyFiles ?? true,
    absolute: options.absolute ?? true,
  });
}

// Case-insensitive line filter — used for quick keyword searches in evidence files
export function grepLines(content: string, query: string): string[] {
  const lines = content.split(/\r?\n/);
  return lines.filter((line) => line.toLowerCase().includes(query.toLowerCase()));
}

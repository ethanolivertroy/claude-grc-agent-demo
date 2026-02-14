import path from "node:path";
import { loadJson } from "../data/data-loader.js";

type FrameworkMapping = {
  source: string;
  target: string;
  mappings: Array<{
    source_control_id: string;
    target_control_id: string;
  }>;
};

type FrameworkMappingsFile = {
  mappings: FrameworkMapping[];
};

const mappingsPath = path.resolve(process.cwd(), "data", "framework-mappings.json");

export async function loadFrameworkMappings(): Promise<FrameworkMappingsFile> {
  return loadJson<FrameworkMappingsFile>(mappingsPath);
}

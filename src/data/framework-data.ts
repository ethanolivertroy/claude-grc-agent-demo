import path from "node:path";
import { loadJson } from "./data-loader.js";

type FrameworkData = {
  framework: string;
  version?: string;
  revision?: string;
  controls?: unknown[];
  functions?: unknown[];
  levels?: unknown[];
  risk_tiers?: unknown[];
};

const dataDir = path.resolve(process.cwd(), "data");

export async function loadFrameworkData(fileName: string): Promise<FrameworkData> {
  return loadJson<FrameworkData>(path.join(dataDir, fileName));
}

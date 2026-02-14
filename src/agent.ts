#!/usr/bin/env node
import { runGrcAgent } from "./grc-agent.js";

type CliOptions = {
  framework?: string;
  baseline?: string;
  scope?: string;
  interactive?: boolean;
  inputs: string[];
};

type ConvertOptions = {
  to?: string;
  output?: string;
  inputPath?: string;
};

// Manual argument parsing — simple flag-value loop, no external dependency.
function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { inputs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "--framework") {
      options.framework = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--baseline") {
      options.baseline = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--scope") {
      options.scope = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--interactive" || arg === "-i") {
      options.interactive = true;
      continue;
    }
    options.inputs.push(arg);
  }
  return options;
}

function parseConvertArgs(argv: string[]): ConvertOptions {
  const options: ConvertOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "--to") {
      options.to = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--output") {
      options.output = argv[i + 1];
      i += 1;
      continue;
    }
    // First non-flag argument is the input path
    if (!arg.startsWith("--") && !options.inputPath) {
      options.inputPath = arg;
    }
  }
  return options;
}

function usage(): string {
  return [
    "Usage:",
    "  grc-agent --framework 'NIST 800-53' --baseline 'FedRAMP Moderate' --scope 'demo' <paths...>",
    "  grc-agent convert --to oscal-ssp [--output out.json] <input-path>",
    "  grc-agent convert --to oscal-mapping [--output out.json] <input-path>",
    "",
    "Commands:",
    "  convert         Convert an SSP document to OSCAL format",
    "",
    "Options:",
    "  --framework     Framework name (e.g. 'NIST 800-53')",
    "  --baseline      Baseline or level (e.g. 'FedRAMP Moderate')",
    "  --scope         Assessment scope description",
    "  -i, --interactive  Run assessment then enter interactive follow-up mode",
    "",
    "Convert options:",
    "  --to            Target format (oscal-ssp or oscal-mapping)",
    "  --output        Output file path (default: <input-stem>-oscal.json)",
  ].join("\n");
}

async function runConvert(argv: string[]): Promise<void> {
  const opts = parseConvertArgs(argv);
  const validTargets = ["oscal-ssp", "oscal-mapping"];
  if (!opts.to || !validTargets.includes(opts.to)) {
    console.error(`Error: --to must be one of: ${validTargets.join(", ")}\n`);
    console.error(usage());
    process.exit(1);
  }
  if (!opts.inputPath) {
    console.error("Error: input file path is required.\n");
    console.error(usage());
    process.exit(1);
  }

  if (opts.to === "oscal-mapping") {
    const { convertToOscalMapping, defaultMappingOutputPath, writeOscalMapping } = await import(
      "./mapping-convert.js"
    );
    const outputPath = opts.output ?? defaultMappingOutputPath(opts.inputPath);
    console.log(`Converting ${opts.inputPath} to OSCAL mapping-collection format...`);
    const oscalMapping = await convertToOscalMapping(opts.inputPath);
    await writeOscalMapping(oscalMapping, outputPath);
    console.log(`OSCAL mapping-collection written to ${outputPath}`);
    return;
  }

  // Dynamic import keeps OSCAL conversion module out of assessment runs
  const { convertToOscalSsp, defaultOutputPath, writeOscalSsp } = await import(
    "./oscal-convert.js"
  );

  const outputPath = opts.output ?? defaultOutputPath(opts.inputPath);
  console.log(`Converting ${opts.inputPath} to OSCAL SSP format...`);

  const oscalSsp = await convertToOscalSsp(opts.inputPath);
  await writeOscalSsp(oscalSsp, outputPath);

  console.log(`OSCAL SSP written to ${outputPath}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // Route to convert subcommand if first argument is "convert"
  if (argv[0] === "convert") {
    await runConvert(argv.slice(1));
    return;
  }

  const options = parseArgs(argv);
  // All three flags are required: framework, baseline, and scope determine the assessment.
  if (!options.framework || !options.baseline || !options.scope) {
    console.error(usage());
    process.exit(1);
  }

  const input = {
    framework: options.framework,
    baselineOrLevel: options.baseline,
    scope: options.scope,
    inputPaths: options.inputs,
  };

  if (options.interactive) {
    // Dynamic import keeps the readline dependency out of single-shot runs.
    const { runInteractiveSession } = await import("./repl.js");
    await runInteractiveSession(input);
  } else {
    const result = await runGrcAgent(input);
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((error) => {
  console.error("Agent failed:", error);
  process.exit(1);
});

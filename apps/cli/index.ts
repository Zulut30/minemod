#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  MAX_INLINE_SPEC_BYTES,
  VALIDATION_PROFILE_IDS,
  validateInlineSpec,
} from "@mcdev/validation";

const VERSION = "0.0.0-phase.0";
const HELP = `mcdev ${VERSION}

Usage:
  mcdev help
  mcdev version
  mcdev spec validate <inline-json>
  mcdev spec validate --profile ${VALIDATION_PROFILE_IDS[0]} <inline-json>

Validation is local-only and loader-neutral unless a compatibility profile is named.
Inline JSON is limited to ${MAX_INLINE_SPEC_BYTES} UTF-8 bytes.
`;

export async function runCli(
  args: readonly string[],
  writeOut: (text: string) => void = (text) => process.stdout.write(text),
  writeError: (text: string) => void = (text) => process.stderr.write(text),
): Promise<number> {
  if (args.length === 0 || (args.length === 1 && ["help", "--help", "-h"].includes(args[0] ?? ""))) {
    writeOut(HELP);
    return 0;
  }
  if (args.length === 1 && ["version", "--version", "-v"].includes(args[0] ?? "")) {
    writeOut(`${VERSION}\n`);
    return 0;
  }
  if (args.length === 3 && args[0] === "spec" && args[1] === "validate") {
    const result = validateInlineSpec(args[2] ?? "", "auto");
    writeOut(`${JSON.stringify(result, null, 2)}\n`);
    return result.valid ? 0 : 1;
  }
  if (
    args.length === 5 &&
    args[0] === "spec" &&
    args[1] === "validate" &&
    args[2] === "--profile" &&
    args[3] === VALIDATION_PROFILE_IDS[0]
  ) {
    const result = validateInlineSpec(args[4] ?? "", "auto", { profile: VALIDATION_PROFILE_IDS[0] });
    writeOut(`${JSON.stringify(result, null, 2)}\n`);
    return result.valid ? 0 : 1;
  }
  writeError("Unsupported command. Run `mcdev help`.\n");
  return 2;
}

async function main(): Promise<number> {
  return runCli(process.argv.slice(2));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`mcdev failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
      process.exitCode = 1;
    });
}

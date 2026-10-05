import process from "node:process";
await import("./camera.test.ts");
await import("../worker/mcp.test.ts");
await import("../worker/continuation.test.ts");
await import("../worker/discovery.test.ts");
await import("../worker/concept-files.test.ts");
await import("../worker/concepts-mcp.test.ts");
if (process.platform !== "win32") {
  process.stdout.write(
    "SKIP Windows desktop E2E: this prototype targets Windows x64. Core tests and desktop typecheck/build run independently.\n",
  );
} else {
  // Fresh checkout тоже проходит desktop тест; у root build другой контракт.
  await import("./build.mjs");
  await import("./test-desktop.mjs");
}

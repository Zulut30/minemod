import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { randomUUID } from "node:crypto";
import process from "node:process";
import console from "node:console";
import { packagedPath } from "./packaged-path.mjs";
import { checkTexelDensityDesktop } from "./check-texel-density-desktop.mjs";
const repo = fileURLToPath(new URL("../../../", import.meta.url)), appDir = join(repo, "apps/model-editor");
const output = join(repo, "output/playwright/texel-density-051-" + randomUUID().slice(0, 8)); await mkdir(output, { recursive: true });
const report = await checkTexelDensityDesktop({ executablePath: await packagedPath(repo, appDir), args: ["--editor-hidden"],
  env: Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== "ELECTRON_RUN_AS_NODE" && typeof value === "string")), timeout: 45_000 }, output);
console.log(JSON.stringify({ status: report.status, output }));

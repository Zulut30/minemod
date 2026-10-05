import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { randomUUID } from "node:crypto";
import process from "node:process";
import console from "node:console";
import { checkAgentBlockoutsDesktop } from "./check-agent-blockouts-desktop.mjs";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const build = JSON.parse(await readFile(join(repo,"output/model-editor/latest-build.json"),"utf8"));
const pkg = JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8"));
assert.equal(build.version,pkg.version,"Сначала упакуйте текущую версию Studio");
const output = resolve(repo,"output/playwright/agent-blockouts-036-"+randomUUID().slice(0,8));
await mkdir(output);
const report = await checkAgentBlockoutsDesktop({
  executablePath:build.executable,args:["--editor-hidden"],
  env:Object.fromEntries(Object.entries(process.env).filter(([key,value])=>key!=="ELECTRON_RUN_AS_NODE"&&typeof value==="string")),
  timeout:45000,
},output);
console.log(JSON.stringify({status:report.status,output,studioVersion:build.version,variants:report.variants.length,captures:report.captures.length}));

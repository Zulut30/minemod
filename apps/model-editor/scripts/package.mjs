import { packager } from "@electron/packager";
import { mkdir, cp, writeFile, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import console from "node:console";
import { randomUUID } from "node:crypto";
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  repo = resolve(appDir, "../..");
const staging = join(repo, "output/model-editor/staging");
if (!resolve(staging).startsWith(resolve(repo, "output/model-editor") + sep))
  throw new Error("Staging escaped the workspace output root");
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await cp(join(appDir, "dist"), join(staging, "dist"), { recursive: true });
const pkg = JSON.parse(await readFile(join(appDir, "package.json"), "utf8"));
const releaseRoot = join(
  repo,
  "output/model-editor/releases",
  pkg.version,
  randomUUID().slice(0, 8),
);
await writeFile(
  join(staging, "package.json"),
  JSON.stringify(
    {
      name: "minemod-studio",
      productName: pkg.productName,
      version: pkg.version,
      main: "dist/main.cjs",
      license: pkg.license,
    },
    null,
    2,
  ),
);
const paths = await packager({
  dir: staging,
  out: releaseRoot,
  name: "MineMod Studio",
  electronVersion: "44.5.1",
  platform: "win32",
  arch: "x64",
  asar: true,
  overwrite: false,
  prune: false,
  executableName: "MineMod Studio",
  appCopyright: "MineMod contributors",
  win32metadata: {
    CompanyName: "MineMod",
    FileDescription: "Local Minecraft model workshop",
    ProductName: "MineMod Studio",
  },
});
await writeFile(
  join(repo, "output/model-editor/latest-build.json"),
  JSON.stringify(
    {
      version: pkg.version,
      directory: paths[0],
      executable: join(paths[0], "MineMod Studio.exe"),
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ packaged: paths }, null, 2));

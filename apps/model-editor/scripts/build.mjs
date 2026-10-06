import { build as bundle } from "esbuild";
import { build as buildRenderer } from "vite";
import react from "@vitejs/plugin-react";
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  readdir,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve, basename, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import process from "node:process";
import console from "node:console";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(appDir, "../.."),
  dist = join(appDir, "dist");
const pkg = JSON.parse(await readFile(join(appDir, "package.json"), "utf8"));
if (!resolve(dist).startsWith(appDir + sep))
  throw new Error("Build directory escaped the application root");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
const modules = new Set();
for (const entry of ["main", "preload", "worker"]) {
  const result = await bundle({
    entryPoints: [join(appDir, entry, "index.ts")],
    outfile: join(dist, `${entry}.cjs`),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    external: ["electron"],
    define: {
      "process.env.MINEMOD_STUDIO_VERSION": JSON.stringify(pkg.version),
    },
    metafile: true,
    legalComments: "eof",
    sourcemap: false,
  });
  for (const file of Object.keys(result.metafile.inputs))
    modules.add(resolve(file));
}
await buildRenderer({
  define: {
    "import.meta.env.VITE_STUDIO_VERSION": JSON.stringify(pkg.version),
  },
  root: join(appDir, "renderer"),
  base: "./",
  configFile: false,
  plugins: [
    react(),
    {
      name: "license-module-inventory",
      generateBundle() {
        for (const id of this.getModuleIds())
          if (!id.startsWith("\0")) modules.add(id.split("?")[0]);
      },
    },
  ],
  build: {
    outDir: join(dist, "renderer"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
await copyFile(
  join(repo, "fixtures/assets/aurora-longsword-v2.item-asset.json"),
  join(dist, "example.json"),
);
const licenses = join(dist, "licenses");
await copyFile(join(repo, "docs/quality/art-quality-rubric-v0.md"), join(dist, "art-quality-rubric.md"));
await mkdir(licenses, { recursive: true });
await copyFile(join(repo, "LICENSE"), join(licenses, "MineMod-Apache-2.0.txt"));
const entries = new Map();
for (const module of modules) {
  if (!module.includes("node_modules")) continue;
  let directory = dirname(module),
    pkg;
  while (directory !== dirname(directory)) {
    try {
      pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (pkg.name && pkg.version) break;
    } catch {
      /* Виртуальные модули не имеют manifest. */
    }
    directory = dirname(directory);
  }
  if (!pkg?.name || entries.has(pkg.name)) continue;
  const licenseFiles = (await readdir(directory)).filter((file) =>
    /^(license|copying|notice)(\.|$)/iu.test(file),
  );
  let upstream;
  if (
    !licenseFiles.length &&
    pkg.name === "@react-three/fiber" &&
    pkg.version === "9.8.1"
  ) {
    // npm-архив не содержит LICENSE; используется зафиксированный файл из соответствующего upstream tag.
    upstream = join(appDir, "third-party/react-three-fiber-9.8.1.LICENSE");
    licenseFiles.push("react-three-fiber-9.8.1.LICENSE");
  }
  if (!pkg.license || !licenseFiles.length)
    throw new Error(`Missing license evidence for bundled ${pkg.name}`);
  const evidence = [];
  for (const file of licenseFiles) {
    const content = await readFile(upstream ?? join(directory, file));
    if (
      upstream &&
      createHash("sha256").update(content).digest("hex") !==
        "9c35b5de7b7493a707fffe4eb23bd2f7f449153c1911f7c6eefb4e591fd5349a"
    )
      throw new Error("Pinned R3F license evidence changed");
    const target = `${pkg.name.replaceAll(/[@/]/gu, "_")}-${pkg.version}-${basename(file)}`;
    await writeFile(join(licenses, target), content);
    evidence.push({
      path: `licenses/${target}`,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
  entries.set(pkg.name, {
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    source: pkg.repository?.url ?? pkg.repository ?? pkg.homepage,
    role: "bundled-runtime",
    evidence,
  });
}
await writeFile(
  join(dist, "dependency-inventory.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      entries: [...entries.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      electron: {
        version: "44.5.1",
        license: "MIT and bundled Chromium/Node third-party notices",
        source: "https://github.com/electron/electron/releases/tag/v44.5.1",
        noticeFiles: ["LICENSE", "LICENSES.chromium.html"],
      },
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Studio build ready: ${dist}; ${entries.size} bundled dependency licenses`,
);
process.exitCode = 0;

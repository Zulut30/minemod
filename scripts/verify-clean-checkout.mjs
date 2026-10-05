import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const digest = (bytes, algorithm = "sha256") =>
  createHash(algorithm).update(bytes).digest("hex");

// Проверка выполняется до install/build и не исправляет checkout автоматически.
export async function verifyCleanCheckout(directory) {
  const root = await realpath(directory);
  const git = (...args) => execFileSync("git", args, {
    cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(await realpath(git("rev-parse", "--show-toplevel").trim()), root,
    "CHECKOUT_ROOT_REQUIRED");
  const objectFormat = git("rev-parse", "--show-object-format").trim();
  assert(["sha1", "sha256"].includes(objectFormat), "UNKNOWN_GIT_OBJECT_FORMAT");
  const entries = git("ls-tree", "-rz", "HEAD").split("\0").filter(Boolean).map(entry => {
    const match = /^(\d{6}) blob ([a-f0-9]+)\t(.+)$/.exec(entry);
    assert(match, "ONLY_REGULAR_TRACKED_FILES_SUPPORTED");
    return { mode: match[1], oid: match[2], path: match[3] };
  });
  const generated = new Set(["output", "node_modules", "dist", "build", ".gradle"]);
  for (const entry of entries) {
    assert(!entry.path.startsWith("output/"), "TRACKED_OUTPUT_FORBIDDEN");
    if (/^(apps|packages)\/[^/]+\/package\.json$/.test(entry.path)) {
      for (const name of ["node_modules", "dist", "build"]) {
        generated.add(`${dirname(entry.path)}/${name}`);
      }
    }
    if (/^fixtures\/[^/]+\/gradlew$/.test(entry.path)) {
      for (const name of ["run", "build", ".gradle"]) {
        generated.add(`${dirname(entry.path)}/${name}`);
      }
    }
  }
  for (const path of generated) {
    try {
      await lstat(join(root, path));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    throw new Error(`GENERATED_PATH_PRESENT: ${path}`);
  }
  let bytesChecked = 0;
  const executableFiles = [], bootstrap = [];
  for (const entry of entries) {
    const file = join(root, entry.path), stat = await lstat(file);
    assert(stat.isFile() && !stat.isSymbolicLink(), `REGULAR_FILE_REQUIRED: ${entry.path}`);
    const bytes = await readFile(file);
    const blob = createHash(objectFormat).update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    assert.equal(blob, entry.oid, `CHECKOUT_BYTES_CHANGED: ${entry.path}`);
    bytesChecked += bytes.length;
    if (entry.path.endsWith(".sh") || entry.path.endsWith("/gradlew")) {
      assert(!bytes.includes(13), `POSIX_SCRIPT_REQUIRES_LF: ${entry.path}`);
      if (entry.path.endsWith("/gradlew") ||
          ["scripts/smoke-client-ci.sh", "scripts/smoke-dedicated-server.sh",
            "scripts/test-smoke-guards.sh"].includes(entry.path)) {
        assert.equal(entry.mode, "100755", `GIT_EXECUTABLE_BIT_REQUIRED: ${entry.path}`);
      }
      if (entry.mode === "100755") {
        assert(bytes.subarray(0, 2).equals(Buffer.from("#!")), `SHEBANG_REQUIRED: ${entry.path}`);
        if (process.platform !== "win32") {
          assert(stat.mode & 0o111, `FILESYSTEM_EXECUTABLE_BIT_REQUIRED: ${entry.path}`);
        }
        executableFiles.push(entry.path);
      }
    }
    if (entry.path.startsWith("fixtures/fabric-1.20.1-empty/") &&
        /(?:gradlew(?:\.bat)?|gradle\/wrapper\/gradle-wrapper\.(?:jar|properties))$/.test(entry.path)) {
      bootstrap.push({ path: entry.path, bytes: bytes.length, sha256: digest(bytes) });
    }
  }
  assert.equal(git("status", "--porcelain", "--untracked-files=all"), "", "DIRTY_CHECKOUT");
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(process.versions.node, pkg.engines.node, "LOCKED_NODE_REQUIRED");
  assert(pkg.packageManager.startsWith(`pnpm@${pkg.engines.pnpm}+sha512.`), "PINNED_COREPACK_PNPM_REQUIRED");
  const lock = JSON.parse(await readFile(join(root, "packs/fabric-1.20.1/runtime-r5/versions.lock.json"), "utf8"));
  const wrapper = bootstrap.find(entry => entry.path.endsWith(".jar"));
  assert.equal(wrapper?.sha256, lock.gradle.wrapperJarSha256, "PINNED_WRAPPER_REQUIRED");
  return {
    schemaVersion: 1, status: "PASS", sourceRevision: git("rev-parse", "HEAD").trim(),
    tree: git("rev-parse", "HEAD^{tree}").trim(), objectFormat,
    platform: process.platform, architecture: process.arch,
    node: process.versions.node, packageManager: pkg.packageManager,
    trackedFiles: entries.length, bytesChecked, absentGeneratedPaths: [...generated].sort(),
    executableFiles, bootstrap,
    lockfileSha256: digest(await readFile(join(root, "pnpm-lock.yaml"))),
    scope: "Fresh checkout bytes/modes/bootstrap inputs only; install/build/runtime evidence is separate",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const job = process.argv[2];
    assert(process.argv.length <= 3 && (!job ||
      ["control-plane", "studio-windows", "fabric-production"].includes(job)), "UNKNOWN_CHECKOUT_JOB");
    const report = await verifyCleanCheckout(process.cwd());
    if (job) {
      const target = join(process.cwd(), "output/ci/clean-checkout", `${job}.json`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, JSON.stringify(report, null, 2) + "\n");
    }
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } catch (error) {
    process.stderr.write(`CLEAN_CHECKOUT_FAILED: ${error.message}\n`);
    process.exitCode = 1;
  }
}

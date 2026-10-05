import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { verifyCleanCheckout } from "./verify-clean-checkout.mjs";

// Собственный disposable clone: не меняем рабочую копию или настройки Git пользователя.
const temporaryBase = await realpath(tmpdir());
const temporary = await mkdtemp(join(temporaryBase, "mcdev-clean-checkout-"));
const checkout = join(temporary, "checkout");
const git = (cwd, ...args) => execFileSync("git", [
  "-c", "core.hooksPath=" + join(temporary, "no-hooks"), ...args,
], { cwd, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
const passed = [];
try {
  git(process.cwd(), "clone", "--no-hardlinks", "--no-checkout", "--quiet", process.cwd(), checkout);
  git(checkout, "-c", "core.autocrlf=true", "checkout", "--quiet", "--detach", "HEAD");
  const initial = await verifyCleanCheckout(checkout);
  assert.equal(initial.status, "PASS");
  assert(initial.bootstrap.length === 4 && initial.trackedFiles > 400);
  passed.push("fresh checkout with core.autocrlf=true preserves exact committed bytes");

  for (const path of ["output", "node_modules", "apps/model-editor/dist", "fixtures/fabric-1.20.1-empty/run"]) {
    const target = resolve(checkout, path);
    assert(target.startsWith(resolve(checkout) + sep));
    await mkdir(target, { recursive: true });
    await assert.rejects(verifyCleanCheckout(checkout), /GENERATED_PATH_PRESENT/);
    await rm(target, { recursive: true });
    passed.push(`rejects pre-existing ${path}`);
  }

  const sourcePath = join(checkout, "README.md"), original = await readFile(sourcePath);
  await writeFile(sourcePath, original.toString("utf8").replace(/\n/g, "\r\n"));
  // Git может нормализовать CRLF в diff: проверка должна сравнить сырые checkout bytes.
  await assert.rejects(verifyCleanCheckout(checkout), /CHECKOUT_BYTES_CHANGED: README.md/);
  await writeFile(sourcePath, original);
  passed.push("rejects transformed raw LF bytes even when Git normalizes text");

  const wrapperPath = "fixtures/fabric-1.20.1-empty/gradlew";
  git(checkout, "update-index", "--chmod=-x", wrapperPath);
  await assert.rejects(verifyCleanCheckout(checkout), /DIRTY_CHECKOUT/);
  git(checkout, "update-index", "--chmod=+x", wrapperPath);
  passed.push("rejects altered index executable bit");
  if (process.platform !== "win32") {
    await chmod(join(checkout, wrapperPath), 0o644);
    await assert.rejects(verifyCleanCheckout(checkout), /FILESYSTEM_EXECUTABLE_BIT_REQUIRED/);
    await chmod(join(checkout, wrapperPath), 0o755);
    passed.push("rejects missing physical POSIX executable bit");
  }

  const jar = join(checkout, "fixtures/fabric-1.20.1-empty/gradle/wrapper/gradle-wrapper.jar");
  const jarBytes = await readFile(jar);
  await writeFile(jar, jarBytes.subarray(0, jarBytes.length - 1));
  await assert.rejects(verifyCleanCheckout(checkout), /CHECKOUT_BYTES_CHANGED/);
  await writeFile(jar, jarBytes);
  passed.push("rejects corrupted bootstrap JAR without rewriting reviewed inputs");

  const untracked = join(checkout, "unexpected-input.txt");
  await writeFile(untracked, "not part of the source revision\n");
  await assert.rejects(verifyCleanCheckout(checkout), /DIRTY_CHECKOUT/);
  await rm(untracked);
  passed.push("rejects untracked source input");
  assert.deepEqual(await verifyCleanCheckout(checkout), initial);
  process.stdout.write(JSON.stringify({ status: "PASS", platform: process.platform, checks: passed,
    sourceRevision: initial.sourceRevision, trackedFiles: initial.trackedFiles }, null, 2) + "\n");
} finally {
  const target = await realpath(temporary);
  assert.equal(dirname(target), temporaryBase);
  assert(target.startsWith(join(temporaryBase, "mcdev-clean-checkout-")));
  await rm(target, { recursive: true, force: true });
}

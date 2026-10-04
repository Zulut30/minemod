import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { projectFromAsset } from "./index.ts";
import { readProject, writeProject } from "../../apps/model-editor/worker/persistence.ts";

const source: unknown = JSON.parse(await readFile(
  new URL("../../fixtures/assets/aurora-longsword-v2.item-asset.json", import.meta.url), "utf8",
));
const previous = projectFromAsset(source, randomUUID());
const older = structuredClone(previous);
older.model.name = "Предыдущая резервная версия";
const next = structuredClone(previous);
next.model.name = "Следующее сохранение";
const directory = await mkdtemp(join(tmpdir(), "mcdev-persistence-crash-"));
try {
  const sourcePath = join(directory, "next.json");
  await writeFile(sourcePath, JSON.stringify(next));
  for (const phase of ["partial-write", "partial-backup", "before-replace"]) {
    const path = join(directory, `${phase}.json`);
    await writeProject(path, older);
    await writeProject(path, previous);
    const original = await readFile(path);
    const originalBackup = await readFile(path + ".bak");
    const child = fork(fileURLToPath(new URL("./persistence-crash-child.mjs", import.meta.url)),
      [path, sourcePath, phase], { execArgv: ["--experimental-strip-types"], silent: true });
    let diagnostics = "";
    child.stderr!.on("data", (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-4096); });
    const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Crash phase timeout: ${phase}; ${diagnostics}`)), 15_000);
        child.once("message", (message) => {
          clearTimeout(timer);
          try { assert.deepEqual(message, { phase }); resolve(); } catch (error) { reject(error); }
        });
        child.once("exit", () => { clearTimeout(timer); reject(new Error(`Early child exit: ${diagnostics}`)); });
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
      });
    } finally {
      child.kill();
      await exited;
    }
    assert.deepEqual(await readFile(path), original, "Killed save must preserve the primary bytes");
    const expectedBackup = phase === "before-replace" ? previous : older;
    if (phase !== "before-replace")
      assert.deepEqual(await readFile(path + ".bak"), originalBackup, "Partial save must preserve the older backup bytes");
    assert.deepEqual(await readProject(path), previous);
    assert.deepEqual(await readProject(path + ".bak"), expectedBackup, "Killed save must preserve a complete backup");
    const pending = (await readdir(directory)).filter((name) => name.startsWith(phase + ".json.") && name.endsWith(".pending"));
    assert.equal(pending.length, phase === "partial-backup" ? 2 : 1, "No partial .bak is published");
    for (const name of pending) {
      if (phase === "partial-write" || name.endsWith(".backup.pending"))
        await assert.rejects(readProject(join(directory, name)));
      else assert.deepEqual(await readProject(join(directory, name)), next);
    }
    await writeProject(path, next);
    assert.deepEqual(await readProject(path), next, "Retry after a crash must succeed");
    assert.deepEqual(await readProject(path + ".bak"), previous);
  }
  const blocked = join(directory, "blocked-backup.json");
  await writeProject(blocked, previous);
  await mkdir(blocked + ".bak");
  const original = await readFile(blocked);
  await assert.rejects(writeProject(blocked, next));
  assert.deepEqual(await readFile(blocked), original, "Backup failure must not publish the new primary");
  assert.equal((await readdir(directory)).filter((name) => name.startsWith("blocked-backup.json.") && name.endsWith(".pending")).length, 0);
} finally {
  await rm(directory, { recursive: true, force: true });
}
process.stdout.write("editor-core: killed primary/backup writes, killed pre-replace save and failed backup preserve files PASS\n");

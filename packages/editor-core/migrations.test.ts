import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseProject, migrateProject, CURRENT_PROJECT_VERSION, type EditorProject } from "./index.ts";
import { readProject, writeProject } from "../../apps/model-editor/worker/persistence.ts";

const legacyText = await readFile(new URL("../../fixtures/editor-projects/v1-painted-variants.mmeditor.json", import.meta.url), "utf8");
type LegacyProject = Omit<EditorProject, "schemaVersion" | "design"> & {
  schemaVersion: number;
  design?: { brief: string; variants: { id: string; label: string; note: string;
    project: Omit<EditorProject, "schemaVersion" | "design"> & { schemaVersion: number } }[] };
};
const legacy = JSON.parse(legacyText) as LegacyProject;
const expected = structuredClone(legacy);
expected.schemaVersion = CURRENT_PROJECT_VERSION;
for (const variant of expected.design!.variants) variant.project.schemaVersion = CURRENT_PROJECT_VERSION;
const migrated = parseProject(legacyText);
assert.deepEqual(migrated, expected, "Only project and snapshot versions may change.");
assert.deepEqual(parseProject(JSON.stringify(migrated)), migrated, "Migration must be idempotent.");
assert.deepEqual(migrateProject(legacy), expected);
assert.deepEqual(legacy, JSON.parse(legacyText), "Migration cannot mutate input.");
const early = structuredClone(legacy); delete early.design;
assert.deepEqual(migrateProject(early), { ...early, schemaVersion: CURRENT_PROJECT_VERSION });
for (const version of [0, 4, 99, -1, "2", null])
  assert.throws(() => parseProject(JSON.stringify({ ...legacy, schemaVersion: version })), { code: "UNSUPPORTED_PROJECT_VERSION" });
const futureVariant = structuredClone(legacy); futureVariant.design!.variants[0]!.project.schemaVersion = 99;
assert.throws(() => parseProject(JSON.stringify(futureVariant)), { code: "UNSUPPORTED_PROJECT_VERSION" });
assert.throws(() => parseProject(JSON.stringify({ ...legacy, futureField: true })), { code: "INVALID_PROJECT" });
const invalidPixels = structuredClone(legacy); invalidPixels.texturePlan.rows[0] = "?".repeat(256);
assert.throws(() => migrateProject(invalidPixels), { code: "INVALID_PROJECT" });
assert(!legacy.texturePlan.palette.some((c) => c.symbol === "v"));
invalidPixels.texturePlan.rows[0] = "v".repeat(256);
assert.throws(() => migrateProject(invalidPixels), { code: "PALETTE" });

const directory = await mkdtemp(join(tmpdir(), "mcdev-project-migrations-"));
const originalBytes = Buffer.from(legacyText.replaceAll("\n", "\r\n"));
try {
  const path = join(directory, "v1.json");
  await writeFile(path, originalBytes);
  assert.deepEqual(await readProject(path), migrated);
  assert.deepEqual(await readFile(path), originalBytes, "Reading cannot rewrite v1.");
  await writeProject(path, migrated);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), migrated);
  assert.deepEqual(await readFile(path + ".bak"), originalBytes, "Backup must preserve CRLF and original bytes.");
  const original = `${path}.v1-${createHash("sha256").update(originalBytes).digest("hex")}.original.json`;
  assert.deepEqual(await readFile(original), originalBytes);
  const next = structuredClone(migrated); next.model.name = "Следующая правка после миграции";
  await writeProject(path, next);
  await writeProject(path, migrated);
  assert.deepEqual(await readFile(original), originalBytes, "Repeated saves cannot rotate away the migration source.");
  await writeFile(path + ".bak", "{broken backup}");
  assert.deepEqual(await readFile(original), originalBytes, "Original must not share an inode with mutable backup.");

  // Настоящий файл v2, сохранённый прежним упакованным редактором.
  const v2Text = await readFile(new URL("../../fixtures/editor-projects/v2-painted-repair.mmeditor.json", import.meta.url), "utf8");
  const v2 = JSON.parse(v2Text) as LegacyProject, v2Expected = structuredClone(v2);
  assert.equal(v2.schemaVersion, 2);
  v2Expected.schemaVersion = CURRENT_PROJECT_VERSION;
  for (const variant of v2Expected.design?.variants ?? []) variant.project.schemaVersion = CURRENT_PROJECT_VERSION;
  assert.deepEqual(parseProject(v2Text), v2Expected, "v2 migration preserves exact painted model and IDs.");
  const v2Path = join(directory, "v2.json"), v2Bytes = Buffer.from(v2Text);
  await writeFile(v2Path, v2Bytes); await writeProject(v2Path, parseProject(v2Text));
  assert.deepEqual(await readFile(v2Path + ".bak"), v2Bytes);
  assert.deepEqual(await readFile(`${v2Path}.v2-${createHash("sha256").update(v2Bytes).digest("hex")}.original.json`), v2Bytes);
  assert.deepEqual(parseProject(await readFile(v2Path, "utf8")), v2Expected);

  // Collision не даёт уничтожить существующую оригинальную копию.
  const collision = join(directory, "collision.json");
  await writeFile(collision, originalBytes);
  const collisionOriginal = `${collision}.v1-${createHash("sha256").update(originalBytes).digest("hex")}.original.json`;
  const different = structuredClone(legacy); different.model.name = "Другой исходник";
  const differentText = JSON.stringify(different);
  await writeFile(collisionOriginal, differentText);
  await assert.rejects(writeProject(collision, migrated), { code: "MIGRATION_BACKUP_CONFLICT" });
  assert.deepEqual(await readFile(collision), originalBytes);
  assert.equal(await readFile(collisionOriginal, "utf8"), differentText);

  // Реальная остановка процесса после complete migration backup, перед заменой v1 primary.
  const interrupted = join(directory, "interrupted.json"), nextSource = join(directory, "next-v2.json");
  await writeFile(interrupted, originalBytes); await writeFile(nextSource, JSON.stringify(migrated));
  const child = fork(fileURLToPath(new URL("./persistence-crash-child.mjs", import.meta.url)),
    [interrupted, nextSource, "before-replace"], { execArgv: ["--experimental-strip-types"], silent: true });
  let diagnostics = "";
  child.stderr!.on("data", (data: Buffer) => { diagnostics = (diagnostics + data.toString()).slice(-4096); });
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Migration crash timeout: ${diagnostics}`)), 15_000);
      child.once("message", (message) => { clearTimeout(timer); try { assert.deepEqual(message, { phase: "before-replace" }); resolve(); } catch (error) { reject(error); } });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`Unexpected child exit: ${diagnostics}`)); });
    });
  } finally { child.kill(); await closed; }
  assert.deepEqual(await readFile(interrupted), originalBytes);
  assert.deepEqual(await readFile(interrupted + ".bak"), originalBytes);
  const interruptedOriginal = `${interrupted}.v1-${createHash("sha256").update(originalBytes).digest("hex")}.original.json`;
  assert.deepEqual(await readFile(interruptedOriginal), originalBytes);
  // Crash оставляет собственный complete staging; сохранение не принимает его за primary.
  for (const name of await readdir(directory)) if (name.startsWith("interrupted.json.") && name.endsWith(".pending")) await rm(join(directory, name));
  await writeProject(interrupted, migrated);
  assert.deepEqual(await readProject(interrupted), migrated);
  assert.deepEqual(await readFile(interruptedOriginal), originalBytes);

  const futureText = JSON.stringify({ ...migrated, schemaVersion: 99 });
  for (const location of ["primary", "backup", "backup-only", "backup-corrupt-primary", "future-variant"]) {
    const target = join(directory, location + ".json");
    const main: string = location === "primary" ? futureText : location === "future-variant" ? JSON.stringify(futureVariant) :
      location === "backup-corrupt-primary" ? "{broken}" : JSON.stringify(migrated);
    if (location !== "backup-only") await writeFile(target, main);
    const backup: string = location.startsWith("backup") ? futureText : JSON.stringify(migrated);
    await writeFile(target + ".bak", backup);
    await assert.rejects(writeProject(target, migrated), { code: "UNSUPPORTED_PROJECT_VERSION" });
    if (location !== "backup-only") assert.equal(await readFile(target, "utf8"), main);
    else await assert.rejects(readFile(target), { code: "ENOENT" });
    assert.equal(await readFile(target + ".bak", "utf8"), backup);
  }
  const malformed = join(directory, "invalid-utf8.json");
  await writeFile(malformed, Buffer.from([123, 255, 125]));
  await assert.rejects(readProject(malformed), { code: "INVALID_JSON" });
  assert.equal((await readdir(directory)).some((name) => name.endsWith(".pending")), false);
} finally { await rm(directory, { recursive: true, force: true }); }
process.stdout.write("editor-core: v1/v2 -> v3 IDs/pixels/UV/variants, exact persistent migration source, collision and future-file guards PASS\n");

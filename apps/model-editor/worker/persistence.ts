import { open, mkdir, rename, rm, link } from "node:fs/promises";
import { dirname } from "node:path";
import { Buffer } from "node:buffer";
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  MAX_PROJECT_BYTES,
  CURRENT_PROJECT_VERSION,
  parseProject,
  type EditorProject,
  EditorError,
} from "@mcdev/editor-core";

/** Windows может временно удерживать только что записанные файлы. Повторы ограничены и не меняют атомарность rename. */
export async function renameWithRetry(
  source: string,
  target: string,
  operation: (source: string, target: string) => Promise<void> = rename,
): Promise<void> {
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      await operation(source, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt === 6 || !["EPERM", "EACCES", "EBUSY"].includes(code ?? ""))
        throw error;
      await delay(25 * 2 ** attempt);
    }
  }
}

async function readProjectDocument(path: string): Promise<{ bytes: Buffer; project: EditorProject; sourceVersion: 1 | 2 | 3 }> {
  const file = await open(path, "r");
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > MAX_PROJECT_BYTES)
      throw new EditorError(
        "SIZE_LIMIT",
        "Файл проекта слишком большой или не является обычным файлом.",
      );
    // Лимит действует и если другой процесс увеличит файл после stat.
    const bytes = Buffer.alloc(MAX_PROJECT_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await file.read(
        bytes,
        length,
        bytes.length - length,
        null,
      );
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > MAX_PROJECT_BYTES)
      throw new EditorError(
        "SIZE_LIMIT",
        "Файл проекта превышает лимит размера.",
      );
    const source = bytes.subarray(0, length), text = source.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(source))
      throw new EditorError("INVALID_JSON", "Проект требует корректный UTF-8; исходник сохранён.");
    const project = parseProject(text);
    return { bytes: source, project, sourceVersion: (JSON.parse(text) as { schemaVersion: 1 | 2 | 3 }).schemaVersion };
  } finally {
    await file.close();
  }
}
export async function readProject(path: string): Promise<EditorProject> {
  return (await readProjectDocument(path)).project;
}
export async function readProjectWithVersion(path: string): Promise<{ project: EditorProject; sourceVersion: 1 | 2 | 3 }> {
  const { project, sourceVersion } = await readProjectDocument(path);
  return { project, sourceVersion };
}
export async function writeProject(
  path: string,
  project: EditorProject,
): Promise<void> {
  const text = JSON.stringify(project, null, 2) + "\n";
  parseProject(text);
  if (project.schemaVersion !== CURRENT_PROJECT_VERSION)
    throw new EditorError("UNSUPPORTED_PROJECT_VERSION", "Для сохранения нужен актуальный формат проекта; сначала выполните миграцию.");
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.pending`;
  const backupTemp = `${path}.${randomUUID()}.backup.pending`;
  const owned = new Set<string>();
  async function stage(destination: string, contents: string | Buffer): Promise<void> {
    const file = await open(destination, "wx", 0o600);
    owned.add(destination);
    try {
      await file.writeFile(contents, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
  }
  try {
    await stage(temp, text);
    let previous: Awaited<ReturnType<typeof readProjectDocument>> | undefined;
    try {
      previous = await readProjectDocument(path);
    } catch (error) {
      if (
        (error instanceof EditorError && error.code === "UNSUPPORTED_PROJECT_VERSION") ||
        !(error instanceof EditorError) &&
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      )
        throw error;
    }
    // Даже backup неизвестной версии нельзя уничтожать сохранением более старого Studio.
    try { await readProject(`${path}.bak`); }
    catch (error) {
      if ((error instanceof EditorError && error.code === "UNSUPPORTED_PROJECT_VERSION") ||
        !(error instanceof EditorError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (previous !== undefined) {
      if (previous.sourceVersion < CURRENT_PROJECT_VERSION) {
        // Отдельный inode: последующие save/backup не меняют original migration source.
        const sourceHash = createHash("sha256").update(previous.bytes).digest("hex");
        const original = `${path}.v${previous.sourceVersion}-${sourceHash}.original.json`, migrationTemp = `${path}.${randomUUID()}.migration.pending`;
        await stage(migrationTemp, previous.bytes);
        try { await link(migrationTemp, original); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          if (!(await readProjectDocument(original)).bytes.equals(previous.bytes))
            throw new EditorError("MIGRATION_BACKUP_CONFLICT", "Исходная резервная копия миграции не совпадает. Проект сохранён без изменений.");
        }
        await rm(migrationTemp);
        owned.delete(migrationTemp);
      }
      // Backup тоже заменяется атомарно: прерванная запись не обнуляет старый .bak.
      await stage(backupTemp, previous.bytes);
      await renameWithRetry(backupTemp, `${path}.bak`);
      owned.delete(backupTemp);
    }
    await renameWithRetry(temp, path);
    owned.delete(temp);
  } finally {
    for (const destination of owned)
      await rm(destination, { force: true }).catch(() => undefined);
  }
}

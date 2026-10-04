import { open, mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  MAX_PROJECT_BYTES,
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

export async function readProject(path: string): Promise<EditorProject> {
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
    return parseProject(bytes.subarray(0, length).toString("utf8"));
  } finally {
    await file.close();
  }
}
export async function writeProject(
  path: string,
  project: EditorProject,
): Promise<void> {
  const text = JSON.stringify(project, null, 2) + "\n";
  parseProject(text);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.pending`;
  const backupTemp = `${path}.${randomUUID()}.backup.pending`;
  const owned = new Set<string>();
  async function stage(destination: string, contents: string): Promise<void> {
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
    let previous: EditorProject | undefined;
    try {
      previous = await readProject(path);
    } catch (error) {
      if (
        !(error instanceof EditorError) &&
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      )
        throw error;
    }
    if (previous !== undefined) {
      // Backup тоже заменяется атомарно: прерванная запись не обнуляет старый .bak.
      await stage(backupTemp, JSON.stringify(previous, null, 2) + "\n");
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

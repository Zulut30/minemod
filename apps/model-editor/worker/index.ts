import { readFile, mkdir, writeFile, rm, stat } from "node:fs/promises";
import { Buffer } from "node:buffer";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { join, dirname, resolve, sep } from "node:path";
import {
  EditorSession,
  EditorError,
  projectFromAsset,
  emptyProject,
  assetRequest,
  cubes,
  type EditorState,
  type EditorProject,
} from "@mcdev/editor-core";
import { compileItemAssetPayload } from "../../../packages/application/item-assets.ts";
import { assetOperationWithEvidence } from "../../../packages/application/evidence.ts";
import { readProjectWithVersion, writeProject, renameWithRetry } from "./persistence.ts";
import type { HostResponse, View } from "../shared/bridge.ts";
import { startEditorMcp } from "./mcp.ts";

interface ServiceRequest {
  id: number;
  kind: string;
  fixturePath?: string;
  recoveryPath?: string;
  path?: string;
  mutation?: unknown;
  control?: unknown;
  action?: "get" | "start" | "stop";
  projectId?: string;
  cubeIds?: string[];
  reference?: { projectId: string; revision: number };
}
const port = process.parentPort;
if (!port) throw new Error("Editor worker requires its private parent port.");
let session: EditorSession;
let fixture: unknown;
let recoveryPath: string;
let connection: Awaited<ReturnType<typeof startEditorMcp>> | undefined;
let selection: string[] = [];
let recoveryWarning = "";
let recoveryWritable = true;
const unsupportedVersion = (error: unknown) => error instanceof EditorError && error.code === "UNSUPPORTED_PROJECT_VERSION";
function protectRecovery(): void {
  recoveryWritable = false;
  recoveryWarning = "Автосохранение остановлено: восстановительный проект имеет неподдерживаемую версию. Оригинал и backup сохранены. Сохраните текущую работу в новый файл.";
}
let finalizing = false;
let stateSequence = 0;
function versioned(result: HostResponse): HostResponse {
  return result.ok ? { ...result, sequence: ++stateSequence } : result;
}
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
  const result = queue.then(operation);
  queue = result.catch(() => undefined);
  return result;
}
const captureWaiters = new Map<
  string,
  {
    resolve: (data: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
function capture(
  state: EditorState,
  view: View,
  options?: {
    referenceProject?: EditorProject;
    silhouette?: boolean;
    layout?: "review";
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      captureWaiters.delete(id);
      reject(
        new EditorError(
          "CAPTURE_TIMEOUT",
          "Рендер не ответил; повторите снимок.",
        ),
      );
    }, 12_000);
    captureWaiters.set(id, { resolve, reject, timer });
    port!.postMessage({
      event: "capture",
      job: {
        id,
        project: state.project,
        revision: state.revision,
        view,
        ...options,
      },
    });
  });
}
const bundle = () =>
  compileItemAssetPayload(
    JSON.stringify(assetRequest(session.state().project)),
  );
async function changed(note: string): Promise<void> {
  selection = selection.filter((id) =>
    cubes(session.state().project).some((c) => c.id === id),
  );
  if (recoveryWritable) {
    try {
      await writeProject(recoveryPath, session.state().project);
      recoveryWarning = "";
    } catch (error) {
      if (unsupportedVersion(error)) protectRecovery();
      else recoveryWarning = "Восстановительная копия недоступна. Сохраните проект вручную.";
    }
  }
  port!.postMessage({
    event: "state",
    result: versioned({
      ok: true,
      state: session.state(),
      note,
      warning: recoveryWarning,
    }),
  });
}
async function run(request: ServiceRequest): Promise<HostResponse> {
  let note: string | undefined;
  if (finalizing)
    throw new EditorError("CLOSING", "Редактор завершает работу.");
  if (["new", "example", "open", "prepareClose"].includes(request.kind)) {
    const current = session.state();
    if (
      request.reference?.projectId !== current.project.projectId ||
      request.reference.revision !== current.revision
    )
      throw new EditorError(
        "STALE_REVISION",
        "Проект изменился во время диалога. Повторите операцию, проверив новые правки.",
      );
  }
  if (request.kind === "prepareClose") {
    finalizing = true;
    connection?.close();
    return { ok: true, state: session.state(), warning: recoveryWarning };
  }
  if (request.kind === "init") {
    fixture = JSON.parse(
      await readFile(request.fixturePath!, "utf8"),
    ) as unknown;
    recoveryPath = request.recoveryPath!;
    let project = projectFromAsset(fixture, randomUUID());
    try {
      const loaded = await readProjectWithVersion(recoveryPath);
      project = loaded.project;
      note = loaded.sourceVersion === 1 ? "Восстановлен проект v1. Миграция в v2 выполнена в памяти; перед сохранением будет создана точная копия исходника." : "Восстановлен последний рабочий проект.";
    } catch (error) {
      if (unsupportedVersion(error)) {
        protectRecovery();
        note = "Восстановительный проект требует совместимую версию Studio. Открыт исходный пример.";
      } else try {
        const loaded = await readProjectWithVersion(`${recoveryPath}.bak`);
        project = loaded.project;
        note = loaded.sourceVersion === 1 ? "Восстановлена резервная копия v1. Миграция в v2 выполнена в памяти; исходник сохранён." : "Восстановлена резервная копия проекта.";
      } catch (backupError) {
        if (unsupportedVersion(backupError)) protectRecovery();
        if (
          (error as NodeJS.ErrnoException).code !== "ENOENT" ||
          (backupError as NodeJS.ErrnoException).code !== "ENOENT"
        ) {
          note = "Восстановление недоступно. Открыт исходный пример; ваши файлы сохранены.";
        }
      }
    }
    session = new EditorSession(project);
  } else if (request.kind === "connection") {
    if (request.action === "start" && !connection)
      connection = await startEditorMcp({
        inspect: () => session.state(),
        selection: () => [...selection],
        preview: (mutation) => session.preview(mutation, "agent"),
        apply: async (mutation) => {
          if (finalizing)
            throw new EditorError("CLOSING", "Редактор завершает работу.");
          const state = session.apply(mutation, "agent");
          await changed(
            "Агент применил правку. Проверьте результат с разных сторон.",
          );
          return state;
        },
        capture,
        export: bundle,
        enqueue,
      });
    if (request.action === "stop") {
      connection?.close();
      connection = undefined;
    }
    return {
      ok: true,
      state: session.state(),
      warning: recoveryWarning,
      connection: connection
        ? { enabled: true, url: connection.url, token: connection.token }
        : { enabled: false },
    };
  } else if (request.kind === "selection") {
    if (request.projectId === session.state().project.projectId) {
      const available = new Set(
        cubes(session.state().project).map((c) => c.id),
      );
      selection = [...new Set(request.cubeIds ?? [])].filter((id) =>
        available.has(id),
      );
    }
  } else if (request.kind === "apply") {
    session.apply(request.mutation);
    note = "Изменения применены.";
  } else if (request.kind === "repair") {
    session.setRepair(request.control);
    note = session.state().repair ? "Адресная правка включена. Агент ограничен выбранной областью и лимитом итераций." : "Адресная правка завершена. Проверьте модель с разных сторон.";
  } else if (request.kind === "new" || request.kind === "example") {
    selection = [];
    session = new EditorSession(
      request.kind === "new"
        ? emptyProject(randomUUID())
        : projectFromAsset(fixture, randomUUID()),
    );
    note =
      request.kind === "new"
        ? "Создан новый проект."
        : "Открыт исходный пример меча.";
  } else if (request.kind === "save") {
    await writeProject(request.path!, session.state().project);
    session.markSaved();
    note = "Проект сохранён.";
  } else if (request.kind === "open") {
    const loaded = await readProjectWithVersion(request.path!);
    selection = [];
    session = new EditorSession(loaded.project);
    session.markSaved();
    note = loaded.sourceVersion === 1 ? "Проект v1 открыт в формате v2. Исходник не изменён; при сохранении будет оставлена отдельная оригинальная копия." : "Проект открыт.";
  } else if (request.kind === "export") {
    const exported = bundle();
    const state = session.state();
    const operation = assetOperationWithEvidence(JSON.stringify(assetRequest(state.project)), "asset-bundle-export",
      { kind: "editor", projectId: state.project.projectId, revision: state.revision });
    if (!operation.ok) throw new EditorError(operation.error.code, operation.error.message);
    const versionedBundle = operation.bundle;
    const destination = join(request.path!, `item-${randomUUID()}`),
      stage = destination + ".pending";
    await mkdir(stage, { recursive: true });
    try {
      for (const file of versionedBundle.files) {
        const target = resolve(stage, file.path);
        if (!target.startsWith(resolve(stage) + sep))
          throw new EditorError(
            "EXPORT_PATH",
            "Путь ресурса выходит за пределы экспорта.",
          );
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, Buffer.from(file.content, file.encoding));
      }
      await writeFile(
        join(stage, "bundle.json"),
        JSON.stringify(exported, null, 2) + "\n",
      );
      await writeFile(
        join(stage, "asset-bundle.v1.json"),
        JSON.stringify(versionedBundle, null, 2) + "\n",
      );
      await writeFile(join(stage, "operation-evidence.v1.json"), JSON.stringify(operation.evidence, null, 2) + "\n");
      await writeProject(
        join(stage, "source.mmeditor.json"),
        session.state().project,
      );
      await renameWithRetry(stage, destination);
      note = `Экспортировано ${exported.elements} кубов. Ресурсы требуют review и проверки в игре. Папка: ${destination}`;
    } catch (error) {
      await rm(stage, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  } else if (request.kind !== "inspect")
    throw new EditorError("UNKNOWN_OPERATION", "Операция не поддерживается.");
  if (["apply", "repair", "new", "example", "open"].includes(request.kind)) {
    await changed(note ?? "Сцена обновлена.");
  }
  return {
    ok: true,
    state: session.state(),
    warning: recoveryWarning,
    ...(note ? { note } : {}),
  };
}
port.on(
  "message",
  ({
    data,
  }: {
    data: ServiceRequest & {
      event?: string;
      captureId?: string;
      png?: string;
      error?: string;
    };
  }) => {
    if (data.event === "capture-result") {
      const waiting = captureWaiters.get(data.captureId!);
      if (waiting) {
        clearTimeout(waiting.timer);
        captureWaiters.delete(data.captureId!);
        if (data.png && data.png.length <= 2_097_152) waiting.resolve(data.png);
        else
          waiting.reject(
            new EditorError(
              "CAPTURE_FAILED",
              "Снимок недоступен. Проверьте поддержку WebGL.",
            ),
          );
      }
      return;
    }
    void enqueue(async () => {
      let result: HostResponse;
      try {
        if (data.path && data.kind !== "save" && data.kind !== "export")
          await stat(data.path);
        result = await run(data);
      } catch (error) {
        if (process.argv.includes("--editor-test"))
          process.stderr.write(
            `Test service ${data.kind}: ${String((error as Error).stack ?? error)}\n`,
          );
        result = {
          ok: false,
          error:
            error instanceof EditorError
              ? { code: error.code, message: error.message }
              : {
                  code: "SERVICE_ERROR",
                  message:
                    "Операция не выполнена. Проверьте формат файла и доступ к папке.",
                },
        };
      }
      port.postMessage({ id: data.id, result: versioned(result) });
    });
  },
);

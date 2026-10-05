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
  ConceptImportSchema, CURRENT_PROJECT_VERSION, MutationSchema,
  type EditorState,
  type EditorProject,
} from "@mcdev/editor-core";
import { compileItemAssetPayload } from "../../../packages/application/item-assets.ts";
import { assetOperationWithEvidence } from "../../../packages/application/evidence.ts";
import { readProjectWithVersion, writeProject, renameWithRetry } from "./persistence.ts";
import type { HostResponse, View } from "../shared/bridge.ts";
import { startEditorMcp } from "./mcp.ts";
import { ConceptStore } from "./concept-files.ts";

interface ServiceRequest {
  id: number;
  kind: string;
  fixturePath?: string;
  recoveryPath?: string;
  path?: string;
  mutation?: unknown;
  control?: unknown;
  conceptImport?: unknown;
  conceptId?: string;
  action?: "get" | "start" | "stop" | "pause" | "resume";
  projectId?: string;
  cubeIds?: string[];
  reference?: { projectId: string; revision: number };
}
const port = process.parentPort;
if (!port) throw new Error("Editor worker requires its private parent port.");
let session: EditorSession;
let fixture: unknown;
let recoveryPath: string;
let conceptStore: ConceptStore;
let connection: Awaited<ReturnType<typeof startEditorMcp>> | undefined;
let selection: string[] = [];
let recoveryWarning = "";
let recoveryWritable = true;
const unsupportedVersion = (error: unknown) => error instanceof EditorError && error.code === "UNSUPPORTED_PROJECT_VERSION";
const protectedSource = (error: unknown) => unsupportedVersion(error) || error instanceof EditorError && error.code.startsWith("CONCEPT_");
function protectRecovery(): void {
  recoveryWritable = false;
  recoveryWarning = "Автосохранение остановлено: версия восстановительного проекта или его concept assets недоступны. Оригинал и backup сохранены. Проверьте исходные файлы; текущую работу можно сохранить в новый файл.";
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
async function capture(
  state: EditorState,
  view: View,
  options?: {
    referenceProject?: EditorProject;
    silhouette?: boolean;
    layout?: "review";
    conceptId?: string;
    signal?: AbortSignal;
  },
): Promise<string> {
  const {signal, ...renderOptions} = options ?? {};
  const cancelled = () => new EditorError("REQUEST_CANCELLED", "Снимок отменён; текущая сцена сохранена.");
  if (signal?.aborted) throw cancelled();
  if (options?.conceptId) {
    const concept=state.project.design?.concepts?.find(c=>c.id===options.conceptId);
    if(!concept)throw new EditorError("CONCEPT_NOT_FOUND","Концепт отсутствует в текущем проекте.");
    await conceptStore.image(concept);
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(cancelled()); return; }
    const id = randomUUID();
    const cleanup = () => {
      clearTimeout(timer);
      captureWaiters.delete(id);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      port!.postMessage({event:"capture-cancel", captureId:id});
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new EditorError(
          "CAPTURE_TIMEOUT",
          "Рендер не ответил; повторите снимок.",
        ),
      );
    }, 12_000);
    captureWaiters.set(id, {
      resolve: data => { cleanup(); resolve(data); },
      reject: error => { cleanup(); reject(error); }, timer,
    });
    signal?.addEventListener("abort", abort, {once:true});
    port!.postMessage({
      event: "capture",
      job: {
        id,
        project: state.project,
        revision: state.revision,
        view,
        ...renderOptions,
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
      await conceptStore.persist(recoveryPath, session.state().project);
      await writeProject(recoveryPath, session.state().project);
      recoveryWarning = "";
    } catch (error) {
      if (protectedSource(error)) protectRecovery();
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
    conceptStore = new ConceptStore(join(dirname(recoveryPath),"concepts"));
    let project = projectFromAsset(fixture, randomUUID());
    try {
      const loaded = await readProjectWithVersion(recoveryPath);
      await conceptStore.restore(recoveryPath, loaded.project);
      project = loaded.project;
      note = loaded.sourceVersion < CURRENT_PROJECT_VERSION ? `Восстановлен проект v${loaded.sourceVersion}. Миграция в v${CURRENT_PROJECT_VERSION} выполнена в памяти; перед сохранением будет создана точная копия исходника.` : "Восстановлен последний рабочий проект.";
    } catch (error) {
      if (protectedSource(error)) {
        protectRecovery();
        note = unsupportedVersion(error) ? "Восстановительный проект требует совместимую версию Studio. Открыт исходный пример." : "Исходные изображения восстановительного проекта недоступны. Оригинал сохранён; открыт исходный пример.";
      } else try {
        const loaded = await readProjectWithVersion(`${recoveryPath}.bak`);
        await conceptStore.restore(recoveryPath, loaded.project);
        project = loaded.project;
        note = loaded.sourceVersion < CURRENT_PROJECT_VERSION ? `Восстановлена резервная копия v${loaded.sourceVersion}. Миграция в v${CURRENT_PROJECT_VERSION} выполнена в памяти; исходник сохранён.` : "Восстановлена резервная копия проекта.";
      } catch (backupError) {
        if (protectedSource(backupError)) protectRecovery();
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
    if (request.action === "pause") connection?.pause();
    if (request.action === "resume") connection?.resume();
    note = request.action === "pause" ? "Доступ агента приостановлен. Применённые правки сохранены в сцене."
      : request.action === "resume" ? "Доступ продолжен. Агент должен прочитать текущую сцену и создать новый preview."
      : request.action === "stop" ? "Доступ агента выключен. Для нового подключения настройте новый ключ." : undefined;
    return {
      ok: true,
      state: session.state(),
      warning: recoveryWarning,
      ...(note ? {note} : {}),
      connection: connection
        ? { enabled: true, paused: connection.access().state === "paused", url: connection.url, token: connection.token }
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
    const mutation=MutationSchema.parse(request.mutation);
    for(const command of mutation.commands)if(command.type==="conceptAdd")await conceptStore.image(command.concept);
    session.apply(request.mutation);
    note = "Изменения применены.";
  } else if (request.kind === "conceptImport") {
    const control=ConceptImportSchema.parse(request.conceptImport),before=session.state();
    if(control.projectId!==before.project.projectId||control.expectedRevision!==before.revision)
      throw new EditorError("REVISION_CONFLICT","Сцена изменилась во время выбора PNG. Повторите импорт.");
    const image=await conceptStore.import(request.path!);
    session.apply({projectId:control.projectId,expectedRevision:control.expectedRevision,key:randomUUID(),commands:[{
      type:"conceptAdd",concept:{...control.draft,...image,id:randomUUID(),mime:"image/png",review:"direction-only"},
    }]});
    note="Концепт сохранён как изображение-направление. Готовая 3D-модель проверяется отдельно.";
  } else if (request.kind === "conceptImage") {
    const state=session.state(),concept=state.project.design?.concepts?.find(c=>c.id===request.conceptId);
    if(state.project.projectId!==request.projectId||!concept)throw new EditorError("CONCEPT_NOT_FOUND","Концепт отсутствует в текущем проекте.");
    const bytes=await conceptStore.image(concept);
    return {ok:true,state,conceptImage:bytes.toString("base64")};
  } else if (request.kind === "repair") {
    session.setRepair(request.control);
    note = session.state().repair ? "Адресная правка включена. Агент ограничен выбранной областью и лимитом итераций." : "Адресная правка завершена. Проверьте модель с разных сторон.";
  } else if (request.kind === "new" || request.kind === "example") {
    selection = [];
    connection?.invalidate();
    session = new EditorSession(
      request.kind === "new"
        ? emptyProject(randomUUID())
        : projectFromAsset(fixture, randomUUID()),
      session.state().revision + 1,
    );
    note =
      request.kind === "new"
        ? "Создан новый проект."
        : "Открыт исходный пример меча.";
  } else if (request.kind === "save") {
    await conceptStore.persist(request.path!, session.state().project);
    await writeProject(request.path!, session.state().project);
    session.markSaved();
    note = "Проект сохранён.";
  } else if (request.kind === "open") {
    const loaded = await readProjectWithVersion(request.path!);
    await conceptStore.restore(request.path!, loaded.project);
    selection = [];
    connection?.invalidate();
    session = new EditorSession(loaded.project, session.state().revision + 1);
    session.markSaved();
    note = loaded.sourceVersion < CURRENT_PROJECT_VERSION ? `Проект v${loaded.sourceVersion} открыт в формате v${CURRENT_PROJECT_VERSION}. Исходник не изменён; при сохранении будет оставлена отдельная оригинальная копия.` : "Проект открыт.";
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
      await conceptStore.persist(join(stage,"source.mmeditor.json"), state.project);
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
  if (["apply", "repair", "conceptImport", "new", "example", "open"].includes(request.kind)) {
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
    const dispatch = async () => {
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
    };
    // Только чтение исходного PNG: capture ждёт renderer, который запросит его через protocol.
    // Постановка этого закрытого запроса в очередь capture создала бы взаимное ожидание.
    if (data.kind === "conceptImage" || data.kind === "connection" && (data.action === "pause" || data.action === "stop")) void dispatch();
    else void enqueue(dispatch);
  },
);

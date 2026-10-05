import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  protocol,
  net,
  utilityProcess,
} from "electron";
import type { UtilityProcess, IpcMainInvokeEvent } from "electron";
import { join, resolve, sep, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { Buffer } from "node:buffer";
import process from "node:process";
import { MAX_COMMAND_BYTES, MutationSchema, RepairControlSchema, ConceptImportSchema, MAX_CONCEPT_BYTES } from "@mcdev/editor-core";
import { z } from "zod";
import type {
  HostRequest,
  HostResponse,
  CaptureJob,
} from "../shared/bridge.ts";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "studio",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
const hidden = process.argv.includes("--editor-hidden");
const testClose = hidden && process.argv.includes("--editor-test-close");
const dataArg = process.argv.find((arg) => arg.startsWith("--editor-data="));
if (dataArg)
  app.setPath("userData", resolve(dataArg.slice("--editor-data=".length)));
const primaryInstance = hidden || app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
let window: BrowserWindow;
let worker: UtilityProcess;
let captureWindow: BrowserWindow | undefined;
let captureJob: CaptureJob | undefined;
let captureTimer: ReturnType<typeof setTimeout> | undefined;
let currentPath: string | undefined;
let sequence = 0;
const pending = new Map<
  number,
  {
    resolve: (value: HostResponse) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const unavailable = (): HostResponse => ({
  ok: false,
  error: {
    code: "SERVICE_UNAVAILABLE",
    message:
      "Сервис редактора недоступен. Перезапустите приложение для загрузки доступной восстановительной копии.",
  },
});
function ask(
  kind: string,
  fields: Record<string, unknown> = {},
): Promise<HostResponse> {
  return new Promise((complete) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      complete(unavailable());
    }, 20_000);
    pending.set(id, { resolve: complete, timer });
    try {
      worker.postMessage({ id, kind, ...fields });
    } catch {
      clearTimeout(timer);
      pending.delete(id);
      complete(unavailable());
    }
  });
}
async function save(asNew: boolean): Promise<HostResponse> {
  let path = asNew ? undefined : currentPath;
  if (!path) {
    const chosen = await dialog.showSaveDialog(window, {
      title: "Сохранить проект",
      defaultPath: "model.mmeditor.json",
      filters: [{ name: "Проект MineMod", extensions: ["json"] }],
    });
    if (chosen.canceled || !chosen.filePath) return ask("inspect");
    path = chosen.filePath;
  }
  const result = await ask("save", { path });
  if (result.ok) currentPath = path;
  return result;
}
type ProjectReference = { projectId: string; revision: number };
async function mayReplace(): Promise<ProjectReference | null> {
  const result = await ask("inspect");
  if (!result.ok) return null;
  const reference = {
    projectId: result.state.project.projectId,
    revision: result.state.revision,
  };
  if (!result.state.dirty) return reference;
  const answer = await dialog.showMessageBox(window, {
    type: "question",
    message: "Сохранить текущий проект?",
    detail: "В текущем проекте есть несохранённые изменения.",
    buttons: ["Сохранить", "Продолжить без сохранения", "Отмена"],
    cancelId: 2,
    defaultId: 0,
  });
  if (answer.response === 2) return null;
  if (answer.response === 1) return reference;
  const saved = await save(false);
  return saved.ok && !saved.state.dirty
    ? {
        projectId: saved.state.project.projectId,
        revision: saved.state.revision,
      }
    : null;
}
function trusted(event: IpcMainInvokeEvent): boolean {
  return (
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame.url.startsWith("studio://app/")
  );
}
let hostQueue = Promise.resolve<unknown>(undefined);
async function handle(request: HostRequest): Promise<HostResponse> {
  let result: HostResponse;
  switch (request.kind) {
    case "inspect":
    case "apply":
    case "connection":
    case "repair":
      result = await ask(
        request.kind,
        request.kind === "apply"
          ? { mutation: request.mutation }
          : request.kind === "connection"
            ? { action: request.action }
            : request.kind === "repair" ? { control: request.control }
            : {},
      );
      break;
    case "save":
    case "saveAs":
      result = await save(request.kind === "saveAs");
      break;
    case "conceptImport": {
      const chosen = await dialog.showOpenDialog(window, {
        title: "PNG концепта или разрешённого reference",
        properties: ["openFile"], filters: [{name:"PNG",extensions:["png"]}],
      });
      result = chosen.canceled || !chosen.filePaths[0] ? await ask("inspect")
        : await ask("conceptImport", {path:chosen.filePaths[0],conceptImport:request.control});
      break;
    }
    case "new":
    case "example": {
      const reference = await mayReplace();
      if (!reference) return ask("inspect");
      result = await ask(request.kind, { reference });
      if (result.ok) currentPath = undefined;
      break;
    }
    case "open": {
      const reference = await mayReplace();
      if (!reference) return ask("inspect");
      const chosen = await dialog.showOpenDialog(window, {
        title: "Открыть проект MineMod",
        properties: ["openFile"],
        filters: [{ name: "Проект MineMod", extensions: ["json"] }],
      });
      if (chosen.canceled || !chosen.filePaths[0]) return ask("inspect");
      result = await ask("open", { path: chosen.filePaths[0], reference });
      if (result.ok) currentPath = chosen.filePaths[0];
      break;
    }
    case "export": {
      const chosen = await dialog.showOpenDialog(window, {
        title: "Папка для нового asset bundle",
        properties: ["openDirectory", "createDirectory"],
      });
      result =
        chosen.canceled || !chosen.filePaths[0]
          ? await ask("inspect")
          : await ask("export", { path: chosen.filePaths[0] });
      break;
    }
  }
  return result.ok && currentPath
    ? { ...result, fileName: basename(currentPath) }
    : result;
}
async function boot(): Promise<void> {
  if (!primaryInstance) return;
  await app.whenReady();
  Menu.setApplicationMenu(null);
  const runtime = join(app.getAppPath(), "dist");
  protocol.handle("studio", async (request) => {
    const url = new URL(request.url);
    if (url.hostname === "app" && url.pathname.startsWith("/concepts/")) {
      const match=/^\/concepts\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.png$/iu.exec(url.pathname);
      const activeCapture = url.searchParams.size === 1 && url.searchParams.get("capture") === captureJob?.id && captureJob?.conceptId === match?.[2] && captureJob?.project.projectId === match?.[1];
      if(!match || !z.uuid().safeParse(match[1]).success || !z.uuid().safeParse(match[2]).success || (url.search && !activeCapture) || url.hash || !worker) return new Response("Not found",{status:404});
      const result=await ask("conceptImage",{projectId:match[1],conceptId:match[2]});
      if(!result.ok || !result.conceptImage || result.conceptImage.length>Math.ceil(MAX_CONCEPT_BYTES/3)*4) return new Response("Not found",{status:404});
      const bytes=Buffer.from(result.conceptImage,"base64");
      return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"image/png","Cache-Control":"no-store"}});
    }
    const root = resolve(runtime, "renderer");
    const target = resolve(root, "." + decodeURIComponent(url.pathname));
    if (url.hostname !== "app" || !target.startsWith(root + sep))
      return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(target).toString());
  });
  worker = utilityProcess.fork(
    join(runtime, "worker.cjs"),
    hidden ? ["--editor-test"] : [],
    { serviceName: "MineMod editor service", stdio: "pipe" },
  );
  worker.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  worker.on(
    "message",
    (message: {
      id: number;
      result: HostResponse;
      event?: string;
      job?: CaptureJob;
    }) => {
      if (message.event === "state") {
        if (window && !window.isDestroyed())
          window.webContents.send("studio:state", message.result);
        return;
      }
      if (message.event === "capture" && message.job) {
        void renderCapture(message.job, runtime);
        return;
      }
      const waiting = pending.get(message.id);
      if (waiting) {
        clearTimeout(waiting.timer);
        pending.delete(message.id);
        waiting.resolve(message.result);
      }
    },
  );
  worker.on("exit", () => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.resolve(unavailable());
    }
    pending.clear();
  });
  const initialized = await ask("init", {
    fixturePath: join(runtime, "example.json"),
    recoveryPath: join(app.getPath("userData"), "recovery.mmeditor.json"),
  });
  window = new BrowserWindow({
    title: "MineMod Studio",
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 760,
    show: false,
    backgroundColor: "#10151d",
    webPreferences: {
      preload: join(runtime, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: !hidden,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  app.on("second-instance", () => {
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  let firstInspect = true;
  const selectionSchema = z.strictObject({
    projectId: z.uuid(),
    cubeIds: z.array(z.string().max(80)).max(256),
  });
  ipcMain.handle("studio:selection", async (event, value: unknown) => {
    if (!trusted(event) || !selectionSchema.safeParse(value).success) return;
    await ask("selection", selectionSchema.parse(value));
  });
  ipcMain.on("studio:capture-ready", (event, id: unknown, failed: unknown = false) => {
    if (
      !captureWindow ||
      event.sender !== captureWindow.webContents ||
      event.senderFrame !== captureWindow.webContents.mainFrame ||
      !event.senderFrame.url.startsWith("studio://app/")
    )
      return;
    if (id === "loaded" && captureJob) {
      captureWindow.webContents.send("studio:capture", captureJob);
      return;
    }
    if (id !== captureJob?.id || typeof id !== "string") return;
    if (failed === true) { captureFailure(id); return; }
    if (failed !== false) return;
    void finishCapture(id);
  });
  ipcMain.handle("studio:request", (event, value: unknown) => {
    if (!trusted(event))
      return {
        ok: false,
        error: {
          code: "IPC_SENDER",
          message: "Недопустимый источник команды.",
        },
      };
    const text = JSON.stringify(value);
    const request = value as HostRequest;
    if (
      !text ||
      Buffer.byteLength(text) > MAX_COMMAND_BYTES ||
      typeof value !== "object" ||
      !value ||
      ![
        "inspect",
        "apply",
        "new",
        "example",
        "open",
        "save",
        "saveAs",
        "export",
        "connection",
        "repair",
        "conceptImport",
      ].includes(request.kind) ||
      Object.keys(value).sort().join(",") !==
        (request.kind === "apply"
          ? "kind,mutation"
          : request.kind === "connection"
            ? "action,kind"
            : request.kind === "repair" ? "control,kind"
            : request.kind === "conceptImport" ? "control,kind"
            : "kind") ||
      (request.kind === "connection" &&
        !["get", "start", "stop"].includes(request.action)) ||
      (request.kind === "apply" &&
        !MutationSchema.safeParse(request.mutation).success) ||
      (request.kind === "repair" && !RepairControlSchema.safeParse(request.control).success) ||
      (request.kind === "conceptImport" && !ConceptImportSchema.safeParse(request.control).success)
    ) {
      return {
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "Некорректный запрос редактора.",
        },
      };
    }
    const result = hostQueue.then(() => {
      if (firstInspect && request.kind === "inspect") {
        firstInspect = false;
        return initialized;
      }
      return handle(request);
    });
    hostQueue = result.catch(() => undefined);
    return result.catch(() => ({
      ok: false,
      error: {
        code: "HOST_ERROR",
        message: "Операция не выполнена. Предыдущие данные сохранены.",
      },
    }));
  });
  let closing = false;
  let closePending = false;
  window.on("close", (event) => {
    if (closing || (hidden && !testClose)) return;
    event.preventDefault();
    if (closePending) return;
    closePending = true;
    const result = hostQueue.then(async () => {
      const reference = await mayReplace();
      if (!reference) return;
      const confirmed = await ask("prepareClose", { reference });
      if (confirmed.ok) {
        closing = true;
        window.close();
      } else {
        window.webContents.send("studio:state", confirmed);
      }
    });
    hostQueue = result
      .catch(() => {
        if (!window.isDestroyed())
          window.webContents.send("studio:state", unavailable());
      })
      .finally(() => {
        closePending = false;
      });
  });
  if (!hidden) window.once("ready-to-show", () => window.show());
  await window.loadURL("studio://app/index.html");
  window.on("closed", () => {
    captureWindow?.destroy();
    app.quit();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => worker.kill());
}
function captureFailure(id: string): void {
  if (captureJob?.id !== id) return;
  clearTimeout(captureTimer);
  captureJob = undefined;
  captureWindow?.destroy();
  captureWindow = undefined;
  worker.postMessage({
    event: "capture-result",
    captureId: id,
    error: "CAPTURE_FAILED",
  });
}
async function renderCapture(job: CaptureJob, runtime: string): Promise<void> {
  if (captureJob) {
    worker.postMessage({
      event: "capture-result",
      captureId: job.id,
      error: "CAPTURE_BUSY",
    });
    return;
  }
  captureJob = job;
  captureTimer = setTimeout(() => captureFailure(job.id), 10_000);
  try {
    if (captureWindow && !captureWindow.isDestroyed()) {
      captureWindow.webContents.send("studio:capture", job);
      return;
    }
    captureWindow = new BrowserWindow({
      width: 1024,
      height: 768,
      useContentSize: true,
      frame: false,
      show: false,
      backgroundColor: "#10151d",
      webPreferences: {
        preload: join(runtime, "preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    captureWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    captureWindow.webContents.on("will-navigate", (event) =>
      event.preventDefault(),
    );
    await captureWindow.loadURL("studio://app/index.html?capture=1");
  } catch {
    captureFailure(job.id);
  }
}
async function finishCapture(id: string): Promise<void> {
  try {
    const image = await captureWindow!.webContents.capturePage(undefined, {
      stayHidden: true,
      stayAwake: true,
    });
    const png = image
      .resize({ width: 1024, height: 768 })
      .toPNG()
      .toString("base64");
    if (captureJob?.id !== id) return;
    clearTimeout(captureTimer);
    captureJob = undefined;
    worker.postMessage({ event: "capture-result", captureId: id, png });
  } catch {
    captureFailure(id);
  }
}
void boot().catch((error: unknown) => {
  process.stderr.write(String(error) + "\n");
  app.exit(1);
});

import { create } from "zustand";
import {
  cubes,
  type EditorCommand,
  type EditorState,
  type EditorProject,
  type GridStep,
} from "@mcdev/editor-core";
import type {
  HostRequest,
  HostResponse,
  ConnectionInfo,
} from "../shared/bridge.ts";
interface StudioUi {
  state: EditorState | null;
  selection: string[];
  hidden: string[];
  busy: boolean;
  note: string;
  error: string;
  warning: string;
  fileName: string;
  view: "perspective" | "front" | "side" | "back";
  grid: boolean;
  gridStep: 0 | GridStep;
  wire: boolean;
  frame: number;
  mode: "model" | "texture" | "variants" | "review";
  paintColor: string;
  paintFocus: boolean;
  draft: { projectId: string; revision: number; project: EditorProject } | null;
  connection: ConnectionInfo;
  receive: (result: HostResponse) => void;
  request: (
    request: HostRequest,
    options?: { requirePreviousSuccess: boolean },
  ) => Promise<HostResponse | null>;
  command: (command: EditorCommand) => Promise<void>;
  select: (ids: string[]) => void;
  toggleHidden: (partId: string) => void;
}
let requestQueue: Promise<HostResponse | null> = Promise.resolve(null);
let pendingRequests = 0;
let stateSequence = -1;
export const useStudio = create<StudioUi>((set, get) => ({
  state: null,
  selection: [],
  hidden: [],
  busy: false,
  note: "Локальная мастерская · ранняя версия",
  error: "",
  warning: "",
  fileName: "",
  view: "perspective",
  grid: true,
  gridStep: 0,
  wire: false,
  frame: 0,
  mode: "model",
  paintColor: "#e5c679",
  paintFocus: true,
  draft: null,
  connection: { enabled: false },
  select: (selection) => {
    set({ selection, draft: null });
    const projectId = get().state?.project.projectId;
    if (projectId)
      void window.studio.selection({ projectId, cubeIds: selection });
  },
  receive: (result) => {
    if (!result.ok) {
      set({ error: `${result.error.message} (${result.error.code})` });
      return;
    }
    if (result.sequence !== undefined) {
      if (result.sequence < stateSequence) return;
      stateSequence = result.sequence;
    }
    const previous = get().state;
    const switched =
      previous?.project.projectId !== result.state.project.projectId;
    if (!switched && previous && previous.revision > result.state.revision)
      return;
    const available = new Set(cubes(result.state.project).map((c) => c.id));
    const chosen = switched
      ? (result.state.project.parts.find((p) => p.id === "guard")?.cubeIds ??
        result.state.project.parts[0]?.cubeIds ??
        [])
      : get().selection.filter((id) => available.has(id));
    set({
      state: result.state,
      selection: chosen,
      ...(switched || previous?.revision !== result.state.revision
        ? { draft: null }
        : {}),
      ...(switched ? { hidden: [], fileName: "" } : {}),
      ...(result.note ? { note: result.note, error: "" } : {}),
      ...(result.warning !== undefined ? { warning: result.warning } : {}),
      ...(result.fileName ? { fileName: result.fileName } : {}),
      ...(result.connection ? { connection: result.connection } : {}),
    });
    void window.studio.selection({
      projectId: result.state.project.projectId,
      cubeIds: chosen,
    });
  },
  toggleHidden: (partId) =>
    set({
      hidden: get().hidden.includes(partId)
        ? get().hidden.filter((id) => id !== partId)
        : [...get().hidden, partId],
    }),
  request: async (request, options) => {
    pendingRequests++;
    set({ busy: true, error: "" });
    const operation = requestQueue.then(async (previous) => {
      try {
        // Сохранение после ввода не должно скрывать отказ его команды.
        if (options?.requirePreviousSuccess && !previous?.ok) return previous;
        const result = await window.studio.request(request);
        get().receive(result);
        return result;
      } catch {
        set({ error: "Не удалось связаться с сервисом редактора." });
        return null;
      } finally {
        pendingRequests--;
        set({ busy: pendingRequests > 0 });
      }
    });
    requestQueue = operation.catch(() => null);
    return operation;
  },
  command: async (command) => {
    const state = get().state;
    if (!state) return;
    await get().request({
      kind: "apply",
      mutation: {
        projectId: state.project.projectId,
        expectedRevision: state.revision,
        key: crypto.randomUUID(),
        commands: [command],
      },
    });
  },
}));

export async function saveProject(asNew = false): Promise<void> {
  const field = document.activeElement as HTMLElement | null;
  field?.blur();
  if (field?.dataset.commitError) return;
  const ui = useStudio.getState();
  await ui.request(
    { kind: asNew ? "saveAs" : "save" },
    { requirePreviousSuccess: ui.busy },
  );
}

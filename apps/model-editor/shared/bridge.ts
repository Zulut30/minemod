import type { EditorState, EditorProject, Mutation } from "@mcdev/editor-core";
export type View = "perspective" | "front" | "side" | "back";
export interface ConnectionInfo {
  enabled: boolean;
  url?: string;
  token?: string;
}
export interface CaptureJob {
  id: string;
  project: EditorProject;
  revision: number;
  view: View;
  referenceProject?: EditorProject;
  silhouette?: boolean;
  layout?: "review";
}
export type HostRequest =
  | {
      kind:
        | "inspect"
        | "new"
        | "example"
        | "open"
        | "save"
        | "saveAs"
        | "export";
    }
  | { kind: "apply"; mutation: Mutation }
  | { kind: "connection"; action: "get" | "start" | "stop" };
export type HostResponse =
  | {
      ok: true;
      state: EditorState;
      note?: string;
      warning?: string;
      sequence?: number;
      fileName?: string;
      connection?: ConnectionInfo;
    }
  | { ok: false; error: { code: string; message: string } };
export interface EditorBridge {
  request: (request: HostRequest) => Promise<HostResponse>;
  onState: (callback: (response: HostResponse) => void) => () => void;
  selection: (value: { projectId: string; cubeIds: string[] }) => Promise<void>;
  onCapture: (callback: (job: CaptureJob) => void) => () => void;
  captureReady: (id: string) => void;
}
declare global {
  interface Window {
    studio: EditorBridge;
  }
}

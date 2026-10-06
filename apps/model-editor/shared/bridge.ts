import type { EditorState, EditorProject, Mutation, RepairControl, ConceptImport } from "@mcdev/editor-core";
import type { AgentStatusMessage } from "./agent-status.ts";
import type { ArtReviewControl, ArtReviewSummary } from "./art-review.ts";
export const VIEWS = ["perspective", "front", "side", "back", "left", "right", "top", "bottom", "rear-perspective"] as const;
export type View = typeof VIEWS[number];
export interface ConnectionInfo {
  enabled: boolean;
  paused?: boolean;
  url?: string;
  token?: string;
  agentStatus?: AgentStatusMessage;
}
export interface CaptureJob {
  id: string;
  project: EditorProject;
  revision: number;
  view: View;
  referenceProject?: EditorProject;
  silhouette?: boolean;
  layout?: "review";
  conceptId?: string;
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
  | { kind: "repair"; control: RepairControl }
  | { kind: "conceptImport"; control: ConceptImport }
  | { kind: "artReview"; control: ArtReviewControl }
  | { kind: "connection"; action: "get" | "start" | "stop" | "pause" | "resume" };
export type HostResponse =
  | {
      ok: true;
      state: EditorState;
      note?: string;
      warning?: string;
      sequence?: number;
      fileName?: string;
      connection?: ConnectionInfo;
      conceptImage?: string;
      artReview?: ArtReviewSummary | null;
    }
  | { ok: false; error: { code: string; message: string } };
export interface EditorBridge {
  request: (request: HostRequest) => Promise<HostResponse>;
  onState: (callback: (response: HostResponse) => void) => () => void;
  onAgentStatus: (callback: (value: AgentStatusMessage) => void) => () => void;
  selection: (value: { projectId: string; cubeIds: string[] }) => Promise<void>;
  onCapture: (callback: (job: CaptureJob) => void) => () => void;
  captureReady: (id: string, failed?: boolean) => void;
}
declare global {
  interface Window {
    studio: EditorBridge;
  }
}

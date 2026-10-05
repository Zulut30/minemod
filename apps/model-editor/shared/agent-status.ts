export const AGENT_TOOL_LABELS = Object.freeze({
  studio_project_inspect: "Читает сцену",
  studio_selection_get: "Читает выделение",
  studio_variant_inspect: "Читает вариант",
  studio_changes_preview: "Проверяет правку",
  studio_changes_apply: "Применяет правку",
  studio_history_undo: "Отменяет свою правку",
  studio_asset_validate: "Проверяет экспорт",
  studio_view_capture: "Готовит снимок",
  studio_model_review: "Готовит обзор модели",
  studio_asset_export: "Готовит экспорт",
  unknown: "Запрос инструмента",
});
export type AgentTool = keyof typeof AGENT_TOOL_LABELS;
export type AgentStage = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export interface AgentOperation {
  id: string;
  tool: AgentTool;
  client: number | null;
  stage: AgentStage;
  enqueuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  elapsedMs: number;
  code: string | null;
}
export interface AgentConnectionStatus {
  available: boolean;
  access: "active" | "paused" | "off";
  notice?: "RATE_LIMIT" | "SESSION_LIMIT" | "SESSION_EXPIRED" | "CLIENT_DISCONNECTED" | null;
  sessions: { client: number; remainingRequests: number; limit: number; expiresAt: number }[];
  httpBudget: { remainingRequests: number; limit: number; resetAt: number };
}
export interface AgentStatus extends AgentConnectionStatus {
  queued: number;
  running: number;
  latest: AgentOperation | null;
  recent: AgentOperation[];
  usage: { source: "external-client-unavailable"; tokens: null; cost: null };
}
export interface AgentStatusMessage {
  sequence: number;
  status: AgentStatus;
}
export const MAX_AGENT_RECENT = 8;
export const MAX_AGENT_STATUS_BYTES = 8192;
export function emptyAgentStatus(available = true): AgentStatus {
  return {available, access: "off", notice: null, sessions: [],
    httpBudget: {remainingRequests: 0, limit: 0, resetAt: 0}, queued: 0, running: 0,
    latest: null, recent: [], usage: {source: "external-client-unavailable", tokens: null, cost: null}};
}

import {randomUUID} from "node:crypto";
import {Buffer} from "node:buffer";
import {
  MAX_AGENT_RECENT, MAX_AGENT_STATUS_BYTES,
  type AgentConnectionStatus, type AgentOperation, type AgentStatus, type AgentTool,
} from "../shared/agent-status.ts";

// Учёт только фактически наблюдаемых действий Studio: без prompts, payloads и секретов.
export class AgentMonitor {
  private active = new Map<string, AgentOperation>();
  private recent: AgentOperation[] = [];
  private context: () => AgentConnectionStatus;
  private changed: (status: AgentStatus) => void;
  private clock: () => number;
  constructor(context: () => AgentConnectionStatus,
    changed: (status: AgentStatus) => void = () => undefined,
    clock: () => number = () => Date.now()) {
    this.context = context; this.changed = changed; this.clock = clock;
  }

  snapshot(): AgentStatus {
    const now = this.clock();
    const active = [...this.active.values()];
    const running = active.filter(operation => operation.stage === "running");
    const latest = running[0] ?? active.at(-1) ?? this.recent[0] ?? null;
    const result: AgentStatus = {
      ...structuredClone(this.context()),
      queued: active.filter(operation => operation.stage === "queued").length,
      running: running.length,
      latest: latest ? {...latest, elapsedMs: Math.max(0, (latest.finishedAt ?? now) - latest.enqueuedAt)} : null,
      recent: structuredClone(this.recent),
      usage: {source: "external-client-unavailable", tokens: null, cost: null},
    };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_AGENT_STATUS_BYTES)
      throw new RangeError("Превышен размер статуса агента.");
    return result;
  }
  publish(): void {
    // Ошибка доставки статуса не должна прерывать атомарную правку сцены.
    try { this.changed(this.snapshot()); } catch { /* Сервис закрывается; состояние остаётся у владельца. */ }
  }
  begin(tool: AgentTool, client: number | null) {
    // HTTP допускает 8 обычных запросов; резерв оставляет место для закрытия и отмены.
    if (this.active.size >= 16) throw new RangeError("Переполнен учёт активных запросов.");
    const operation: AgentOperation = {
      id: randomUUID(), tool, client, stage: "queued", enqueuedAt: this.clock(),
      startedAt: null, finishedAt: null, elapsedMs: 0, code: null,
    };
    this.active.set(operation.id, operation);
    this.publish();
    let finished = false;
    const finish = (stage: "succeeded" | "failed" | "cancelled", code: string | null = null) => {
      if (finished) return;
      finished = true;
      this.active.delete(operation.id);
      operation.stage = stage;
      operation.finishedAt = Math.max(operation.startedAt ?? operation.enqueuedAt, this.clock());
      operation.elapsedMs = Math.max(0, operation.finishedAt - operation.enqueuedAt);
      operation.code = code === null ? null : /^[A-Z][A-Z0-9_]{0,47}$/u.test(code) ? code : "STUDIO_ERROR";
      this.recent.unshift(operation);
      this.recent = this.recent.slice(0, MAX_AGENT_RECENT);
      this.publish();
    };
    return {
      running: () => {
        if (finished) return;
        operation.stage = "running";
        operation.startedAt ??= Math.max(operation.enqueuedAt, this.clock());
        this.publish();
      },
      finish,
    };
  }
}

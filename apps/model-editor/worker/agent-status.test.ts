import assert from "node:assert/strict";
import {Buffer} from "node:buffer";
import {AgentMonitor} from "./agent-status.ts";
import {MAX_AGENT_RECENT, MAX_AGENT_STATUS_BYTES, type AgentConnectionStatus, type AgentStatus} from "../shared/agent-status.ts";
let now = 1000;
const context: AgentConnectionStatus = {
  available: true, access: "active", sessions: [{client: 1, remainingRequests: 1000, limit: 1024, expiresAt: 901000}],
  httpBudget: {remainingRequests: 119, limit: 120, resetAt: 61000},
};
const updates: AgentStatus[] = [];
const monitor = new AgentMonitor(() => context, status => {updates.push(status);}, () => now);
const image = monitor.begin("studio_view_capture", 1);
image.running();now += 100;
const edit = monitor.begin("studio_changes_apply", 1);
assert.equal(monitor.snapshot().running, 1);assert.equal(monitor.snapshot().queued, 1);
assert.equal(monitor.snapshot().latest!.tool, "studio_view_capture", "Выполняемый снимок виден, даже когда новая правка стоит в очереди");
const seen = monitor.snapshot();seen.sessions[0]!.remainingRequests = 0;seen.latest!.tool = "unknown";
assert.equal(monitor.snapshot().sessions[0]!.remainingRequests, 1000);assert.equal(monitor.snapshot().latest!.tool, "studio_view_capture");
image.finish("cancelled", "REQUEST_CANCELLED");now += 75;
assert.equal(monitor.snapshot().queued, 1);assert.equal(monitor.snapshot().running, 0);
edit.running();now += 25;edit.finish("succeeded");
const complete = monitor.snapshot();assert.equal(complete.latest!.elapsedMs, 100);assert.equal(complete.queued + complete.running, 0);
image.running();image.finish("failed", "STUDIO_ERROR");assert.deepEqual(monitor.snapshot(), complete, "Запоздавший ответ отменённого снимка не заменяет новую завершённую правку");
assert.deepEqual(complete.usage, {source: "external-client-unavailable", tokens: null, cost: null});
const bad = monitor.begin("unknown", null);bad.finish("failed", "private-token-must-not-be-echoed");
assert.equal(monitor.snapshot().latest!.code, "STUDIO_ERROR");assert(!JSON.stringify(updates).includes("private-token"));
for(let i=0;i<30;i++)monitor.begin("studio_project_inspect", 1).finish("succeeded");
assert.equal(monitor.snapshot().recent.length, MAX_AGENT_RECENT);assert(Buffer.byteLength(JSON.stringify(monitor.snapshot())) <= MAX_AGENT_STATUS_BYTES);
assert.equal(monitor.snapshot().recent.some(r => r.stage === "running" || r.stage === "queued"), false);
now -= 1000;const adjusted = monitor.begin("studio_selection_get", 1);now -= 1000;adjusted.finish("succeeded");assert.equal(monitor.snapshot().latest!.elapsedMs, 0);
const unavailable = new AgentMonitor(() => context, () => {throw new Error("Closed parent port");});
assert.doesNotThrow(() => unavailable.begin("studio_changes_apply", 1).finish("succeeded"));
assert(updates.some(s => s.latest?.stage === "running"));assert(updates.some(s => s.recent.some(r => r.stage === "cancelled")));
process.stdout.write("Agent monitor: queued/running cancellation, late-result isolation, immutable snapshots, bounded recent history, no payload echo and unknown external usage PASS\n");

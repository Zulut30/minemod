import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { EditorSession, projectFromAsset, type EditorCommand } from "@mcdev/editor-core";
import { startEditorMcp } from "./mcp.ts";
import { CONTRACT_URI, SCENE_URI, HUMAN_COMMANDS, STUDIO_LIMITS, AgentMutationSchema } from "./discovery.ts";

let session = new EditorSession(projectFromAsset(JSON.parse(await readFile(new URL(
  "../../../fixtures/assets/aurora-longsword-v2.item-asset.json", import.meta.url,
), "utf8")), randomUUID()));
let queue: Promise<unknown> = Promise.resolve();
const server = await startEditorMcp({
  inspect: () => session.state(), selection: () => session.state().project.parts[0]!.cubeIds,
  preview: (m) => session.preview(m), apply: async (m) => session.apply(m, "agent"),
  capture: async () => "", export: () => ({}),
  enqueue: (operation) => { const result = queue.then(operation); queue = result.catch(() => undefined); return result; },
});
const client = new Client({ name: "discovery-contract-test", version: "1" });
const headers = { Authorization: `Bearer ${server.token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
const read = async (uri: string) => {
  const result = await client.readResource({ uri });
  assert.equal(result.contents.length, 1);
  assert.equal(result.contents[0]!.mimeType, "application/json");
  const content = result.contents[0]!; assert("text" in content);
  assert(Buffer.byteLength(content.text) < STUDIO_LIMITS.responseBytes);
  return JSON.parse(content.text);
};
const mutation = (commands: unknown[]) => ({ projectId: session.state().project.projectId,
  expectedRevision: session.state().revision, key: randomUUID(), commands });
const call = async (name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  return { result, data: JSON.parse(content[0]!.text) };
};
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } }) as Transport);
  assert(client.getInstructions()!.includes(CONTRACT_URI));
  assert(client.getServerCapabilities()!.resources);
  const resources = (await client.listResources()).resources;
  assert.deepEqual(resources.map((r) => r.uri), [CONTRACT_URI, SCENE_URI]);
  const tools = (await client.listTools()).tools, contracts = await read(CONTRACT_URI);
  assert.equal(tools.length, 10);
  assert.equal(contracts.tools.length, tools.length);
  for (const tool of tools) {
    const declared = contracts.tools.find((t: { name: string }) => t.name === tool.name);
    assert.deepEqual(declared.inputSchema, tool.inputSchema, tool.name);
    assert.equal(declared.description, tool.description);
    assert.equal(declared.schemaId, tool._meta!["studio/schemaId"]);
    assert.equal(declared.readOnly, tool.annotations!.readOnlyHint);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  assert.equal(contracts.schemaDigest, createHash("sha256").update(JSON.stringify(contracts.tools)).digest("hex"));
  assert.deepEqual(contracts.limits, STUDIO_LIMITS);
  const previewSchema = contracts.tools.find((t: { name: string }) => t.name === "studio_changes_preview").inputSchema;
  const commandSchemas = previewSchema.properties.commands.items.oneOf ?? previewSchema.properties.commands.items.anyOf;
  const advertised = commandSchemas.map((s: { properties: { type: { const: string } } }) => s.properties.type.const);
  assert.deepEqual(advertised, contracts.agentCommands);
  // Реальный CLI пропускал preview из-за draft-7 items: [schema, ...].
  const byCommand = (name: string) => commandSchemas.find((s: { properties: { type: { const: string } } }) =>
    s.properties.type.const === name).properties;
  const tuples = [
    [byCommand("transform").translation, 3, "number"],
    [byCommand("transform").scale, 3, "number"],
    [byCommand("paint").points.items, 2, "integer"],
    [byCommand("fill").seed, 2, "integer"],
    [byCommand("uv").rect, 4, "integer"],
  ] as const;
  for (const [tuple, length, itemType] of tuples) {
    assert.equal(Array.isArray(tuple.items), false, "CLI must receive a single items schema.");
    assert.equal(tuple.items.type, itemType);
    assert.equal(tuple.minItems, length); assert.equal(tuple.maxItems, length);
  }
  assert.equal(byCommand("transform").scale.items.minimum, 0.01);
  assert.equal(byCommand("transform").scale.items.maximum, 20);
  assert.equal(byCommand("paint").points.maxItems, STUDIO_LIMITS.strokePoints);
  assert.equal(byCommand("paint").points.items.items.maximum, 255);
  assert.equal(byCommand("uv").rect.items.maximum, 256);
  const validTuples = [
    { type: "transform", cubeIds: ["test_cube"], translation: [0, 1, 2], scale: [1, 2, 3] },
    { type: "paint", cubeIds: ["test_cube"], color: "#112233", size: 1, points: [[0, 255]] },
    { type: "fill", cubeIds: ["test_cube"], color: null, seed: [0, 255] },
    { type: "uv", cubeId: "test_cube", face: "north", rect: [0, 0, 256, 256] },
  ];
  for (const command of validTuples) {
    const payload = mutation([command]);
    assert.equal(AgentMutationSchema.safeParse(payload).success, true);
    for (const [field, value] of Object.entries(command)) {
      if (!Array.isArray(value) || field === "cubeIds") continue;
      const nested = field === "points";
      const tuple = nested ? value[0] as number[] : value;
      for (const wrong of [tuple.slice(1), [...tuple, 0]]) {
        assert.equal(AgentMutationSchema.safeParse(mutation([{ ...command,
          [field]: nested ? [wrong] : wrong }])).success, false, `${command.type}/${field} length`);
      }
    }
  }
  assert.deepEqual(contracts.humanOnlyCommands, HUMAN_COMMANDS);
  for (const human of HUMAN_COMMANDS) assert(!advertised.includes(human));
  for (const required of ["pivot", "snap", "paint", "uv", "redo", "draftVariant"]) assert(advertised.includes(required));
  assert.equal(byCommand("draftVariant").label.maxLength,32);
  assert.equal(byCommand("draftVariant").note.maxLength,300);
  assert.equal(contracts.limits.agentDrafts,3);
  const initial = session.state(), scene = await read(SCENE_URI);
  assert.equal(scene.projectId, initial.project.projectId);
  assert.equal(scene.revision, initial.revision);
  assert.deepEqual(scene.parts, initial.project.parts);
  assert.deepEqual(scene.selection, initial.project.parts[0]!.cubeIds);
  assert.deepEqual(session.state(), initial);
  const sentinel = "secret-user-payload-not-to-be-echoed";
  const invalid = [
    ["studio_block_create", {}, "UNKNOWN_TOOL"],
    ["studio_project_inspect", { shell: sentinel }, "INVALID_ARGUMENTS"],
    ["studio_selection_get", { path: sentinel }, "INVALID_ARGUMENTS"],
    ["studio_changes_apply", { projectId: sentinel, proposalId: randomUUID() }, "INVALID_ARGUMENTS"],
    ["studio_changes_preview", mutation([{ type: "pivot", cubeIds: scene.cubeIds.slice(0, 1), axis: "x", value: 129 }]), "INVALID_ARGUMENTS"],
    ["studio_changes_preview", mutation([{ type: "snap", cubeIds: scene.cubeIds.slice(0, 1), step: 0.3 }]), "INVALID_ARGUMENTS"],
    ["studio_changes_preview", mutation([{ type: "rotate", cubeIds: scene.cubeIds.slice(0, 1), axis: "z", angle: 30 }]), "INVALID_ARGUMENTS"],
    ["studio_changes_preview", mutation([{ type: "paint", cubeIds: scene.cubeIds.slice(0, 1), color: "#fff000", size: 9, points: [[0, 0]] }]), "INVALID_ARGUMENTS"],
    ["studio_changes_preview", mutation([{ type: "eval", script: sentinel }]), "INVALID_ARGUMENTS"],
    ["studio_changes_preview", mutation([{ type: "draftVariant", variantId: randomUUID(), label: "A", project: sentinel }]), "INVALID_ARGUMENTS"],
    ["studio_changes_preview", mutation([{ type: "draftVariant", variantId: randomUUID(), label: "A", approval: sentinel }]), "INVALID_ARGUMENTS"],
    ["studio_changes_preview", mutation([{ type: "brief", text: sentinel }]), "HUMAN_ONLY"],
    ["studio_changes_preview", mutation([{ type: "lock", partId: scene.parts[0].id, locked: false }]), "LOCKED"],
    ["studio_changes_preview", mutation([{ type: "delete", cubeIds: ["invented_cube"] }]), "TARGET"],
    ["studio_changes_preview", { ...mutation([{ type: "undo" }]), expectedRevision: -1 }, "INVALID_ARGUMENTS"],
    ["studio_changes_preview", mutation(Array.from({ length: 33 }, () => ({ type: "undo" }))), "INVALID_ARGUMENTS"],
    ["studio_view_capture", { projectId: scene.projectId, expectedRevision: scene.revision, view: sentinel }, "INVALID_ARGUMENTS"],
  ] as const;
  for (const [name, args, code] of invalid) {
    const { result, data } = await call(name, args);
    assert.equal(result.isError, true); assert.equal(data.error.code, code);
    assert.deepEqual(result.structuredContent, { error: data.error });
    assert(data.error.recovery.action.length > 15);
    assert.equal(data.error.recovery.automaticRetry, false);
    assert(!JSON.stringify(result).includes(sentinel));
    assert(Buffer.byteLength(JSON.stringify(result)) < 8192);
    assert.deepEqual(session.state(), initial, name);
  }
  const many = await call("studio_changes_preview", mutation(Array.from({ length: 32 }, () => ({ type: "pivot", value: sentinel }))));
  assert.equal(many.data.error.details.issues.length, 8);
  assert.equal(many.data.error.details.truncated, true);
  assert(!JSON.stringify(many).includes(sentinel));
  const id = scene.parts.find((p: { locked: boolean }) => !p.locked).cubeIds[0];
  const command: EditorCommand = { type: "pivot", cubeIds: [id], axis: "x", value: 7.125 };
  const preview = await call("studio_changes_preview", mutation([command]));
  assert(!preview.result.isError); assert.deepEqual(session.state(), initial);
  session.apply(mutation([{ type: "pivot", cubeIds: [id], axis: "y", value: 11.125 }]) as Parameters<EditorSession["apply"]>[0]);
  const stale = await call("studio_changes_apply", { projectId: scene.projectId, proposalId: preview.data.proposalId });
  assert.equal(stale.data.error.code, "REVISION_CONFLICT");
  assert(stale.data.error.recovery.action.includes("новый preview"));
  const refreshed = await read(SCENE_URI); assert.equal(refreshed.revision, 1);
  const repaired = await call("studio_changes_preview", mutation([command]));
  await call("studio_changes_apply", { projectId: refreshed.projectId, proposalId: repaired.data.proposalId });
  assert.equal((await read(SCENE_URI)).revision, 2);
  const previousId = refreshed.projectId;
  session = new EditorSession({ ...session.state().project, projectId: randomUUID() });
  assert.notEqual((await read(SCENE_URI)).projectId, previousId);
  assert.equal((await read(CONTRACT_URI)).schemaDigest, contracts.schemaDigest);
  await assert.rejects(client.readResource({ uri: "file:///C:/Windows/system.ini" }));
  assert.equal((await fetch(server.url, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "resources/read", params: { uri: CONTRACT_URI } }) })).status, 401);
  process.stdout.write(`Studio discovery: exact ten SDK schemas, dynamic IDs/revision, ${invalid.length} rejected calls without payload echo, bounded recovery and repaired CAS PASS\n`);
} finally { await client.close(); server.close(); }

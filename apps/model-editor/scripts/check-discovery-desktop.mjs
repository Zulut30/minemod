/* global window, document */
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CONTRACT_URI, SCENE_URI } from "../worker/discovery.ts";

export async function checkDiscoveryDesktop(options, output) {
  const root = join(output, "discovery"); await mkdir(root, { recursive: true });
  const application = await electron.launch({ ...options, args: options.args.filter((v) => !v.startsWith("--editor-data="))
    .concat(`--editor-data=${join(root, "user-data")}`) });
  let client;
  try {
    const page = await application.firstWindow(); await page.getByTestId("part-guard").waitFor();
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    const inspect = async () => (await page.evaluate(() => window.studio.request({ kind: "inspect" }))).state;
    const connected = await page.evaluate(() => window.studio.request({ kind: "connection", action: "start" }));
    assert(connected.ok && connected.connection?.enabled);
    const connection = connected.connection;
    client = new Client({ name: "packaged-discovery-033", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(connection.url), {
      requestInit: { headers: { Authorization: `Bearer ${connection.token}` } },
    }));
    const read = async (uri) => JSON.parse((await client.readResource({ uri })).contents[0].text);
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      return { result, data: JSON.parse(result.content[0].text) };
    };
    const initial = await inspect(), tools = (await client.listTools()).tools, contract = await read(CONTRACT_URI);
    assert.deepEqual((await client.listResources()).resources.map((r) => r.uri), [CONTRACT_URI, SCENE_URI]);
    assert.equal(tools.length, 10);
    for (const tool of tools) assert.deepEqual(contract.tools.find((t) => t.name === tool.name).inputSchema, tool.inputSchema);
    assert.equal(contract.schemaDigest, createHash("sha256").update(JSON.stringify(contract.tools)).digest("hex"));
    const scene = await read(SCENE_URI);
    assert.equal(scene.projectId, initial.project.projectId); assert.equal(scene.revision, initial.revision);
    assert.deepEqual(scene.parts, initial.project.parts); assert.deepEqual(await inspect(), initial);
    await writeFile(join(root, "contract.json"), JSON.stringify(contract, null, 2) + "\n");
    await writeFile(join(root, "scene.json"), JSON.stringify(scene, null, 2) + "\n");
    const sentinel = "not-to-echo-private-request";
    const invented = await call("studio_generate_block", { prompt: sentinel });
    assert.equal(invented.data.error.code, "UNKNOWN_TOOL");
    const bad = await call("studio_changes_preview", { projectId: scene.projectId, expectedRevision: scene.revision,
      key: randomUUID(), commands: [{ type: "pivot", cubeIds: scene.cubeIds.slice(0, 1), axis: "x", value: sentinel }] });
    assert.equal(bad.data.error.code, "INVALID_ARGUMENTS");
    assert.equal(bad.data.error.details.schemaId, `${CONTRACT_URI}#studio_changes_preview`);
    assert(!JSON.stringify([bad, invented]).includes(sentinel));
    assert.deepEqual(await inspect(), initial);
    const guard = scene.parts.find((p) => p.id === "guard").cubeIds;
    const command = { type: "pivot", cubeIds: guard, axis: "x", value: 8.125 };
    const request = { projectId: scene.projectId, expectedRevision: scene.revision, key: randomUUID(), commands: [command] };
    const proposal = await call("studio_changes_preview", request); assert(!proposal.result.isError);
    assert.deepEqual(await inspect(), initial);
    // Ручное действие между preview/apply делает предложение устаревшим.
    assert((await page.evaluate((mutation) => window.studio.request({ kind: "apply", mutation }),
      { ...request, key: randomUUID(), commands: [{ ...command, axis: "y", value: 12.125 }] })).ok);
    const human = await inspect();
    const stale = await call("studio_changes_apply", { projectId: scene.projectId, proposalId: proposal.data.proposalId });
    assert.equal(stale.data.error.code, "REVISION_CONFLICT");
    assert.equal(stale.data.error.recovery.automaticRetry, false);
    assert.deepEqual(await inspect(), human);
    const fresh = await read(SCENE_URI); assert.equal(fresh.revision, human.revision);
    const fixed = await call("studio_changes_preview", { ...request, key: randomUUID(), expectedRevision: fresh.revision });
    const applied = await call("studio_changes_apply", { projectId: fresh.projectId, proposalId: fixed.data.proposalId });
    assert(!applied.result.isError); const after = await inspect();
    assert.equal(after.revision, human.revision + 1);
    assert.equal((await read(SCENE_URI)).revision, after.revision);
    const image = await client.callTool({ name: "studio_view_capture", arguments: { projectId: fresh.projectId,
      expectedRevision: after.revision, view: "front" } });
    assert(!image.isError); const png = Buffer.from(image.content.find((c) => c.type === "image").data, "base64");
    assert.equal(png.readUInt32BE(16), 1024); assert.equal(png.readUInt32BE(20), 768);
    await writeFile(join(root, "after-repaired-call.png"), png);
    await page.waitForFunction((revision) => document.querySelector('[data-testid="revision"]').textContent === `r${revision}`, after.revision);
    assert.deepEqual(await inspect(), after); assert.deepEqual(errors, []);
    assert(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((w) => !w.isVisible())));
    const report = { status: "PASS", hidden: true, toolCount: tools.length, publishedSchemasMatchSDK: true,
      contractDigest: contract.schemaDigest, dynamicIdsAndRevision: true, unknownToolRecovery: true,
      invalidInputWithoutPayloadEcho: true, rejectedCallsAtomic: true, actualHumanCasConflict: true,
      repairedPreviewApply: true, actualPng: { bytes: png.length, sha256: createHash("sha256").update(png).digest("hex") },
      independentModelTurn: false };
    await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2) + "\n"); return report;
  } finally { await client?.close(); await application.close(); }
}

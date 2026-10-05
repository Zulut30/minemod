/* global window, document */
import { _electron as electron } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import { readDesignBrief, cubes } from "@mcdev/editor-core";

export async function checkBriefDesktop(options, output) {
  const root = join(output, "brief"); await mkdir(root, {recursive: true});
  const launch = {...options, args: options.args.filter(a => !a.startsWith("--editor-data=") && a !== "--editor-test-close").concat(`--editor-data=${join(root,"user-data")}`)};
  let app = await electron.launch(launch), client;
  try {
    let page = await app.firstWindow(); await page.getByTestId("part-guard").waitFor();
    const inspect = async () => {const r = await page.evaluate(() => window.studio.request({kind:"inspect"}));assert(r.ok);return r.state;};
    const settled = () => page.waitForFunction(() => !document.querySelector('[data-testid="save-project"]').disabled);
    const path = join(root,"структурированный бриф.mmeditor.json");
    await app.evaluate(({dialog}, path) => {dialog.showSaveDialog=async()=>({canceled:false,filePath:path});dialog.showMessageBox=async()=>({response:1});},path);
    await page.getByTestId("lock-grip").click(); await settled();
    const original = await inspect();
    await page.getByTestId("mode-variants").click();
    await page.getByTestId("structured-brief-mode").click();
    await page.getByTestId("brief-purpose").fill("Короткий ледяной топор");
    await page.getByTestId("brief-silhouette").fill("Односторонняя широкая кромка и короткий обух");
    await page.getByTestId("brief-materials").fill("Лёд, сталь, кожа");
    await page.getByTestId("brief-palette").fill("#172333, #172333");
    await page.getByTestId("save-brief").click();
    await page.locator(".brief-error").waitFor(); assert.deepEqual(await inspect(), original);
    await page.getByTestId("brief-palette").fill("#172333, #b8e5ed, #e9f8ed");
    await page.getByTestId("save-brief").click(); await settled();
    const saved = await inspect(), brief = readDesignBrief(saved.project.design.brief); assert(brief);
    assert.equal(brief.purpose,"Короткий ледяной топор");assert.deepEqual(brief.preserve,["grip"]);
    for(const key of ["model","texturePlan","parts"])assert.deepEqual(saved.project[key],original.project[key]);
    await page.evaluate(()=>window.studio.request({kind:"connection",action:"start"}));
    const connection=await page.evaluate(()=>window.studio.request({kind:"connection",action:"get"}));
    client=new Client({name:"structured-brief-check",version:"1"});
    await client.connect(new StreamableHTTPClientTransport(new URL(connection.connection.url),{requestInit:{headers:{Authorization:`Bearer ${connection.connection.token}`}}}));
    const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});return {response:r,data:JSON.parse(r.content[0].text)};};
    const inspected=await call("studio_project_inspect");assert.deepEqual(inspected.data.project.design.structuredBrief,brief);
    const denied=await call("studio_changes_preview",{projectId:saved.project.projectId,expectedRevision:saved.revision,key:randomUUID(),commands:[{type:"designBrief",brief}]});
    assert(denied.response.isError);assert.equal(denied.data.error.code,"HUMAN_ONLY");assert.deepEqual((await inspect()).project,saved.project);
    await page.getByTestId("brief-purpose").fill("Сохранённое исправление человека");
    const preview=await call("studio_changes_preview",{projectId:saved.project.projectId,expectedRevision:saved.revision,key:randomUUID(),commands:[{type:"transform",cubeIds:["guard_center"],translation:[0.25,0,0],scale:[1,1,1]}]});
    assert(!preview.response.isError);
    const applied=await call("studio_changes_apply",{projectId:saved.project.projectId,proposalId:preview.data.proposalId});assert(!applied.response.isError);
    await page.getByTestId("refresh-brief-reference").waitFor();
    const concurrent=await inspect();
    await page.getByTestId("save-brief").click();await settled();
    await page.locator(".brief-error").waitFor();assert.deepEqual((await inspect()).project,concurrent.project);
    assert.equal(await page.getByTestId("brief-purpose").inputValue(),"Сохранённое исправление человека");
    await page.getByTestId("refresh-brief-reference").click();
    await page.getByTestId("save-brief").click(); await settled();
    const final=await inspect();assert.equal(readDesignBrief(final.project.design.brief).purpose,"Сохранённое исправление человека");
    for(const key of ["model","texturePlan","parts"])assert.deepEqual(final.project[key],concurrent.project[key]);
    await page.getByTestId("save-as").click(); await settled();
    const bytes=await readFile(path);assert.deepEqual(JSON.parse(bytes.toString("utf8")),final.project);
    const hidden=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible()));assert(hidden);
    const png=await app.evaluate(async({BrowserWindow})=>{const png=await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});return png.toPNG().toString("base64");});
    await writeFile(join(root,"structured-brief.png"),Buffer.from(png,"base64"));
    await client.close();client=undefined;await app.close();app=await electron.launch(launch);
    page=await app.firstWindow();await page.getByTestId("part-guard").waitFor();
    assert.deepEqual((await inspect()).project,final.project);
    await page.getByTestId("mode-variants").click();await page.getByTestId("brief-purpose").waitFor();
    assert.equal(await page.getByTestId("brief-purpose").inputValue(),"Сохранённое исправление человека");
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
    await page.getByTestId("new-project").click();await settled();
    const blank=await inspect();assert.notEqual(blank.project.projectId,final.project.projectId);assert.equal(cubes(blank.project).length,0);
    assert.equal(await page.getByTestId("design-brief").inputValue(),"");
    await page.getByTestId("structured-brief-mode").click();
    await page.getByTestId("brief-purpose").fill("Бриф до создания модели");
    await page.getByTestId("brief-silhouette").fill("Односторонний короткий топор");
    await page.getByTestId("brief-materials").fill("Лёд и кожа");
    await page.getByTestId("brief-palette").fill("#172333, #e9f8ed");
    await page.getByTestId("save-brief").click();await settled();
    const planned=await inspect();assert.equal(cubes(planned.project).length,0);
    assert.equal(readDesignBrief(planned.project.design.brief).purpose,"Бриф до создания модели");
    const report={status:"PASS",hidden,projectId:final.project.projectId,initialStructuredBrief:brief,
      finalStructuredBrief:readDesignBrief(final.project.design.brief),finalRevision:final.revision,
      newProjectBeforeGeneration:{projectId:planned.project.projectId,cubes:0,brief:readDesignBrief(planned.project.design.brief)},
      savedFile:{bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")},
      checks:["editable structured fields", "invalid palette preserves scene", "same brief reaches public MCP", "agent cannot replace brief",
        "concurrent agent edit rejects stale brief", "draft survives conflict", "explicit refresh preserves new geometry", "geometry/pixels/locks unchanged by brief",
        "exact saved project", "restart restores structured fields", "project switch resets draft", "editable brief in empty scene before geometry"]};
    await writeFile(join(root,"report.json"),JSON.stringify(report,null,2)+"\n");return report;
  } finally {await client?.close();await app.close();}
}

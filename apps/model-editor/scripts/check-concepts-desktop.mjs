/* global window, document, fetch, Image, structuredClone */
import { _electron as electron } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, readdir, cp } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { conceptFixture } from "./concept-fixture.mjs";
import { verifyAssetBundleV1 } from "../../../packages/application/asset-bundles.ts";
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
export async function checkConceptsDesktop(options,output) {
  const root=join(output,"concepts");await mkdir(root,{recursive:true});
  const bytes=conceptFixture(),source=join(root,"оригинальный PNG.png"),invalid=join(root,"повреждённый.png"),savedPath=join(root,"проект с концептом.mmeditor.json");
  await writeFile(source,bytes);await writeFile(invalid,Buffer.from("not a PNG"));
  const launch=data=>({...options,args:options.args.filter(a=>!a.startsWith("--editor-data=")).concat(`--editor-data=${data}`)});
  let app,client,page;
  const inspect=async()=>{const result=await page.evaluate(()=>window.studio.request({kind:"inspect"}));assert(result.ok);return result.state;};
  const request=value=>page.evaluate(value=>window.studio.request(value),value);
  const settled=()=>page.waitForFunction(()=>!document.querySelector('[data-testid="save-project"]').disabled);
  const openDialog=async path=>app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);
  const start=async(data)=>{app=await electron.launch(launch(data));page=await app.firstWindow();await page.getByTestId("part-guard").waitFor();await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});assert(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())));};
  const stop=async()=>{await client?.close();client=undefined;await app.close();app=undefined;};
  try {
    await start(join(root,"user-data"));const original=await inspect();
    await page.getByTestId("mode-variants").click();await page.getByTestId("concept-panel").locator("summary").first().click();
    assert(await page.getByTestId("concept-import").isDisabled());
    await page.getByTestId("concept-label").fill("Форма оружия · технический PNG");await page.getByTestId("concept-attribution").fill("Собственные тестовые пиксели");await page.getByTestId("concept-rights").fill("Собственная работа для проверки импорта");
    await page.getByTestId("concept-origin").selectOption("permission");assert(await page.getByTestId("concept-import").isDisabled());await page.getByTestId("concept-origin").selectOption("original");
    await page.getByTestId("concept-note").fill("Изображение-направление; не художественная приёмка");
    await openDialog(invalid);await page.getByTestId("concept-import").click();await settled();assert.deepEqual(await inspect(),original);
    assert.match(await page.getByTestId("status-message").textContent(),/CONCEPT_IMAGE/u);
    await openDialog(source);await page.getByTestId("concept-import").click();await settled();const added=await inspect(),concept=added.project.design.concepts[0];
    assert.equal(concept.sha256,hash(bytes));assert.equal(concept.bytes,bytes.length);assert.equal(concept.review,"direction-only");assert.deepEqual(added.project.model,original.project.model);assert.deepEqual(added.project.texturePlan,original.project.texturePlan);
    await page.getByTestId(`concept-${concept.id}`).locator("img").evaluate(img=>img.decode());
    const visibleText=await page.getByTestId("concept-panel").textContent();assert(visibleText.includes("2D направление"));
    const uri=`studio://app/concepts/${added.project.projectId}/${concept.id}.png`;
    const returned=await page.evaluate(async uri=>Array.from(new Uint8Array(await (await fetch(uri)).arrayBuffer())),uri);assert.deepEqual(Buffer.from(returned),bytes);
    const privateUri=uri.replace(concept.id,randomUUID());assert.equal(await page.evaluate(async uri=>(await fetch(uri)).status,privateUri),404);
    await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},savedPath);
    await page.getByTestId("save-project").click();await settled();assert.deepEqual(JSON.parse(await readFile(savedPath,"utf8")),added.project);
    const blobPath=join(savedPath+".assets","concepts",concept.sha256+".png");assert.deepEqual(await readFile(blobPath),bytes);
    const connection=await request({kind:"connection",action:"start"});client=new Client({name:"concepts-035-desktop",version:"1"});
    await client.connect(new StreamableHTTPClientTransport(new URL(connection.connection.url),{requestInit:{headers:{Authorization:`Bearer ${connection.connection.token}`}}}));
    const beforeCapture=await inspect(),capture=await client.callTool({name:"studio_view_capture",arguments:{projectId:added.project.projectId,expectedRevision:beforeCapture.revision,conceptId:concept.id}});
    assert.equal(capture.isError,undefined);const image=capture.content.find(c=>c.type==="image"),meta=JSON.parse(capture.content.find(c=>c.type==="text").text);assert.equal(meta.view,"concept");assert.equal(meta.renderedCubeCount,0);assert.equal(meta.concept.sha256,concept.sha256);const png=Buffer.from(image.data,"base64");assert.equal(png.readUInt32BE(16),1024);assert.equal(png.readUInt32BE(20),768);
    const pixels=await page.evaluate(async base64=>{const img=new Image();img.src=`data:image/png;base64,${base64}`;await img.decode();const canvas=document.createElement("canvas");canvas.width=img.width;canvas.height=img.height;const context=canvas.getContext("2d");context.drawImage(img,0,0);const data=context.getImageData(0,0,canvas.width,canvas.height).data;let cyan=0,gold=0;for(let i=0;i<data.length;i+=4){if(data[i]>90&&data[i]<135&&data[i+1]>190&&data[i+2]>200)cyan++;if(data[i]>200&&data[i+1]>140&&data[i+1]<190&&data[i+2]<100)gold++;}return {cyan,gold};},image.data);assert(pixels.cyan>100&&pixels.gold>100,"Returned MCP PNG must render actual concept pixels.");
    await writeFile(join(root,"mcp-concept.png"),png);assert.deepEqual(await inspect(),beforeCapture);
    assert(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())));
    const cacheBlob=join(root,"user-data","concepts",concept.sha256+".png");await writeFile(cacheBlob,conceptFixture({width:16,height:32}));
    const brokenCapture=await client.callTool({name:"studio_view_capture",arguments:{projectId:added.project.projectId,expectedRevision:beforeCapture.revision,conceptId:concept.id}});
    assert.equal(brokenCapture.isError,true);assert.equal(JSON.parse(brokenCapture.content.find(c=>c.type==="text").text).error.code,"CONCEPT_INTEGRITY");await writeFile(cacheBlob,bytes);assert.deepEqual(await inspect(),beforeCapture);
    await page.getByTestId(`concept-remove-${concept.id}`).click();await settled();assert.equal((await inspect()).project.design.concepts.length,0);assert.deepEqual(await readFile(blobPath),bytes);
    await page.locator(".variant-history").getByRole("button",{name:"Отмена",exact:true}).click();await settled();assert.deepEqual((await inspect()).project,added.project);
    const stale=await request({kind:"conceptImport",control:{projectId:added.project.projectId,expectedRevision:0,draft:{label:"Stale",role:"concept",origin:"original",attribution:"Test",rights:"Own",source:"",note:""}}});assert.equal(stale.ok,false);assert.equal(stale.error.code,"REVISION_CONFLICT");
    await openDialog(root);const exported=await request({kind:"export"});assert.equal(exported.ok,true);const directory=(await readdir(root)).find(n=>n.startsWith("item-"));assert(directory);const exportRoot=join(root,directory),bundle=JSON.parse(await readFile(join(exportRoot,"asset-bundle.v1.json"),"utf8"));verifyAssetBundleV1(bundle);assert(!JSON.stringify(bundle).includes(concept.sha256));assert.deepEqual(await readFile(join(exportRoot,"source.mmeditor.json.assets","concepts",concept.sha256+".png")),bytes);
    const screenshot=await app.evaluate(async({BrowserWindow})=>{const main=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes("capture=1"));return (await main.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString("base64");});await writeFile(join(root,"concept-panel.png"),Buffer.from(screenshot,"base64"));
    await stop();
    // Перенос только проекта и sidecar в чистый профиль без исходного cache.
    const transfer=join(root,"transfer");await mkdir(transfer);const moved=join(transfer,"перенесённый.json");await cp(savedPath,moved);await cp(savedPath+".assets",moved+".assets",{recursive:true});
    await start(join(root,"fresh-profile"));await openDialog(moved);const opened=await request({kind:"open"});assert.equal(opened.ok,true);assert.deepEqual(opened.state.project,added.project);
    const loaded=await page.evaluate(async uri=>Array.from(new Uint8Array(await (await fetch(uri)).arrayBuffer())),uri);assert.deepEqual(Buffer.from(loaded),bytes);
    const uppercase=structuredClone(added.project);uppercase.projectId=uppercase.projectId.toUpperCase();await writeFile(moved,JSON.stringify(uppercase));await openDialog(moved);const upperOpened=await request({kind:"open"});assert.equal(upperOpened.ok,true);assert.equal(upperOpened.state.project.projectId,uppercase.projectId);
    const upperPng=await page.evaluate(async uri=>Array.from(new Uint8Array(await (await fetch(uri)).arrayBuffer())),uri.replace(added.project.projectId,uppercase.projectId));assert.deepEqual(Buffer.from(upperPng),bytes);await writeFile(moved,JSON.stringify(added.project));await stop();
    const missingProfile=join(root,"missing-recovery");await mkdir(missingProfile);const missingRecovery=join(missingProfile,"recovery.mmeditor.json"),savedBytes=await readFile(savedPath);await writeFile(missingRecovery,savedBytes);await writeFile(missingRecovery+".bak",JSON.stringify(original.project));
    await start(missingProfile);const missingState=await request({kind:"inspect"});assert.match(missingState.warning,/Автосохранение остановлено/u);assert.notEqual(missingState.state.project.projectId,added.project.projectId);
    const change=await request({kind:"apply",mutation:{projectId:missingState.state.project.projectId,expectedRevision:missingState.state.revision,key:randomUUID(),commands:[{type:"brief",text:"Работа после защищённого восстановления"}]}});assert.equal(change.ok,true);assert.match(change.warning,/Автосохранение остановлено/u);assert.deepEqual(await readFile(missingRecovery),savedBytes);assert.deepEqual(JSON.parse(await readFile(missingRecovery+".bak","utf8")),original.project);await stop();
    // Повреждённый sidecar в ещё одном чистом профиле не заменяет рабочую сцену.
    await writeFile(join(moved+".assets","concepts",concept.sha256+".png"),conceptFixture({width:16,height:32}));await start(join(root,"corrupt-profile"));const beforeBad=await inspect();await openDialog(moved);const bad=await request({kind:"open"});assert.equal(bad.ok,false);assert.equal(bad.error.code,"CONCEPT_INTEGRITY");assert.deepEqual(await inspect(),beforeBad);assert.deepEqual(JSON.parse(await readFile(moved,"utf8")),added.project);
    const report={status:"PASS",hidden:true,projectVersion:added.project.schemaVersion,concept,originalBytes:bytes.length,originalSha256:hash(bytes),capture:{path:"mcp-concept.png",bytes:png.length,sha256:hash(png),pixels},checks:["GUI provenance and mandatory permission source", "invalid PNG is atomic", "original bytes and model/pixels preserved", "closed protocol IDs", "saved sidecar", "MCP original concept pixels and read-only scene", "corrupt original gives controlled capture failure", "all windows hidden", "human remove/undo keeps original", "stale import rejected", "concept excluded from game bundle", "exported editor source has sidecar", "fresh-profile transfer", "missing recovery PNG protects source and backup", "corrupt sidecar refuses open without replacing scene"]};
    await writeFile(join(root,"report.json"),JSON.stringify(report,null,2)+"\n");return report;
  } finally {await client?.close();if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>undefined);}
}

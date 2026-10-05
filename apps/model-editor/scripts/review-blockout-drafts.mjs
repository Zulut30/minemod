/* global window, document */
import { _electron as electron } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { comparisonFrame } from "../renderer/camera.ts";
const root=resolve(process.argv[2]??"output/model-editor/blockout-20261005-v1"),build=JSON.parse(await readFile("output/model-editor/latest-build.json","utf8"));
const authored=JSON.parse(await readFile(join(root,"authoring-report.json"),"utf8"));
assert(authored.files.length>=2&&authored.files.length<=3);
const output=join(root,"reviews-"+randomUUID().slice(0,8));await mkdir(output);
const application=await electron.launch({executablePath:build.executable,args:["--editor-hidden",`--editor-data=${join(output,"user-data")}`],env:Object.fromEntries(Object.entries(process.env).filter(([k,v])=>k!=="ELECTRON_RUN_AS_NODE"&&typeof v==="string")),timeout:45000});
let client;
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const capture=async(name,args,path)=>{const result=await client.callTool({name,arguments:args});assert(!result.isError,JSON.stringify(result));const image=result.content.find(c=>c.type==="image"),metadata=JSON.parse(result.content.find(c=>c.type==="text").text),bytes=Buffer.from(image.data,"base64");assert.equal(bytes.readUInt32BE(16),1024);assert.equal(bytes.readUInt32BE(20),768);await writeFile(join(output,path),bytes);return {path,bytes:bytes.length,sha256:sha(bytes),metadata};};
try {
  const page=await application.firstWindow();await page.getByTestId("part-guard").waitFor();
  await application.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
  const inspect=async()=>{const result=await page.evaluate(()=>window.studio.request({kind:"inspect"}));assert(result.ok);return result.state;};
  const reports=[];
  let selectionProof;
  for(const entry of authored.files) {
    const key=entry.variant;assert(/^[a-z]$/u.test(key));
    const source=join(root,key+".mmeditor.json");await application.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},source);
    const opened=await page.evaluate(()=>window.studio.request({kind:"open"}));assert(opened.ok);const before=await inspect();assert.equal(before.project.design.concepts.length,1);assert.equal(before.project.design.variants.length,authored.files.length);
    const connection=await page.evaluate(()=>window.studio.request({kind:"connection",action:"start"}));assert(connection.ok);client=new Client({name:"blockout-draft-review",version:"1"});
    await client.connect(new StreamableHTTPClientTransport(new URL(connection.connection.url),{requestInit:{headers:{Authorization:`Bearer ${connection.connection.token}`}}}));
    const ref={projectId:before.project.projectId,expectedRevision:before.revision};
    const review=await capture("studio_model_review",ref,key+"-review.png");
    const active=entry.variantId?before.project.design.variants.find(v=>v.id===entry.variantId):before.project.design.variants.find(v=>v.label===before.project.model.name);
    const reference=entry.referenceVariantId?before.project.design.variants.find(v=>v.id===entry.referenceVariantId):before.project.design.variants.find(v=>v.label.startsWith(key==="b"?"A":"B"));
    assert(active&&reference);
    const commonRef={...ref,variantId:active.id,compareToVariantId:reference.id};
    const views=[];for(const view of ["front","back","left","right","top","bottom","perspective","rear-perspective"])
      views.push(await capture("studio_view_capture",{...commonRef,view},key+"-"+view+".png"));
    const silhouette=await capture("studio_view_capture",{...commonRef,view:"front",silhouette:true},key+"-silhouette.png");
    assert.deepEqual(await inspect(),before,"All review captures preserve active project/history");
    assert(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())));
    reports.push({key,name:before.project.model.name,source,sourceSha256:sha(await readFile(source)),framing:comparisonFrame([active.project,reference.project]),review,views,silhouette,scenePreserved:true});
    if(entry===authored.files.at(-1)){
      await page.getByTestId("mode-variants").click();
      await page.getByLabel("Вариант для сравнения").selectOption(reference.id);
      await page.getByTestId("restore-variant").click();
      await page.waitForFunction(()=>!document.querySelector('[data-testid="save-project"]').disabled);
      const chosen=await inspect();
      for(const field of ["model","texturePlan","parts"])assert.deepEqual(chosen.project[field],reference.project[field]);
      assert.deepEqual(chosen.project.design,before.project.design);
      await page.locator(".variant-history").getByRole("button",{name:"Отмена",exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector('[data-testid="save-project"]').disabled);
      const restored=await inspect();assert.deepEqual(restored.project,before.project);
      selectionProof={status:"PASS",selectedVariantId:reference.id,projectRestored:true,revisionBefore:before.revision,revisionAfter:restored.revision,scriptedGuiOnly:true,humanArtisticApproval:false};
    }
    await client.close();client=undefined;
  }
  const allFramesEqual=reports.every(r=>JSON.stringify(r.framing)===JSON.stringify(reports[0].framing));
  const report={status:"DRAFT_RENDERED",studioVersion:build.version,package:build.executable,output,reports,selectionProof,allFramesEqual,commonFraming:"Each pair uses the union of active/reference geometry; allFramesEqual records whether the entire comparison shares one frame",artisticApproval:"NOT_PERFORMED",gameAcceptance:"NOT_RUN",generationBoundary:"Geometry authoring used editor-core agent commands; this run verifies actual read-only MCP captures and scripted GUI restore/undo, not independent CLI generation"};
  await writeFile(join(output,"report.json"),JSON.stringify(report,null,2)+"\n");
  const escape=value=>String(value).replace(/[&<>"']/gu,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const labels={front:"Спереди",back:"Сзади",left:"Слева",right:"Справа",top:"Сверху",bottom:"Снизу",perspective:"¾","rear-perspective":"¾ сзади",silhouette:"Силуэт",review:"Обзор и 32/64 px"};
  const title=reports.map(r=>escape(r.name)).join(" · ");
  const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
body{margin:0;padding:28px;background:#10151d;color:#e2e9f3;font:16px system-ui}h1{font-size:24px}p{color:#aab8c9;max-width:1100px;line-height:1.5}
nav{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0}button{background:#222d3b;color:#e2e9f3;border:1px solid #303d4d;border-radius:7px;padding:9px 15px;cursor:pointer}
button[aria-pressed=true]{background:#79d4c5;color:#102727}main{display:grid;grid-template-columns:repeat(${reports.length},minmax(0,1fr));gap:16px}
article{padding:14px;border:1px solid #303d4d;border-radius:10px;background:#19212c}img{width:100%;display:block;background:#10151d}a{color:#79d4c5}h2{font-size:18px}
@media(max-width:850px){main{grid-template-columns:1fr}}</style>
<h1>${title}</h1><p>Редактируемые 3D-черновики в нейтральном материале. Виды и силуэты сняты MCP; варианты каждой пары используют общий масштаб. Обзор показывает 32/64 px. Выбор направления и финальная художественная приёмка — отдельные решения.</p>
<nav>${Object.entries(labels).map(([v,label],i)=>`<button data-view="${v}" aria-pressed="${i===0}">${label}</button>`).join("")}</nav>
<main>${reports.map(r=>`<article><h2>${escape(r.name)}</h2><img data-key="${r.key}" src="${r.key}-front.png" alt="${escape(r.name)}"><p><a href="../${r.key}.mmeditor.json">Проект Studio</a> · <a href="${r.key}-review.png">Обзор PNG</a></p></article>`).join("")}</main>
<p>При переносе проекта возьмите одноимённую папку .assets. <a href="../concept-board.png">Исходный 2D-концепт</a>. Художественная приёмка и проверка в Minecraft ещё не выполнены.</p>
<script>document.querySelectorAll('button').forEach(b=>b.onclick=()=>{document.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));document.querySelectorAll('img[data-key]').forEach(i=>i.src=i.dataset.key+'-'+b.dataset.view+'.png')})</script></html>`;
  await writeFile(join(output,"comparison.html"),html);console.log(JSON.stringify({status:report.status,output,models:reports.length,captures:reports.length*10}));
} finally {await client?.close();await application.evaluate(({app})=>app.exit(0)).catch(()=>undefined);}

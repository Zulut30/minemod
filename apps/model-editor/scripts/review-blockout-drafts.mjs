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
const nativeIds=["silhouette-32","silhouette-64","color-32","color-64"];
const captureNative=async(key)=>{
  const capturePage=application.windows().find(p=>p.url().includes("capture=1"));
  assert(capturePage,"Нужно окно actual MCP review");
  const rasters=await capturePage.evaluate(async(ids)=>{
    const rows=[];
    for(const id of ids){
      const image=document.querySelector(`[data-testid="review-${id}"]`);
      await image.decode();
      const resolution=Number(id.split("-").at(-1)),rect=image.getBoundingClientRect();
      if(image.naturalWidth!==resolution||image.naturalHeight!==resolution||[rect.width,rect.height].some(n=>Math.abs(n*window.devicePixelRatio-resolution)>=0.1))
        throw new Error("Native preview должен иметь source/display 1:1");
      rows.push({id,png:image.src,width:resolution,height:resolution,display:[rect.width,rect.height],pixelRatio:window.devicePixelRatio});
      if(id.startsWith("color-")){
        const canvas=document.createElement("canvas");canvas.width=canvas.height=resolution;
        const context=canvas.getContext("2d");context.drawImage(image,0,0);
        context.globalCompositeOperation="source-in";context.fillStyle="#000000";context.fillRect(0,0,resolution,resolution);
        rows.push({id:`perspective-silhouette-${resolution}`,png:canvas.toDataURL(),width:resolution,height:resolution,display:null});
      }
    }
    return rows;
  },nativeIds);
  const entries=[];
  for(const raster of rasters){
    assert(raster.png.startsWith("data:image/png;base64,"));
    const bytes=Buffer.from(raster.png.split(",")[1],"base64"),path=`${key}-native-${raster.id}.png`;
    assert.equal(bytes.readUInt32BE(16),raster.width);assert.equal(bytes.readUInt32BE(20),raster.height);
    await writeFile(join(output,path),bytes);
    entries.push({id:raster.id,path,width:raster.width,height:raster.height,display:raster.display,pixelRatio:raster.pixelRatio??null,bytes:bytes.length,sha256:sha(bytes)});
  }
  return entries;
};
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
    const sourceSha256=sha(await readFile(source));
    const opened=await page.evaluate(()=>window.studio.request({kind:"open"}));assert(opened.ok);const before=await inspect();assert.equal(before.project.design.concepts.length,1);assert.equal(before.project.design.variants.length,authored.files.length);
    const connection=await page.evaluate(()=>window.studio.request({kind:"connection",action:"start"}));assert(connection.ok);client=new Client({name:"blockout-draft-review",version:"1"});
    await client.connect(new StreamableHTTPClientTransport(new URL(connection.connection.url),{requestInit:{headers:{Authorization:`Bearer ${connection.connection.token}`}}}));
    const ref={projectId:before.project.projectId,expectedRevision:before.revision};
    const active=entry.variantId?before.project.design.variants.find(v=>v.id===entry.variantId):before.project.design.variants.find(v=>v.label===before.project.model.name);
    const reference=entry.referenceVariantId?before.project.design.variants.find(v=>v.id===entry.referenceVariantId):before.project.design.variants.find(v=>v.label.startsWith(key==="b"?"A":"B"));
    assert(active&&reference);
    const commonRef={...ref,variantId:active.id,compareToVariantId:reference.id};
    const review=await capture("studio_model_review",commonRef,key+"-review.png");
    const native=await captureNative(key);
    const reviewCameras=await application.windows().find(p=>p.url().includes("capture=1")).evaluate(()=>
      [...document.querySelectorAll(".review-canvas canvas")].map(c=>JSON.parse(c.dataset.camera)));
    assert.deepEqual(reviewCameras.map(c=>c.view),["front","side","back","perspective"]);
    for(const camera of reviewCameras)assert.deepEqual(camera.target,comparisonFrame([active.project,reference.project]).center);
    const views=[];for(const view of ["front","back","left","right","top","bottom","perspective","rear-perspective"])
      views.push(await capture("studio_view_capture",{...commonRef,view},key+"-"+view+".png"));
    const silhouette=await capture("studio_view_capture",{...commonRef,view:"front",silhouette:true},key+"-silhouette.png");
    assert.deepEqual(await inspect(),before,"All review captures preserve active project/history");
    assert(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())));
    assert.equal(sha(await readFile(source)),sourceSha256,"Review не должен менять source file");
    reports.push({key,name:before.project.model.name,source,sourceSha256,framing:comparisonFrame([active.project,reference.project]),reviewCameras,review,views,silhouette,native,scenePreserved:true});
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
  const reviewCamerasEqual=reports.every(r=>JSON.stringify(r.reviewCameras)===JSON.stringify(reports[0].reviewCameras));
  if(allFramesEqual)assert(reviewCamerasEqual,"Общий framing должен совпадать и в фактических review cameras");
  const report={status:"DRAFT_RENDERED",studioVersion:build.version,package:build.executable,asarSha256:sha(await readFile(join(build.directory,"resources/app.asar"))),output,reports,selectionProof,allFramesEqual,reviewCamerasEqual,commonFraming:"Each pair uses the union of active/reference geometry; allFramesEqual records whether the entire comparison shares one frame",recognition:"NOT_PERFORMED",artisticApproval:"NOT_PERFORMED",gameAcceptance:"NOT_RUN",generationBoundary:"Geometry authoring used editor-core agent commands; this run verifies actual read-only MCP captures and scripted GUI restore/undo, not independent CLI generation"};
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
<p><a href="recognition.html">Проверка силуэтов 32/64 px без цвета и увеличения</a>. При переносе проекта возьмите одноимённую папку .assets. <a href="../concept-board.png">Исходный 2D-концепт</a>. Художественная приёмка и проверка в Minecraft ещё не выполнены.</p>
<script>document.querySelectorAll('button').forEach(b=>b.onclick=()=>{document.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));document.querySelectorAll('img[data-key]').forEach(i=>i.src=i.dataset.key+'-'+b.dataset.view+'.png')})</script></html>`;
  await writeFile(join(output,"comparison.html"),html);
  const recognition=reports.map((r,i)=>({code:`S${i+1}`,sourceSha256:r.sourceSha256,images:r.native.filter(n=>n.id.includes("silhouette"))}));
  const identity={schemaVersion:1,kind:"human-recognition-observation",studioVersion:build.version,asarSha256:report.asarSha256,reportSha256:sha(await readFile(join(output,"report.json"))),candidates:recognition,artisticApproval:"NOT_GRANTED",gameAcceptance:"NOT_RUN"};
  await writeFile(join(output,"recognition.html"),`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'">
<title>Читаемость силуэтов · 32/64 px</title><style>body{margin:0;padding:24px;background:#10151d;color:#e2e9f3;font:15px system-ui;line-height:1.5}main{max-width:1000px;margin:auto}h1{font-size:24px}p{color:#aab8c9}article{margin:20px 0;padding:18px;background:#19212c;border:1px solid #303d4d;border-radius:10px}.rasters{display:flex;flex-wrap:wrap;gap:16px}figure{margin:0;min-width:140px}figure div{width:80px;height:80px;display:grid;place-items:center;background:#e6edf5;border-radius:4px}img{display:block;image-rendering:pixelated}figcaption{font-size:12px;color:#aab8c9;margin-top:6px}label{display:block;margin-top:14px}input,textarea,select{box-sizing:border-box;width:100%;max-width:640px;padding:9px;background:#10151d;color:#e2e9f3;border:1px solid #526074;border-radius:5px;font:inherit}textarea{min-height:65px;resize:vertical}button{padding:10px 16px;background:#79d4c5;color:#102727;border:0;border-radius:6px;font:inherit;cursor:pointer}:focus-visible{outline:3px solid #79d4c5;outline-offset:3px}a{color:#79d4c5}</style>
<main><h1>Что читается в маленьком силуэте</h1><p>Каждый PNG показан 1:1: 32 или 64 физических пикселя с учётом масштаба экрана. Названия моделей и цвет здесь скрыты. Это предпросмотр редактора; размер в Minecraft и GUI transforms ещё не проверены. Знание исходного задания влияет на ответ — отметьте его ниже.</p>
<label>Что было известно до просмотра?<select id="exposure"><option value="known-project">Знаком с проектом или заданием</option><option value="unprimed">Не знал тип предмета и задание</option><option value="unknown">Не уверен</option></select></label>
${recognition.map(r=>`<article data-code="${r.code}"><h2>${r.code}</h2><div class="rasters">${r.images.map(n=>`<figure><div><img src="${escape(n.path)}" width="${n.width}" height="${n.height}" alt="${r.code}: ${n.id.startsWith("perspective")?"три четверти":"спереди"}, ${n.width} px"></div><figcaption>${n.id.startsWith("perspective")?"Три четверти":"Спереди"} · ${n.width} px</figcaption></figure>`).join("")}</div><label>Какой тип предмета вы видите?<input class="item-type" maxlength="200"></label><label>Какая отличительная форма заметна? В каком размере она теряется?<textarea class="trait" maxlength="1000"></textarea></label></article>`).join("")}
<p>Ответ фиксирует наблюдение человека. Он сам по себе не утверждает объём, текстуру или готовность модели.</p><button id="download">Сохранить ответы в JSON</button><p id="status" role="status"></p><p><a href="comparison.html">Полные виды и исходные проекты</a></p></main>
<script>const identity=${JSON.stringify(identity)};let media;const nativeSize=()=>{media?.removeEventListener('change',nativeSize);const ratio=window.devicePixelRatio;document.querySelectorAll('img').forEach(i=>{i.style.width=Number(i.getAttribute('width'))/ratio+'px';i.style.height=Number(i.getAttribute('height'))/ratio+'px'});media=matchMedia('(resolution: '+ratio+'dppx)');media.addEventListener('change',nativeSize)};nativeSize();document.getElementById('download').onclick=()=>{const answers=[...document.querySelectorAll('article')].map(a=>({code:a.dataset.code,itemType:a.querySelector('.item-type').value.trim(),distinctiveForm:a.querySelector('.trait').value.trim()}));if(answers.some(a=>!a.itemType||!a.distinctiveForm)){document.getElementById('status').textContent='Заполните тип и форму для каждого силуэта.';return}const payload={...identity,observedAt:new Date().toISOString(),pixelRatio:window.devicePixelRatio,priorBriefExposure:document.getElementById('exposure').value,answers};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)+'\\n'],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='silhouette-observation.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);document.getElementById('status').textContent='Ответы сохранены локально. Автоматическая оценка или approval не назначаются.'};</script></html>`);
  console.log(JSON.stringify({status:report.status,output,models:reports.length,captures:reports.length*16,recognition:"NOT_PERFORMED"}));
} finally {await client?.close();await application.evaluate(({app})=>app.exit(0)).catch(()=>undefined);}

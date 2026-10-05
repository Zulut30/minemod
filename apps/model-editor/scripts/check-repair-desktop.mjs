/* global window, document */
import { _electron as electron } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { textureMask, texturePixels } from "@mcdev/editor-core";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
export async function checkRepairDesktop(options, output) {
  const root = join(output,"repair");await mkdir(root,{recursive:true});
  const app = await electron.launch({...options,args:options.args.filter(a=>!a.startsWith("--editor-data="))
    .concat(`--editor-data=${join(root,"user-data")}`)});
  let client;
  try {
    const page = await app.firstWindow();await page.getByTestId("part-guard").waitFor();
    const inspect = async () => { const result = await page.evaluate(()=>window.studio.request({kind:"inspect"}));assert(result.ok);return result.state; };
    const settled = () => page.waitForFunction(()=>!document.querySelector('[data-testid="save-project"]').disabled);
    const initial = await inspect(), guard=initial.project.parts.find(p=>p.id==="guard"),grip=initial.project.parts.find(p=>p.id==="grip");
    // Настоящий ручной штрих через canvas до начала ремонта.
    await page.getByTestId("part-grip").click();await page.getByTestId("mode-texture").click();
    await page.getByLabel("Куб для UV").selectOption(grip.cubeIds[0]);await page.getByLabel("Грань текстуры").selectOption("north");
    await page.getByLabel("Масштаб текстуры").selectOption("4");
    const uv=initial.project.texturePlan.faces.find(f=>f.cubeId===grip.cubeIds[0]).uv.north;
    const x=Math.min(uv[0],uv[2]),y=Math.min(uv[1],uv[3]),width=initial.project.model.texture.width;
    const symbol=initial.project.texturePlan.rows[y][x],oldColor=initial.project.texturePlan.palette.find(c=>c.symbol===symbol)?.color;
    const color=initial.project.texturePlan.palette.find(c=>c.color!==oldColor).color;
    await page.getByTestId("brush-color").fill(color);
    await page.locator(".texture-scroll").evaluate((el,p)=>{el.scrollLeft=Math.max(0,p[0]-el.clientWidth/2);el.scrollTop=Math.max(0,p[1]-el.clientHeight/2);},[x*4,y*4]);
    const box=await page.getByTestId("paint-canvas").boundingBox();assert(box);
    await page.mouse.click(box.x+(x+0.5)*box.width/width,box.y+(y+0.5)*box.height/width);
    await page.waitForFunction(r=>document.querySelector('[data-testid="revision"]').textContent===`r${r}`,initial.revision+1);
    const painted=await inspect();assert.notDeepEqual(painted.project.texturePlan,initial.project.texturePlan);
    await page.getByTestId("mode-model").click();await page.getByTestId("part-guard").click();
    await page.getByTestId("repair-panel").locator("summary").click();
    await page.getByTestId("repair-note").fill("Укоротить гарду: сохранить рукоять и ручную покраску");
    await page.getByTestId("repair-limit").selectOption("2");await page.getByTestId("repair-start").click();await settled();
    const active=await inspect();assert.deepEqual(active.project,painted.project);assert.deepEqual(active.repair.partIds,[guard.id]);assert.equal(active.repair.maxIterations,2);
    await page.getByTestId("agent-toggle").click();await settled();
    const connection=await page.evaluate(()=>window.studio.request({kind:"connection",action:"get"}));assert(connection.ok && connection.connection.enabled);
    client=new Client({name:"targeted-repair-038",version:"1"});
    await client.connect(new StreamableHTTPClientTransport(new URL(connection.connection.url),{requestInit:{headers:{Authorization:`Bearer ${connection.connection.token}`}}}));
    const call=async(name,args={})=>{const result=await client.callTool({name,arguments:args});const text=result.content.find(c=>c.type==="text");return {result,data:text?JSON.parse(text.text):undefined};};
    const input=async commands=>{const s=await inspect();return {projectId:s.project.projectId,expectedRevision:s.revision,key:randomUUID(),commands};};
    const ref=async()=>{const s=await inspect();return {projectId:s.project.projectId,expectedRevision:s.revision};};
    const captures=[];
    const review=async name=>{const before=await inspect();const r=await call("studio_model_review",await ref());assert(!r.result.isError);
      const image=r.result.content.find(c=>c.type==="image");assert(image);const bytes=Buffer.from(image.data,"base64");assert(bytes.length>1000);
      await writeFile(join(root,name),bytes);captures.push({path:name,bytes:bytes.length,sha256:sha(bytes)});assert.deepEqual(await inspect(),before);};
    await review("before-review.png");
    const exportedBefore=(await call("studio_asset_export",{...await ref(),format:"bundle-v1"})).data.bundle;
    const originalPng=exportedBefore.files.find(f=>f.path.endsWith(".png"));assert(originalPng);
    const wrong=await call("studio_changes_preview",await input([{type:"transform",cubeIds:grip.cubeIds,translation:[0.125,0,0],scale:[1,1,1]}]));
    assert.equal(wrong.data.error.code,"REPAIR_SCOPE");assert.deepEqual(await inspect(),active);
    const move={type:"transform",cubeIds:guard.cubeIds,translation:[0,0,0],scale:[0.9,1,1]};
    for(let iteration=1;iteration<=2;iteration++) {
      const before=await inspect(), preview=await call("studio_changes_preview",await input([move]));assert(!preview.result.isError);
      assert.deepEqual(await inspect(),before);assert.equal(preview.data.repair.usedIterations,iteration);
      const apply={projectId:active.project.projectId,proposalId:preview.data.proposalId};assert(!(await call("studio_changes_apply",apply)).result.isError);
      const after=await inspect();assert.equal(after.repair.usedIterations,iteration);
      assert.deepEqual(after.project.texturePlan,painted.project.texturePlan);
      assert.deepEqual(after.project.model.bones.flatMap(b=>b.cubes).filter(c=>!guard.cubeIds.includes(c.id)),painted.project.model.bones.flatMap(b=>b.cubes).filter(c=>!guard.cubeIds.includes(c.id)));
      assert(!(await call("studio_changes_apply",apply)).result.isError);assert.deepEqual(await inspect(),after);
      await review(`after-${iteration}-review.png`);
    }
    assert.notEqual(captures[0].sha256,captures[2].sha256,"Actual rendered proportions must change");
    const denied=await call("studio_changes_preview",await input([move]));assert.equal(denied.data.error.code,"REPAIR_BUDGET");
    assert.equal((await call("studio_repair_reset")).result.isError,true);
    const exportedAfter=(await call("studio_asset_export",{...await ref(),format:"bundle-v1"})).data.bundle;
    assert.deepEqual(exportedAfter.files.find(f=>f.path.endsWith(".png")),originalPng,"Exported PNG must preserve the manual stroke exactly");
    await page.getByTestId("repair-budget").filter({hasText:"Осталось итераций: 0 из 2"}).waitFor();
    await page.getByTestId("repair-stop").click();await settled();assert.equal((await inspect()).repair,null);
    await page.getByTestId("repair-note").fill("Уточнить блик только на передней грани гарды");
    await page.getByTestId("repair-area").selectOption("texture");await page.getByTestId("repair-face").selectOption("north");
    await page.getByTestId("repair-limit").selectOption("1");await page.getByTestId("repair-start").click();await settled();
    const textureCase=await inspect();assert.equal(textureCase.repair.face,"north");
    const badFace=await call("studio_changes_preview",await input([{type:"paint",cubeIds:[guard.cubeIds[0]],face:"south",color,size:1,points:[[x,y]]}]));
    assert.equal(badFace.data.error.code,"REPAIR_SCOPE");assert.deepEqual(await inspect(),textureCase);
    const guardUv=textureCase.project.texturePlan.faces.find(f=>f.cubeId===guard.cubeIds[0]).uv.north;
    const point=[Math.min(guardUv[0],guardUv[2]),Math.min(guardUv[1],guardUv[3])];
    const oldPixel=texturePixels(textureCase.project)[point[1]*width+point[0]];
    const paintColor=textureCase.project.texturePlan.palette.find(c=>c.color.toLowerCase()!==oldPixel).color;
    const texturePreview=await call("studio_changes_preview",await input([{type:"paint",cubeIds:[guard.cubeIds[0]],face:"north",color:paintColor,size:1,points:[point]}]));
    assert(!texturePreview.result.isError);assert(!(await call("studio_changes_apply",{projectId:active.project.projectId,proposalId:texturePreview.data.proposalId})).result.isError);
    const actualPaint=await inspect(),allowed=textureMask(textureCase.project,guard.cubeIds,"north"),previousPixels=texturePixels(textureCase.project);
    assert.deepEqual(actualPaint.project.model,textureCase.project.model);
    assert(texturePixels(actualPaint.project).every((pixel,i)=>allowed[i]||pixel===previousPixels[i]));
    assert.notDeepEqual(actualPaint.project.texturePlan,textureCase.project.texturePlan);await review("material-review.png");
    await page.getByTestId("repair-stop").click();await settled();
    await page.getByTestId("repair-note").fill("Отразить рисунок передней грани гарды, сохранить остальные грани");
    await page.getByTestId("repair-area").selectOption("uv");await page.getByTestId("repair-face").selectOption("north");
    await page.getByTestId("repair-start").click();await settled();
    const uvCase=await inspect(),oldUv=uvCase.project.texturePlan.faces.find(f=>f.cubeId===guard.cubeIds[0]).uv.north;
    const uvPreview=await call("studio_changes_preview",await input([{type:"uv",cubeId:guard.cubeIds[0],face:"north",rect:[oldUv[2],oldUv[1],oldUv[0],oldUv[3]]}]));
    assert(!uvPreview.result.isError);assert(!(await call("studio_changes_apply",{projectId:active.project.projectId,proposalId:uvPreview.data.proposalId})).result.isError);
    assert.deepEqual((await inspect()).project.model,uvCase.project.model);await review("uv-review.png");
    const hidden=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible()));assert(hidden);
    const mainWindow=await app.browserWindow(page);
    const screenshot=await mainWindow.evaluate(async window=>(await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString("base64"));
    await writeFile(join(root,"repair-panel.png"),Buffer.from(screenshot,"base64"));
    const final=await inspect();const report={status:"PASS",hidden,projectId:final.project.projectId,captures,
      manualPng:{path:originalPng.path,sha256:sha(Buffer.from(originalPng.content,originalPng.encoding)),bytes:Buffer.from(originalPng.content,originalPng.encoding).length},finalProjectSha256:sha(JSON.stringify(final.project)),
      checks:["real human canvas stroke","human starts scoped case via UI","MCP discovers note/parts/budget","out-of-scope request rejected atomically",
        "preview preserves actual state and budget","two targeted HTTP geometry applies","accepted geometry and manual PNG unchanged",
        "exact replay spends no budget","actual multi-angle PNG before/after","third iteration rejected","agent cannot reset authorization",
        "UI shows exhausted budget","human ends and starts face-specific material task","wrong face rejected",
        "actual target face material paint preserves geometry/other pixels","actual scoped UV mirror preserves geometry","material and UV rendered reviews"]};
    await writeFile(join(root,"report.json"),JSON.stringify(report,null,2)+"\n");return report;
  } finally {await client?.close();await app.close();}
}

/* global window, document, AbortController */
import {_electron as electron} from "playwright";
import assert from "node:assert/strict";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {randomUUID,createHash} from "node:crypto";
import {Buffer} from "node:buffer";
import {URL} from "node:url";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export async function checkContinuationDesktop(options,output){
 const root=join(output,"continuation");await mkdir(root,{recursive:true});
 const launch={...options,args:options.args.filter(a=>!a.startsWith("--editor-data=")).concat(`--editor-data=${join(root,"user-data")}`)};
 let app=await electron.launch(launch),client,transport;
 const errors=[];
 try{
  let page=await app.firstWindow();page.on("pageerror",e=>errors.push(e.message));await page.getByTestId("part-guard").waitFor();
  const savedPath=join(root,"продолжение.mmeditor.json");
  await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});dialog.showMessageBox=async()=>({response:1});},savedPath);
  const inspect=async()=>{const r=await page.evaluate(()=>window.studio.request({kind:"inspect"}));assert(r.ok);return r.state;};
  const screenshot=async path=>{
    // Собственное скрытое окно: после закрытия capture compositor может хранить старый GUI frame.
    await app.evaluate(({BrowserWindow})=>{
      const main=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes("?capture="));
      const [width,height]=main.getSize();main.setSize(width+1,height);main.setSize(width,height);
    });
    const encoded=await app.evaluate(async({BrowserWindow})=>{
      const main=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes("?capture="));
      await main.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
      return (await main.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString("base64");
    });await writeFile(path,Buffer.from(encoded,"base64"));
  };
  await page.getByTestId("agent-settings").click();await page.getByTestId("agent-toggle").click();
  const connection=await page.evaluate(()=>window.studio.request({kind:"connection",action:"get"}));assert(connection.ok&&connection.connection.enabled);
  const connect=async()=>{client=new Client({name:"continuation-desktop-039",version:"1"});transport=new StreamableHTTPClientTransport(new URL(connection.connection.url),{requestInit:{headers:{Authorization:`Bearer ${connection.connection.token}`}}});await client.connect(transport);assert(transport.sessionId);};await connect();
  const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});return {result:r,body:JSON.parse(r.content.find(c=>c.type==="text").text)};};
  const scene=async()=>JSON.parse((await client.readResource({uri:"studio://scene/v1"})).contents[0].text);
  const initial=await inspect(),mutation={projectId:initial.project.projectId,expectedRevision:initial.revision,key:randomUUID(),commands:[{type:"add",cubeId:"continuation_cube"}]};
  const original=await call("studio_changes_preview",mutation);assert(!original.result.isError);

  // Только наш скрытый тестовый экземпляр: удерживаем native capture без ready ACK.
  await app.evaluate(({ipcMain})=>{globalThis.__continuationCaptureListeners=ipcMain.listeners("studio:capture-ready");ipcMain.removeAllListeners("studio:capture-ready");});
  const sdkWindowPromise=app.waitForEvent("window",{timeout:5000}),sdkAbort=new AbortController();
  const sdkCapture=client.callTool({name:"studio_view_capture",arguments:{projectId:initial.project.projectId,expectedRevision:initial.revision,view:"front"}},undefined,{signal:sdkAbort.signal});
  const sdkRejected=assert.rejects(sdkCapture);const sdkWindow=await sdkWindowPromise;const sdkClosed=sdkWindow.waitForEvent("close",{timeout:5000});sdkAbort.abort();await sdkRejected;await sdkClosed;
  assert.deepEqual((await inspect()).project,initial.project);assert.equal((await scene()).revision,initial.revision);
  const captureWindow=app.waitForEvent("window",{timeout:5000});
  const pendingCapture=call("studio_view_capture",{projectId:initial.project.projectId,expectedRevision:initial.revision,view:"front"});await captureWindow;
  await page.getByTestId("save-project").click();await page.waitForFunction(()=>document.querySelector('[data-testid="save-project"]').disabled);
  const requestedAt=Date.now();await page.getByTestId("agent-pause").click();
  const cancelled=await pendingCapture;const pauseMs=Date.now()-requestedAt;
  assert(cancelled.result.isError);assert.equal(cancelled.body.error.code,"REQUEST_CANCELLED");assert(pauseMs<5000,`Pause took ${pauseMs}ms`);
  await page.waitForFunction(()=>!document.querySelector('[data-testid="save-project"]').disabled);
  await page.getByTestId("agent-access-state").filter({hasText:"Пауза"}).waitFor();
  const paused=await inspect();assert.deepEqual(paused.project,initial.project);assert.equal(paused.revision,initial.revision);assert.equal(paused.dirty,false);
  assert.deepEqual(JSON.parse(await readFile(savedPath,"utf8")),initial.project);
  assert.equal((await scene()).agentAccess.state,"paused");
  const blocked=await call("studio_changes_apply",{projectId:initial.project.projectId,proposalId:original.body.proposalId});assert(blocked.result.isError);assert.equal(blocked.body.error.code,"AGENT_PAUSED");
  assert(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())));
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
  await screenshot(join(root,"paused-ui.png"));
  await app.evaluate(({ipcMain})=>{for(const listener of globalThis.__continuationCaptureListeners)ipcMain.on("studio:capture-ready",listener);delete globalThis.__continuationCaptureListeners;});

  await page.getByTestId("agent-pause").click();await page.getByTestId("agent-access-state").filter({hasText:"Доступ активен"}).waitFor();
  const resumed=await page.evaluate(()=>window.studio.request({kind:"connection",action:"get"}));assert(resumed.ok);assert.equal(resumed.connection.url,connection.connection.url);assert.equal(resumed.connection.token,connection.connection.token);assert.equal(resumed.connection.paused,false);
  const expired=await call("studio_changes_apply",{projectId:initial.project.projectId,proposalId:original.body.proposalId});assert(expired.result.isError);assert.equal(expired.body.error.code,"PROPOSAL_EXPIRED");
  const fresh=await call("studio_changes_preview",mutation);assert(!fresh.result.isError);assert(!(await call("studio_changes_apply",{projectId:initial.project.projectId,proposalId:fresh.body.proposalId})).result.isError);
  const applied=await inspect();assert.equal(applied.project.model.bones.flatMap(b=>b.cubes).filter(c=>c.id==="continuation_cube").length,1);
  await client.close();await connect();const live=await scene();assert.equal(live.revision,applied.revision);
  const replay=await call("studio_changes_preview",mutation);assert(!replay.result.isError);assert(!(await call("studio_changes_apply",{projectId:mutation.projectId,proposalId:replay.body.proposalId})).result.isError);assert.deepEqual(await inspect(),applied);
  const pngResult=await client.callTool({name:"studio_view_capture",arguments:{projectId:mutation.projectId,expectedRevision:applied.revision,view:"front"}});assert(!pngResult.isError);
  const png=Buffer.from(pngResult.content.find(c=>c.type==="image").data,"base64");assert.equal(png.readUInt32BE(16),1024);assert.equal(png.readUInt32BE(20),768);await writeFile(join(root,"after-resume.png"),png);
  const stale=await call("studio_changes_preview",{projectId:mutation.projectId,expectedRevision:applied.revision,key:randomUUID(),commands:[{type:"transform",cubeIds:["continuation_cube"],translation:[0.125,0,0],scale:[1,1,1]}]});assert(!stale.result.isError);
  const human=await page.evaluate(m=>window.studio.request({kind:"apply",mutation:m}),{projectId:mutation.projectId,expectedRevision:applied.revision,key:randomUUID(),commands:[{type:"brief",text:"Ручная правка после продолжения"}]});assert(human.ok);
  const conflict=await call("studio_changes_apply",{projectId:mutation.projectId,proposalId:stale.body.proposalId});assert(conflict.result.isError);assert.equal(conflict.body.error.code,"REVISION_CONFLICT");assert.deepEqual(await inspect(),human.state);

  const reopened=await page.evaluate(()=>window.studio.request({kind:"open"}));assert(reopened.ok);assert(reopened.state.revision>human.state.revision);assert.deepEqual(reopened.state.project,initial.project);
  const staleOpen=await call("studio_changes_preview",mutation);assert(staleOpen.result.isError);assert.equal(staleOpen.body.error.code,"REVISION_CONFLICT");
  await screenshot(join(root,"resumed-ui.png"));
  await page.getByTestId("agent-toggle").click();await page.getByTestId("agent-pause").waitFor({state:"detached"});assert.deepEqual((await inspect()).project,initial.project);
  await client.close();client=undefined;await app.close();app=await electron.launch(launch);page=await app.firstWindow();page.on("pageerror",e=>errors.push(e.message));await page.getByTestId("part-guard").waitFor();
  const restored=await inspect();assert.deepEqual(restored.project,initial.project);
  const off=await page.evaluate(()=>window.studio.request({kind:"connection",action:"get"}));assert(off.ok&&!off.connection.enabled);
  const next=await page.evaluate(()=>window.studio.request({kind:"connection",action:"start"}));assert(next.ok&&next.connection.enabled);assert.notEqual(next.connection.token,connection.connection.token);
  assert(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())));assert.deepEqual(errors,[]);
  const report={status:"PASS",hidden:true,actor:"Scripted GUI and SDK in own packaged app",independentModelTurn:false,pauseMs,sdkCancelledNativeCapture:true,sameSdkSessionAfterCancellation:true,cancelledNativeCapture:true,pauseBypassedBusySave:true,queuedSaveCompleted:true,pausedCallsRejected:true,endpointPreservedOnResume:true,expiredProposalRejected:true,reconnectReplay:true,humanCasConflict:true,sameProjectOpenRevisionProtected:true,restartSourcePreserved:true,restartAccessOff:true,newTokenAfterRestart:true,sourceSha256:createHash("sha256").update(await readFile(savedPath)).digest("hex"),png:{path:"after-resume.png",bytes:png.length,sha256:createHash("sha256").update(png).digest("hex")},replayBoundary:"Last 100 keys in current EditorSession; process restart cache is not persisted",artisticApproval:"NOT_PERFORMED",gameAcceptance:"NOT_RUN"};
  await writeFile(join(root,"report.json"),JSON.stringify(report,null,2)+"\n");return report;
 }finally{await client?.close();await app.close();}
}

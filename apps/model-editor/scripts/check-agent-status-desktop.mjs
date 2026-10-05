/* global window, document, AbortController, fetch */
import {_electron as electron} from "playwright";
import assert from "node:assert/strict";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {randomUUID,createHash} from "node:crypto";
import {Buffer} from "node:buffer";
import {URL} from "node:url";
import process from "node:process";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export async function checkAgentStatusDesktop(options,output) {
  const root=join(output,"agent-status");await mkdir(root,{recursive:true});
  const launch={...options,args:options.args.filter(a=>!a.startsWith("--editor-data=")&&a!=="--editor-test-close")
    .concat("--editor-test-close",`--editor-data=${join(root,"user-data")}`)};
  let app=await electron.launch(launch),client,transport;
  const errors=[];
  try {
    let page=await app.firstWindow();page.on("pageerror",error=>errors.push(error.message));await page.getByTestId("part-guard").waitFor();
    const inspect=async()=>{const result=await page.evaluate(()=>window.studio.request({kind:"inspect"}));assert(result.ok);return result.state;};
    const first=await inspect();
    const human=await page.evaluate(mutation=>window.studio.request({kind:"apply",mutation}),{
      projectId:first.project.projectId,expectedRevision:first.revision,key:randomUUID(),commands:[{type:"brief",text:"Проверка наблюдения за агентом: исходник сохраняется"}],
    });assert(human.ok);const initial=await inspect();
    await page.evaluate(()=>{window.__agentEvents=[];window.__agentUnsubscribe=window.studio.onAgentStatus(value=>window.__agentEvents.push(value));});
    await page.getByTestId("agent-settings").click();await page.getByTestId("agent-toggle").click();
    const response=await page.evaluate(()=>window.studio.request({kind:"connection",action:"get"}));assert(response.ok&&response.connection.enabled);
    const connection=response.connection;
    const connect=async()=>{
      client=new Client({name:"PRIVATE-client-name-040",version:"1"});
      transport=new StreamableHTTPClientTransport(new URL(connection.url),{requestInit:{headers:{Authorization:`Bearer ${connection.token}`}}});
      await client.connect(transport);
    };await connect();
    const captureArgs={projectId:initial.project.projectId,expectedRevision:initial.revision,view:"front"};
    const hold=()=>app.evaluate(({ipcMain})=>{globalThis.__agentAck=ipcMain.listeners("studio:capture-ready");ipcMain.removeAllListeners("studio:capture-ready");});
    const release=()=>app.evaluate(({ipcMain})=>{for(const listener of globalThis.__agentAck)ipcMain.on("studio:capture-ready",listener);delete globalThis.__agentAck;});
    const screenshot=async name=>{
      await page.getByTestId("agent-progress").scrollIntoViewIfNeeded();
      const encoded=await app.evaluate(async({BrowserWindow})=>{
        const main=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes("?capture="));
        const [width,height]=main.getSize();main.setSize(width+1,height);main.setSize(width,height);
        await main.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
        return (await main.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString("base64");
      });await writeFile(join(root,name),Buffer.from(encoded,"base64"));
    };
    await hold();const created=app.waitForEvent("window",{timeout:5000}),abort=new AbortController();
    const pending=client.callTool({name:"studio_view_capture",arguments:captureArgs},undefined,{signal:abort.signal});
    const rejected=assert.rejects(pending);const native=await created;
    await page.getByTestId("agent-operation").filter({hasText:"Выполняется · Готовит снимок"}).waitFor();
    const queued=client.callTool({name:"studio_project_inspect",arguments:{}});
    await page.getByTestId("agent-queue").filter({hasText:"Очередь: 1 · работа: 1"}).waitFor();
    await page.waitForFunction(()=>document.querySelector('[data-testid="agent-elapsed"]')?.textContent!=="0 с");
    const runningText=await page.getByTestId("agent-operation").textContent();await screenshot("queued-ui.png");
    const closed=native.waitForEvent("close",{timeout:5000});abort.abort();await rejected;await closed;
    assert(!(await queued).isError);await page.getByTestId("agent-operation").filter({hasText:"Завершено · Читает сцену"}).waitFor();
    await release();
    const capture=await client.callTool({name:"studio_view_capture",arguments:captureArgs});assert(!capture.isError);
    const png=Buffer.from(capture.content.find(c=>c.type==="image").data,"base64");assert.equal(png.readUInt32BE(16),1024);assert.equal(png.readUInt32BE(20),768);
    await writeFile(join(root,"native.png"),png);
    const malformed=await client.callTool({name:"studio_project_inspect",arguments:{privatePayload:"PRIVATE-request-payload-040"}});
    assert(malformed.isError);await page.getByTestId("agent-operation").filter({hasText:"Не выполнено · Читает сцену"}).waitFor();
    await page.getByTestId("agent-budget-details").locator("summary").click();
    await page.getByTestId("agent-usage").filter({hasText:"Токены: неизвестно · стоимость: неизвестно"}).waitFor();
    assert.match(await page.getByTestId("agent-local-budget").textContent(),/\/ 120/u);
    assert.match(await page.getByTestId("agent-session-budget").first().textContent(),/\/ 1024/u);
    await screenshot("status-ui.png");
    const expired=await fetch(connection.url,{method:"POST",headers:{Authorization:`Bearer ${connection.token}`,"Content-Type":"application/json",Accept:"application/json, text/event-stream","Mcp-Session-Id":randomUUID()},
      body:JSON.stringify({jsonrpc:"2.0",id:1,method:"resources/list"})});assert.equal(expired.status,404);
    await page.getByTestId("agent-notice").filter({hasText:"Подключитесь заново"}).waitFor();
    await transport.terminateSession();await client.close();await connect();
    assert(!(await client.callTool({name:"studio_project_inspect",arguments:{}})).isError);
    await page.getByTestId("agent-notice").waitFor({state:"detached"});
    assert.deepEqual((await inspect()).project,initial.project);
    const saved=join(root,"исходник.mmeditor.json");
    await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},saved);
    await page.getByTestId("save-project").click();await page.waitForFunction(()=>document.querySelector('[data-testid="status-message"]')?.textContent.includes("Проект сохранён"));
    assert.deepEqual(JSON.parse(await readFile(saved,"utf8")),initial.project);

    // Прерывается только utility process этого скрытого экземпляра, найденный через его app metrics.
    await hold();const crashWindow=app.windows().find(candidate=>candidate.url().includes("?capture=")) ?? app.waitForEvent("window",{timeout:5000});
    const crashCall=client.callTool({name:"studio_view_capture",arguments:captureArgs},undefined,{timeout:5000});const crashRejected=assert.rejects(crashCall);
    const orphan=await crashWindow;const orphanClosed=orphan.waitForEvent("close",{timeout:5000});
    await page.getByTestId("agent-operation").filter({hasText:"Выполняется"}).waitFor();
    const servicePid=await app.evaluate(({app})=>{
      const service=app.getAppMetrics().find(metric=>metric.type==="Utility"&&metric.name==="MineMod editor service");
      if(!service?.pid)throw new Error("Own editor service missing");
      return service.pid;
    });
    process.kill(servicePid);
    await orphanClosed;await crashRejected;
    await page.getByTestId("agent-operation").filter({hasText:"Сервис редактора недоступен"}).waitFor();
    assert(await page.getByTestId("agent-toggle").isDisabled());
    const started=Date.now();const unavailable=await page.evaluate(()=>window.studio.request({kind:"connection",action:"get"}));
    assert(!unavailable.ok);assert.equal(unavailable.error.code,"SERVICE_UNAVAILABLE");const unavailableMs=Date.now()-started;assert(unavailableMs<1000);
    await screenshot("service-unavailable-ui.png");
    assert.deepEqual(JSON.parse(await readFile(saved,"utf8")),initial.project);
    const events=await page.evaluate(()=>window.__agentEvents);
    assert(events.length>10);assert(events.every(event=>Object.keys(event).sort().join(",")==="sequence,status"));
    assert(events.every((event,index)=>index===0||event.sequence>=events[index-1].sequence));
    for(let index=1;index<events.length;index++)if(events[index].sequence===events[index-1].sequence)assert.deepEqual(events[index],events[index-1],"Повтор чтения после сбоя возвращает тот же snapshot");
    assert(events.every(event=>Buffer.byteLength(JSON.stringify(event.status))<=8192));
    const text=JSON.stringify(events);for(const secret of [connection.token,"PRIVATE-client-name-040","PRIVATE-request-payload-040"])assert(!text.includes(secret));
    assert(events.some(event=>event.status.running===1&&event.status.queued===1));
    assert(events.some(event=>event.status.recent.some(operation=>operation.stage==="cancelled")));
    assert(events.every(event=>event.status.usage.tokens===null&&event.status.usage.cost===null));
    assert.equal(events.at(-1).status.available,false);assert.equal(events.at(-1).status.running+events.at(-1).status.queued,0);
    assert(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())));
    await client.close();client=undefined;await app.close();
    app=await electron.launch(launch);page=await app.firstWindow();page.on("pageerror",error=>errors.push(error.message));await page.getByTestId("part-guard").waitFor();
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
    assert.deepEqual((await inspect()).project,initial.project);
    const restored=await page.evaluate(()=>window.studio.request({kind:"connection",action:"get"}));assert(restored.ok&&!restored.connection.enabled);assert(restored.connection.agentStatus.status.available);
    const next=await page.evaluate(()=>window.studio.request({kind:"connection",action:"start"}));assert(next.ok&&next.connection.enabled);assert.notEqual(next.connection.token,connection.token);
    assert.deepEqual(errors,[]);
    const report={status:"PASS",hidden:true,actor:"Own packaged app, scripted GUI and real SDK",runningText,metadataEvents:events.length,maxMetadataBytes:Math.max(...events.map(event=>Buffer.byteLength(JSON.stringify(event.status)))),
      realNativeCapture:true,queuedState:true,liveElapsed:true,cancelledRequestObserved:true,lateCancellationDoesNotReplaceSuccess:true,failedInputObserved:true,localBudgetsObserved:true,expiredSessionReconnect:true,
      noPayloadOrClientNameOrTokenInMetadata:true,unknownExternalUsage:true,sourcePreserved:true,workerFailureObserved:true,captureClosedOnWorkerExit:true,unavailableMs,restartSourcePreserved:true,restartAccessOff:true,
      source:{path:"исходник.mmeditor.json",sha256:createHash("sha256").update(await readFile(saved)).digest("hex")},png:{path:"native.png",sha256:createHash("sha256").update(png).digest("hex"),bytes:png.length},
      boundaries:{externalModelTurn:"NOT_RUN_THIS_POINT",artisticApproval:"NOT_PERFORMED",authoredGameAcceptance:"NOT_RUN"}};
    await writeFile(join(root,"report.json"),JSON.stringify(report,null,2)+"\n");return report;
  } catch(error) {
    await writeFile(join(root,"failure.json"),JSON.stringify({status:"FAIL",error:String(error),errors},null,2)+"\n");throw error;
  } finally {await client?.close();await app.close();}
}

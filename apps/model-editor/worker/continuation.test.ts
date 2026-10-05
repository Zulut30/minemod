import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {setTimeout,clearTimeout} from "node:timers";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {Transport} from "@modelcontextprotocol/sdk/shared/transport.js";
import {EditorSession,EditorError,projectFromAsset,cubes,type Mutation} from "@mcdev/editor-core";
import {startEditorMcp,type McpEditor} from "./mcp.ts";
import {SCENE_URI} from "./discovery.ts";
import {STUDIO_LIMITS} from "./discovery.ts";
import {Buffer} from "node:buffer";
import {MAX_AGENT_STATUS_BYTES, AGENT_TOOL_LABELS, type AgentStatus} from "../shared/agent-status.ts";

function deferred<T>() { let resolve!: (value:T)=>void; return {promise:new Promise<T>(r=>{resolve=r;}),resolve:(value:T)=>resolve(value)}; }
async function within<T>(promise:Promise<T>):Promise<T> {
  let timer:ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise,new Promise<T>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error("Continuation test timeout")),5000);})]); }
  finally { clearTimeout(timer!); }
}
const project=projectFromAsset(JSON.parse(await readFile(new URL("../../../fixtures/assets/aurora-longsword-v2.item-asset.json",import.meta.url),"utf8")),randomUUID());
let session=new EditorSession(project), queue:Promise<unknown>=Promise.resolve(),enqueued=0;
let gate: {entered:ReturnType<typeof deferred<void>>;release:ReturnType<typeof deferred<void>>}|undefined;
let captureEntered=deferred<void>(), captureAborted=deferred<void>(),captureCalls=0,captureAbortCalls=0;
const backend:McpEditor={
  inspect:()=>session.state(),selection:()=>[],preview:m=>session.preview(m),apply:async m=>session.apply(m,"agent"),
  capture:async (_state,_view,options)=>{
    assert(options?.signal);captureCalls++;captureEntered.resolve();
    return new Promise<string>((_resolve,reject)=>{
      const abort=()=>{captureAbortCalls++;captureAborted.resolve();reject(new EditorError("REQUEST_CANCELLED","Снимок отменён."));};
      if(options.signal!.aborted)abort();else options.signal!.addEventListener("abort",abort,{once:true});
    });
  },export:()=>{throw new Error("Not requested");},
  enqueue:operation=>{
    enqueued++;
    const waiting=gate;gate=undefined;
    const result=queue.then(async()=>{if(waiting){waiting.entered.resolve();await waiting.release.promise;}return operation();});
    queue=result.catch(()=>undefined);return result;
  },
};
const statuses:AgentStatus[]=[];
const observer={onStatus:(s:AgentStatus)=>{statuses.push(s);}};
let server=await startEditorMcp(backend,observer);
let client!:Client;
let transport!:StreamableHTTPClientTransport,cancellationObserved=deferred<void>();
const connect=async()=>{client=new Client({name:"continuation-039",version:"1"});transport=new StreamableHTTPClientTransport(new URL(server.url),{requestInit:{headers:{Authorization:`Bearer ${server.token}`}},fetch:async(input,init)=>{
  const response=await fetch(input,init);
  if(typeof init?.body==="string"&&JSON.parse(init.body).method==="notifications/cancelled")cancellationObserved.resolve();
  return response;
}});await client.connect(transport as Transport);assert(transport.sessionId);};
const body=(r:Awaited<ReturnType<Client["callTool"]>>)=>{
  const content=r.content as {type:string;text?:string}[];
  return JSON.parse(content.find(c=>c.type==="text")!.text!);
};
const call=(name:string,args:Record<string,unknown>)=>client.callTool({name,arguments:args});
const mutation=(commands:Mutation["commands"],key=randomUUID()):Mutation=>({projectId:session.state().project.projectId,expectedRevision:session.state().revision,key,commands});
const preview=async(m:Mutation)=>{const r=await call("studio_changes_preview",m);assert(!r.isError,JSON.stringify(body(r)));return body(r).proposalId as string;};
const apply=(proposalId:string)=>call("studio_changes_apply",{projectId:session.state().project.projectId,proposalId});
const scene=async()=>{const resource=(await client.readResource({uri:SCENE_URI})).contents[0]!;assert("text" in resource);return JSON.parse(resource.text);};
try{
  await connect();const initial=session.state(),url=server.url,token=server.token;
  const unused=await preview(mutation([{type:"add",cubeId:"unused_after_pause"}]));
  server.pause();assert.equal(server.url,url);assert.equal(server.token,token);assert.deepEqual(session.state(),initial);
  const paused=await call("studio_project_inspect",{});assert(paused.isError);assert.equal(body(paused).error.code,"AGENT_PAUSED");
  assert.equal((await scene()).agentAccess.state,"paused");server.resume();assert.equal((await scene()).agentAccess.state,"active");
  const expired=await apply(unused);assert(expired.isError);assert.equal(body(expired).error.code,"PROPOSAL_EXPIRED");assert.deepEqual(session.state(),initial);
  const original=mutation([{type:"add",cubeId:"reconnect_only_once"}]);assert(!(await apply(await preview(original))).isError);const applied=session.state();
  await client.close();await connect();assert.equal((await scene()).revision,applied.revision);
  assert(!(await apply(await preview(original))).isError);assert.deepEqual(session.state(),applied);assert.equal(cubes(applied.project).filter(c=>c.id==="reconnect_only_once").length,1);
  const changedKey=await call("studio_changes_preview",{...original,commands:[{type:"add",cubeId:"wrong_same_key"}]});assert(changedKey.isError);assert.equal(body(changedKey).error.code,"KEY_CONFLICT");
  const stale=await preview(mutation([{type:"add",cubeId:"stale_after_human"}]));session.apply(mutation([{type:"brief",text:"Ручная правка во время сеанса"}]),"human");const manual=session.state();
  const conflict=await apply(stale);assert(conflict.isError);assert.equal(body(conflict).error.code,"REVISION_CONFLICT");assert.deepEqual(session.state(),manual);
  const queuedProposal=await preview(mutation([{type:"add",cubeId:"cancel_queued_apply"}]));
  const blocked={entered:deferred<void>(),release:deferred<void>()};gate=blocked;
  const pending=apply(queuedProposal);await within(blocked.entered.promise);server.pause();server.resume();blocked.release.resolve();
  const cancelled=await within(pending);assert(cancelled.isError);assert.equal(body(cancelled).error.code,"REQUEST_CANCELLED");assert.deepEqual(session.state(),manual);
  captureEntered=deferred();captureAborted=deferred();
  const capture=call("studio_view_capture",{projectId:manual.project.projectId,expectedRevision:manual.revision,view:"front"});await within(captureEntered.promise);
  server.pause();await within(captureAborted.promise);const stoppedCapture=await within(capture);assert(stoppedCapture.isError);assert.equal(body(stoppedCapture).error.code,"REQUEST_CANCELLED");assert.deepEqual(session.state(),manual);server.resume();

  const clientProposal=await preview(mutation([{type:"add",cubeId:"sdk_cancelled_apply"}]));
  const sdkGate={entered:deferred<void>(),release:deferred<void>()};gate=sdkGate;cancellationObserved=deferred();
  const abortApply=new AbortController();const sdkQueued=client.callTool({name:"studio_changes_apply",arguments:{projectId:manual.project.projectId,proposalId:clientProposal}},undefined,{signal:abortApply.signal});
  const queuedRejected=assert.rejects(sdkQueued);await within(sdkGate.entered.promise);abortApply.abort();await within(queuedRejected);await within(cancellationObserved.promise);
  sdkGate.release.resolve();await queue;assert.deepEqual(session.state(),manual);
  captureEntered=deferred();captureAborted=deferred();cancellationObserved=deferred();
  const abortCapture=new AbortController();const sdkCapture=client.callTool({name:"studio_view_capture",arguments:{projectId:manual.project.projectId,expectedRevision:manual.revision,view:"front"}},undefined,{signal:abortCapture.signal});
  const captureRejected=assert.rejects(sdkCapture);await within(captureEntered.promise);abortCapture.abort();await within(captureRejected);await within(captureAborted.promise);await within(cancellationObserved.promise);await queue;
  assert.equal((await scene()).revision,manual.revision,"Тот же SDK-клиент продолжает работать после отмены");

  // Две MCP-сессии имеют одинаковые RPC IDs; notification клиента A не отменяет B.
  const sessionA=transport.sessionId!;const another=new Client({name:"continuation-isolation",version:"1"});
  const anotherTransport=new StreamableHTTPClientTransport(new URL(server.url),{requestInit:{headers:{Authorization:`Bearer ${server.token}`}}});await another.connect(anotherTransport as Transport);assert.notEqual(anotherTransport.sessionId,sessionA);
  const headers=(id:string)=>({Authorization:`Bearer ${server.token}`,"Content-Type":"application/json",Accept:"application/json, text/event-stream","Mcp-Session-Id":id});
  const rpc=(id:string,message:unknown)=>fetch(server.url,{method:"POST",headers:headers(id),body:JSON.stringify(message)});
  const request={jsonrpc:"2.0",id:902,method:"tools/call",params:{name:"studio_view_capture",arguments:{projectId:manual.project.projectId,expectedRevision:manual.revision,view:"front"}}};
  captureEntered=deferred();captureAborted=deferred();const first=rpc(sessionA,request);await within(captureEntered.promise);
  const duplicate=await rpc(sessionA,request);assert.equal(duplicate.status,409);
  const abortsBeforeWrong=captureAbortCalls;
  const wrong=await rpc(anotherTransport.sessionId!,{jsonrpc:"2.0",method:"notifications/cancelled",params:{requestId:902}});assert.equal(wrong.status,202);assert.equal(captureAbortCalls,abortsBeforeWrong);
  const oldCalls=captureCalls;const second=rpc(anotherTransport.sessionId!,request);
  const oldAborted=captureAborted;await rpc(sessionA,{jsonrpc:"2.0",method:"notifications/cancelled",params:{requestId:902}});await within(oldAborted.promise);assert.equal((await within(first)).status,202);
  captureAborted=deferred();
  await within((async()=>{while(captureCalls<oldCalls+1)await new Promise<void>(r=>setTimeout(r,5));})());
  const abortsBeforeCompleted=captureAbortCalls;
  await rpc(sessionA,{jsonrpc:"2.0",method:"notifications/cancelled",params:{requestId:902}});assert.equal(captureAbortCalls,abortsBeforeCompleted);assert.deepEqual(session.state(),manual);
  await rpc(anotherTransport.sessionId!,{jsonrpc:"2.0",method:"notifications/cancelled",params:{requestId:902}});await within(captureAborted.promise);assert.equal((await within(second)).status,202);await queue;
  const deletedId=anotherTransport.sessionId!;await anotherTransport.terminateSession();await another.close();assert.equal((await rpc(deletedId,{jsonrpc:"2.0",id:99,method:"resources/list"})).status,404);
  assert.equal((await rpc(randomUUID(),{jsonrpc:"2.0",id:99,method:"resources/list"})).status,404);

  // Все обычные slots заняты: служебный резерв всё равно пропускает cancellation.
  const saturatedBefore=enqueued;const saturated:Array<Promise<Response>>=[];
  for(let i=0;i<STUDIO_LIMITS.concurrentRequests;i++)saturated.push(rpc(sessionA,{...request,id:1000+i}));
  await within((async()=>{while(enqueued<saturatedBefore+STUDIO_LIMITS.concurrentRequests)await new Promise<void>(r=>setTimeout(r,5));})());
  assert.equal((await rpc(sessionA,{jsonrpc:"2.0",id:1100,method:"resources/list"})).status,429);
  for(let i=0;i<STUDIO_LIMITS.concurrentRequests;i++)assert.equal((await rpc(sessionA,{jsonrpc:"2.0",method:"notifications/cancelled",params:{requestId:1000+i}})).status,202);
  for(const response of await within(Promise.all(saturated)))assert.equal(response.status,202);
  await queue;assert.equal((await scene()).revision,manual.revision);assert.deepEqual(session.state(),manual);

  // Лимит числа сессий работает независимо от общей очереди и не меняет проект.
  const temporary:StreamableHTTPClientTransport[]=[];
  try {
    // Закрытый client.close() не означает DELETE; предыдущая reconnect-сессия всё ещё существует.
    for(let i=0;i<STUDIO_LIMITS.sessions-2;i++){
      const t=new StreamableHTTPClientTransport(new URL(server.url),{requestInit:{headers:{Authorization:`Bearer ${server.token}`}}});
      const c=new Client({name:"continuation-limit",version:"1"});await c.connect(t as Transport);temporary.push(t);
    }
    const denied=await fetch(server.url,{method:"POST",headers:headers(""),body:JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"overflow",version:"1"}}})});
    assert.equal(denied.status,400,"Пустой session header не принимается");
    const over=await fetch(server.url,{method:"POST",headers:{Authorization:`Bearer ${server.token}`,"Content-Type":"application/json",Accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"overflow",version:"1"}}})});assert.equal(over.status,429);
  }finally{for(const t of temporary){await t.terminateSession();await t.close();}}

  // Два stateless HTTP-клиента могут использовать один JSON-RPC id. Закрываем только их собственный response.
  const raw=(signal:AbortSignal)=>fetch(server.url,{method:"POST",headers:{Authorization:`Bearer ${server.token}`,"Content-Type":"application/json",Accept:"application/json, text/event-stream"},signal,body:JSON.stringify({jsonrpc:"2.0",id:901,method:"tools/call",params:{name:"studio_view_capture",arguments:{projectId:manual.project.projectId,expectedRevision:manual.revision,view:"front"}}})}).then(r=>r.json()).catch(()=>undefined);
  const a=new AbortController(),b=new AbortController();const rawExpected=captureCalls+2;captureEntered=deferred();captureAborted=deferred();const aRequest=raw(a.signal);await within(captureEntered.promise);
  const aAborted=captureAborted;const bRequest=raw(b.signal);a.abort();await within(aAborted.promise);
  captureEntered=deferred();captureAborted=deferred();
  // B уже в общей очереди; дождитесь его отдельного capture вместо отмены по общему RPC id.
  await within((async()=>{while(captureCalls<rawExpected)await new Promise<void>(r=>setTimeout(r,5));})());
  assert.equal(b.signal.aborted,false);b.abort();await within(captureAborted.promise);await within(Promise.all([aRequest,bRequest]));assert.deepEqual(session.state(),manual);
  await queue;
  // Новый runtime project с тем же сохранённым projectId не переиспользует revision=0.
  server.invalidate();session=new EditorSession(manual.project,manual.revision+1);
  const afterOpen=session.state();const oldRequest=await call("studio_changes_preview",original);assert(oldRequest.isError);assert.equal(body(oldRequest).error.code,"REVISION_CONFLICT");assert.deepEqual(session.state(),afterOpen);
  assert.throws(()=>new EditorSession(project,-1),RangeError);assert.throws(()=>new EditorSession(project,Number.MAX_SAFE_INTEGER+1),RangeError);
  server.close();await client.close();server=await startEditorMcp(backend,observer);await connect();assert.equal((await scene()).revision,afterOpen.revision);
  const resumed=mutation([{type:"add",cubeId:"new_connection"}]);assert(!(await apply(await preview(resumed))).isError);
  await client.close();server.close();server=await startEditorMcp(backend,observer);
  const boundedBefore=session.state();
  // Только тестовые часы: никакого production флага обхода limits или истечения сессии.
  const realNow=Date.now;let now=realNow();Date.now=()=>now;
  try {
    const initialize=async()=>{
      const response=await fetch(server.url,{method:"POST",headers:{Authorization:`Bearer ${server.token}`,"Content-Type":"application/json",Accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"bounded-lifetime",version:"1"}}})});
      assert.equal(response.status,200);await response.json();const id=response.headers.get("mcp-session-id");assert(id);return id;
    };
    const lifetime=await initialize();
    for(let i=1;i<STUDIO_LIMITS.sessionRequests;i++){
      if(i%100===0)now+=60_001;
      const response=await rpc(lifetime,{jsonrpc:"2.0",id:i+1,method:"resources/list"});assert.equal(response.status,200);await response.json();
    }
    assert.equal((await rpc(lifetime,{jsonrpc:"2.0",id:2000,method:"resources/list"})).status,429);
    assert.equal((await rpc(lifetime,{jsonrpc:"2.0",id:2001,method:"resources/list"})).status,404);
    const idle=await initialize();now+=STUDIO_LIMITS.sessionIdleSeconds*1000+1;
    assert.equal((await rpc(idle,{jsonrpc:"2.0",id:2,method:"resources/list"})).status,404);
    const fresh=await initialize();const last=await rpc(fresh,{jsonrpc:"2.0",id:2,method:"resources/list"});assert.equal(last.status,200);await last.json();
    assert.deepEqual(session.state(),boundedBefore);
  }finally{Date.now=realNow;}
  assert(statuses.some(s=>s.running===1&&s.queued>0),"Наблюдение различает выполняемый native adapter и очередь");
  for(const stage of ["succeeded","failed","cancelled"])assert(statuses.some(s=>s.recent.some(r=>r.stage===stage)),stage);
  for(const notice of ["RATE_LIMIT","SESSION_LIMIT","SESSION_EXPIRED","CLIENT_DISCONNECTED"])assert(statuses.some(s=>s.notice===notice),notice);
  assert(statuses.some(s=>s.sessions.some(c=>c.remainingRequests===0&&c.limit===1024)));
  assert(statuses.some(s=>s.access==="paused"));assert(statuses.some(s=>s.access==="off"));
  assert(statuses.every(s=>s.recent.length<=8&&s.usage.tokens===null&&s.usage.cost===null));
  assert(statuses.every(s=>Buffer.byteLength(JSON.stringify(s))<=MAX_AGENT_STATUS_BYTES));
  assert(statuses.every(s=>!s.latest||s.latest.tool in AGENT_TOOL_LABELS));
  assert(!JSON.stringify(statuses).includes(server.token));assert(!JSON.stringify(statuses).includes("Ручная правка во время сеанса"));
  assert.equal(server.status().notice,null,"Свежая сессия снимает старое сообщение о лимите");
  assert.equal(server.status().queued+server.status().running,0);
  process.stdout.write("Agent status over real HTTP/SDK: queue, cancellation, error, caps, reconnect, bounded private metadata and unknown external usage PASS\n");
  process.stdout.write("Studio continuation: pause/resume, SDK cancellation, same-id MCP/HTTP isolation, session count/lifetime/idle caps/DELETE, reconnect replay, stale human/open revisions and token restart PASS\n");
}finally{server.close();await client?.close();}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { EditorSession, projectFromAsset, type Concept } from "@mcdev/editor-core";
import { startEditorMcp } from "./mcp.ts";
import { SCENE_URI } from "./discovery.ts";
const project=projectFromAsset(JSON.parse(await readFile(new URL("../../../fixtures/assets/aurora-longsword-v2.item-asset.json",import.meta.url),"utf8")),randomUUID());
const concept: Concept={id:randomUUID(),label:"Контрольный концепт",role:"concept",origin:"original",attribution:"Own test",rights:"Own pixels",source:"",note:"Not art approval",mime:"image/png",sha256:"a".repeat(64),bytes:100,width:32,height:64,review:"direction-only"};
project.design={brief:"Read concept before geometry",variants:[],concepts:[concept]};const session=new EditorSession(project);
let queue:Promise<unknown>=Promise.resolve(),captured:unknown;
const server=await startEditorMcp({inspect:()=>session.state(),selection:()=>[],preview:m=>session.preview(m),apply:async m=>session.apply(m,"agent"),
  capture:async(_state,_view,options)=>{captured=options;return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";},export:()=>({}),
  enqueue:operation=>{const result=queue.then(operation);queue=result.catch(()=>undefined);return result;}});
const client=new Client({name:"concept-contract-test",version:"1"});
const ref=()=>({projectId:project.projectId,expectedRevision:session.state().revision});
const call=async(name:string,args:Record<string,unknown>)=>{const result=await client.callTool({name,arguments:args});const content=result.content as {type:string;text?:string}[];return {result,data:JSON.parse(content.find(c=>c.type==="text")!.text!)};};
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url),{requestInit:{headers:{Authorization:`Bearer ${server.token}`}}}) as Transport);
  const initial=session.state();const inspected=await call("studio_project_inspect",{});assert.deepEqual(inspected.data.project.design.concepts,[concept]);
  const resource=await client.readResource({uri:SCENE_URI});const text=resource.contents[0]!;assert("text" in text);assert.deepEqual(JSON.parse(text.text).concepts,[concept]);
  const view=await call("studio_view_capture",{...ref(),conceptId:concept.id});assert.equal(view.result.isError,undefined);assert.equal(view.data.view,"concept");assert.equal(view.data.renderedCubeCount,0);assert.deepEqual(view.data.concept,concept);assert.deepEqual(captured,{conceptId:concept.id});assert.deepEqual(session.state(),initial);
  const sentinel="private-file-must-not-be-echoed";
  for(const [args,code] of [[{...ref(),conceptId:randomUUID()},"CONCEPT_NOT_FOUND"],[{...ref(),conceptId:concept.id,silhouette:true},"CONCEPT_NOT_FOUND"],
    [{...ref(),conceptId:concept.id,variantId:randomUUID()},"CONCEPT_NOT_FOUND"],[{...ref(),conceptId:concept.id,compareToVariantId:randomUUID()},"CONCEPT_NOT_FOUND"],
    [{...ref(),conceptId:concept.id,expectedRevision:1},"REVISION_CONFLICT"],[{...ref(),conceptId:concept.id,path:sentinel},"INVALID_ARGUMENTS"]] as const) {
    const rejected=await call("studio_view_capture",args);assert.equal(rejected.result.isError,true);assert.equal(rejected.data.error.code,code);assert(!JSON.stringify(rejected.result).includes(sentinel));assert.deepEqual(session.state(),initial);
  }
  for(const command of [{type:"conceptAdd",concept},{type:"conceptRemove",conceptId:concept.id}]) {
    const rejected=await call("studio_changes_preview",{...ref(),key:randomUUID(),commands:[command]});assert.equal(rejected.result.isError,true);assert.equal(rejected.data.error.code,"HUMAN_ONLY");assert.deepEqual(session.state(),initial);
  }
} finally { await client.close();server.close(); }
process.stdout.write("Concept MCP: discovery, bounded read-only capture, stale/mixed/unknown refs, privacy and human-only mutations PASS\n");

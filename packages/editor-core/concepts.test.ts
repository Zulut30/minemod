import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { EditorSession, ConceptDraftSchema, ConceptDescriptorSchema, assetRequest, projectFromAsset, parseProject, type Concept, type EditorCommand } from "./index.ts";
const original=projectFromAsset(JSON.parse(await readFile(new URL("../../fixtures/assets/aurora-longsword-v2.item-asset.json",import.meta.url),"utf8")),randomUUID());
const session=new EditorSession(original);
const concept: Concept={id:randomUUID(),label:"Силуэт оружия",role:"concept",origin:"original",attribution:"Автор проекта",rights:"Собственная работа",source:"",note:"Сохранить контрастную гарду",mime:"image/png",sha256:"a".repeat(64),bytes:100,width:32,height:64,review:"direction-only"};
const mutation=(commands:EditorCommand[])=>({projectId:original.projectId,expectedRevision:session.state().revision,key:randomUUID(),commands});
const add: EditorCommand={type:"conceptAdd",concept};
for(const command of [add,{type:"conceptRemove",conceptId:concept.id} as EditorCommand]) {
  const before=session.state();assert.throws(()=>session.apply(mutation([command]),"agent"),{code:"HUMAN_ONLY"});assert.deepEqual(session.state(),before);
}
const stale=mutation([add]);session.apply(mutation([{type:"brief",text:"Согласованный силуэт"}]),"human");
assert.throws(()=>session.apply(stale,"human"),{code:"REVISION_CONFLICT"});
const before=session.state();session.apply(mutation([add]),"human");
assert.deepEqual(session.state().project.model,before.project.model);assert.deepEqual(session.state().project.texturePlan,before.project.texturePlan);
assert.equal(session.state().project.design!.brief,"Согласованный силуэт");
assert.deepEqual(assetRequest(session.state().project),assetRequest(before.project),"Concept metadata cannot enter exported game assets.");
const added=session.state();
for(const duplicate of [concept,{...concept,id:randomUUID()},{...concept,sha256:"b".repeat(64)}]) {
  assert.throws(()=>session.apply(mutation([{type:"conceptAdd",concept:duplicate}]),"human"),{code:"CONCEPT_DUPLICATE"});assert.deepEqual(session.state(),added);
}
assert.throws(()=>session.apply(mutation([{type:"conceptRemove",conceptId:randomUUID()}]),"human"),{code:"CONCEPT_NOT_FOUND"});
session.apply(mutation([{type:"conceptRemove",conceptId:concept.id}]),"human");assert.equal(session.state().project.design!.concepts!.length,0);
session.apply(mutation([{type:"undo"}]),"human");assert.deepEqual(session.state().project,added.project);
assert.throws(()=>session.apply(mutation([{type:"undo"}]),"agent"),{code:"HUMAN_HISTORY"});
session.apply(mutation([{type:"redo"}]),"human");assert.equal(session.state().project.design!.concepts!.length,0);
for(let i=0;i<3;i++)session.apply(mutation([{type:"conceptAdd",concept:{...concept,id:randomUUID(),sha256:String(i).repeat(64)}}]),"human");
const full=session.state();assert.throws(()=>session.apply(mutation([add]),"human"),{code:"CONCEPT_LIMIT"});assert.deepEqual(session.state(),full);
assert.deepEqual(parseProject(JSON.stringify(full.project)),full.project);
for(const value of [{...concept,origin:"permission",source:""},{...concept,width:4097},{...concept,width:4096,height:4096},
  {...concept,bytes:8_388_609},{...concept,rights:""},{...concept,review:"approved"},{...concept,path:"C:/private.png"}])
  assert.equal(ConceptDescriptorSchema.safeParse(value).success,false);
assert.equal(ConceptDraftSchema.safeParse({...concept,id:undefined}).success,false,"Draft rejects descriptors and unknown fields.");
process.stdout.write("Concepts: human ownership, CAS, undo, strict limits, original model/pixels and game asset separation PASS\n");

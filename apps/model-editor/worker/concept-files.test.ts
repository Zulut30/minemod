import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, lstat } from "node:fs/promises";
import { join, dirname, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { ConceptStore, checkConceptPng, readConceptFile } from "./concept-files.ts";
import { projectFromAsset, type Concept } from "@mcdev/editor-core";
import { conceptFixture, pngChunk } from "../scripts/concept-fixture.mjs";
const png=conceptFixture(),meta=checkConceptPng(png);
assert.deepEqual([meta.width,meta.height,meta.bytes],[32,64,png.length]);
const corrupt=Buffer.from(png);corrupt[corrupt.length-1]=corrupt[corrupt.length-1]!^1;
for(const image of [Buffer.from("{not PNG}"),corrupt,png.subarray(0,-1),Buffer.concat([png,Buffer.from([0])]),
  conceptFixture({filter:5}),conceptFixture({color:3}),conceptFixture({width:4097,height:1}),conceptFixture({width:2049,height:2049}),
  conceptFixture({extra:[pngChunk("acTL",Buffer.alloc(8))]}),conceptFixture({extra:[pngChunk("ABCD")]}),
  conceptFixture({extra:[pngChunk("zTXt",Buffer.concat([Buffer.from([120,0,0]),deflateSync(Buffer.alloc(1_048_577))]))]})])
  assert.throws(()=>checkConceptPng(image),{code:"CONCEPT_IMAGE"});
const text=pngChunk("zTXt",Buffer.concat([Buffer.from([120,0,0]),deflateSync(Buffer.from("own provenance"))]));
const metadataPng=conceptFixture({extra:[text]});assert.equal(checkConceptPng(metadataPng).bytes,metadataPng.length);
assert.throws(()=>checkConceptPng(conceptFixture({extra:Array.from({length:5},()=>pngChunk("zTXt",Buffer.concat([Buffer.from([120,0,0]),deflateSync(Buffer.alloc(1_048_576))])))})),{code:"CONCEPT_IMAGE"});
const root=await mkdtemp(join(tmpdir(),"studio-concepts-"));
try {
  const input=join(root,"оригинал с пробелами.png");await writeFile(input,metadataPng);
  const store=new ConceptStore(join(root,"cache")),imported=await store.import(input);
  const concept: Concept={...imported,id:randomUUID(),label:"Тестовый PNG",role:"concept",origin:"original",attribution:"Synthetic test",rights:"Own test pixels",source:"",note:"Not art approval",mime:"image/png",review:"direction-only"};
  const project=projectFromAsset(JSON.parse(await readFile(new URL("../../../fixtures/assets/aurora-longsword-v2.item-asset.json",import.meta.url),"utf8")),randomUUID());
  project.design={brief:"Control test",variants:[],concepts:[concept]};
  const path=join(root,"проект.json");await store.persist(path,project);await writeFile(path,JSON.stringify(project));
  const transferred=new ConceptStore(join(root,"fresh-cache"));await transferred.restore(path,project);
  assert.deepEqual(await transferred.image(concept),metadataPng,"Transfer preserves every original PNG byte including metadata.");
  assert.deepEqual(await readFile(input),metadataPng);await store.import(input);assert.deepEqual(await store.image(concept),metadataPng);
  await Promise.all([store.import(input),store.import(input)]);assert.equal((await readdir(store.root)).some(n=>n.endsWith(".pending")),false);
  await assert.rejects(store.image({...concept,width:31}),{code:"CONCEPT_INTEGRITY"});
  const absent=join(root,"missing.json");const missing=new ConceptStore(join(root,"missing-cache"));
  await assert.rejects(missing.restore(absent,project),{code:"CONCEPT_MISSING"});await assert.rejects(lstat(absent+".assets"),{code:"ENOENT"});
  const existing=await readFile(path);await writeFile(join(path+".assets","concepts",concept.sha256+".png"),png);
  await assert.rejects(new ConceptStore(join(root,"other-cache")).restore(path,project),{code:"CONCEPT_INTEGRITY"});assert.deepEqual(await readFile(path),existing);
  await writeFile(join(store.root,concept.sha256+".png"),png);
  await assert.rejects(store.import(input),{code:"CONCEPT_INTEGRITY"});assert.deepEqual(await readFile(join(store.root,concept.sha256+".png")),png);
  const removed=structuredClone(project);removed.design!.concepts=[];await transferred.persist(path,removed);
  assert.deepEqual(await transferred.image(concept),metadataPng,"Removing descriptor must preserve originals for undo.");
  const ordinary=join(root,"ordinary");await mkdir(ordinary);const linked=join(root,"linked");await symlink(ordinary,linked,"junction");
  await assert.rejects(new ConceptStore(linked).import(input),{code:"CONCEPT_LINK"});
  await assert.rejects(readConceptFile(ordinary),{code:"CONCEPT_LINK"});
} finally {
  assert.equal(dirname(root),resolve(tmpdir()));assert(basename(root).startsWith("studio-concepts-"));assert(!(await lstat(root)).isSymbolicLink());
  await rm(root,{recursive:true,force:true});
}
process.stdout.write("Concept PNG/store: bounded stream/metadata, checksum, transfer, exact bytes, corruption refusal, links, noncreating reads and undo originals PASS\n");

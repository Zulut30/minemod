import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,URL} from 'node:url';
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import process from 'node:process';
import {parseBenchmark,pairFrame,BENCHMARK_CLASSES} from './art-benchmark-data.mjs';
import {facePixels,armorLayers,armorFaceRects} from './art-benchmark-paint.mjs';

const raw=await readFile(fileURLToPath(new URL('../../../fixtures/art/benchmark-scenes.v1.json',import.meta.url)),'utf8');
const catalog=parseBenchmark(raw);
const controls=JSON.parse(await readFile(fileURLToPath(new URL('../../../fixtures/production/control-briefs.v1.json',import.meta.url)),'utf8'));
const digest=x=>createHash('sha256').update(x).digest('hex');
for(const modelClass of BENCHMARK_CLASSES){
  const pair=catalog.examples.filter(x=>x.modelClass===modelClass),brief=controls.briefs.find(x=>x.assetClass===modelClass);
  assert.equal(pair.length,2);assert.deepEqual(pair.map(x=>x.variant),['trait','counterexample']);
  for(const example of pair){assert.equal(example.briefId,brief.id);assert.deepEqual(example.palette,brief.palette);assert(example.observations.length>=2);}
  const frame=pairFrame(pair);assert(Number.isFinite(frame.span)&&frame.span>0);assert(frame.center.every(Number.isFinite));
  // Плохая геометрия включается в union, смена порядка не меняет масштаб.
  assert.deepEqual(pairFrame([...pair].reverse()),frame);
  assert(pair.every(item=>item.boxes.every(b=>b.origin.every((v,axis)=>Math.abs(v+b.size[axis]/2-frame.center[axis])<=frame.span/2))));
  if(modelClass==='armor'||modelClass==='building-block')assert.deepEqual(pair[0].boxes,pair[1].boxes);
  if(modelClass==='decorative-prop')assert.equal(pair[0].boxes.length,pair[1].boxes.length);
}
const reject=mutate=>{const data=globalThis.structuredClone(catalog);mutate(data);assert.throws(()=>parseBenchmark(JSON.stringify(data)));};
reject(x=>{x.examples[0].representation='six-face-block-reference';});
reject(x=>{x.examples[0].eval='process.exit()';});
reject(x=>{x.provenance.externalAssets=true;});
reject(x=>{x.provenance.license='unknown';});
reject(x=>{x.evidenceState.artisticApproval='approved';});
reject(x=>{x.examples[1].id=x.examples[0].id;});
reject(x=>{x.examples[1].variant='trait';});
reject(x=>{x.examples[1].palette[0]='#ffffff';});
reject(x=>{x.examples[0].boxes[0].origin[0]=Infinity;});
reject(x=>{x.examples[0].boxes[0].size[0]=0;});
reject(x=>{x.examples[0].boxes[0].origin[0]=64;});
reject(x=>{x.examples[0].boxes[1].id=x.examples[0].boxes[0].id;});
reject(x=>{x.examples[0].boxes=Array(65).fill(x.examples[0].boxes[0]);});
reject(x=>{x.examples[2].boxes[0].armorPart=undefined;});
reject(x=>{x.examples[4].boxes[0].size[0]=15;});
reject(x=>{x.examples[0].boxes[0].armorPart='arm';});
reject(x=>{x.examples[0].label='😀';});
assert.throws(()=>parseBenchmark(' '.repeat(262145)));
assert.throws(()=>parseBenchmark(JSON.stringify(catalog)+'Ж'.repeat(131073)));
assert.throws(()=>parseBenchmark('{'));
for(const item of catalog.examples){
  const pixels=facePixels(item,item.boxes[0].material,'south');assert.equal(pixels.pixels.length,16*16*4);
  const allowed=new Set(item.palette.map(x=>x.slice(1)));
  for(let i=0;i<pixels.pixels.length;i+=4){assert.equal(pixels.pixels[i+3],255);assert(allowed.has(Buffer.from(pixels.pixels.slice(i,i+3)).toString('hex')));}
  assert.equal(digest(pixels.pixels),digest(facePixels(item,item.boxes[0].material,'south').pixels));
}
const block=catalog.examples.find(x=>x.modelClass==='building-block'&&x.variant==='trait');
assert.notEqual(digest(facePixels(block,'stone','south').pixels),digest(facePixels(block,'stone','up').pixels));
for(const part of ['head','body','arm','leg'])for(const [x,y,w,h] of Object.values(armorFaceRects(part))){assert(x>=0&&y>=0&&w>0&&h>0&&x+w<=64&&y+h<=32);}
const armor=catalog.examples.filter(x=>x.modelClass==='armor');
for(const item of armor){const layers=armorLayers(item);assert.equal(layers.length,2);for(const layer of layers){assert.equal(layer.width,64);assert.equal(layer.height,32);assert.equal(layer.pixels.length,8192);}assert.notEqual(digest(layers[0].pixels),digest(layers[1].pixels));}
assert.notEqual(digest(armorLayers(armor[0])[0].pixels),digest(armorLayers(armor[1])[0].pixels));
process.stdout.write(JSON.stringify({status:'PASS',examples:10,classes:5,negativeCases:20,checks:['unchanged-control-palettes','representation','rights-and-unapproved-state','bounded-strict-data','pair-union-framing','equal-geometry-contrasts','deterministic-original-pixels','two-native-armor-layers'],artisticScore:'not-computed'})+'\n');

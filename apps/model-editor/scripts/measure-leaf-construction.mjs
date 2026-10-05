import * as THREE from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { cubes, parseProject } from '../../../packages/editor-core/index.ts';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import console from 'node:console';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const sha=b=>createHash('sha256').update(b).digest('hex');
function oriented(c){const pivot=new THREE.Vector3(...c.pivot),rotation=new THREE.Euler(...c.rotation.map(v=>v*Math.PI/180));const center=new THREE.Vector3(...c.origin.map((v,i)=>v+c.size[i]/2)).sub(pivot).applyEuler(rotation).add(pivot);const half=new THREE.Vector3(...c.size.map(v=>v/2+c.inflate));return new OBB(center,half,new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(rotation)));}
function bounds(items){const box=new THREE.Box3();for(const c of items){const pivot=new THREE.Vector3(...c.pivot),euler=new THREE.Euler(...c.rotation.map(v=>v*Math.PI/180));for(const x of [0,1])for(const y of [0,1])for(const z of [0,1]){const p=new THREE.Vector3(...c.origin.map((v,i)=>v+([x,y,z][i]?c.size[i]+c.inflate:-c.inflate)));box.expandByPoint(p.sub(pivot).applyEuler(euler).add(pivot));}}return{min:box.min.toArray(),max:box.max.toArray(),size:box.getSize(new THREE.Vector3()).toArray()};}
const box=(origin,size,rotation=[0,0,0],pivot=[0,0,0])=>({origin,size,rotation,pivot,inflate:0});
assert(oriented(box([0,0,0],[1,1,1])).intersectsOBB(oriented(box([1,0,0],[1,1,1]))));
assert(!oriented(box([0,0,0],[1,1,1])).intersectsOBB(oriented(box([1.01,0,0],[1,1,1]))));
const diagonal=box([-2,-.05,-.5],[4,.1,1],[0,0,45]);const parallel=box([-2,.95,-.5],[4,.1,1],[0,0,45],[0,1,0]);
assert(Math.abs(bounds([diagonal]).size[0]-4.1/Math.sqrt(2))<1e-9);
assert(!oriented(diagonal).intersectsOBB(oriented(parallel)));
const aroundPivot=oriented(box([3,4,-.5],[2,.1,1],[0,0,45],[3,4,0]));
assert(Math.abs(aroundPivot.center.x-(3+.95/Math.sqrt(2)))<1e-9);
assert(Math.abs(aroundPivot.center.y-(4+1.05/Math.sqrt(2)))<1e-9);
assert.deepEqual(oriented({...box([0,0,0],[1,1,1]),inflate:.125}).halfSize.toArray(),[.625,.625,.625]);
const results=[];
for(const key of ['a','b']){
 const path=`output/model-editor/leaf-volume-20261005-v3c/${key}.mmeditor.json`,bytes=await readFile(path),p=parseProject(bytes.toString('utf8')),items=cubes(p),obbs=items.map(oriented),adj=items.map(()=>new Set()),contacts=[];
 const epsilon=1e-12;
 for(let a=0;a<items.length;a++)for(let b=a+1;b<items.length;b++)if(obbs[a].intersectsOBB(obbs[b],epsilon)){adj[a].add(b);adj[b].add(a);contacts.push([items[a].id,items[b].id]);}
 const components=[],seen=new Set();for(let at=0;at<items.length;at++)if(!seen.has(at)){const pending=[at],component=[];seen.add(at);while(pending.length){const i=pending.pop();component.push(items[i].id);for(const j of adj[i])if(!seen.has(j)){seen.add(j);pending.push(j);}}components.push(component.sort());}
 const parts=p.parts.map(part=>({id:part.id,label:part.label,...bounds(items.filter(c=>part.cubeIds.includes(c.id)))}));
 const partContacts=[];for(let a=0;a<p.parts.length;a++)for(let b=a+1;b<p.parts.length;b++){const pa=p.parts[a],pb=p.parts[b],edges=contacts.filter(([l,r])=>pa.cubeIds.includes(l)&&pb.cubeIds.includes(r)||pa.cubeIds.includes(r)&&pb.cubeIds.includes(l));partContacts.push({parts:[pa.id,pb.id],contacts:edges});}
 const blade=parts.find(x=>x.id==='blade_group'),handle=parts.find(x=>x.id==='handle_group');
 assert(blade&&handle&&handle.size[1]>0,'Для этого исследования нужны непустые blade_group и handle_group');
 results.push({key,path,sourceSha256:sha(bytes),epsilon,components,contacts,parts,partContacts,bladeLengthToHandleLength:blade.size[1]/handle.size[1],thicknesses:items.filter(c=>/blade_(edge|ridge)|ricasso|neck|guard_core/u.test(c.id)).map(c=>({id:c.id,size:c.size})),technicalInterpretation:'OBB touching/overlap connectivity only. No surface-quality, intentional-joint, intersection-volume, mass-balance or art approval conclusion.'});
 assert.equal(sha(await readFile(path)),sha(bytes));
}
await mkdir('output/verification',{recursive:true});
await writeFile('output/verification/leaf-construction-044.json',JSON.stringify({status:'MEASURED',three:'0.186.1',reference:'https://threejs.org/docs/pages/OBB.html',contactProbes:'PASS',results,artisticAcceptance:'NOT_PERFORMED',gameAcceptance:'NOT_RUN'},null,2)+'\n');
console.log(JSON.stringify({status:'MEASURED',results:results.map(r=>({key:r.key,components:r.components.length,parts:r.parts,bladeLengthToHandleLength:r.bladeLengthToHandleLength}))}));

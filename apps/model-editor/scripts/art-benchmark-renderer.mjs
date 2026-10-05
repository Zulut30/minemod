/* global document, ImageData */
import * as THREE from 'three';
import {facePixels, armorLayers, armorFaceRects, BOX_FACE_ORDER} from './art-benchmark-paint.mjs';

const directions={front:[0,0,1],back:[0,0,-1],left:[-1,0,0],right:[1,0,0],top:[0,1,0],bottom:[0,-1,0],perspective:[1,.55,1], 'rear-perspective':[-1,.55,-1]};
function canvasFromPixels({width,height,pixels}) {
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels),width,height),0,0);
  return canvas;
}
function texture(canvas) {
  const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;tex.magFilter=THREE.NearestFilter;tex.minFilter=THREE.NearestFilter;tex.generateMipmaps=false;return tex;
}
function armorFaceCanvas(layers,part,face) {
  const [x,y,w,h]=armorFaceRects(part)[face],canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const context=canvas.getContext('2d');context.imageSmoothingEnabled=false;
  context.drawImage(layers[part==='leg'?1:0],x,y,w,h,0,0,w,h);
  if(part==='leg') context.drawImage(layers[0],x,y+Math.max(0,h-4),w,Math.min(4,h),0,Math.max(0,h-4),w,Math.min(4,h));
  return canvas;
}
export function renderReference(item,frame,view,size,mode='textured',wall=false) {
  const scene=new THREE.Scene();const maps=[],materials=[],geometries=[];
  scene.add(new THREE.HemisphereLight(0xffffff,0x777f91,2));
  const key=new THREE.DirectionalLight(0xffffff,1.4);key.position.set(-18,30,30);scene.add(key);
  const layers=item.modelClass==='armor'?armorLayers(item).map(canvasFromPixels):null;
  const root=new THREE.Group();scene.add(root);
  const copies=wall?[-1,0,1].flatMap(x=>[-1,0,1].map(y=>[x*16,y*16,0])):[[0,0,0]];
  for(const offset of copies) for(const b of item.boxes) {
    const geometry=new THREE.BoxGeometry(...b.size);geometries.push(geometry);
    const mats=BOX_FACE_ORDER.map(face=>{
      if(mode==='silhouette') return new THREE.MeshBasicMaterial({color:0x000000});
      if(mode==='neutral') return new THREE.MeshLambertMaterial({color:0x9fabb9});
      const source=layers?armorFaceCanvas(layers,b.armorPart,face):canvasFromPixels(facePixels(item,b.material,face));
      const tex=texture(source);maps.push(tex);return new THREE.MeshLambertMaterial({map:tex,alphaTest:.5});
    });materials.push(...mats);
    const mesh=new THREE.Mesh(geometry,mats);mesh.position.set(...b.origin.map((v,axis)=>v+b.size[axis]/2+offset[axis]));root.add(mesh);
  }
  const span=wall?Math.hypot(48,48,16)*1.12:frame.span;
  const center=new THREE.Vector3(...frame.center),camera=new THREE.OrthographicCamera(-span/2,span/2,span/2,-span/2,.1,400);
  const direction=new THREE.Vector3(...directions[view]).normalize();camera.position.copy(center).addScaledVector(direction,120);
  if(view==='top'||view==='bottom')camera.up.set(0,0,-1);camera.lookAt(center);
  const renderer=new THREE.WebGLRenderer({antialias:false,alpha:false,preserveDrawingBuffer:true});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;renderer.setPixelRatio(1);renderer.setSize(size,size,false);renderer.setClearColor(mode==='silhouette'?0xffffff:0x202630,1);
  try {
    renderer.render(scene,camera);
    let raster=null;
    if(mode==='silhouette'){
      const gl=renderer.getContext(),pixels=new Uint8Array(size*size*4);gl.readPixels(0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      let foregroundPixels=0;const lower=[size,size],upper=[-1,-1];
      for(let y=0;y<size;y++)for(let x=0;x<size;x++){const offset=(y*size+x)*4;if(pixels[offset]<10&&pixels[offset+1]<10&&pixels[offset+2]<10){foregroundPixels++;lower[0]=Math.min(lower[0],x);lower[1]=Math.min(lower[1],y);upper[0]=Math.max(upper[0],x);upper[1]=Math.max(upper[1],y);}}
      raster={foregroundPixels,lower,upper,scope:'nonempty and unclipped buffer only; no recognition score'};
    }
    return {dataUrl:renderer.domElement.toDataURL('image/png'),frame:{center:frame.center,span},size,view,mode,raster,pixelRatio:renderer.getPixelRatio(),antialias:false,threeRevision:THREE.REVISION};
  }
  finally {maps.forEach(x=>x.dispose());materials.forEach(x=>x.dispose());geometries.forEach(x=>x.dispose());renderer.dispose();renderer.forceContextLoss();}
}
export function referenceTextures(item) {
  if(item.modelClass==='armor')return armorLayers(item).map((pixels,index)=>({id:'layer-'+(index+1),...pixels,dataUrl:canvasFromPixels(pixels).toDataURL('image/png'),pixels:undefined}));
  if(item.modelClass==='building-block')return BOX_FACE_ORDER.map(face=>{const pixels=facePixels(item,'stone',face);return{id:face,width:16,height:16,dataUrl:canvasFromPixels(pixels).toDataURL('image/png')};});
  return [];
}
globalThis.artBenchmark={renderReference,referenceTextures};

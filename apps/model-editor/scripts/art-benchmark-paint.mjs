// Оригинальные фиксированные рисунки reference-сцен. Не runtime texture exporter.
export const ARMOR_UV = Object.freeze({head: [0, 0, 8, 8, 8], body: [16, 16, 8, 12, 4], arm: [40, 16, 4, 12, 4], leg: [0, 16, 4, 12, 4]});
export const BOX_FACE_ORDER = Object.freeze(['east', 'west', 'up', 'down', 'south', 'north']);
export function armorFaceRects(part) {
  const [u, v, w, h, d] = ARMOR_UV[part];
  return {west: [u, v+d, d, h], south: [u+d, v+d, w, h], east: [u+d+w, v+d, d, h], north: [u+2*d+w, v+d, w, h], up: [u+d, v, w, d], down: [u+d+w, v, w, d]};
}
function recipe(item, material) {
  const polar = item.modelClass === 'weapon' || item.modelClass === 'armor';
  if (polar) return material === 'leather' || material === 'joint' ? [0, 5, 1, 2] : material === 'ice' ? [2, 3, 4, 0] : [0, 1, 3, 4];
  if (item.modelClass === 'creature') return material === 'joint' ? [0, 0, 1, 2] : material === 'coral' || material === 'ice' ? [1, 4, 5, 0] : [1, 2, 3, 0];
  return material === 'stone' ? [0, 1, 2, 4] : material === 'coral' ? [3, 6, 7, 0] : [3, 4, 5, 0];
}
function rgba(color) { return [parseInt(color.slice(1,3),16), parseInt(color.slice(3,5),16), parseInt(color.slice(5,7),16), 255]; }
export function facePixels(item, material, face, width = 16, height = 16) {
  const colors = item.palette.map(rgba), [shadow, base, highlight, accent] = recipe(item, material);
  const pixels = new Uint8Array(width*height*4);
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    let index;
    if (item.pattern === 'noise') index = (x*7+y*13+(x*y)%7) % colors.length;
    else if (item.modelClass === 'building-block') {
      if (face === 'up' || face === 'down') index = (x===4 || x===11 || y===4 || y===11) ? shadow : base;
      else { const seam = y===4 || y===12 || (x === (y<4 || y>12 ? 4 : 12)); index = seam ? shadow : (y===5 || y===13 ? highlight : base); }
      if ((x===2 || x===13) && (y===2 || y===13)) index=accent;
      if ((x===3 || x===12) && (y===2 || y===13)) index=5;
    } else if (material === 'leather' || material === 'joint') index = y%5===4 ? shadow : base;
    else { index = x<2 ? highlight : x>=width-2 || y>=height-2 ? shadow : base; if (material==='coral' && x>width/2 && y<height/2) index=highlight; }
    if (item.modelClass==='building-block' && item.pattern==='noise' && (x===0||y===0||x===width-1||y===height-1)) index=0;
    pixels.set(colors[index],(y*width+x)*4);
  }
  return {width,height,pixels};
}
export function armorLayers(item) {
  const colors=item.palette.map(rgba);
  return [1,2].map(layer => {
    const pixels=new Uint8Array(64*32*4);
    for (const part of ['head','body','arm','leg']) for (const [face,[u,v,w,h]] of Object.entries(armorFaceRects(part))) for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      let index=1;
      if (item.pattern==='noise') index=(x*7+y*13+(x*y)%7+layer)%colors.length;
      else {
        if (x===0 || x===w-1 || y===0) index=3;
        if (y>=h-3) index=0;
        if (part==='body' && face==='south' && layer===1 && x>=3 && x<=4 && y>=3 && y<=5) index=4;
        if (part==='head' && face==='south' && x>=2 && x<=5 && y>=3 && y<=5) index=y===4 && (x===2||x===5) ? 0 : 5;
        if (part==='leg' && layer===1 && y<h-4) index=0;
        if (part==='leg' && layer===2 && y>=h-4) index=0;
        if (part==='body' && layer===2) index=y>=h-3 ? 5 : 0;
      }
      pixels.set(colors[index],((v+y)*64+u+x)*4);
    }
    return {width:64,height:32,pixels};
  });
}

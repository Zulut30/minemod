// Собственные синтетические пиксели для технического теста; это не художественный концепт.
import { Buffer } from "node:buffer";
import { crc32, deflateSync } from "node:zlib";
export function pngChunk(type,body=Buffer.alloc(0)) {
  const chunk=Buffer.alloc(body.length+12);chunk.writeUInt32BE(body.length,0);chunk.write(type,4,"ascii");body.copy(chunk,8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4,-4)),chunk.length-4);return chunk;
}
export function conceptFixture({width=32,height=64,filter=0,interlace=0,color=6,extra=[]}={}) {
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=color;header[12]=interlace;
  const rows=Buffer.alloc(height*(1+width*4));
  for(let y=0;y<height;y++) {
    rows[y*(1+width*4)]=filter;
    for(let x=0;x<width;x++){const pos=y*(1+width*4)+1+x*4;const blade=y>3&&y<42&&Math.abs(x-width/2)<3,guard=y>=42&&y<46&&x>4&&x<width-4,grip=y>=46&&y<height-3&&Math.abs(x-width/2)<2;
      rows[pos]=blade?110:guard?225:grip?79:24;rows[pos+1]=blade?220:guard?171:grip?87:30;rows[pos+2]=blade?238:guard?81:grip?119:42;rows[pos+3]=255;}
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk("IHDR",header),...extra,pngChunk("IDAT",deflateSync(rows)),pngChunk("IEND")]);
}

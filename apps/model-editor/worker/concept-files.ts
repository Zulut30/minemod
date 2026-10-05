import { open, mkdir, lstat, link, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { crc32, inflateSync } from "node:zlib";
import { EditorError, MAX_CONCEPT_BYTES, MAX_CONCEPT_DIMENSION, type Concept, type EditorProject } from "@mcdev/editor-core";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const bad = (message: string): never => { throw new EditorError("CONCEPT_IMAGE", message); };
export function checkConceptPng(bytes: Buffer): { width: number; height: number; bytes: number; sha256: string } {
  if (bytes.length > MAX_CONCEPT_BYTES || bytes.length < 45 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    bad("Нужен PNG до 8 MiB. Исходное изображение не меняется.");
  let offset=8, width=0, height=0, depth=0, color=0, interlace=0, chunks=0, ended=false, dataEnded=false, palette=false, metadataBytes=0;
  const imageChunks: Buffer[]=[];
  while(offset<bytes.length) {
    if (++chunks>4096 || offset+12>bytes.length) bad("PNG содержит слишком много chunks или обрезан.");
    const length=bytes.readUInt32BE(offset), end=offset+12+length;
    if(end>bytes.length) bad("PNG chunk выходит за границы файла.");
    const type=bytes.toString("ascii",offset+4,offset+8), body=bytes.subarray(offset+8,end-4);
    if(!bytes.subarray(offset+4,offset+8).every(c=>(c>=65&&c<=90)||(c>=97&&c<=122)) || type[2]!==type[2]!.toUpperCase() || crc32(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4)) bad("PNG checksum или тип chunk некорректен.");
    if(chunks===1 && type!=="IHDR") bad("PNG должен начинаться с IHDR.");
    if(type==="IHDR") {
      if(chunks!==1 || length!==13) bad("PNG header некорректен.");
      width=body.readUInt32BE(0);height=body.readUInt32BE(4);depth=body[8]!;color=body[9]!;interlace=body[12]!;
      const depths: Record<number,number[]>={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      if(!width||!height||width>MAX_CONCEPT_DIMENSION||height>MAX_CONCEPT_DIMENSION||width*height>4_194_304 ||
        !depths[color]?.includes(depth)||body[10]!==0||body[11]!==0||interlace>1) bad("PNG: стороны до 4096, площадь до 4 Mpx; нужен стандартный color/compression profile.");
    } else if(type==="PLTE") {
      if(palette||imageChunks.length||!length||length%3||length>768||[0,4].includes(color)||(color===3&&length/3>2**depth)) bad("PNG palette некорректна.");
      palette=true;
    } else if(type==="IDAT") {
      if(dataEnded||(color===3&&!palette)) bad("PNG IDAT/palette ordering некорректен.");
      imageChunks.push(body);
    } else {
      if(imageChunks.length) dataEnded=true;
      if(type==="IEND") { if(length||!imageChunks.length||end!==bytes.length) bad("PNG trailer некорректен.");ended=true; }
      else if(["acTL","fcTL","fdAT"].includes(type)) bad("Для концепта нужен статичный PNG. APNG требует отдельного профиля.");
      else if(["iCCP","zTXt","iTXt"].includes(type)) {
        const keyword=body.indexOf(0);if(keyword<1||keyword>79)bad("PNG metadata header некорректен.");
        let text: Buffer,compressed=true;
        if(type==="iTXt") {
          const flag=body[keyword+1],method=body[keyword+2],language=body.indexOf(0,keyword+3),translated=body.indexOf(0,language+1);
          if((flag!==0&&flag!==1)||method!==0||language<keyword+3||translated<language+1)bad("PNG international text header некорректен.");
          compressed=flag===1;text=body.subarray(translated+1);
        } else {if(body[keyword+1]!==0)bad("PNG metadata compression некорректен.");text=body.subarray(keyword+2);}
        try {
          const decoded=compressed?inflateSync(text,{maxOutputLength:1_048_576}):text;
          metadataBytes+=decoded.length;
          if(decoded.length>1_048_576||metadataBytes>4_194_304)bad("PNG metadata превышают ограничение распаковки.");
        }
        catch {bad("PNG metadata повреждены или превышают 1 MiB после распаковки.");}
      }
      else if(type[0]===type[0]!.toUpperCase()) bad("PNG содержит неизвестный critical chunk.");
    }
    offset=end;
  }
  if(!ended) bad("PNG не завершён.");
  const channels: Record<number,number>={0:1,2:3,3:1,4:2,6:4};
  const passes=interlace ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]];
  const rows=passes.map(([x,y,dx,dy])=>{
    const w=Math.max(0,Math.ceil((width-x!)/dx!)), h=Math.max(0,Math.ceil((height-y!)/dy!));
    return {h:w?h:0,row:Math.ceil(w*depth*channels[color]!/8)+1};
  });
  const expected=rows.reduce((n,p)=>n+p.h*p.row,0);
  let decoded: Buffer;
  try { decoded=inflateSync(Buffer.concat(imageChunks),{maxOutputLength:expected+1}); }
  catch { return bad("PNG pixel stream повреждён или превышает размер header."); }
  if(decoded.length!==expected) bad("PNG pixel stream не соответствует header.");
  let pos=0;for(const pass of rows)for(let row=0;row<pass.h;row++){if(decoded[pos]!>4)bad("PNG filter некорректен.");pos+=pass.row;}
  return {width,height,bytes:bytes.length,sha256:sha(bytes)};
}
export async function readConceptFile(path: string): Promise<Buffer> {
  const before=await lstat(path);
  if(!before.isFile()||before.isSymbolicLink()) throw new EditorError("CONCEPT_LINK","Нужен обычный файл концепта без ссылки.");
  const file=await open(path,"r");
  try {
    const stat=await file.stat();if(!stat.isFile()||stat.size>MAX_CONCEPT_BYTES)bad("Нужен обычный PNG-файл до 8 MiB.");
    const after=await lstat(path);
    if(after.isSymbolicLink()||stat.ino!==before.ino||stat.dev!==before.dev||stat.ino!==after.ino||stat.dev!==after.dev)
      throw new EditorError("CONCEPT_LINK","Файл изменился во время открытия; повторите импорт.");
    const buffer=Buffer.alloc(Math.min(stat.size+1,MAX_CONCEPT_BYTES+1));let length=0;
    while(length<buffer.length){const {bytesRead}=await file.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
    if(length!==stat.size)bad("PNG изменился во время чтения; повторите импорт.");
    return buffer.subarray(0,length);
  } finally {await file.close();}
}
async function directory(path: string): Promise<void> {
  await mkdir(path,{recursive:true});await checkDirectory(path);
}
async function checkDirectory(path: string): Promise<void> {
  const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink())throw new EditorError("CONCEPT_LINK","Каталог концептов должен быть обычным каталогом без ссылки.");
}
export class ConceptStore {
  readonly root: string;
  constructor(root: string) {this.root=root;}
  private path(root: string, hash: string): string {
    if(!/^[0-9a-f]{64}$/u.test(hash))throw new EditorError("CONCEPT_ID","Некорректный hash концепта.");
    return join(root,hash+".png");
  }
  private async get(root: string, concept: Concept): Promise<Buffer> {
    await checkDirectory(root);
    const bytes=await readConceptFile(this.path(root,concept.sha256)),actual=checkConceptPng(bytes);
    if(actual.sha256!==concept.sha256||actual.bytes!==concept.bytes||actual.width!==concept.width||actual.height!==concept.height)
      throw new EditorError("CONCEPT_INTEGRITY","PNG не совпадает с descriptor проекта. Файл не заменён.");
    return bytes;
  }
  private async put(root: string, hash: string, bytes: Buffer): Promise<void> {
    await directory(root);const target=this.path(root,hash);
    try { if(!(await readConceptFile(target)).equals(bytes))throw new EditorError("CONCEPT_INTEGRITY","Существующий PNG не совпадает с hash; файл не заменён.");return; }
    catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
    const staging=join(root,`.${randomUUID()}.pending`);const file=await open(staging,"wx",0o600);
    try {
      try {await file.writeFile(bytes);await file.sync();} finally {await file.close();}
      try {await link(staging,target);}
      catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST"||!(await readConceptFile(target)).equals(bytes))throw error;}
    }
    finally {await rm(staging,{force:true});}
  }
  async import(path: string): Promise<ReturnType<typeof checkConceptPng>> {
    const bytes=await readConceptFile(path),result=checkConceptPng(bytes);await this.put(this.root,result.sha256,bytes);return result;
  }
  async image(concept: Concept): Promise<Buffer> {
    try {return await this.get(this.root,concept);}
    catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")throw new EditorError("CONCEPT_MISSING","Оригинальный PNG отсутствует в хранилище проекта.");throw error;}
  }
  async persist(projectPath: string, project: EditorProject): Promise<void> {
    const sidecar=projectPath+".assets";
    for(const concept of project.design?.concepts??[]){await directory(sidecar);const bytes=await this.image(concept);await this.put(join(sidecar,"concepts"),concept.sha256,bytes);}
  }
  async restore(projectPath: string, project: EditorProject): Promise<void> {
    for(const concept of project.design?.concepts??[]) {
      try {await this.image(concept);}
      catch(error){if(!(error instanceof EditorError)||error.code!=="CONCEPT_MISSING")throw error;
        const sidecar=projectPath+".assets";
        let bytes: Buffer;
        try {await checkDirectory(sidecar);bytes=await this.get(join(sidecar,"concepts"),concept);}
        catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")throw new EditorError("CONCEPT_MISSING","Оригинальный PNG отсутствует. Перенесите рядом с проектом его папку .assets.");throw error;}
        await this.put(this.root,concept.sha256,bytes);
      }
    }
  }
}

/* global document, innerWidth */
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import process from 'node:process';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {parseBenchmark,pairFrame,BENCHMARK_VIEWS} from './art-benchmark-data.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const output=join(repo,'output/model-editor/art-benchmark-042');
const witness=join(repo,'output/playwright/art-benchmark-042');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const catalogBytes=await readFile(join(repo,'fixtures/art/benchmark-scenes.v1.json'));
const catalog=parseBenchmark(catalogBytes.toString('utf8'));
const briefBytes=await readFile(join(repo,'fixtures/production/control-briefs.v1.json'));
const briefs=JSON.parse(briefBytes.toString('utf8'));
for(const item of catalog.examples){const brief=briefs.briefs.find(x=>x.id===item.briefId);assert.equal(brief?.assetClass,item.modelClass);assert.deepEqual(brief.palette,item.palette);}
await mkdir(join(output,'captures'),{recursive:true});await mkdir(witness,{recursive:true});
await writeFile(join(output,'source.json'),catalogBytes);await writeFile(join(output,'control-briefs.v1.json'),briefBytes);await writeFile(join(output,'LICENSE'),await readFile(join(repo,'LICENSE')));
await build({entryPoints:[join(repo,'apps/model-editor/scripts/art-benchmark-renderer.mjs')],outfile:join(output,'renderer.js'),bundle:true,platform:'browser',format:'iife',target:'es2022',legalComments:'eof'});
await writeFile(join(output,'render.html'),'<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; img-src data:; connect-src \'none\'"><script src="renderer.js"></script>');
const sources=[];
for(const path of ['fixtures/art/benchmark-scenes.v1.json','fixtures/production/control-briefs.v1.json','apps/model-editor/scripts/art-benchmark-data.mjs','apps/model-editor/scripts/art-benchmark-paint.mjs','apps/model-editor/scripts/art-benchmark-renderer.mjs','apps/model-editor/scripts/preview-art-benchmark.mjs','pnpm-lock.yaml']){const bytes=await readFile(join(repo,path));sources.push({path,bytes:bytes.length,sha256:sha(bytes)});}
const pkg=name=>readFile(join(repo,`apps/model-editor/node_modules/${name}/package.json`),'utf8').then(JSON.parse);
const [three,playwright]=await Promise.all([pkg('three'),pkg('playwright')]);
const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});
const manifest={schemaVersion:1,kind:'mcdev-art-reference-captures',catalogSha256:sha(catalogBytes),controlBriefsSha256:sha(briefBytes),sources,versions:{node:process.versions.node,three:three.version,playwright:playwright.version,browser:browser.version()},renderer:{projection:'orthographic',pixelRatio:1,antialias:false,textureFilter:'nearest',outputColorSpace:'srgb',lighting:'fixed hemisphere + directional',unitsPerBlock:16,nativeCapture:'direct 32/64 drawing buffer; no resize'},provenance:catalog.provenance,evidenceState:catalog.evidenceState,examples:[],leafAppendix:{status:'not-attached'},verification:{status:'pending'}};
const errors=[],external=[];
const page=await browser.newPage({viewport:{width:1400,height:1000},deviceScaleFactor:1});
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('request',r=>{if(/^https?:/u.test(r.url()))external.push(r.url());});
try {
  await page.goto(pathToFileURL(join(output,'render.html')).href);
  for(const item of catalog.examples){
    const frame=pairFrame(catalog.examples.filter(x=>x.modelClass===item.modelClass));
    const captures=[];
    const tasks=BENCHMARK_VIEWS.flatMap(view=>['neutral','textured'].map(mode=>({view,mode,size:256})));
    tasks.push(...[32,64].flatMap(size=>[{view:'front',mode:'silhouette',size},{view:'perspective',mode:'silhouette',size},{view:'perspective',mode:'textured',size}]));
    if(item.modelClass==='building-block')tasks.push({view:'front',mode:'textured',size:256,wall:true});
    for(const task of tasks){
      const rendered=await page.evaluate(({item,frame,task})=>{
        const r=globalThis.artBenchmark.renderReference(item,frame,task.view,task.size,task.mode,task.wall);
        // Проверка истинного drawing buffer и непустого силуэта, без художественного score.
        return r;
      },{item,frame,task});
      assert.equal(rendered.pixelRatio,1);assert.equal(rendered.antialias,false);assert.equal(rendered.size,task.size);
      if(task.mode==='silhouette'){assert(rendered.raster.foregroundPixels>0&&rendered.raster.foregroundPixels<task.size*task.size);assert(rendered.raster.lower.every(x=>x>0)&&rendered.raster.upper.every(x=>x<task.size-1));}
      const bytes=Buffer.from(rendered.dataUrl.split(',')[1],'base64');assert.equal(bytes.readUInt32BE(16),task.size);assert.equal(bytes.readUInt32BE(20),task.size);
      const path=`captures/${item.id}-${task.wall?'wall':task.view}-${task.mode}-${task.size}.png`;
      await writeFile(join(output,path),bytes);captures.push({...task,path,bytes:bytes.length,sha256:sha(bytes),frame:rendered.frame,raster:rendered.raster});
    }
    const textures=await page.evaluate(item=>globalThis.artBenchmark.referenceTextures(item),item);
    const textureCaptures=[];
    for(const t of textures){const bytes=Buffer.from(t.dataUrl.split(',')[1],'base64');assert.equal(bytes.readUInt32BE(16),t.width);assert.equal(bytes.readUInt32BE(20),t.height);const path=`captures/${item.id}-${t.id}.png`;await writeFile(join(output,path),bytes);textureCaptures.push({id:t.id,width:t.width,height:t.height,path,bytes:bytes.length,sha256:sha(bytes)});}
    manifest.examples.push({id:item.id,modelClass:item.modelClass,representation:item.representation,variant:item.variant,sourceSha256:sha(Buffer.from(JSON.stringify(item))),frame,captures,textures:textureCaptures,scope:'illustrative reference only; control brief not executed by generator',requiredControlContexts:briefs.briefs.find(x=>x.id===item.briefId).requiredCaptures,gameContexts:'not-run',runtimeCapability:'not-verified',texelDensity:'illustrative; not a verified uniform profile'});
    process.stdout.write(`Captured ${item.id}: ${captures.length} views, ${textureCaptures.length} textures\n`);
  }
  // Дополнение из реального Studio, если исходный локальный witness сохранён. Только фиксированные пути.
  const leafRoot=join(repo,'output/model-editor/leaf-volume-20261005-v3c');
  let leafBytes;
  try{leafBytes=await readFile(join(leafRoot,'reviews-b6f9b030/report.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(leafBytes){
    const report=JSON.parse(leafBytes.toString('utf8'));assert(report.allFramesEqual);assert.equal(report.artisticApproval,'NOT_PERFORMED');assert.equal(report.studioVersion,'0.18.0');
    const saved=[];
    for(const key of ['a','b']){
      const entry=report.reports.find(x=>x.source.replaceAll('\\','/').endsWith(`/${key}.mmeditor.json`));assert(entry?.scenePreserved);
      const source=await readFile(join(leafRoot,`${key}.mmeditor.json`));assert.equal(sha(source),entry.sourceSha256);
      const sourcePath=`leaf-${key}.mmeditor.json`;await writeFile(join(output,sourcePath),source);
      const concepts=JSON.parse(source.toString('utf8')).design?.concepts??[];assert(concepts.length<=4);
      const sidecars=[];
      for(const concept of concepts){
        assert.match(concept.sha256,/^[a-f0-9]{64}$/u);
        const bytes=await readFile(join(leafRoot,`${key}.mmeditor.json.assets/concepts/${concept.sha256}.png`));
        assert(bytes.length<=8388608);assert.equal(bytes.length,concept.bytes);assert.equal(sha(bytes),concept.sha256);
        const path=`${sourcePath}.assets/concepts/${concept.sha256}.png`;await mkdir(dirname(join(output,path)),{recursive:true});await writeFile(join(output,path),bytes);
        sidecars.push({path,bytes:bytes.length,sha256:sha(bytes),descriptor:concept});
      }
      const images=[];
      for(const view of ['review',...BENCHMARK_VIEWS,'silhouette']){
        const imagePath=`${key}-${view}.png`,expected=[entry.review,...entry.views,entry.silhouette].find(x=>x.path===imagePath);assert(expected);
        const bytes=await readFile(join(leafRoot,'reviews-b6f9b030',imagePath));assert.equal(sha(bytes),expected.sha256);assert.equal(bytes.length,expected.bytes);
        const path=`captures/leaf-${imagePath}`;await writeFile(join(output,path),bytes);images.push({path,bytes:bytes.length,sha256:sha(bytes)});
      }
      saved.push({id:key,sourcePath,sourceSha256:sha(source),frame:entry.framing,images,sidecars});
    }
    manifest.leafAppendix={status:'attached',selection:'direction-A-only',volumeApproval:'not-performed',studioVersion:report.studioVersion,sourceReportSha256:sha(leafBytes),examples:saved,conceptRights:'Original descriptor retained; separate rights review not performed. Reference catalog license does not replace it.'};
  }
  const card=item=>{
    const entry=manifest.examples.find(x=>x.id===item.id);
    const image=(view,mode,size=256,wall=false)=>entry.captures.find(c=>c.view===view&&c.mode===mode&&c.size===size&&Boolean(c.wall)===wall)?.path;
    return `<article class="${item.variant}"><div class="tag">${item.variant==='trait'?'Полезная черта':'Ошибка для сравнения'}</div><h3>${esc(item.label)}</h3><img class="hero" src="${image('perspective','textured')}" alt="${esc(item.label)}"><div class="native"><span>Нативные 32 px<img width="32" height="32" src="${image('perspective','textured',32)}" alt="Текстура 32 px"></span><span>Нативные 64 px<img width="64" height="64" src="${image('perspective','textured',64)}" alt="Текстура 64 px"></span><span>Силуэт 32 px<img width="32" height="32" src="${image('front','silhouette',32)}" alt="Силуэт спереди 32 px"></span><span>Силуэт 64 px<img width="64" height="64" src="${image('perspective','silhouette',64)}" alt="Силуэт в перспективе 64 px"></span></div>${item.observations.map(o=>`<div class="observation"><small>${esc(o.criterion)} · ${esc(o.view)}</small><p>${esc(o.observation)}</p><p class="question">Проверить: ${esc(o.question)}</p></div>`).join('')}${item.modelClass==='building-block'?`<figure><img class="wall" src="${image('front','textured',256,true)}" alt="Кладка 3 на 3"><figcaption>Учебная стена 3×3; одинаковый framing пары</figcaption></figure>`:''}${entry.textures.length?`<details><summary>${item.modelClass==='armor'?'Два слоя 64×32':'Шесть граней 16×16'}</summary><div class="textures">${entry.textures.map(t=>`<figure><a href="${t.path}"><img src="${t.path}" width="${t.width*3}" height="${t.height*3}" alt="${esc(t.id)}"></a><figcaption>${esc(t.id)} · ${t.width}×${t.height} · ×3 для просмотра</figcaption></figure>`).join('')}</div></details>`:''}<details><summary>Все восемь видов: материал и нейтральная форма</summary><div class="views">${BENCHMARK_VIEWS.map(view=>`<figure><a href="${image(view,'textured')}"><img src="${image(view,'textured')}" alt="${esc(view)} текстура"></a><a href="${image(view,'neutral')}"><img src="${image(view,'neutral')}" alt="${esc(view)} форма"></a><figcaption>${esc(view)} · текстура / форма</figcaption></figure>`).join('')}</div></details><footer>${esc(item.representation)}<br><code>${entry.sourceSha256}</code></footer></article>`;
  };
  const titles={weapon:'Оружие',armor:'Броня', 'building-block':'Строительный блок','decorative-prop':'Декоративный алтарь',creature:'Существо'};
  const leaf=manifest.leafAppendix.status==='attached'?`<section id="leaf"><h2>«Лист»: фактические черновики Studio</h2><p>Пользователь выбрал направление A. Объём и текстура ещё не приняты. Эти снимки сняты Studio 0.18.0 при общем framing обоих вариантов, без beauty-фильтра.</p><div class="pair">${manifest.leafAppendix.examples.map(x=>`<article><h3>${x.id==='a'?'Предыдущий объём':'Текущий объём v3c'}</h3><img class="leaf" src="captures/leaf-${x.id}-review.png" alt="Обзор Листа"><p><a href="${x.sourcePath}">Editable source</a> · <a href="captures/leaf-${x.id}-silhouette.png">Силуэт</a></p><details><summary>Восемь видов</summary><div class="views">${BENCHMARK_VIEWS.map(v=>`<a href="captures/leaf-${x.id}-${v}.png"><img src="captures/leaf-${x.id}-${v}.png" alt="${esc(v)}"></a>`).join('')}</div></details></article>`).join('')}</div><p>Фронт показывает спокойную центральную массу, но сбоку клинок выглядит узкой полосой, а воротник выделяется сильнее его объёма. Повторяющиеся ступени видны и с тыла. Следующая задача: проверить переход гребня к кромке и отношение воротника к клинку при сохранении выбранной формы. Это наблюдение агента по PNG, без человеческих баллов.</p></section>`:'<p>Локальные Studio-снимки «Листа» не приложены к этому запуску. Учебный набор остаётся воспроизводимым из tracked source.</p>';
  const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; connect-src 'none'"><title>MineMod — художественный benchmark</title><style>body{margin:0;background:#10141b;color:#dce5ef;font:15px system-ui;line-height:1.65}main{max-width:1300px;margin:auto;padding:32px 24px}h1{font-size:34px;line-height:1.2}h2{font-size:26px;margin:60px 0 12px}h3{font-size:21px;line-height:1.35}p{max-width:1000px}a{color:#9bcfc8}nav{display:flex;flex-wrap:wrap;gap:20px;margin:26px 0}.notice{padding:16px 22px;border-left:3px solid #b9ab7b;background:#1b212c;color:#dcd1ad}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}article{background:#1a212c;border:1px solid #344051;border-radius:14px;padding:22px;min-width:0}.tag{color:#8ec7b7;font-size:13px}.counterexample .tag{color:#d7a58f}.hero{display:block;width:256px;height:256px;max-width:100%;margin:auto;image-rendering:pixelated;background:#202630}.native{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start;margin:20px 0}.native span{font-size:11px;color:#a3b4c8;display:flex;flex-direction:column;gap:10px;align-items:center}.native img{image-rendering:pixelated}.observation{border-top:1px solid #354152;padding-top:12px}.observation small{color:#9aadc3}.observation p{margin:6px 0 12px}.question{color:#c2d2ec}details{margin:18px 0}summary{cursor:pointer;color:#a6c5ec;padding:8px 0}.views{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.views img{display:inline-block;width:50%;image-rendering:pixelated}.views>a>img{width:100%}figure{margin:0}figcaption{font-size:11px;color:#9aadc3}.wall{width:256px;max-width:100%;image-rendering:pixelated}.textures{display:flex;flex-wrap:wrap;gap:16px}.textures img{max-width:100%;image-rendering:pixelated}footer{margin-top:24px;font-size:11px;color:#8b9bb2}code{overflow-wrap:anywhere}.leaf{display:block;width:100%}@media(max-width:780px){main{padding:22px 14px}.pair{grid-template-columns:1fr}h1{font-size:27px}article{padding:18px}}</style></head><body><main><div class="tag">MINEMOD · ART REFERENCE BENCHMARK v1</div><h1>Какая черта делает модель понятнее</h1><p>Десять оригинальных учебных примеров: форма, крепления, материалы и иерархия деталей. В каждой паре одинаковая палитра, масштаб, камера и свет. Сложность меша не даёт художественных баллов.</p><p class="notice">Это reference-сцены, а не готовые игровые модели и не результаты сравнительного сеанса генерации. «Полезная черта» относится к конкретному приёму; human ratings и художественная приёмка не записаны. Манекен не подтверждает работу брони в Minecraft, статичный краб не подтверждает rig или анимацию.</p><nav>${Object.entries(titles).map(([id,title])=>`<a href="#${id}">${title}</a>`).join('')}<a href="#leaf">Лист</a><a href="manifest.json">Manifest для ИИ</a><a href="source.json">Reference source</a></nav>${Object.entries(titles).map(([id,title])=>`<section id="${id}"><h2>${title}</h2><div class="pair">${catalog.examples.filter(x=>x.modelClass===id).map(card).join('')}</div></section>`).join('')}${leaf}<footer>Original procedural references · Codex · модель/seed не зафиксированы · <a href="LICENSE">Apache-2.0</a>. Внешние assets не использованы. Входные control briefs сохранены без изменения: <a href="control-briefs.v1.json">исходный JSON</a>. Нативные PNG 32/64 отрисованы напрямую, крупные виды имеют 256×256. Локальный reference renderer не экспортирует Minecraft assets и не меняет trusted pack/JAR.</footer></main></body></html>`;
  await writeFile(join(output,'index.html'),html);
  await page.goto(pathToFileURL(join(output,'index.html')).href);
  await page.waitForFunction(()=>[...document.images].every(x=>x.complete && x.naturalWidth>0));
  const images=await page.evaluate(async()=>{
    const failures=[];let native=0;
    for(const image of document.images){
      if(/-(32|64)\.png$/u.test(image.src)){native++;const expected=Number(image.src.match(/-(32|64)\.png$/u)[1]);if(image.naturalWidth!==expected || image.width!==expected || image.height!==expected)failures.push('Native dimensions: '+image.src);}
    }
    return {native,failures,articles:document.querySelectorAll('article.trait,article.counterexample').length};
  });
  assert.equal(images.articles,10);assert.equal(images.native,40);assert.deepEqual(images.failures,[]);
  assert.equal(manifest.examples.flatMap(x=>x.captures).filter(x=>x.raster?.foregroundPixels>0).length,40);
  const layouts=[];
  for(const width of [1400,390]){await page.setViewportSize({width,height:1000});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);const path=join(witness,`board-${width}.png`);await page.screenshot({path,fullPage:false});const bytes=await readFile(path);layouts.push({width,overflow,path:resolve(path),sha256:sha(bytes)});}
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  for(const entry of manifest.examples)for(const capture of [...entry.captures,...entry.textures]){const bytes=await readFile(join(output,capture.path));assert.equal(bytes.length,capture.bytes);assert.equal(sha(bytes),capture.sha256);}
  manifest.verification={status:'technical-pass',images,layouts,networkRequests:external.length,browserErrors:errors.length,artisticScore:'not-computed'};
  await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  process.stdout.write(JSON.stringify({status:'REFERENCE_RENDERED',examples:manifest.examples.length,captures:manifest.examples.reduce((n,x)=>n+x.captures.length+x.textures.length,0),leaf:manifest.leafAppendix.status,index:join(output,'index.html'),manifestSha256:sha(await readFile(join(output,'manifest.json')))},null,2)+'\n');
}finally{await browser.close();}

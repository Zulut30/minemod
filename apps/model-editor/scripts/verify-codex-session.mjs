/* global window */
import assert from 'node:assert/strict';
import console from 'node:console';
import { setTimeout, clearTimeout } from 'node:timers';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { randomUUID, createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { _electron as electron } from 'playwright';
import { cubes, blockoutGeometry, AGENT_DRAFT_PREFIX } from '@mcdev/editor-core';
import { verifyAssetBundleV1 } from '../../../packages/application/asset-bundles.ts';

const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const blockoutRun=process.argv.includes('--blockouts');
const roadmapId=blockoutRun?'036':'031', serverName=`studio_verification_${roadmapId}`, tokenVariable=`MINE_MOD_STUDIO_${roadmapId}_TOKEN`;
assert.equal(process.version,'v24.21.0','Use the pinned workspace Node runtime');
const cli=process.env.MINEMOD_CODEX_ENTRY;
assert(cli,'Set MINEMOD_CODEX_ENTRY to the installed @openai/codex/bin/codex.js entrypoint');
const version=spawnSync(process.execPath,[cli,'--version'],{encoding:'utf8',windowsHide:true,timeout:10000});
assert.equal(version.status,0);assert.equal(version.stdout.trim(),'codex-cli 0.160.0','Review another CLI version before changing this verified profile');
const meta=JSON.parse(await readFile(join(root,'output/model-editor/latest-build.json'),'utf8'));
const output=join(root,'output/playwright',`independent-codex-${roadmapId}-${randomUUID().slice(0,8)}`);
await mkdir(join(output,'agent-workspace'),{recursive:true});
const brief=blockoutRun?'Создай с нуля три геометрически разных нейтральных blockout длинного меча «Лист» в выразительном стиле Minecraft. Пользователь выбрал симметричный листовой клинок; исходный 2D-концепт доступен в design.concepts, ориентируйся на колонку A. Варианты должны отличаться распределением ширины, объёмом клинка и конструкцией гарды, а не только цветом. Связная рукоять, крепление клинка и читаемый силуэт в 32/64 px. Материал #aebdcb, без рун и украшений; до 48 кубов на вариант и существующий атлас 256×256. Художественная приёмка и игровая проверка отдельны.':'Создай с нуля короткий односторонний ледяной топор в выразительном стиле Minecraft. Широкая светлая кромка, тёмный обух, гранёный кристалл у основания, короткая асимметричная гарда, удобная рукоять с кожаной обмоткой и заметное крепление головы. Форма должна читаться в 32/64 px с обеих сторон. Палитра #172333, #304b63, #628fa5, #b8e5ed, #e9f8ed, #665040. Создай один самостоятельный дизайн, до 64 кубов и 24 цветов; используй существующий атлас 256×256. Технический exporter не подтверждает художественную приёмку или работу в игре.';
const prompt=blockoutRun?`Ты проводишь самостоятельный verification-сеанс установленного Codex CLI с MineMod Studio. Используй только MCP ${serverName} и чтение его resources. Shell, файловые правки, web, другие MCP, skills, subagents и computer use запрещены. Сначала прочитай live schemas/IDs/revision и бриф; прочитай 2D-концепт через studio_view_capture с conceptId. Исходник пустой, оператор не создаёт геометрию. Бриф: ${brief}
Сам придумай три конструкции. Форму 1 создай через preview/apply, посмотри PNG front/back/side/perspective и обзор с 32/64 px, исправь конкретный видимый дефект, затем сохрани через команду draftVariant с новым UUID в preview/apply. Повтори для форм 2 и 3: меняй рабочую модель разрешёнными командами, оставляя сохранённые снимки неизменными. Нельзя вызывать checkpoint/restoreVariant/deleteVariant, менять brief/locks или подменять PNG. Всего три ИИ-черновика и ручной исходник. Только цвет или другие IDs не считаются новой формой. Батчи до 32 команд; rate 120 POST/min, не делай автоматические повторения при отказе. Прочитай IDs сохранённых снимков и сравни их через variantId/compareToVariantId при одном ракурсе. После трёх форм вызови studio_asset_validate и studio_asset_export format="bundle-v1". Не записывай геометрию или экспорт в файлы; оператор сохранит точный результат. Не выдавай human approval и не утверждай работу в Minecraft. Заверши с actual revision, тремя variant IDs и конкретной визуальной критикой.`:`Ты проводишь самостоятельный verification-сеанс установленного Codex CLI с MineMod Studio. Используй только разрешённые MCP инструменты единственного включённого сервера studio_verification_031 и чтение его resources. Не используй shell, файловые правки, web, другие MCP, skills, subagents или computer use. Все geometry/texture изменения делай только через studio_changes_preview → studio_changes_apply с actual projectId/revision/key. Пустой проект уже создан оператором; сначала прочитай actual schema/IDs/state. Сам придумай конструкцию и размещение частей, не проси оператора делать геометрию. Бриф: ${brief}
После blockout запрашивай реальные PNG через studio_view_capture или studio_model_review, оцени видимый объём и силуэт; исправь найденные проблемы разрешёнными правками. Обязательно посмотри фронт, тыл и перспективу, а также 32/64 px review. Затем вызови studio_asset_validate и studio_asset_export с format="bundle-v1". Не записывай generated geometry или экспорт в файлы: оператор сохранит точный полученный результат для review. Не создавай три варианта и не пытайся выдавать human approval: это ограниченный технический сеанс создания одного дизайна из empty scene. Заверши кратко с реальной revision, количеством кубов, что увидел на PNG и незакрытыми ограничениями. Нельзя утверждать, что модель одобрена человеком или проверена в Minecraft.`;
await writeFile(join(output,'brief.txt'),brief+'\n'); await writeFile(join(output,'prompt.txt'),prompt+'\n');
const flags=['--disable','apps','--disable','plugins','--disable','remote_plugin','--disable','hooks','--disable','memories',
  '--disable','multi_agent','--disable','multi_agent_v2','--disable','shell_tool','--disable','unified_exec',
  '--disable','shell_snapshot','--disable','skill_mcp_dependency_install','-c','web_search="disabled"'];
const probe=spawnSync(process.execPath,[cli,...flags,'mcp','list','--json'],{encoding:'utf8',windowsHide:true,timeout:10000});
assert.equal(probe.status,0,'CLI config probe failed');
const prior=JSON.parse(probe.stdout);
assert(prior.every(s=>/^[-a-zA-Z0-9_]+$/.test(s.name)),'Unsupported config server id');
const disabled=prior.flatMap(s=>['-c',`mcp_servers.${s.name}.enabled=false`]);
const app=await electron.launch({executablePath:meta.executable,args:['--editor-hidden','--editor-test-close',`--editor-data=${join(output,'user-data')}`],
  env:Object.fromEntries(Object.entries(process.env).filter(([k,v])=>k!=='ELECTRON_RUN_AS_NODE'&&typeof v==='string')),timeout:45000});
let child, timer; const events=[], captures=[], exports=[]; let violations=[];
let connection;
const redact=(s)=>connection?.token?s.replaceAll(connection.token,'[redacted-session-token]'):s;
try {
  const page=await app.firstWindow(); await page.getByTestId('part-guard').waitFor();
  assert(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())), 'Owned test window must stay hidden');
  // Only this fresh operator-owned test instance discards its default example.
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
  await page.getByTestId('new-project').click();
  const state=async()=>{const r=await page.evaluate(()=>window.studio.request({kind:'inspect'}));assert(r.ok);return r.state;};
  let initial=await state(); assert.equal(cubes(initial.project).length,0,'Operator must start empty');
  const setBrief=await page.evaluate(mutation=>window.studio.request({kind:'apply',mutation}),{
    projectId:initial.project.projectId,expectedRevision:initial.revision,key:randomUUID(),commands:[{type:'brief',text:brief},...(blockoutRun?[{type:'checkpoint',variantId:randomUUID(),label:'Ручной пустой исходник',note:'Оператор не создаёт геометрию'}]:[])]});
  assert(setBrief.ok); initial=await state(); assert.equal(cubes(initial.project).length,0);
  if(blockoutRun){
    const conceptPath=join(root,'fixtures/production/concepts/weapon-directions-20261005.png');
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},conceptPath);
    const imported=await page.evaluate(control=>window.studio.request({kind:'conceptImport',control}),{
      projectId:initial.project.projectId,expectedRevision:initial.revision,draft:{label:'Лист · направление A',role:'concept',origin:'ai-generated',
      attribution:'OpenAI image_gen · собственный brief',rights:'Оригинальная генерация для проекта; внешние references не использованы. Проверка прав отдельно.',source:'imagegen skill · 2026-10-05',note:'Выбрано направление A: листовая масса. Это 2D направление, не approval модели.'}});
    assert(imported.ok);initial=await state();assert.equal(cubes(initial.project).length,0);
  }
  await writeFile(join(output,'initial-project.json'),JSON.stringify(initial.project,null,2)+'\n');
  const connected=await page.evaluate(()=>window.studio.request({kind:'connection',action:'start'}));
  assert(connected.ok&&connected.connection?.enabled); connection=connected.connection;
  const server=['-c',`mcp_servers.${serverName}.url=${JSON.stringify(connection.url)}`,
    '-c',`mcp_servers.${serverName}.bearer_token_env_var="${tokenVariable}"`,
    '-c',`mcp_servers.${serverName}.default_tools_approval_mode="auto"`,
    '-c',`mcp_servers.${serverName}.tools.studio_changes_apply.approval_mode="approve"`,
    '-c',`mcp_servers.${serverName}.tools.studio_history_undo.approval_mode="approve"`,
    '-c',`mcp_servers.${serverName}.enabled_tools=["studio_project_inspect","studio_variant_inspect","studio_selection_get","studio_changes_preview","studio_changes_apply","studio_history_undo","studio_view_capture","studio_model_review","studio_asset_validate","studio_asset_export"]`,
    '-c',`mcp_servers.${serverName}.enabled=true`];
  const childEnv={...process.env,[tokenVariable]:connection.token};
  delete childEnv.OPENAI_API_KEY; delete childEnv.CODEX_API_KEY;
  const check=spawnSync(process.execPath,[cli,...flags,...disabled,...server,'mcp','list','--json'],{
    encoding:'utf8',windowsHide:true,env:childEnv,timeout:10000});
  assert.equal(check.status,0); const active=JSON.parse(check.stdout).filter(s=>s.enabled!==false);
  assert.equal(active.length,1); assert.equal(active[0].name,serverName);
  const args=[cli,'exec','--json','--ephemeral','--skip-git-repo-check','--sandbox','read-only',
    '-C',join(output,'agent-workspace'),'-c','approval_policy="never"',...flags,...disabled,...server,'-'];
  await writeFile(join(output,'invocation.json'),JSON.stringify({executable:process.execPath,args,
    cliVersion:'0.160.0',inheritedModelSettings:true,auth:'existing local ChatGPT login; no credentials copied',
    enabledMcpServers:[serverName],operatorGeometryChanges:0,userConfigModified:false,blockoutRun},null,2)+'\n');
  console.log(JSON.stringify({started:true,output,projectId:initial.project.projectId,initialRevision:initial.revision,cubes:0,hidden:true}));
  child=spawn(process.execPath,args,{cwd:root,env:childEnv,windowsHide:true,stdio:['pipe','pipe','pipe']});
  child.stdin.end(prompt); let stderr='';
  child.stderr.on('data',d=>{stderr+=redact(d.toString()); if(stderr.length>1000000)child.kill();});
  let timedOut=false;
  timer=setTimeout(()=>{timedOut=true;child.kill();},12*60*1000);
  let exitCode; const done=new Promise(resolve=>child.once('exit',code=>{exitCode=code;resolve();}));
  for await(const line of createInterface({input:child.stdout,crlfDelay:Infinity})) {
    let e; try {e=JSON.parse(line);}catch{continue;}
    const item=e.item;
    if(item?.type==='command_execution'||item?.type==='file_change'||item?.type==='web_search') {
      violations.push(item.type);child.kill();
    }
    if(item?.type==='mcp_tool_call'&&item.server!==serverName) {
      violations.push('other-mcp-server');child.kill();
    }
    if(e.type==='item.completed'&&item?.type==='mcp_tool_call') {
      for(const [i,c] of (item.result?.content??[]).entries()) {
        if(c.type==='image'&&c.data) {
          const data=Buffer.from(c.data,'base64'), file=`${item.id}-${i}.png`;
          await writeFile(join(output,file),data); captures.push({file,tool:item.tool,arguments:item.arguments,
            bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
          delete c.data;c.localCapture=file;
        }
        if(c.type==='text'&&item.tool==='studio_asset_export') {
          let data;try{data=JSON.parse(c.text);}catch{continue;}
          if(data.bundle){verifyAssetBundleV1(data.bundle);const file=`${item.id}-bundle.json`;
            await writeFile(join(output,file),JSON.stringify(data.bundle,null,2)+'\n');exports.push(file);}
        }
      }
      console.log(JSON.stringify({tool:item.tool,status:item.status,event:e.type,events:events.length+1}));
    }
    events.push(e);
    if(events.length>500){violations.push('event-limit');child.kill();}
    await writeFile(join(output,'events.jsonl'),events.map(e=>redact(JSON.stringify(e))).join('\n')+'\n');
  }
  await done; clearTimeout(timer);
  await writeFile(join(output,'stderr.log'),stderr);
  const final=await state(); await writeFile(join(output,'final-project.json'),JSON.stringify(final.project,null,2)+'\n');
  let editablePath;
  if(blockoutRun){
    editablePath=join(output,'three-leaf-blockouts.mmeditor.json');
    await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},editablePath);
    const saved=await page.evaluate(()=>window.studio.request({kind:'save'}));assert(saved.ok);
    assert.deepEqual(JSON.parse(await readFile(editablePath,'utf8')),final.project);
    const concept=final.project.design.concepts[0];
    assert.equal(createHash('sha256').update(await readFile(editablePath+'.assets/concepts/'+concept.sha256+'.png')).digest('hex'),concept.sha256);
  }
  const hidden=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible()));
  const completed=events.find(e=>e.type==='turn.completed');
  const variants=final.project.design?.variants.filter(v=>v.label.startsWith(AGENT_DRAFT_PREFIX))??[];
  const proposedDraftIds=events.filter(e=>e.type==='item.completed'&&e.item?.type==='mcp_tool_call'&&e.item.tool==='studio_changes_preview')
    .flatMap(e=>(e.item.arguments.commands??[]).filter(c=>c.type==='draftVariant').map(c=>c.variantId));
  const blockoutPass=!blockoutRun||(variants.length===3&&new Set(variants.map(v=>blockoutGeometry(v.project))).size===3&&
    variants.every(v=>proposedDraftIds.includes(v.id))&&JSON.stringify(final.project.design.variants[0])===JSON.stringify(initial.project.design.variants[0]));
  const technicalPass=exitCode===0&&!timedOut&&hidden&&!violations.length&&!!completed&&blockoutPass&&
    cubes(final.project).length>0&&captures.length>0&&exports.length>0&&!stderr.includes('Skipping MCP tool');
  const report={schemaVersion:1,status:technicalPass?'PASS':'FAIL',actor:'Installed Codex CLI independent model turn',cliVersion:'0.160.0',
    output,executable:meta.executable,studioVersion:meta.version,initialCubes:cubes(initial.project).length,
    finalCubes:cubes(final.project).length,initialRevision:initial.revision,finalRevision:final.revision,
    projectId:final.project.projectId,exitCode,timedOut,hidden,violations,captures,exports,usage:completed?.usage??null,
    mcpCalls:events.filter(e=>e.type==='item.completed'&&e.item?.type==='mcp_tool_call').length,
    completed:!!completed,artisticApproval:'not-granted',minecraftAcceptance:'not-tested',blockoutRun,blockoutPass,
    variants:variants.map(v=>({id:v.id,label:v.label,geometrySha256:createHash('sha256').update(blockoutGeometry(v.project)).digest('hex')})),
    operatorGeometryChanges:0,operatorSnapshots:blockoutRun?1:0,agentDrafts:variants.length,editablePath,
    fullControlBrief005:blockoutRun?'not-tested: three neutral blockouts from one direction, no game views':'not-tested: single-design 256 atlas technical session, not three variants or game views'};
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if(!technicalPass)process.exitCode=1;
} finally {
  clearTimeout(timer);if(child&&child.exitCode===null)child.kill();
  await app.close();
}

/* global window */
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import {Buffer} from 'node:buffer';
import {setTimeout,clearTimeout} from 'node:timers';
import {spawn,spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {URL,fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import { _electron as electron } from 'playwright';
import {cubes} from '@mcdev/editor-core';
import {verifyAssetBundleV1} from '../../../packages/application/asset-bundles.ts';
import {retainNativeExport} from './retain-native-export.mjs';
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
assert.equal(process.version,'v24.21.0','Use pinned workspace Node');
const cli=process.env.MINEMOD_CLAUDE_EXE;assert(cli,'Set MINEMOD_CLAUDE_EXE to the installed Claude Code executable');
const version=spawnSync(cli,['--version'],{encoding:'utf8',windowsHide:true,timeout:10000});
assert.equal(version.status,0);assert.equal(version.stdout.trim(),'2.1.289 (Claude Code)');
const auth=spawnSync(cli,['auth','status'],{encoding:'utf8',windowsHide:true,timeout:10000});
assert.equal(auth.status,0);const login=JSON.parse(auth.stdout);assert(login.loggedIn&&login.authMethod==='claude.ai');
let userSettings={};try{userSettings=JSON.parse(await readFile(join(login.configDirectory,'settings.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const enabledPlugins=Object.fromEntries(Object.keys(userSettings.enabledPlugins??{}).map(name=>[name,false]));
const output=join(root,'output/playwright',`independent-claude-032-${randomUUID().slice(0,8)}`);
await mkdir(join(output,'agent-workspace'),{recursive:true});
const brief='Создай с нуля короткий односторонний ледяной топор в выразительном стиле Minecraft. Широкая светлая кромка, тёмный обух, гранёный кристалл у основания, короткая асимметричная гарда, удобная рукоять с кожаной обмоткой и заметное крепление головы. Форма должна читаться в 32/64 px с обеих сторон. Палитра #172333, #304b63, #628fa5, #b8e5ed, #e9f8ed, #665040. Создай один самостоятельный дизайн, до 64 кубов и 24 цветов; используй существующий атлас 256×256. Технический exporter не подтверждает художественную приёмку или работу в игре.';
const prompt=`Самостоятельный технический сеанс установленного Claude Code с MineMod Studio. Разрешены только 10 MCP инструментов studio_verification_032. Не используй shell, файловые изменения, web, skills, subagents, computer use или другие MCP. Оператор создал пустой проект и записал только бриф; всю геометрию и рисунок создаёшь ты. Сначала прочитай actual state/IDs через studio_project_inspect и studio_selection_get; схемы входов уже опубликованы в MCP. Изменения только studio_changes_preview → studio_changes_apply с актуальными projectId/revision и UUID key. Бриф: ${brief}\nСам придумай конструкцию. После blockout получи реальные PNG через studio_model_review (4 вида, силуэт, 32/64 px), назови конкретные видимые недостатки и исправь их. Затем получи PNG фронта, тыла и перспективы. Выполни studio_asset_validate и studio_asset_export format="bundle-v1"; не записывай файлы, точный export сохранит оператор. Один дизайн; художественного human approval и проверки Minecraft ещё нет. Заверши кратко: реальная revision, что проверено по PNG и ограничения. Если запрещённая операция недоступна, не обходи запрет.`;
await writeFile(join(output,'brief.txt'),brief+'\n');await writeFile(join(output,'prompt.txt'),prompt+'\n');
const meta=JSON.parse(await readFile(join(root,'output/model-editor/latest-build.json'),'utf8'));
const app=await electron.launch({executablePath:meta.executable,args:['--editor-hidden','--editor-test-close',`--editor-data=${join(output,'user-data')}`],
  env:Object.fromEntries(Object.entries(process.env).filter(([k,v])=>k!=='ELECTRON_RUN_AS_NODE'&&typeof v==='string')),timeout:45000});
const names=['studio_project_inspect','studio_variant_inspect','studio_selection_get','studio_changes_preview','studio_changes_apply','studio_history_undo','studio_view_capture','studio_model_review','studio_asset_validate','studio_asset_export'];
const allowed=names.map(n=>`mcp__studio_verification_032__${n}`);
let connection,child,timer;const events=[],captures=[],exports=[],nativeOutputs=[],violations=[],calls=new Map();
const redact=s=>connection?.token?s.replaceAll(connection.token,'[redacted-session-token]'):s;
try{
 const page=await app.firstWindow();await page.getByTestId('part-guard').waitFor();
 assert(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())));
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
 await page.getByTestId('new-project').click();
 const state=async()=>{const r=await page.evaluate(()=>window.studio.request({kind:'inspect'}));assert(r.ok);return r.state;};
 let initial=await state();assert.equal(cubes(initial.project).length,0);
 const attached=await page.evaluate(mutation=>window.studio.request({kind:'apply',mutation}),{projectId:initial.project.projectId,expectedRevision:initial.revision,key:randomUUID(),commands:[{type:'brief',text:brief}]});assert(attached.ok);
 initial=await state();assert.equal(cubes(initial.project).length,0);await writeFile(join(output,'initial-project.json'),JSON.stringify(initial.project,null,2)+'\n');
 const result=await page.evaluate(()=>window.studio.request({kind:'connection',action:'start'}));assert(result.ok&&result.connection.enabled);connection=result.connection;
 const config={mcpServers:{studio_verification_032:{type:'http',url:connection.url,headers:{Authorization:'Bearer ${MINEMOD_STUDIO_032_TOKEN}'}}}};
 const settings={disableAllHooks:true,enabledPlugins,autoMemoryEnabled:false};
 const args=['-p','--verbose','--output-format','stream-json','--tools','','--allowedTools',allowed.join(','),
  '--strict-mcp-config','--mcp-config',JSON.stringify(config),'--setting-sources','user','--settings',JSON.stringify(settings),
  '--permission-mode','dontAsk','--permission-prompts','none','--disable-slash-commands','--no-session-persistence'];
 const env={...process.env,MINEMOD_STUDIO_032_TOKEN:connection.token,ENABLE_TOOL_SEARCH:'false'};
 delete env.ANTHROPIC_API_KEY;delete env.ANTHROPIC_AUTH_TOKEN;delete env.CLAUDE_CODE_OAUTH_TOKEN;
 await writeFile(join(output,'invocation.json'),JSON.stringify({executable:cli,args,auth:'existing claude.ai login',modelSettings:'inherited',userConfigModified:false,operatorGeometryChanges:0},null,2)+'\n');
 child=spawn(cli,args,{cwd:join(output,'agent-workspace'),env,windowsHide:true,stdio:['pipe','pipe','pipe']});child.stdin.end(prompt);
 console.log(JSON.stringify({started:true,output,initialRevision:initial.revision,initialCubes:0,hidden:true}));
 let stderr='',timedOut=false,exitCode;child.stderr.on('data',d=>{stderr+=redact(d.toString());if(stderr.length>1000000)child.kill();});
 const done=new Promise((resolve,reject)=>{child.once('exit',code=>{exitCode=code;resolve();});child.once('error',reject);});
 timer=setTimeout(()=>{timedOut=true;child.kill();},12*60*1000);
 async function retain(value,id,call){
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){for(const c of value)await retain(c,id,call);return;}
  const encoded=value.type==='image'?(value.source?.data??value.data):undefined;
  if(encoded){const b=Buffer.from(encoded,'base64'),file=`${id}-${captures.length}.png`;await writeFile(join(output,file),b);
    captures.push({file,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex'),tool:call?.name,arguments:call?.input});
    if(value.source)delete value.source.data;delete value.data;value.localCapture=file;
  }
  if(value.type==='text'&&call?.name.endsWith('__studio_asset_export')){
    let data;try{data=JSON.parse(value.text);}catch{/* Native CLI may retain oversized export separately. */}
    if(data?.bundle){verifyAssetBundleV1(data.bundle);const file=`${id}-bundle.json`;await writeFile(join(output,file),JSON.stringify(data.bundle,null,2)+'\n');exports.push(file);}
  }
  for(const c of Object.values(value))await retain(c,id,call);
 }
 for await(const line of createInterface({input:child.stdout,crlfDelay:Infinity})){
  let e;try{e=JSON.parse(line);}catch{continue;}
  if(e.type==='system'&&e.subtype==='init'){
    const other=(e.tools??[]).filter(n=>!allowed.includes(n)&&n!=='EndConversation');
    if(other.length){violations.push(`Unexpected exposed tools: ${other.join(',')}`);child.kill();}
    const servers=e.mcp_servers??[];if(servers.some(s=>s.name!=='studio_verification_032')||!servers.some(s=>s.name==='studio_verification_032'&&s.status==='connected')){violations.push('Expected sole Studio connection');child.kill();}
  }
  for(const block of e.message?.content??[]){
    if(block.type==='tool_use'){
      if(!allowed.includes(block.name)&&block.name!=='EndConversation'){violations.push(block.name);child.kill();}
      calls.set(block.id,{name:block.name,input:block.input});console.log(JSON.stringify({tool:block.name,event:e.type,events:events.length+1}));
    }
    if(block.type==='tool_result'){
      const call=calls.get(block.tool_use_id);
      await retain(block.content,block.tool_use_id,call);
      if(!block.is_error){
        const retained=await retainNativeExport(block.content,block.tool_use_id,call,{output,
          init:events.find(e=>e.type==='system'&&e.subtype==='init'),projectsDirectory:login.projectsDirectory});
        if(retained){exports.push(retained.file);nativeOutputs.push(retained.native);}
      }
    }
  }
  events.push(e);if(events.length>500){violations.push('event-limit');child.kill();}
  await writeFile(join(output,'events.jsonl'),events.map(e=>redact(JSON.stringify(e))).join('\n')+'\n');
 }
 await done;clearTimeout(timer);await writeFile(join(output,'stderr.log'),stderr);
 const final=await state();await writeFile(join(output,'final-project.json'),JSON.stringify(final.project,null,2)+'\n');
 const hidden=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible()));
 const completed=events.find(e=>e.type==='result');
 const pass=exitCode===0&&!timedOut&&hidden&&!violations.length&&completed&&!completed.is_error&&cubes(final.project).length>0&&captures.length>0&&exports.length>0;
 const report={schemaVersion:1,status:pass?'PASS':'FAIL',actor:'Installed Claude Code independent model turn',cliVersion:'2.1.289',
  studioVersion:meta.version,executable:meta.executable,output,projectId:initial.project.projectId,initialRevision:initial.revision,finalRevision:final.revision,
  initialCubes:0,finalCubes:cubes(final.project).length,hidden,exitCode,timedOut,violations,captures,exports,nativeOutputs,mcpCalls:calls.size,
  actualModel:events.find(e=>e.type==='system'&&e.subtype==='init')?.model,usage:completed?.usage??null,
  artisticApproval:'not-granted',minecraftAcceptance:'not-tested',fullControlBrief005:'not-tested: same single-design technical brief as 031; not three variants/game views'};
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,output,finalCubes:report.finalCubes,revision:report.finalRevision,captures:captures.length,exports:exports.length,violations}));
 if(!pass)process.exitCode=1;
}finally{clearTimeout(timer);if(child&&child.exitCode===null)child.kill();await app.close();}

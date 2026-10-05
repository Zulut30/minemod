/* global window, document */
import { _electron as electron } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { cubes, blockoutGeometry, texturePixels, textureMask } from "@mcdev/editor-core";
import { verifyAssetBundleV1 } from "../../../packages/application/asset-bundles.ts";
import { comparisonFrame } from "../renderer/camera.ts";

export async function checkAgentBlockoutsDesktop(options, output) {
  const root = join(output, "agent-blockouts");
  await mkdir(root, { recursive: true });
  const launchOptions = { ...options, args: options.args.filter(a => !a.startsWith("--editor-data=")).concat(`--editor-data=${join(root, "user-data")}`) };
  let application = await electron.launch(launchOptions), client;
  const trace = [], captures = [], problems = [];
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  try {
    let page = await application.firstWindow();
    page.on("pageerror", e => problems.push(e.message));
    await page.getByTestId("part-guard").waitFor();
    const sourcePath = join(root, "три черновика.mmeditor.json");
    await application.evaluate(({ dialog }, path) => {
      dialog.showMessageBox = async () => ({ response: 1 });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, sourcePath);
    await page.getByTestId("new-project").click();
    const inspect = async () => { const result = await page.evaluate(() => window.studio.request({ kind: "inspect" })); assert(result.ok); return result.state; };
    const settled = async () => page.waitForFunction(() => !document.querySelector('[data-testid="save-project"]').disabled);
    const human = async commands => {
      const state = await inspect();
      const result = await page.evaluate(mutation => window.studio.request({ kind: "apply", mutation }), {
        projectId: state.project.projectId, expectedRevision: state.revision, key: randomUUID(), commands,
      });
      assert(result.ok, JSON.stringify(result)); await settled();
    };
    const recipe = JSON.parse(await readFile(new URL("../../../fixtures/production/weapon-blockouts.v1.json", import.meta.url), "utf8"));
    const protectedIds = ["grip", "pommel", "collar"];
    assert.equal(cubes((await inspect()).project).length, 0);
    const shapes = recipe.variants[0].shapes.filter(s => protectedIds.includes(s.id));
    for (const s of shapes) await human([
      { type: "add", cubeId: s.id },
      { type: "transform", cubeIds: [s.id], translation: s.origin.map((n,i) => n - [7,8,7][i]), scale: s.size.map(n => n / 2) },
      { type: "recolor", cubeIds: [s.id], color: recipe.material },
    ]);
    const gripFace = (await inspect()).project.texturePlan.faces.find(f => f.cubeId === "grip").uv.north;
    const baselineId = randomUUID();
    await human([
      { type: "paint", cubeIds: ["grip"], face: "north", color: "#61798b", points: [[gripFace[0]+1,gripFace[1]+1]], size: 1 },
      { type: "groupPart", partId: "manual_handle", label: "Ручная рукоять", cubeIds: protectedIds },
      { type: "lock", partId: "manual_handle", locked: true },
      { type: "brief", text: "Три нейтральные формы меча: Лист, Клык и Раскол. Сохранить ручную рукоять и рисунок; выбрать направление до текстуры." },
      { type: "checkpoint", variantId: baselineId, label: "Ручной исходник", note: "Locked geometry and one authored pixel" },
    ]);
    const baseline = await inspect();
    await writeFile(join(root,"initial-project.json"),JSON.stringify(baseline.project,null,2)+"\n");
    const original = baseline.project.design.variants[0];
    const manualPixels = texturePixels(baseline.project), mask = textureMask(baseline.project,protectedIds);
    const protectedCubes = cubes(baseline.project);
    const checkProtected = state => {
      assert.deepEqual(state.project.design.variants[0],original);
      assert.deepEqual(cubes(state.project).filter(c => protectedIds.includes(c.id)),protectedCubes);
      assert(state.project.parts.find(p => p.id === "manual_handle").locked);
      assert.equal(state.project.design.brief,baseline.project.design.brief);
      const pixels = texturePixels(state.project);
      for(let i=0;i<mask.length;i++) if(mask[i]) assert.equal(pixels[i],manualPixels[i]);
    };
    const connection = await page.evaluate(() => window.studio.request({ kind:"connection",action:"start" }));
    assert(connection.ok);
    client = new Client({ name:"agent-blockout-functional-proof",version:"1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(connection.connection.url),{ requestInit:{ headers:{ Authorization:`Bearer ${connection.connection.token}` } } }));
    const call = async (name,args={}) => {
      const result = await client.callTool({name,arguments:args});
      const data = JSON.parse(result.content.find(c => c.type==="text").text);
      trace.push({name,args,result:data,isError:!!result.isError});return {result,data};
    };
    const ref = async () => { const state = await inspect(); return {projectId:state.project.projectId,expectedRevision:state.revision}; };
    const agent = async commands => {
      const preview = await call("studio_changes_preview",{...(await ref()),key:randomUUID(),commands});
      assert(!preview.result.isError,JSON.stringify(preview.data));
      const result = await call("studio_changes_apply",{projectId:baseline.project.projectId,proposalId:preview.data.proposalId});
      assert(!result.result.isError,JSON.stringify(result.data));await settled();checkProtected(await inspect());
    };
    const deny = async (commands,code) => {
      const before = await inspect();
      const rejected = await call("studio_changes_preview",{...(await ref()),key:randomUUID(),commands});
      assert(rejected.result.isError);assert.equal(rejected.data.error.code,code);assert.deepEqual(await inspect(),before);
    };
    const advertised = await client.listTools();
    const commandSchema = advertised.tools.find(t => t.name==="studio_changes_preview").inputSchema.properties.commands.items;
    assert((commandSchema.oneOf??commandSchema.anyOf).some(s => s.properties.type.const==="draftVariant"));
    const variants = [];
    for (const variant of recipe.variants) {
      const old = cubes((await inspect()).project).filter(c => !protectedIds.includes(c.id)).map(c => c.id);
      if(old.length) await agent([{type:"delete",cubeIds:old}]);
      const editable = variant.shapes.filter(s => !protectedIds.includes(s.id));
      for(let offset=0;offset<editable.length;offset+=8) await agent(editable.slice(offset,offset+8).flatMap(s => [
        {type:"add",cubeId:s.id},
        {type:"transform",cubeIds:[s.id],translation:s.origin.map((n,i) => n - [7,8,7][i]),scale:s.size.map(n => n/2)},
        {type:"recolor",cubeIds:[s.id],color:recipe.material},
      ]));
      const state = await inspect();
      const key = randomUUID(), variantId = randomUUID();
      const args = {...(await ref()),key,commands:[{type:"draftVariant",variantId,label:variant.label,note:variant.note.slice(0,300)}]};
      const proposed = await call("studio_changes_preview",args);assert(!proposed.result.isError);assert.deepEqual(await inspect(),state);
      const applied = await call("studio_changes_apply",{projectId:baseline.project.projectId,proposalId:proposed.data.proposalId});assert(!applied.result.isError);await settled();
      const after = await inspect();checkProtected(after);
      const replayed = await call("studio_changes_apply",{projectId:baseline.project.projectId,proposalId:proposed.data.proposalId});assert(!replayed.result.isError);assert.deepEqual(await inspect(),after);
      const snapshot = after.project.design.variants.find(v => v.id===variantId);assert(snapshot.label.startsWith("ИИ-черновик · "));
      assert.deepEqual(snapshot.project.model,after.project.model);assert.deepEqual(snapshot.project.texturePlan,after.project.texturePlan);
      variants.push({key:variant.key,id:variantId,label:snapshot.label,geometry:blockoutGeometry(snapshot.project)});
      if(variants.length===1){
        await deny([{type:"recolor",cubeIds:["blade_mass"],color:"#8fa2b3"},{type:"draftVariant",variantId:randomUUID(),label:"Только цвет"}],"VARIANT_GEOMETRY_DUPLICATE");
        await deny([{type:"transform",cubeIds:["blade_mass"],translation:[.25,0,0],scale:[1,1,1]},{type:"draftVariant",variantId:baselineId,label:"Подмена"}],"VARIANT_ID");
        await deny([{type:"transform",cubeIds:["grip"],translation:[0,.25,0],scale:[1,1,1]}],"LOCKED");
      }
    }
    assert.equal(new Set(variants.map(v => v.geometry)).size,3);
    const final = await inspect();checkProtected(final);assert.equal(final.project.design.variants.length,4);
    await deny([{type:"transform",cubeIds:["blade_mass"],translation:[.25,0,0],scale:[1,1,1]},{type:"draftVariant",variantId:randomUUID(),label:"Четвёртый"}],"VARIANT_LIMIT");
    await deny([{type:"restoreVariant",variantId:variants[0].id}],"HUMAN_ONLY");
    await deny([{type:"deleteVariant",variantId:baselineId}],"HUMAN_ONLY");
    const frames = [];
    for(const variant of variants){
      const reference = variants[variant.key==="b"?0:1];
      const pair = [variant,reference].map(v => final.project.design.variants.find(s => s.id===v.id).project);
      frames.push(comparisonFrame(pair));
      const args = {...(await ref()),variantId:variant.id,compareToVariantId:reference.id};
      for(const view of ["front","back","left","right","top","bottom","perspective","rear-perspective","silhouette","review"]){
        const name = view==="review"?"studio_model_review":"studio_view_capture";
        const shot = await call(name,{...args,...(view==="review"?{}:{view:view==="silhouette"?"front":view,...(view==="silhouette"?{silhouette:true}:{})})});
        assert(!shot.result.isError,JSON.stringify(shot.data));
        const bytes = Buffer.from(shot.result.content.find(c => c.type==="image").data,"base64");
        assert.equal(bytes.readUInt32BE(16),1024);assert.equal(bytes.readUInt32BE(20),768);
        const path = `${variant.key}-${view}.png`;await writeFile(join(root,path),bytes);captures.push({path,sha256:hash(bytes),bytes:bytes.length,metadata:shot.data});
      }
    }
    assert(frames.every(frame => JSON.stringify(frame)===JSON.stringify(frames[0])));
    assert.deepEqual(await inspect(),final,"Captures do not modify project/history");
    await page.getByTestId("mode-variants").click();
    await page.getByLabel("Вариант для сравнения").selectOption(variants[0].id);
    await page.getByTestId("restore-variant").click();await settled();
    const chosen = await inspect(), firstSnapshot = final.project.design.variants.find(v => v.id===variants[0].id);
    for(const key of ["model","texturePlan","parts"])assert.deepEqual(chosen.project[key],firstSnapshot.project[key]);
    await deny([{type:"undo"}],"HUMAN_HISTORY");
    await page.locator(".variant-history").getByRole("button",{name:"Отмена",exact:true}).click();await settled();
    assert.deepEqual((await inspect()).project,final.project);
    await page.getByTestId("save-project").click();await settled();
    assert.deepEqual(JSON.parse(await readFile(sourcePath,"utf8")),final.project);
    const exported = await call("studio_asset_export",{...(await ref()),format:"bundle-v1"});assert(!exported.result.isError);verifyAssetBundleV1(exported.data.bundle);
    await writeFile(join(root,"bundle.json"),JSON.stringify(exported.data.bundle,null,2)+"\n");
    await client.close();client=undefined;await application.close();
    application = await electron.launch(launchOptions);page = await application.firstWindow();
    await page.getByTestId("new-project").waitFor();
    await page.waitForFunction(() => window.studio.request({kind:"inspect"}).then(r => r.ok && r.state.project.design?.variants.length===4));
    assert.deepEqual((await inspect()).project,final.project);
    assert(await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().every(w => !w.isVisible())));
    assert.deepEqual(problems,[]);
    const report = {status:"PASS",root,hidden:true,actor:"Actual MCP SDK agent operations",independentModelTurn:false,operatorBaselineCubes:protectedIds.length,
      snapshotCreation:"All three drafts created through MCP preview/apply; operator created only manual baseline",
      variants:variants.map(({geometry,...v}) => ({...v,geometrySha256:hash(geometry)})),allFramesEqual:true,
      captures,sourcePath,sourceSha256:hash(await readFile(sourcePath)),manualSourceAndPixelsPreserved:true,
      restoreUndo:true,replay:true,restart:true,exportVerified:true,artisticApproval:"NOT_PERFORMED",gameAcceptance:"NOT_RUN"};
    await writeFile(join(root,"trace.json"),JSON.stringify(trace,null,2)+"\n");await writeFile(join(root,"report.json"),JSON.stringify(report,null,2)+"\n");
    return report;
  } finally {await client?.close();await application?.evaluate(({app}) => app.exit(0)).catch(() => undefined);}
}

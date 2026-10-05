import assert from 'node:assert/strict';
import {readFile,writeFile,lstat,realpath} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyAssetBundleV1} from '../../../packages/application/asset-bundles.ts';

// Оператор читает только native tool-result своего CLI-сеанса; агенту File/Read не добавляется.
export async function retainNativeExport(text,id,call,{output,init,projectsDirectory}) {
  if(call?.name!=='mcp__studio_verification_032__studio_asset_export'||typeof text!=='string')return;
  const match=text.match(/Output has been saved to ([a-zA-Z]:\\[^\r\n]+\.txt)\./);if(!match)return;
  assert(/^toolu_[a-zA-Z0-9]+$/.test(id));
  assert(init&&init.cwd===join(output,'agent-workspace')&&/^[a-f0-9-]{36}$/.test(init.session_id));
  const path=resolve(match[1]),expected=resolve(projectsDirectory,
    init.cwd.replace(/[^a-zA-Z0-9]/g,'-'),init.session_id,'tool-results');
  assert.equal(dirname(path).toLowerCase(),expected.toLowerCase());
  assert(/^mcp-studio_verification_032-studio_asset_export-\d+\.txt$/.test(basename(path)));
  const stats=await lstat(path);assert(stats.isFile()&&!stats.isSymbolicLink()&&stats.size<=2097152);
  assert.equal(dirname(await realpath(path)).toLowerCase(),(await realpath(expected)).toLowerCase());
  const bytes=await readFile(path);assert(bytes.length<=2097152);
  const data=JSON.parse(bytes.toString('utf8'));
  assert.equal(data.projectId,call.input.projectId);assert.equal(data.revision,call.input.expectedRevision);
  verifyAssetBundleV1(data.bundle);
  const file=`${id}-bundle.json`,nativeFile=`${id}-native-tool-output.txt`;
  await writeFile(join(output,nativeFile),bytes);await writeFile(join(output,file),JSON.stringify(data.bundle,null,2)+'\n');
  return {file,native:{toolUseId:id,path,retained:nativeFile,bytes:bytes.length,
    sha256:createHash('sha256').update(bytes).digest('hex')}};
}

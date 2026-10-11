// Derived portable replay. Recorded evidence is never overwritten.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const verify=await import(new URL('./verify-package.mjs',import.meta.url));
await verify.verifyPackage();
if(process.argv.includes('--verify-only'))process.exit(0);
if(!process.versions.node.startsWith('24.'))throw Error('Replay requires Node24, recorded runtime24.19.0');
const required=name=>{const v=process.env[name];if(!v)throw Error('Required environment variable '+name);return resolve(v);};
const { preflightConsumers } = await import(new URL('./preflight-consumers.mjs',import.meta.url));
const consumerPreflight=preflightConsumers();
console.log(JSON.stringify({status:'consumer-preflight-passed',...consumerPreflight.reports}));
if(process.argv.includes('--preflight-only'))process.exit(0);
const { entries }=consumerPreflight;
const cache=required('QRGEN_EAN_STUDY_CACHE_DIR'),prepared=required('QRGEN_EAN_PREPARED_FIXTURES_DIR'),dependency=required('QRGEN_DEPENDENCY_ROOT');
const req=createRequire(join(dependency,existsSync(join(dependency,'packages/sdk/package.json'))?'packages/sdk/package.json':'package.json'));
const sharp=req('sharp'),{PNG}=req('pngjs');
const { planReplayWorkspace }=await import(new URL('./output-workspace.mjs',import.meta.url));
const outputPlan=planReplayWorkspace({explicitOutput:process.env.QRGEN_STAGED_MATRIX_OUTPUT_DIR,protectedRoots:[here,dependency,cache,prepared,...Object.values(entries).map(e=>resolve(dirname(e),'..'))]});
// Both choices have passed identical canonical containment checks before any creation.
let workspace;
if(outputPlan.kind==='explicit'){mkdirSync(outputPlan.path,{recursive:true});workspace=outputPlan.path;}
else workspace=mkdtempSync(outputPlan.prefix);
const portableBytes=gunzipSync(readFileSync(join(here,'portable-plan.json.gz'))),plan=JSON.parse(portableBytes);
const sourcePath=i=>i.group==='generated-72-format-matrix'?join(prepared,i.id+'.png'):join(cache,i.sourceCacheRelative);
const transports=join(workspace,'transports');mkdirSync(transports);
async function load(i,bytes){
 if(i.loadType==='png'){const p=PNG.sync.read(bytes);return{width:p.width,height:p.height,data:p.data};}
 if(i.loadType==='original'){const{data,info}=await sharp(bytes).flatten({background:'#ffffff'}).removeAlpha().toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});return{width:info.width,height:info.height,data};}
 if(i.loadType==='negative-derived'){
  const{data,info}=await sharp(bytes).flatten({background:'#ffffff'}).removeAlpha().toColourspace('srgb').resize({width:640,height:480,fit:'inside',withoutEnlargement:true,kernel:'lanczos3'}).raw().toBuffer({resolveWithObject:true});
  const left=Math.floor((640-info.width)/2),top=Math.floor((480-info.height)/2),rgba=Buffer.alloc(640*480*4);
  for(let p=0;p<640*480;p++){rgba[p*4]=rgba[p*4+1]=rgba[p*4+2]=214;rgba[p*4+3]=255;}
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const j=(y*info.width+x)*3,Y=Math.round(16+(65.738*data[j]+129.057*data[j+1]+25.064*data[j+2])/255),v=Math.max(0,Math.min(255,Math.round((Y-16)*255/219))),k=((y+top)*640+x+left)*4;rgba[k]=rgba[k+1]=rgba[k+2]=v;}
  return{width:640,height:480,data:rgba};
 }
 throw Error('Unknown frozen raster loader');
}
for(const[index,i]of plan.items.entries()){
 const source=sourcePath(i),bytes=readFileSync(source);if(sha(bytes)!==i.fileSha256)throw Error('Source file changed '+i.key);
 let p,transport=bytes,path=source;
 if(i.reusedSourceBytes)p=PNG.sync.read(bytes);
 else{p=await load(i,bytes);const encoded=new PNG({width:p.width,height:p.height});encoded.data=Buffer.from(p.data);transport=PNG.sync.write(encoded,{colorType:6,inputColorType:6,inputHasAlpha:true});path=join(transports,String(index).padStart(4,'0')+'.png');writeFileSync(path,transport);}
 const check=PNG.sync.read(transport);if(check.width!==i.width||check.height!==i.height||sha(check.data)!==i.rgbaSha256||sha(transport)!==i.transportSha256)throw Error('Frozen transport/pixel mismatch '+i.key);
 i.path=source;i.transportPath=path;
}
plan.replay={preparedAt:new Date().toISOString(),scope:'Derived resolved-path replay plan; not original frozen-plan bytes',portablePlanSha256:sha(portableBytes),originalPlanSha256:JSON.parse(readFileSync(join(here,'original-evidence-hashes.json'))).files['frozen-plan.json'].sha256};
const resolvedBytes=Buffer.from(JSON.stringify(plan,null,2)+'\n');writeFileSync(join(workspace,'frozen-plan.json'),resolvedBytes);writeFileSync(join(workspace,'freeze.json'),JSON.stringify({planSha256:sha(resolvedBytes),decodeCalls:0,scope:'Fresh derived replay plan prepared before SDK imports'},null,2)+'\n');
for(const file of['run-consumer.mjs','summarize.mjs'])copyFileSync(join(here,file),join(workspace,file));
writeFileSync(join(workspace,'replay-provenance.json'),JSON.stringify({createdAt:new Date().toISOString(),node:process.version,replayRunnerSha256:sha(readFileSync(fileURLToPath(import.meta.url))),portablePlanSha256:sha(portableBytes),resolvedPlanSha256:sha(resolvedBytes),consumerPreflight:consumerPreflight.reports,counts:plan.counts,sharp:sharp.versions,pngjs:req('pngjs/package.json').version},null,2)+'\n');
console.log('Fresh replay workspace: '+workspace);
for(const label of['baseline','candidate'])for(const format of['esm','cjs']){
 const entry=format==='esm'?entries[label]:entries[label].replace(/\.js$/,'.cjs');
 const result=spawnSync(process.execPath,[join(workspace,'run-consumer.mjs'),label,format,entry,join(workspace,label+'-'+format)],{stdio:'inherit'});if(result.error||result.status!==0)throw result.error??Error('Replay SDK run failed: '+label+'/'+format);
}
const summary=spawnSync(process.execPath,[join(workspace,'summarize.mjs')],{stdio:'inherit'});if(summary.error||summary.status!==0)throw summary.error??Error('Replay summarization failed');
console.log('Fresh outputs are separate from historical recorded evidence. Compare full normalized results and summary explicitly.');

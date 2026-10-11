// Derived portable launcher. All generated files go into a new external directory.
import {readFile,writeFile,mkdir,copyFile,realpath,stat} from 'node:fs/promises';
import {resolve,dirname,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const packageRoot=dirname(fileURLToPath(import.meta.url)),hash=b=>createHash('sha256').update(b).digest('hex');
const readJson=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
function required(k){if(!process.env[k])throw Error('Required environment variable '+k);return resolve(process.env[k]);}
async function prospectiveCanonical(p){try{return await realpath(p);}catch(e){if(e.code!=='ENOENT')throw e;return join(await prospectiveCanonical(dirname(p)),p.split(/[\\/]/).at(-1));}}
function inside(p,parent){const rel=relative(parent,p);return rel===''||(!rel.startsWith('..')&&!isAbsolute(rel));}
const mode=process.argv[3]??'all';if(!['all','offline-smoke','cleanup','check-inputs'].includes(mode))throw Error('Mode must be all, offline-smoke, cleanup or check-inputs.');
if(!process.argv[2])throw Error('Usage: node replay.mjs NEW_EXTERNAL_OUTPUT_DIR [all|offline-smoke|cleanup|check-inputs]');
const repo=await realpath(required('QRGEN_DIAGNOSTIC_REPO')),stage=await realpath(required('QRGEN_STAGED_SDK_ROOT')),input=await realpath(required('QRGEN_STAGED_INPUT_DIR'));
required('QRGEN_CHROMIUM');
const output=await prospectiveCanonical(resolve(process.argv[2]));
for(const protectedRoot of [await realpath(packageRoot),repo,input,stage])if(inside(output,protectedRoot))throw Error('Output must be outside package, checkout, staged SDK and input directories.');
try{await stat(output);throw Error('Output directory already exists; recorded files will not be overwritten.');}catch(e){if(e.code!=='ENOENT')throw e;}
const binding=await readJson(join(packageRoot,'assets-and-inputs.json')),requiredInputs=[];
for(const [id,x]of Object.entries(binding.fixtures))requiredInputs.push({name:id+'.png',pin:x.png});
for(const [id,x]of Object.entries(binding.camera)){requiredInputs.push({name:id+'.y4m',pin:x.y4m},{name:id+'-preflight.png',pin:x.png});}
for(const x of requiredInputs){const b=await readFile(join(input,x.name));if(hash(b)!==x.pin.sha256||b.length!==x.pin.bytes)throw Error('Frozen fixture mismatch: '+x.name);}
for(const v of ['baseline','candidate'])for(const [name,pin]of Object.entries(binding.assets[v].files)){const b=await readFile(join(stage,'consumers',v,'package',name));if(hash(b)!==pin.sha256||b.length!==pin.bytes)throw Error('Frozen staged asset mismatch: '+v+'/'+name);}
if(mode==='check-inputs'){console.log(JSON.stringify({inputPinsVerified:true,outputRejectedIfExistingOrProtected:true,decoderExecuted:false,mode}));process.exit(0);}
await mkdir(join(output,'fixtures'),{recursive:true});
for(const x of requiredInputs)await copyFile(join(input,x.name),join(output,'fixtures',x.name));
for(const name of ['original-protocol.json','predecode-amendment.json','assets-and-inputs.json','cleanup-supplement-protocol.json','iife-supplement-protocol.json'])await copyFile(join(packageRoot,name),join(output,name));
for(const name of ['run.mjs','common.mjs','browser-harness.js','cleanup-harness.js'])await copyFile(join(packageRoot,'replay',name),join(output,name));
await writeFile(join(output,'portable-replay-context.json'),JSON.stringify({freshReplayStartedAt:new Date().toISOString(),mode,scope:'Fresh derived replay; does not overwrite or amend recorded studies. No latency, phone, parity or production-promotion claim.',originalBindingSha256:hash(await readFile(join(packageRoot,'assets-and-inputs.json'))),synchronousRequestTelemetryAdded:true},null,2)+'\n',{flag:'wx'});
const run=spawnSync(process.execPath,[join(output,'run.mjs'),'fresh-observations'],{env:{...process.env,QRGEN_DIAGNOSTIC_REPO:repo,QRGEN_STAGED_SDK_ROOT:stage,QRGEN_STAGED_WORKDIR:output,QRGEN_REPLAY_MODE:mode},stdio:'inherit'});
if(run.error)throw run.error;
process.exitCode=run.status??1;

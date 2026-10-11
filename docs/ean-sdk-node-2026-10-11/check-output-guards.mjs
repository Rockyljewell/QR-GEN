// Guard-only probes. Creates mock directories outside this report; never imports an SDK.
import {mkdirSync,existsSync,readdirSync,symlinkSync,realpathSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {planReplayWorkspace} from './output-workspace.mjs';
const target=process.argv[2];if(!target)throw Error('Usage: node check-output-guards.mjs NEW_EXTERNAL_PROBE_DIR');
const here=dirname(fileURLToPath(import.meta.url)),probe=resolve(target);
planReplayWorkspace({explicitOutput:probe,protectedRoots:[here]});
mkdirSync(probe,{recursive:true});
const names=['package','dependency','cache','prepared','baseline-consumer','candidate-consumer'];
const protectedRoots=names.map(n=>join(probe,n));for(const p of protectedRoots)mkdirSync(p);
const ordinary=join(probe,'ordinary-temp');mkdirSync(ordinary);
const originalEnv={TEMP:process.env.TEMP,TMP:process.env.TMP,TMPDIR:process.env.TMPDIR},checks=[];
let wasmCalls=0,fetchCalls=0;
for(const method of ['compile','compileStreaming','instantiate','instantiateStreaming'])WebAssembly[method]=()=>{wasmCalls++;throw Error('No engine calls permitted in guard probes');};
globalThis.fetch=()=>{fetchCalls++;throw Error('No network permitted in guard probes');};
function setTemp(p){process.env.TEMP=p;process.env.TMP=p;process.env.TMPDIR=p;}
const snapshot=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?snapshot(join(dir,e.name)):[join(dir,e.name)]).sort();
const before=[];
for(let i=0;i<names.length;i++){
 const root=protectedRoots[i],link=join(probe,'temp-alias-'+names[i]);symlinkSync(root,link,process.platform==='win32'?'junction':'dir');
 before.push(...snapshot(root));
 for(const [kind,path]of [['direct',root],['junction-or-symlink',link]]){
  setTemp(path);let error;try{planReplayWorkspace({protectedRoots});}catch(e){error=e.message;}
  checks.push({id:'default-temp-'+names[i]+'-'+kind,rejected:!!error,passed:/Output may not be inside/.test(error??'')});
  let explicitError;try{planReplayWorkspace({explicitOutput:join(path,'new-output'),protectedRoots});}catch(e){explicitError=e.message;}
  checks.push({id:'explicit-'+names[i]+'-'+kind,rejected:!!explicitError,passed:/Output may not be inside/.test(explicitError??'')});
 }
}
try{
 setTemp(ordinary);const defaultPlan=planReplayWorkspace({protectedRoots});checks.push({id:'ordinary-default-temp-accepted',passed:defaultPlan.kind==='temporary'&&defaultPlan.prefix===join(realpathSync(ordinary),'qrgen-staged-sdk-node-')});
 const explicit=join(ordinary,'new-output'),explicitPlan=planReplayWorkspace({explicitOutput:explicit,protectedRoots});checks.push({id:'ordinary-explicit-accepted',passed:explicitPlan.kind==='explicit'&&explicitPlan.path===explicit&&!existsSync(explicit)});
 let existingError;try{planReplayWorkspace({explicitOutput:ordinary,protectedRoots});}catch(e){existingError=e.message;}checks.push({id:'existing-output-rejected',passed:existingError==='Use a fresh output directory'});
 const after=protectedRoots.flatMap(snapshot);checks.push({id:'protected-mock-trees-unchanged',passed:JSON.stringify(before.sort())===JSON.stringify(after.sort())});
 checks.push({id:'planning-created-no-default-workspace',passed:readdirSync(ordinary).length===0});
}finally{for(const [k,v]of Object.entries(originalEnv))if(v===undefined)delete process.env[k];else process.env[k]=v;}
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const result={scope:'File-only v3 output planning probes on mock protected roots; no SDK import, image decoder, browser or matrix replay',checkedAt:new Date().toISOString(),node:process.version,platform:process.platform,checks,allPassed:checks.every(x=>x.passed),sdkCalls:0,wasmCalls,fetchCalls,guardSha256:sha(join(here,'output-workspace.mjs')),runnerSha256:sha(fileURLToPath(import.meta.url)),note:'Probe scaffolding lives only in the supplied fresh external directory. Real report/input/consumer trees were not touched. Default TEMP/TMP/TMPDIR direct and symlink/junction cases are exercised.'};
writeFileSync(join(probe,'validation.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result,null,2));if(!result.allPassed||wasmCalls||fetchCalls)process.exitCode=1;

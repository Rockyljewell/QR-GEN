// Frozen-profile paired reader gate. Requires parent-bound compiled artifacts.
import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync,openSync,writeSync,closeSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,resolve,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import http from 'node:http';import https from 'node:https';
const here=dirname(fileURLToPath(import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const json=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const planPath=join(here,'frozen-plan.json'),planBytes=readFileSync(planPath),plan=json(planPath);
const args=process.argv.slice(2);if(args.length!==2)throw Error('Usage: node run-paired.mjs BUILD-BINDING.json FRESH-OUTPUT-DIR');
const bindingPath=resolve(args[0]),binding=json(bindingPath),output=resolve(args[1]);
if(binding.planSha256!==sha(planBytes)||binding.cppCommit!==plan.cppCommit||binding.wrapperCommit!==plan.wrapperCommit)
 throw Error('Build binding does not match frozen plan/commits');
if(binding.patchSha256!==plan.files.find(x=>x.path==='actual-row-trace.patch').sha256||binding.status!=='successful-compiled-builds-bound')
 throw Error('Parent must bind successful compiled builds and exact patch before recognition');
if(!binding.workflowRun?.id||!/^\b[a-fA-F0-9]{40}\b$/.test(binding.workflowRun.headSha??'')||binding.workflowRun.conclusion!=='success')
 throw Error('Bind exact successful workflow run/head before recognition');
for(const k of ['baseline','instrumented'])if(!binding[k]?.artifactId||!/^[a-f0-9]{64}$/.test(binding[k].archiveSha256??''))
 throw Error('Bind verified downloaded artifact/archive identity for '+k);
for(const f of plan.files)if(sha(readFileSync(join(here,f.path)))!==f.sha256)throw Error('Frozen runner/package file changed: '+f.path);
if(plan.inputs.length!==15||plan.profiles.length!==90||new Set(plan.profiles.map(x=>x.id)).size!==90)throw Error('Frozen count mismatch');
const within=(r,p)=>{const x=relative(r,p);return x===''||(!isAbsolute(x)&&x!=='..'&&!x.startsWith('..'+sep));};
const canonicalNew=p=>{let q=p;const tails=[];while(!existsSync(q)){tails.unshift(q.slice(dirname(q).length+1));const d=dirname(q);if(d===q)throw Error('Cannot resolve output');q=d;}return resolve(realpathSync(q),...tails);};
const dependencyRoot=realpathSync(resolve(process.env.QRGEN_TRACE_DEPENDENCY_ROOT??'C:/Users/rocky/OneDrive/Desktop/QR-GEN/packages/sdk'));
const realOutput=canonicalNew(output);
const protectedRoots=[realpathSync(here),dependencyRoot,...['baseline','instrumented'].map(k=>realpathSync(resolve(binding[k].root)))];
for(const input of plan.inputs)protectedRoots.push(realpathSync(dirname(input.sourcePath)),realpathSync(dirname(input.transportPath)));
for(const root of protectedRoots)if(within(root,realOutput)||within(realOutput,root))throw Error('Output overlaps protected package/input/consumer: '+root);
if(existsSync(output))throw Error('Use a new, nonexistent output directory');
const req=createRequire(join(dependencyRoot,'package.json')),{PNG}=req('pngjs');
const pixels=new Map();
for(const x of plan.inputs){
 const source=readFileSync(x.sourcePath),bytes=readFileSync(x.transportPath),p=PNG.sync.read(bytes);
 if(sha(source)!==x.sourceSha256||sha(bytes)!==x.transportSha256||sha(p.data)!==x.rgbaSha256||p.width!==x.width||p.height!==x.height)
  throw Error('Input mismatch before recognition: '+x.key);
 pixels.set(x.key,{width:p.width,height:p.height,data:new Uint8ClampedArray(p.data)});
}
function walk(root,dir=root){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
 if(e.isSymbolicLink())throw Error('Symlink in build artifact');const p=join(dir,e.name);return e.isDirectory()?walk(root,p):[{path:relative(root,p).replaceAll('\\','/'),sha256:sha(readFileSync(p)),bytes:readFileSync(p).length}];
}).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);}
for(const k of ['baseline','instrumented']){
 const b=binding[k];b.root=realpathSync(resolve(b.root));b.modulePath=join(b.root,'dist/es/reader/index.js');b.wasmPath=join(b.root,'zxing_reader.wasm');
 const evidenceBytes=readFileSync(join(b.root,'build-evidence.json')),evidence=JSON.parse(evidenceBytes);
 if(sha(evidenceBytes)!==b.buildEvidenceSha256||evidence.variant!==k||evidence.cppCommit!==plan.cppCommit||evidence.wrapperCommit!==plan.wrapperCommit)
  throw Error('Build evidence pin mismatch: '+k);
 if(JSON.stringify(walk(join(b.root,'dist/es')))!==JSON.stringify(evidence.esGraph))throw Error('Entire retained ES graph changed: '+k);
 for(const f of evidence.compilerFiles)if(sha(readFileSync(join(b.root,f.path)))!==f.sha256)throw Error('Compiler evidence changed: '+f.path);
 b.wasm=readFileSync(b.wasmPath);
 if(sha(b.wasm)!==b.wasmSha256||sha(b.wasm)!==evidence.wasmSha256||sha(readFileSync(join(b.root,'matched-emscripten-glue.js')))!==evidence.glueSha256)
  throw Error('WASM/glue pin mismatch: '+k);
 if(k==='baseline'&&(b.wasmSha256!=='aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931'||evidence.compileDefinition!==null))
  throw Error('Uninstrumented baseline must reproduce retained released WASM and have no diagnostic definition');
 if(k==='instrumented'&&(evidence.compileDefinition!=='ZXING_QRGEN_ROW_TRACE=1'||evidence.patchSha256!==binding.patchSha256))
  throw Error('Instrumented build does not bind exact definition/patch');
}
if(binding.baseline.root===binding.instrumented.root)throw Error('Independent matching wrapper trees required');
mkdirSync(output);mkdirSync(join(output,'traces'));
const save=(n,v)=>writeFileSync(join(output,n),JSON.stringify(v,null,2)+'\n');
save('execution-binding.json',{...binding,baseline:{...binding.baseline,wasm:undefined},instrumented:{...binding.instrumented,wasm:undefined},
 bindingFileSha256:sha(readFileSync(bindingPath)),planSha256:sha(planBytes),runnerSha256:sha(readFileSync(fileURLToPath(import.meta.url))),node:process.version,
 scope:'Paired public-output gate and bounded traces. No policy evaluation or truth correction.'});
const instantiated=[];const fingerprint=b=>{if(b instanceof ArrayBuffer)return sha(new Uint8Array(b));if(ArrayBuffer.isView(b))return sha(new Uint8Array(b.buffer,b.byteOffset,b.byteLength));return null;};
const allowed=new Set(['baseline','instrumented'].map(k=>binding[k].wasmSha256));
for(const key of ['compile','instantiate']){const original=WebAssembly[key];WebAssembly[key]=function(first,...rest){const hash=fingerprint(first);if(hash){instantiated.push({api:key,sha256:hash});if(!allowed.has(hash))throw Error('Unexpected WASM bytes');}return Reflect.apply(original,WebAssembly,[first,...rest]);};}
const OriginalModule=WebAssembly.Module;
WebAssembly.Module=new Proxy(OriginalModule,{construct(t,args,n){const hash=fingerprint(args[0]);instantiated.push({api:'Module',sha256:hash});if(!allowed.has(hash))throw Error('Unexpected WASM Module bytes');return Reflect.construct(t,args,n);}});
const denied=()=>{throw Error('Network forbidden in frozen local study');};globalThis.fetch=denied;
http.request=http.get=https.request=https.get=denied;
let current=null;
const prefix='QRGEN_ROW_TRACE ';
const hostCap=34*1024*1024;
const patchText=readFileSync(join(here,'actual-row-trace.patch'),'utf8');
const knownEvents=new Set([...patchText.matchAll(/\bQRT(?:_EAN|_BOOL)?\(\s*"([^"]+)"/g),...patchText.matchAll(/\bEvent\s+\w+\(\s*"([^"]+)"/g)].map(m=>m[1]));
function capture(variant,line){
 // Never throw through Emscripten printErr: transport failures invalidate evidence afterwards.
 try{
  const s=String(line)+'\n';if(!current){throw Error('stderr outside measured profile');}
  const c=current[variant];c.bytes+=Buffer.byteLength(s);if(c.bytes>hostCap){c.hostDropped++;return;}
  writeSync(c.fd,s);if(!s.startsWith(prefix)){c.nonTrace++;return;}
  const e=JSON.parse(s.slice(prefix.length));
  if(e.schema!==1||typeof e.event!=='string'||!knownEvents.has(e.event))throw Error('Unexpected trace event schema/type');
  if(!Number.isSafeInteger(e.seq)||e.seq!==c.seq+1)c.sequenceGaps++;
  if(!c.events)c.first=e.event;c.last=e.event;
  c.seq=e.seq;c.events++;c.types[e.event]=(c.types[e.event]??0)+1;
  if(e.event==='call-begin')c.begin=e;
  if(e.event==='call-end'){c.end=e;c.endLineBytes=Buffer.byteLength(s);}
 }catch(err){if(current)current[variant].transportErrors.push(String(err));else outOfCallErrors.push({variant,error:String(err)});}
}
const outOfCallErrors=[];const engines={};
for(const k of ['baseline','instrumented']){
 const b=binding[k],reader=await import(pathToFileURL(b.modulePath).href+'?traceStudy='+k);
 if(reader.ZXING_WASM_VERSION!=='3.1.5'||reader.ZXING_CPP_COMMIT!==plan.cppCommit)throw Error('Reader identity mismatch');
 reader.prepareZXingModule({overrides:{wasmBinary:b.wasm.buffer.slice(b.wasm.byteOffset,b.wasm.byteOffset+b.wasm.byteLength),
  printErr:line=>capture(k,line),print:line=>capture(k,'UNEXPECTED_STDOUT '+line),locateFile:denied},fireImmediately:false});engines[k]=reader;
}
function ownProperties(v,implicitIndices=0){
 if(Object.getOwnPropertySymbols(v).length)throw Error('Unexpected result symbol key');const properties={};
 for(const key of Object.getOwnPropertyNames(v).sort()){
  const d=Object.getOwnPropertyDescriptor(v,key);if(!('value'in d))throw Error('Accessor result property');
  const n=Number(key);if(Number.isInteger(n)&&n>=0&&n<implicitIndices&&String(n)===key)continue;
  properties[key]=record(d.value);
 }
 return properties;
}
function record(v){
 if(v===undefined)return {$undefined:true};if(v===null||typeof v==='string'||typeof v==='boolean')return v;
 if(typeof v==='number'){if(!Number.isFinite(v))throw Error('Non-finite result value');return Object.is(v,-0)?{$negativeZero:true}:v;}
 if(ArrayBuffer.isView(v))return {$typedArray:v.constructor.name,bytes:Buffer.from(v.buffer,v.byteOffset,v.byteLength).toString('hex'),length:v.length??null,$properties:ownProperties(v,v.length??0)};
 if(v instanceof ArrayBuffer)return {$arrayBuffer:Buffer.from(v).toString('hex'),$properties:ownProperties(v)};
 if(typeof v!=='object')throw Error('Unrecordable result type '+typeof v);
 return {$kind:Array.isArray(v)?'Array':'Object',$properties:ownProperties(v)};
}
const records=[],summary={schemaVersion:1,startedAt:new Date().toISOString(),plannedProfiles:90,completedProfiles:0,readerCalls:0,
 engineCalls:{baseline:0,instrumented:0},engineMilliseconds:{baseline:0,instrumented:0},
 outputMismatches:0,inputMutations:0,readerErrors:0,transportFailures:0,completeTraces:0,status:'running',recognitionPolicy:'unchanged upstream baseline'};
save('summary.json',summary);
let failure=null;
try{
 for(let i=0;i<plan.profiles.length;++i){const p=plan.profiles[i],source=pixels.get(p.inputKey),entry={profile:p.id,inputKey:p.inputKey,options:p.options,results:{},trace:{}};
  current={};for(const k of ['baseline','instrumented'])current[k]={fd:openSync(join(output,'traces',String(i).padStart(3,'0')+'-'+k+'.stderr.jsonl'),'wx'),bytes:0,hostDropped:0,nonTrace:0,seq:0,events:0,sequenceGaps:0,types:{},transportErrors:[]};
  for(const k of ['baseline','instrumented']){
   const input={width:source.width,height:source.height,data:new Uint8ClampedArray(source.data)},before=sha(input.data),start=performance.now();
   try{entry.results[k]=record(await engines[k].readBarcodes(input,p.options));}catch(e){entry.results[k]={$readerError:String(e)};++summary.readerErrors;}
   ++summary.readerCalls;entry[k+'Ms']=performance.now()-start;
   ++summary.engineCalls[k];summary.engineMilliseconds[k]+=entry[k+'Ms'];
   if(sha(input.data)!==before){++summary.inputMutations;entry[k+'InputMutation']=true;}
   if(summary.readerErrors||summary.inputMutations)break;
  }
  for(const k of ['baseline','instrumented']){const c=current[k];closeSync(c.fd);delete c.fd;entry.trace[k]=c;}
  current=null;entry.equal=Object.hasOwn(entry.results,'baseline')&&Object.hasOwn(entry.results,'instrumented')?
   JSON.stringify(entry.results.baseline)===JSON.stringify(entry.results.instrumented):null;
  if(entry.equal===false)++summary.outputMismatches;
  const b=entry.trace.baseline,t=entry.trace.instrumented;
  entry.traceComplete=b.events===0&&b.bytes===0&&b.transportErrors.length===0&&t.events>0&&t.first==='call-begin'&&t.last==='call-end'&&t.types['call-begin']===1&&t.types['call-end']===1&&
   t.end?.dropped===0&&t.end?.oversized===0&&t.hostDropped===0&&t.nonTrace===0&&t.sequenceGaps===0&&t.transportErrors.length===0;
  entry.traceComplete&&=t.begin.width===source.width&&t.begin.height===source.height&&
   t.begin.maxEvents===plan.bounds.maxEventsPerCall&&t.begin.maxBytes===plan.bounds.maxBytesPerCall&&t.begin.maxLine===plan.bounds.maxEventBytes&&
   t.end.priorBytes===t.bytes-t.endLineBytes&&t.end.priorEvents===t.events-1&&t.end.seq===t.seq&&(t.types['row-attempt']??0)===t.end.rows&&
   (t.types['decode-attempt']??0)===t.end.attempts&&(t.types['left-guard-found']??0)===t.end.candidates&&
   (t.types['collector-insert']??0)===t.end.groups&&t.types['oned-pass-begin']===t.end.passes;
  if(entry.traceComplete)++summary.completeTraces;else if(Object.hasOwn(entry.results,'instrumented'))++summary.transportFailures;
  records.push(entry);summary.completedProfiles=records.length;
  writeFileSync(join(output,'paired-records.jsonl.gz'),gzipSync(records.map(x=>JSON.stringify(x)).join('\n')+'\n',{mtime:0}));save('summary.json',summary);
  if(!entry.equal||summary.readerErrors||summary.inputMutations||!entry.traceComplete||outOfCallErrors.length)throw Error('Gate failed at '+p.id);
 }
 const hashes=new Set(instantiated.map(x=>x.sha256));if([...allowed].some(h=>!hashes.has(h)))throw Error('Expected WASM bytes were not observed at compilation/instantiation');
 summary.status='public-output-conformance-passed-trace-interpretation-permitted';
}catch(e){failure=String(e);summary.status='failed-stop-no-trace-interpretation';summary.failure=failure;}
finally{
 if(current)for(const c of Object.values(current))if(c.fd!==undefined)closeSync(c.fd);
 summary.finishedAt=new Date().toISOString();summary.outOfCallErrors=outOfCallErrors;summary.instantiated=instantiated;save('summary.json',summary);
 save('execution-file-inventory.json',{scope:'Exact retained paired-run files; inventory excludes itself.',files:walk(output)});
}
console.log(JSON.stringify(summary));if(failure)process.exitCode=1;

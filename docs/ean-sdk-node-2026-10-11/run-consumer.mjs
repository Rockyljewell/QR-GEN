import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

const here=dirname(fileURLToPath(import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
const [label,format,entryArg,outputArg]=process.argv.slice(2);
if(!['baseline','candidate'].includes(label)||!['esm','cjs'].includes(format)||!entryArg||!outputArg)throw Error('Usage: run-consumer.mjs baseline|candidate esm|cjs ABS_ENTRY ABS_NEW_OUTPUT_DIR');
if(!process.versions.node.startsWith('24.'))throw Error('This matrix is predeclared for Node24; actual '+process.version);
const entry=resolve(entryArg),output=resolve(outputArg),planPath=join(here,'frozen-plan.json');
const outputRelative=relative(here,output);if(!outputRelative||isAbsolute(outputRelative)||outputRelative==='..'||outputRelative.startsWith('..'+sep))throw Error('Results must be inside this artifact harness directory');
const planBytes=readFileSync(planPath),freeze=JSON.parse(readFileSync(join(here,'freeze.json')));
if(sha(planBytes)!==freeze.planSha256)throw Error('Frozen input/option plan changed');
const plan=JSON.parse(planBytes);
if(existsSync(output))throw Error('Refusing existing results directory '+output);
mkdirSync(output,{recursive:true});
const expectedReader=label==='candidate'?'f9d636340ef9b9b3e433e9c81a1cff228c80c4d9f45b748b6fe116308821ddc6':'aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931';
const assets=Object.fromEntries(['reader','writer'].map(kind=>{const p=join(dirname(entry),'wasm',`zxing_${kind}.wasm`),b=readFileSync(p);return[kind,{path:p,bytes:b.length,sha256:sha(b)}];}));
if(assets.reader.sha256!==expectedReader)throw Error('Packed reader asset hash mismatch');
const networkAttempts=[];
const block=(kind,args)=>{networkAttempts.push({kind,argument:String(args[0]).slice(0,300)});throw Error('Network is prohibited in this packed local-engine study');};
globalThis.fetch=(...args)=>Promise.reject((()=>{try{block('fetch',args);}catch(e){return e;}})());
for(const[name,module]of[['http',http],['https',https]])for(const method of['request','get'])module[method]=(...args)=>block(name+'.'+method,args);
const compiled=new Map();
function capture(input,via){let b;if(input instanceof ArrayBuffer)b=new Uint8Array(input);else if(ArrayBuffer.isView(input))b=new Uint8Array(input.buffer,input.byteOffset,input.byteLength);else return;const h=sha(b),p=compiled.get(h)??{sha256:h,bytes:b.length,count:0,via:[]};p.count++;if(!p.via.includes(via))p.via.push(via);compiled.set(h,p);}
for(const method of['compile','instantiate']){const original=WebAssembly[method];WebAssembly[method]=function(...args){capture(args[0],method);return Reflect.apply(original,WebAssembly,args);};}
const NativeModule=WebAssembly.Module;
WebAssembly.Module=new Proxy(NativeModule,{construct(target,args,newTarget){capture(args[0],'Module');return Reflect.construct(target,args,newTarget);}});
const startedAt=new Date().toISOString(),memoryBefore=process.memoryUsage();
const namespace=format==='esm'?await import(pathToFileURL(entry).href):createRequire(entry)(entry);
const sdk=typeof namespace.scanImage==='function'?namespace:namespace.default;
if(typeof sdk.scanImage!=='function')throw Error('Packed entry lacks public scanImage');
const required=['data','symbology','symbologyName','rawBytes','contentType','isGS1','location','frameSize','orientation','ecLevel','symbologyIdentifier','timestamp'];
function serialize(value){if(value===undefined)return{$undefined:true};if(typeof value==='number'&&!Number.isFinite(value))return{$number:String(value)};if(typeof value==='bigint')return{$bigint:String(value)};if(Array.isArray(value))return value.map(serialize);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,serialize(value[k])]));return value;}
function normalize(barcode,item,errors){
 for(const key of required)if(!Object.hasOwn(barcode,key))errors.push('Missing public field '+key);
 if(!Number.isFinite(barcode.timestamp))errors.push('Nonfinite timestamp');
 if(typeof barcode.rawBytes!=='string'||Buffer.from(barcode.rawBytes,'base64').toString('base64')!==barcode.rawBytes)errors.push('Noncanonical Base64 rawBytes');
 if(barcode.frameSize?.width!==item.width||barcode.frameSize?.height!==item.height)errors.push('Public frameSize differs from frozen raster');
 if(Reflect.ownKeys(barcode).some(k=>typeof k==='symbol'))errors.push('Unexpected symbol-key public property');
 const copy={};for(const k of Object.keys(barcode))if(k!=='timestamp')copy[k]=barcode[k];return serialize(copy);
}
const itemMap=new Map(plan.items.map(i=>[i.key,i])),errors=[],profileOutput=join(output,'results.jsonl');
let successful=0,mutations=0,validationFailures=0;
for(const profile of plan.profiles){
 const item=itemMap.get(profile.itemKey),bytes=readFileSync(item.transportPath);
 if(sha(bytes)!==item.transportSha256)throw Error('Transport changed after plan freeze '+item.key);
 const backing=new Uint8Array(bytes.length+8);backing.fill(0x5a);backing.set(bytes,3);const input=backing.subarray(3,3+bytes.length),before=sha(backing),validation=[];
 const start=performance.now();let result;
 try{const found=await sdk.scanImage(input,profile.options);if(!Array.isArray(found))throw Error('scanImage did not return array');if(found.length>profile.options.maxResults)validation.push('Public maxResults exceeded');result={status:'fulfilled',output:found.map(b=>normalize(b,item,validation))};successful++;}
 catch(error){const detail={name:error?.name??null,message:String(error?.message??error),code:error?.code??null,stack:error?.stack??null};result={status:'rejected',error:detail};errors.push({profileId:profile.id,...detail});}
 const mutated=sha(backing)!==before;if(mutated)mutations++;if(validation.length)validationFailures++;
 appendFileSync(profileOutput,JSON.stringify({profileId:profile.id,itemKey:profile.itemKey,arm:profile.arm,scope:profile.scope,options:profile.options,...result,inputBackingMutation:mutated,validationErrors:validation,elapsedMs:performance.now()-start})+'\n');
 if((Number(profile.id)+1)%200===0)console.log(JSON.stringify({label,format,completed:Number(profile.id)+1,total:plan.profiles.length}));
}
const compilation=Array.from(compiled.values());
const provenanceErrors=[];
if(!compiled.has(expectedReader))provenanceErrors.push('Expected reader bytes were not observed at WASM compile/instantiate boundary');
for(const h of compiled.keys())if(h!==expectedReader)provenanceErrors.push('Unexpected instantiated/compiled WASM '+h);
if(networkAttempts.length)provenanceErrors.push('Prohibited network attempted');
const summary={label,format,node:process.version,startedAt,completedAt:new Date().toISOString(),entry,entrySha256:sha(readFileSync(entry)),expectedReaderSha256:expectedReader,assets,compiledWasm:compilation,networkAttempts,planSha256:sha(planBytes),runnerSha256:sha(readFileSync(fileURLToPath(import.meta.url))),profiles:plan.profiles.length,successful,errors,mutations,validationFailures,provenanceErrors,capabilities:typeof sdk.getRuntimeCapabilities==='function'?sdk.getRuntimeCapabilities():null,memoryBefore,memoryAfter:process.memoryUsage(),resultsSha256:sha(readFileSync(profileOutput)),status:errors.length||mutations||validationFailures||provenanceErrors.length?'failed':'passed'};
writeFileSync(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({label,format,status:summary.status,profiles:summary.profiles,errors:errors.length,mutations,validationFailures,compiledWasm:compilation.map(i=>i.sha256),networkAttempts:networkAttempts.length}));
if(summary.status!=='passed')process.exitCode=1;

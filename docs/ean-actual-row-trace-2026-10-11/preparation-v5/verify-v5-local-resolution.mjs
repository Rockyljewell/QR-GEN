// Pure functions only: no reader/glue import, WASM compilation, build or recognition.
import {readFileSync} from 'node:fs';import {dirname,join,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';import vm from 'node:vm';
const here=dirname(fileURLToPath(import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const runner=readFileSync(join(here,'run-paired.mjs'),'utf8');
const helper=runner.slice(runner.indexOf('function locatePinnedReaderWasm('),runner.indexOf('const outOfCallErrors=[];'));
assert(helper.startsWith('function locatePinnedReaderWasm(')&&helper.includes("url.hostname!==''"));
const context={pathToFileURL,isAbsolute};vm.createContext(context);vm.runInContext(helper,context);
const target=join(here,'synthetic-local-only/zxing_reader.wasm'),expected=pathToFileURL(target).href;
assert.equal(context.locatePinnedReaderWasm('zxing_reader.wasm','',target),expected);
const checks=[{name:'exact-local-name-empty-prefix-resolves-to-pinned-path',passed:true}];
for(const name of ['zxing_writer.wasm','zxing_full.wasm','../zxing_reader.wasm','https://example.invalid/zxing_reader.wasm','file:///other/zxing_reader.wasm','zxing_reader.wasm?x=1','ZXING_READER.WASM','%7Azxing_reader.wasm']){
 assert.throws(()=>context.locatePinnedReaderWasm(name,'',target));checks.push({name:'reject-name-'+name,passed:true});
}
for(const prefix of ['https://example.invalid/','file:///other/','../',null,undefined])assert.throws(()=>context.locatePinnedReaderWasm('zxing_reader.wasm',prefix,target));
checks.push({name:'reject-all-unexpected-prefixes',passed:true});
assert.throws(()=>context.locatePinnedReaderWasm('zxing_reader.wasm','','relative/zxing_reader.wasm'));
checks.push({name:'reject-relative-target',passed:true});
const denied=()=>{throw Error('Network forbidden in frozen local study');};
function extract(source,name){const at=source.indexOf('function '+name+'(');assert(at>=0,name);const brace=source.indexOf('{',at);let depth=1,i=brace+1;for(;i<source.length&&depth;i++){if(source[i]==='{')depth++;else if(source[i]==='}')depth--;}assert.equal(depth,0);return source.slice(at,i);}
const pins=[];
for(const variant of ['baseline','instrumented']){
 const path=join(here,'../row-trace-build-v4-success',variant,'matched-emscripten-glue.js'),bytes=readFileSync(path),source=bytes.toString();
 const functions=['locateFile','findWasmBinary','getBinarySync'].map(name=>extract(source,name)).join('\n');
 // vm scripts have no import.meta. Substitute a synthetic URL solely in the
 // unused fallback branch; the supplied locateFile branch is kept verbatim.
 assert.equal((functions.match(/import\.meta\.url/g)??[]).length,1);
 const probeFunctions=functions.replace('import.meta.url','syntheticModuleUrl');
 const synthetic=new Uint8Array([0,97,115,109,1,0,0,0]).buffer;
 let reads=0;const c={Module:{locateFile:denied},scriptDirectory:'',wasmBinary:synthetic,wasmBinaryFile:undefined,
  readBinary:()=>{reads++;throw Error('No disk/network reads in pure probe');},Uint8Array,URL,syntheticModuleUrl:pathToFileURL(join(here,'synthetic-local-only/index.js')).href};
 vm.createContext(c);vm.runInContext(probeFunctions,c);
 assert.throws(()=>vm.runInContext('wasmBinaryFile=findWasmBinary()',c),/Network forbidden/);
 c.Module.locateFile=(name,prefix)=>context.locatePinnedReaderWasm(name,prefix,target);
 vm.runInContext('wasmBinaryFile=findWasmBinary();selected=getBinarySync(wasmBinaryFile)',c);
 assert.equal(c.wasmBinaryFile,expected);assert.deepEqual(Array.from(c.selected),[0,97,115,109,1,0,0,0]);assert.equal(reads,0);
 pins.push({variant,glueSha256:sha(bytes),extractedFunctionsSha256:sha(functions),probeFunctionsSha256:sha(probeFunctions),modelAmendment:'Unused import.meta.url fallback replaced by syntheticModuleUrl for vm script parsing; supplied locateFile branch unchanged.'});
 checks.push({name:'pinned-'+variant+'-glue-reproduces-old-failure-and-selects-synthetic-in-memory-bytes-with-new-resolver',passed:true});
}
assert(runner.includes('globalThis.fetch=denied')&&runner.includes('http.request=http.get=https.request=https.get=denied'));
checks.push({name:'fetch-http-https-denials-preserved',passed:true});
console.log(JSON.stringify({scope:'Pure extracted-function and local filename probes using synthetic bytes, not reader/glue execution or WASM instantiation.',checks,pinnedGlue:pins,runnerSha256:sha(readFileSync(join(here,'run-paired.mjs'))),auditCodeSha256:sha(readFileSync(fileURLToPath(import.meta.url))),readerImports:0,wasmInstantiations:0,recognitionCalls:0}));

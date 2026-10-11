// File-only retained-cache and synthetic negative probes; no reader imports/builds.
import {readFileSync} from 'node:fs';import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';import vm from 'node:vm';import assert from 'node:assert/strict';
const here=dirname(fileURLToPath(import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const code=readFileSync(join(here,'capture-build-evidence.mjs'),'utf8');
const loop=code.slice(code.indexOf("for(const phase of ['reader','writer','full'])"),code.indexOf('const evidence='));
assert(loop.includes('stb-populate')&&loop.includes('CMAKE_PROJECT_NAME:STATIC'));
const attempt=resolve(here,'../row-trace-build-attempt-v3'),checks=[];
function virtual(variant,mutate=()=>{}){
 const files=new Map(),root='/retained';
 for(const phase of ['reader','writer','full']){
  const dir=join(attempt,variant,'cmake',phase),manifest=JSON.parse(readFileSync(join(dir,'phase-manifest.json')));
  for(const f of manifest.files){const b=readFileSync(join(dir,f.path));assert.equal(sha(b),f.sha256);assert.equal(b.length,f.bytes);files.set(join(root,'cmake',phase,f.path),b);}
  files.set(join(root,'cmake',phase,'phase-manifest.json'),Buffer.from(JSON.stringify(manifest)));
 }
 mutate(files,root);
 // Synthetic mutations update the file digest so each negative case reaches its intended semantic check.
 for(const phase of ['reader','writer','full']){const p=join(root,'cmake',phase,'phase-manifest.json'),m=JSON.parse(files.get(p));for(const f of m.files){const b=files.get(join(root,'cmake',phase,f.path));assert(b);f.sha256=sha(b);f.bytes=b.length;}files.set(p,Buffer.from(JSON.stringify(m)));}
 const c={root,sha,join,expected:variant==='instrumented',flag:'-DZXING_QRGEN_ROW_TRACE=1',readFileSync:(p,enc)=>{assert(files.has(p),'Missing virtual file '+p);const b=files.get(p);return enc?b.toString(enc):b;}};
 vm.createContext(c);vm.runInContext(loop,c);return files;
}
for(const variant of ['baseline','instrumented']){virtual(variant);checks.push({name:'all-three-retained-phases-'+variant,passed:true});}
const file=(root,phase,name)=>join(root,'cmake',phase,name);
const edit=(files,path,old,next)=>{const s=files.get(path).toString();assert(s.includes(old),old);files.set(path,Buffer.from(s.replace(old,next)));};
const remove=(files,root,phase,path)=>{const p=file(root,phase,'phase-manifest.json'),m=JSON.parse(files.get(p));assert(m.files.some(f=>f.path===path));m.files=m.files.filter(f=>f.path!==path);files.set(p,Buffer.from(JSON.stringify(m)));};
function reject(name,mutate,variant='instrumented'){assert.throws(()=>virtual(variant,mutate),name);checks.push({name,passed:true});}
reject('missing-top-cache',(f,r)=>remove(f,r,'reader','CMakeCache.txt'));
reject('wrong-top-project',(f,r)=>edit(f,file(r,'reader','CMakeCache.txt'),'CMAKE_PROJECT_NAME:STATIC=ZXingWasm','CMAKE_PROJECT_NAME:STATIC=Other'));
reject('missing-instrumented-top-flag',(f,r)=>edit(f,file(r,'reader','CMakeCache.txt'),'CMAKE_CXX_FLAGS:STRING=-DZXING_QRGEN_ROW_TRACE=1','CMAKE_CXX_FLAGS:STRING='));
reject('unexpected-baseline-top-flag',(f,r)=>edit(f,file(r,'reader','CMakeCache.txt'),'CMAKE_CXX_FLAGS:STRING=','CMAKE_CXX_FLAGS:STRING=-DZXING_QRGEN_ROW_TRACE=1'),'baseline');
reject('unexpected-child-cache-project',(f,r)=>edit(f,file(r,'reader','_deps/stb-subbuild/CMakeCache.txt'),'CMAKE_PROJECT_NAME:STATIC=stb-populate','CMAKE_PROJECT_NAME:STATIC=Other'));
reject('child-cxx-flags-entry',(f,r)=>{const p=file(r,'reader','_deps/stb-subbuild/CMakeCache.txt');f.set(p,Buffer.concat([f.get(p),Buffer.from('\nCMAKE_CXX_FLAGS:STRING=\n')]));});
reject('child-cxx-compiler-entry',(f,r)=>{const p=file(r,'reader','_deps/stb-subbuild/CMakeCache.txt');f.set(p,Buffer.concat([f.get(p),Buffer.from('\nCMAKE_CXX_COMPILER:FILEPATH=/compiler\n')]));});
reject('unknown-child-cache-path',(f,r)=>{const p=file(r,'reader','phase-manifest.json'),m=JSON.parse(f.get(p)),b=f.get(file(r,'reader','_deps/stb-subbuild/CMakeCache.txt'));m.files.push({path:'_deps/other/CMakeCache.txt',sha256:sha(b),bytes:b.length});f.set(file(r,'reader','_deps/other/CMakeCache.txt'),b);f.set(p,Buffer.from(JSON.stringify(m)));});
reject('macro-only-in-comment',(f,r)=>edit(f,file(r,'reader','CMakeFiles/zxing_reader.dir/flags.make'),'CXX_FLAGS = -DZXING_QRGEN_ROW_TRACE=1',' # -DZXING_QRGEN_ROW_TRACE=1\nCXX_FLAGS ='));
reject('wrong-macro-value',(f,r)=>edit(f,file(r,'reader','CMakeFiles/zxing_reader.dir/flags.make'),'CXX_FLAGS = -DZXING_QRGEN_ROW_TRACE=1','CXX_FLAGS = -DZXING_QRGEN_ROW_TRACE=0'));
for(const [phase,path]of [['reader','ZXing/CMakeFiles/ZXing.dir/flags.make'],['reader','CMakeFiles/zxing_reader.dir/flags.make'],['writer','CMakeFiles/zxing_writer.dir/flags.make'],['full','CMakeFiles/zxing_full.dir/flags.make']])reject('missing-target-'+phase+'-'+path,(f,r)=>remove(f,r,phase,path));
for(const phase of ['reader','writer','full']){
 const dir=join(attempt,'instrumented','cmake',phase),m=JSON.parse(readFileSync(join(dir,'phase-manifest.json')));
 const caches=m.files.filter(f=>f.path.endsWith('CMakeCache.txt')).map(f=>readFileSync(join(dir,f.path),'utf8'));
 assert(caches.some(s=>s.includes('-DZXING_QRGEN_ROW_TRACE=1')!==true));
}
checks.push({name:'v3-all-cache-condition-reproduced-false-rejection-in-three-instrumented-phases',passed:true});
console.log(JSON.stringify({scope:'Exact retained phase snapshots plus synthetic negative verifier probes. No builds, reader imports or recognition.',checks,captureCodeSha256:sha(readFileSync(join(here,'capture-build-evidence.mjs'))),auditCodeSha256:sha(readFileSync(fileURLToPath(import.meta.url))),readerImports:0,recognitionCalls:0}));

// File-only build provenance. Deliberately does not import or call a decoder.
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';import {createHash} from 'node:crypto';
const [rootArg,variant,metadataPath]=process.argv.slice(2);if(!['baseline','instrumented'].includes(variant)||!metadataPath)throw Error('root baseline|instrumented patch-metadata.json required');
const root=resolve(rootArg),sha=b=>createHash('sha256').update(b).digest('hex'),metadata=JSON.parse(readFileSync(metadataPath));
const walk=(base,dir=base)=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>{if(e.isSymbolicLink())throw Error('Symlink build output');const p=join(dir,e.name);return e.isDirectory()?walk(base,p):[{path:relative(base,p).replaceAll('\\','/'),sha256:sha(readFileSync(p)),bytes:readFileSync(p).length}];}).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
const wasm=readFileSync(join(root,'zxing_reader.wasm'));if(wasm.subarray(0,8).toString('hex')!=='0061736d01000000')throw Error('Invalid WASM header');
const cxxFlags=readFileSync(join(root,'cxxflags.txt'),'utf8').trim();
const flag='-DZXING_QRGEN_ROW_TRACE=1',expected=variant==='instrumented';
if(cxxFlags!==(expected?flag:''))throw Error('Declared CXXFLAGS do not match diagnostic variant');
for(const phase of ['reader','writer','full']){
 const base=join(root,'cmake',phase),m=JSON.parse(readFileSync(join(base,'phase-manifest.json')));
 for(const f of m.files)if(sha(readFileSync(join(base,f.path)))!==f.sha256)throw Error('Phase snapshot changed: '+phase+'/'+f.path);
 const caches=m.files.filter(f=>f.path.endsWith('CMakeCache.txt')).map(f=>({path:f.path,text:readFileSync(join(base,f.path),'utf8')}));
 const flags=m.files.filter(f=>f.path.endsWith('flags.make')).map(f=>({path:f.path,text:readFileSync(join(base,f.path),'utf8')}));
 const value=(text,key)=>{const lines=text.split(/\r?\n/).filter(s=>s.startsWith(key+'='));if(lines.length!==1)throw Error('Missing/duplicate cache key '+key+': '+phase);return lines[0].slice(key.length+1);};
 const top=caches.filter(f=>f.path==='CMakeCache.txt');
 if(top.length!==1||value(top[0].text,'CMAKE_PROJECT_NAME:STATIC')!=='ZXingWasm'||value(top[0].text,'CMAKE_CXX_FLAGS:STRING')!==(expected?flag:''))throw Error('Actual top-level cache/project/flags mismatch: '+phase);
 for(const child of caches.filter(f=>f.path!=='CMakeCache.txt')){
  // Retain and hash the non-compiling FetchContent setup cache; it has no C++ flags.
  if(child.path!=='_deps/stb-subbuild/CMakeCache.txt'||value(child.text,'CMAKE_PROJECT_NAME:STATIC')!=='stb-populate'||/^CMAKE_(?:CXX_FLAGS|CXX_COMPILER|C_COMPILER)(?::|[-_])/m.test(child.text)||child.text.includes(flag))throw Error('Unrecognised or compiling child cache: '+phase+'/'+child.path);
 }
 const cxx=flags.filter(f=>/^CXX_FLAGS\s*=/m.test(f.text));
 if(!cxx.length||cxx.some(f=>{const lines=f.text.split(/\r?\n/).filter(s=>/^CXX_FLAGS\s*=/.test(s));if(lines.length!==1)return true;const tokens=lines[0].slice(lines[0].indexOf('=')+1).trim().split(/\s+/).filter(s=>s.startsWith('-DZXING_QRGEN_ROW_TRACE'));return JSON.stringify(tokens)!==JSON.stringify(expected?[flag]:[]);}))throw Error('Actual C++ compiler flags mismatch: '+phase);
 const required=['ZXing/CMakeFiles/ZXing.dir/flags.make','CMakeFiles/zxing_reader.dir/flags.make',...(phase!=='reader'?['CMakeFiles/zxing_writer.dir/flags.make']:[]),...(phase==='full'?['CMakeFiles/zxing_full.dir/flags.make']:[])];
 if(required.some(path=>cxx.filter(f=>f.path===path).length!==1))throw Error('Phase-appropriate actual C++ target flags missing: '+phase);
}
const evidence={scope:'Successful build file fingerprints only; no reader imports or recognition.',variant,
 wrapperCommit:metadata.wrapperCommit,cppCommit:metadata.cppCommit,compileDefinition:variant==='instrumented'?metadata.compileDefinition:null,
 patchSha256:variant==='instrumented'?metadata.patchSha256:null,esGraph:walk(join(root,'dist/es')),
 wasmSha256:sha(wasm),wasmBytes:wasm.length,glueSha256:sha(readFileSync(join(root,'matched-emscripten-glue.js'))),
 compilerFiles:[...walk(join(root,'cmake')).map(f=>({...f,path:'cmake/'+f.path})),...['cxxflags.txt','CMakeLists.txt'].map(path=>({path,sha256:sha(readFileSync(join(root,path)))}))],
 node:process.version,recognitionCalls:0};
writeFileSync(join(root,'build-evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));

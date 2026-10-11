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
 const caches=m.files.filter(f=>f.path.endsWith('CMakeCache.txt')).map(f=>readFileSync(join(base,f.path),'utf8'));
 const flags=m.files.filter(f=>f.path.endsWith('flags.make')).map(f=>({path:f.path,text:readFileSync(join(base,f.path),'utf8')}));
 if(!caches.some(s=>/^CMAKE_CXX_FLAGS:STRING=/m.test(s))||caches.some(s=>s.includes(flag)!==expected))throw Error('Actual cache flag mismatch: '+phase);
 const cxx=flags.filter(f=>/^CXX_FLAGS\s*=/m.test(f.text));
 if(!cxx.length||cxx.some(f=>f.text.includes(flag)!==expected))throw Error('Actual C++ compiler flags mismatch: '+phase);
 if(phase==='reader'&&(!cxx.some(f=>f.path.includes('ZXing.dir/'))||!cxx.some(f=>f.path.includes('zxing_reader.dir/'))))throw Error('Reader/core compile flags missing');
}
const evidence={scope:'Successful build file fingerprints only; no reader imports or recognition.',variant,
 wrapperCommit:metadata.wrapperCommit,cppCommit:metadata.cppCommit,compileDefinition:variant==='instrumented'?metadata.compileDefinition:null,
 patchSha256:variant==='instrumented'?metadata.patchSha256:null,esGraph:walk(join(root,'dist/es')),
 wasmSha256:sha(wasm),wasmBytes:wasm.length,glueSha256:sha(readFileSync(join(root,'matched-emscripten-glue.js'))),
 compilerFiles:[...walk(join(root,'cmake')).map(f=>({...f,path:'cmake/'+f.path})),...['cxxflags.txt','CMakeLists.txt'].map(path=>({path,sha256:sha(readFileSync(join(root,path)))}))],
 node:process.version,recognitionCalls:0};
writeFileSync(join(root,'build-evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));

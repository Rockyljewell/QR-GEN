// Portable replay of the frozen source-port diagnostic; never writes package files.
import{readFileSync,writeFileSync,mkdirSync,existsSync}from'node:fs';import{join,resolve,dirname,relative,isAbsolute,sep}from'node:path';import{tmpdir}from'node:os';import{fileURLToPath}from'node:url';
import{sharp,PNG,reader,wasm,sha,lum,options,simpleResult}from'./trace-rows.mjs';
import{portRead}from'./port-engine.mjs';import{portRead as wordPortRead}from'./port-word-engine.mjs';
const packageRoot=dirname(fileURLToPath(import.meta.url)),cache=resolve(process.env.QRGEN_EAN_STUDY_CACHE_DIR??join(tmpdir(),'qrgen-ean-study-5bdcab8035-315')),out=resolve(process.env.QRGEN_EAN_MECHANISM_OUTPUT_DIR??join(tmpdir(),'qrgen-ean-mechanism-results'));
const rel=relative(packageRoot,out);if(!rel||!(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)))throw Error('Output must be outside package');mkdirSync(out,{recursive:true});
const read=f=>JSON.parse(readFileSync(join(packageRoot,f),'utf8')),manifest=read('frozen-raster-manifest.json'),generated=read('generated-manifest.json');
const chrome=resolve(process.env.QRGEN_EAN_CHROME_PNG??join(packageRoot,'../ean-browser-diagnostic-2026-10-11/fixtures/ean13-2-07-full.png'));if(!existsSync(chrome))throw Error('Exact Chrome supplement required; set QRGEN_EAN_CHROME_PNG');
const items=[];for(const c of manifest.cases)for(const r of c.rasters)items.push({id:c.id,truth:c.truth,group:r.pipeline,local:r.local??c.localImage,pngSha256:r.pngSha256??c.sourceSha256,rgbaSha256:r.pixelsSha256});
for(const r of manifest.supplement.rasters)items.push({id:manifest.supplement.id,truth:manifest.supplement.truth,group:'actual-Chrome-supplement',local:null,pngSha256:r.pngSha256??manifest.supplement.sourceSha256,rgbaSha256:r.pixelsSha256});
for(const c of generated.cases)items.push({id:c.id,truth:c.expected,group:c.kind==='control'?'generated-no-code':'generated-positive',local:'generated/'+c.local,pngSha256:c.sha256,rgbaSha256:c.rgbaSha256});
const plan={scope:'Portable artifact-only source-port replay, not compiled/patchedWASM. Exact inherited frozen471rasters×fast/hard; EAN13,max255,min2,downscale:false,invert:false,Ignoreaddon. Two policies evaluated uniformly without truth use.',frozenAt:new Date().toISOString(),cppCommit:reader.ZXING_CPP_COMMIT,readerVersion:reader.ZXING_WASM_VERSION,wasmSha256:sha(wasm),options,items,runnerFingerprints:Object.fromEntries(['run-port.mjs','trace-rows.mjs','port-engine.mjs','port-word-engine.mjs','word-ambiguity.mjs'].map(f=>[f,sha(readFileSync(join(packageRoot,f)))]))};
writeFileSync(join(out,'execution-plan.json'),JSON.stringify(plan,null,2)+'\n');
const result={scope:plan.scope,planSha256:sha(readFileSync(join(out,'execution-plan.json'))),runs:[]},key=r=>r.group+'/'+r.id+'/'+r.tryHarder;
const archivedWord=new Map(read('recorded-word-results.json').runs.map(r=>[key(r),r])),archivedTie=new Map(read('recorded-tie-results.json').runs.map(r=>[key(r),r]));
function comparable(a){return a.map(r=>({text:r.text,lineCount:r.lineCount,position:r.position})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));}
function same(a,b){return JSON.stringify(comparable(a))===JSON.stringify(comparable(b));}
let baselineMismatches=0,recordedMismatches=0;
for(let i=0;i<items.length;i++){const c=items[i],bytes=readFileSync(c.local===null?chrome:join(cache,c.local));if(sha(bytes)!==c.pngSha256)throw Error('Frozen PNG changed:'+c.id);let p;
if(c.group==='original-RGBA-white-sRGB'){const raw=await sharp(bytes).flatten({background:'#ffffff'}).removeAlpha().toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});p={width:raw.info.width,height:raw.info.height,data:raw.data};}else{const a=PNG.sync.read(bytes);p={width:a.width,height:a.height,data:a.data};}
if(sha(p.data)!==c.rgbaSha256)throw Error('Frozen pixels changed:'+c.id);p.lum=lum(p);
for(const tryHarder of[false,true]){const actual=(await reader.readBarcodes(p,{...options,tryHarder})).map(simpleResult),before=portRead(p,{tryHarder,rejectTies:false}),rejectAnyTie=portRead(p,{tryHarder,rejectTies:true}),rejectMultipleWords=wordPortRead(p,{tryHarder,rejectTies:false}),r={id:c.id,group:c.group,truth:c.truth,tryHarder,actual,before,rejectAnyTie,rejectMultipleWords,baselineMatches:same(actual,before)};
const w=archivedWord.get(key(r)),t=archivedTie.get(key(r));r.matchesRecorded=!!w&&!!t&&same(actual,w.actual)&&same(before,w.before)&&same(rejectMultipleWords,w.after)&&same(rejectAnyTie,t.after);baselineMismatches+=!r.baselineMatches;recordedMismatches+=!r.matchesRecorded;result.runs.push(r);}
if((i+1)%100===0)console.log(JSON.stringify({processed:i+1,total:items.length}));}
const verification={scope:plan.scope,completedAt:new Date().toISOString(),rasters:items.length,profiles:result.runs.length,baselineMismatches,recordedMismatches,allFrozenRasterHashesMatched:true};writeFileSync(join(out,'results.json'),JSON.stringify(result)+'\n');writeFileSync(join(out,'verification.json'),JSON.stringify(verification,null,2)+'\n');console.log(JSON.stringify(verification));if(baselineMismatches||recordedMismatches)process.exitCode=1;


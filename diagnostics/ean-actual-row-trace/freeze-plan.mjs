// Fixture verification only. No reader or SDK imports, builds or recognition.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)), art=resolve(here,'..');
const sha=b=>createHash('sha256').update(b).digest('hex');
const dependencyRoot=resolve(process.env.QRGEN_TRACE_DEPENDENCY_ROOT??'C:/Users/rocky/OneDrive/Desktop/QR-GEN/packages/sdk');
const req=createRequire(join(dependencyRoot,'package.json')), {PNG}=req('pngjs');
const json=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const nodePath=join(art,'staged-sdk-node-validation/frozen-plan.json'), node=json(nodePath);
const physicalPath=join(art,'ean-physical-conflict-feasibility/control-rasters.json'), physical=json(physicalPath);
const spec=[['original-RGBA-white-sRGB','ean13-1-35'],['derived-limited-Y-expanded-RGB','ean13-1-35'],
 ['derived-limited-Y-expanded-RGB','ean13-2-07'],['actual-Chrome-supplement','actual-Chrome-ean13-2-07-full'],
 ['original-RGBA-white-sRGB','ean13-2-14'],['original-RGBA-white-sRGB','ean13-2-20']];
const inputs=spec.map(([group,id])=>{
 const a=node.items.filter(x=>x.group===group&&x.id===id); if(a.length!==1)throw Error('Missing/duplicate exact input '+group+'/'+id);
 const x=a[0];return {key:x.key,id:x.id,group:x.group,kind:'existing-photograph',sourcePath:x.path,
  sourceSha256:x.fileSha256,transportPath:x.transportPath,transportSha256:x.transportSha256,
  rgbaSha256:x.rgbaSha256,width:x.width,height:x.height,sourceLoadType:x.loadType};
});
if(physical.controls.length!==9)throw Error('Expected exactly nine saved controls');
for(const x of physical.controls)inputs.push({key:'physical-control/'+x.id,id:x.id,group:'physical-control',kind:'existing-generated-control',
 sourcePath:x.path,sourceSha256:x.pngSha256,transportPath:x.path,transportSha256:x.pngSha256,
 rgbaSha256:x.rgbaSha256,width:x.width,height:x.height,placements:x.placementsBeforeRotation,controlSpec:x.spec});
if(inputs.length!==15||new Set(inputs.map(x=>x.key)).size!==15)throw Error('Expected 15 unique frozen rasters');
for(const x of inputs){
 const source=readFileSync(x.sourcePath), bytes=readFileSync(x.transportPath), p=PNG.sync.read(bytes);
 if(sha(source)!==x.sourceSha256||sha(bytes)!==x.transportSha256||sha(p.data)!==x.rgbaSha256||p.width!==x.width||p.height!==x.height)
  throw Error('Input identity mismatch: '+x.key);
 x.sourceBytes=source.length;x.transportBytes=bytes.length;
}
const options={formats:['EAN13'],tryHarder:false,tryRotate:true,tryInvert:false,tryDownscale:false,tryDenoise:false,
 isPure:false,minLineCount:2,maxNumberOfSymbols:255,eanAddOnSymbol:'Ignore',returnErrors:false,textMode:'HRI',binarizer:'LocalAverage'};
const profiles=[];
for(const input of inputs)for(const tryHarder of [false,true])for(const maxNumberOfSymbols of [1,2,255])
 profiles.push({id:input.key+'/'+(tryHarder?'hard':'fast')+'/max'+maxNumberOfSymbols,inputKey:input.key,
  options:{...options,tryHarder,maxNumberOfSymbols}});
const code=['PROTOCOL.md','QRGenRowTrace.h','prepare-instrumentation.py','actual-row-trace.patch','patch-metadata.json',
 'freeze-plan.mjs','run-paired.mjs','capture-build-evidence.mjs','diagnostic-build.yml','verify-build-inputs.py','snapshot-build-phase.py','freeze-package.py','verify-validation-only.mjs','verify-v3-amendment.py','REVIEW-AMENDMENT.md','v1-provenance.json','v2-provenance.json','build-failure-provenance.json','accessor-audit.json','README.md'];
const plan={schemaVersion:1,frozenAt:new Date().toISOString(),scope:'Unchanged-policy actual C++ instrumentation, 15 rasters Ã— 6 profiles; no recognition during freeze.',
 cppCommit:'2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4',wrapperCommit:'b7dcf63aefc7b94fb97ba09e9b1fb213d9399f54',
 count:{rasters:15,profiles:90},parentPlans:[{path:nodePath,sha256:sha(readFileSync(nodePath))},{path:physicalPath,sha256:sha(readFileSync(physicalPath))}],
 files:code.map(path=>({path,sha256:sha(readFileSync(join(here,path))),bytes:readFileSync(join(here,path)).length})),inputs,profiles,
 preparation:{readerImports:0,recognitionCalls:0,node:process.version,pngjs:json(req.resolve('pngjs/package.json')).version},
 gates:['root-bound successful compiled build provenance','all 90 exact ordered public output comparisons pass','all inputs unchanged','complete trace transport before interpretation'],
 bounds:json(join(here,'patch-metadata.json')).bounds};
const output=join(here,'frozen-plan.json');if(existsSync(output))throw Error('Frozen plan already exists; do not overwrite');
writeFileSync(output,JSON.stringify(plan,null,2)+'\n');
console.log(JSON.stringify({path:output,sha256:sha(readFileSync(output)),rasters:inputs.length,profiles:profiles.length,recognitionCalls:0}));

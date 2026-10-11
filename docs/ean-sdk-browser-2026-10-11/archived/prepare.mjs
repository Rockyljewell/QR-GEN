// No SDK imports or decoder calls: freeze assets and browser-observed input pixels.
import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {root,art,repo,stage,hash,json,save,digest,sharp,server,launch,context} from './common.mjs';
await mkdir(join(root,'fixtures'),{recursive:true});
const policyPath=join(art,'ean-sdk-integration-protocol/protocol.json');
const policy=await json(policyPath);
await copyFile(policyPath,join(root,'original-protocol.json'));
const amendment={frozenAt:new Date().toISOString(),beforeAnyStagedSdkDecode:true,originalProtocolSha256:hash(await readFile(policyPath)),reason:'Bind actual isolated consumer builds accurately; no behavioral policy changes.',changes:[
 'Candidate config.ts changes ONLY its ZXING_WASM_VERSION metadata import to the matched private reader graph. Version remains3.1.5, default CDN remains released and MUST be overridden for this study. No config logic change.',
 'Baseline uses exact-base official released3.1.5 dependency reader graph; its released reader WASM is byte-identical to the rebuilt baseline artifact. Do not assert baseline rebuilt wrapper identity if source bytes differ.',
 'No esbuild metafile/input graph was retained. Provenance consists of root frozen source inventory, direct actual dependency/private graph hashes, generated embedded Worker string and built consumer assets. Do not label this an esbuild metafile.',
 'Successful root staging and this explicit artifact-only execution authorization supersede original awaiting-execution status. Original policy bytes remain unchanged.'
]};
await save(join(root,'predecode-amendment.json'),amendment);
const inputs={actual07:join(repo,policy.fixtures.actual07.relativeSource),original35:join(art,policy.fixtures.original35.cacheRelativeSource),derived35:join(art,policy.fixtures.derived35.cacheRelativeSource),cleanEAN:join(repo,'docs',policy.fixtures.cleanEAN.packageRelativeSource),cleanQR:join(repo,'docs',policy.fixtures.cleanQR.packageRelativeSource),cleanUPC:join(repo,'docs',policy.fixtures.cleanUPC.packageRelativeSource)};
const fixtures={};
for(const [id,p] of Object.entries(inputs)){const b=await readFile(p);if(hash(b)!==policy.fixtures[id].pngSha256)throw Error('PNG pin mismatch '+id);await writeFile(join(root,'fixtures',id+'.png'),b,{flag:'wx'});const {data,info}=await sharp(b).ensureAlpha().raw().toBuffer({resolveWithObject:true});fixtures[id]={png:await digest(p),rgbaSha256:hash(data),width:info.width,height:info.height};if(policy.fixtures[id].rgbaSha256&&fixtures[id].rgbaSha256!==policy.fixtures[id].rgbaSha256)throw Error('RGBA pin mismatch '+id);}
const blank=Buffer.alloc(640*480*4,255),actual=(await sharp(inputs.actual07).ensureAlpha().raw().toBuffer()),qr=await sharp(inputs.cleanQR).ensureAlpha().raw().toBuffer({resolveWithObject:true}),ean=await sharp(inputs.cleanEAN).ensureAlpha().raw().toBuffer({resolveWithObject:true});
function overlay(dst,src,w,h,x,y){for(let row=0;row<h;row++)src.copy(dst,((row+y)*640+x)*4,row*w*4,(row+1)*w*4);}
const mixA=Buffer.from(actual);overlay(mixA,qr.data,qr.info.width,qr.info.height,24,20);const mixC=Buffer.from(blank);overlay(mixC,qr.data,qr.info.width,qr.info.height,24,20);overlay(mixC,ean.data,ean.info.width,ean.info.height,100,300);
for(const [id,data] of Object.entries({blank,mixedActual:mixA,mixedClean:mixC})){if(hash(data)!==policy.fixtures[id].rgbaSha256)throw Error('composition pin mismatch '+id);const png=await sharp(data,{raw:{width:640,height:480,channels:4}}).png().toBuffer();await writeFile(join(root,'fixtures',id+'.png'),png,{flag:'wx'});fixtures[id]={png:{bytes:png.length,sha256:hash(png)},rgbaSha256:hash(data),width:640,height:480};}
process.env.QRGEN_COMPARISON_REPO=repo;
const helper=join(art,'blackbox-comparison/review-package/image-camera.mjs');
const {writeImageCamera}=await import(pathToFileURL(helper));
await writeImageCamera(join(root,'fixtures/preflight35Y4M.y4m'),inputs.original35,{width:640,height:480,frames:30});
await copyFile(join(art,policy.cameraMatrix.preparation.historical07Y4M.cacheRelativeSource),join(root,'fixtures/historical07Y4M.y4m'));
await copyFile(join(art,policy.cameraMatrix.preparation.retailMixedY4M.cacheRelativeSource),join(root,'fixtures/retailMixedY4M.y4m'));
const srv=await server(),camera={};
try {
 for(const id of ['historical07Y4M','preflight35Y4M','retailMixedY4M']){
  const browser=await launch(join(root,'fixtures',id+'.y4m'));const {context:c,blocked}=await context(browser,srv.origin);
  try{const p=await c.newPage();await p.goto(srv.origin);const out=await p.evaluate(async()=>{
   const tracks=[];const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480}},audio:false});tracks.push(...stream.getTracks());const v=document.createElement('video');v.muted=true;v.playsInline=true;document.body.append(v);v.srcObject=stream;await v.play();await new Promise(r=>v.requestVideoFrameCallback(r));const canvas=document.createElement('canvas');canvas.width=v.videoWidth;canvas.height=v.videoHeight;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(v,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height);const rgbaSha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data.data))].map(x=>x.toString(16).padStart(2,'0')).join('');const png=canvas.toDataURL('image/png').split(',')[1];tracks.forEach(t=>t.stop());v.srcObject=null;v.remove();return {width:canvas.width,height:canvas.height,rgbaSha256,png,ended:tracks.every(t=>t.readyState==='ended'),videoDetached:!v.isConnected};});
   const png=Buffer.from(out.png,'base64');delete out.png;await writeFile(join(root,'fixtures',id+'-preflight.png'),png,{flag:'wx'});camera[id]={...out,png:{bytes:png.length,sha256:hash(png)},y4m:await digest(join(root,'fixtures',id+'.y4m')),blocked};if(id==='historical07Y4M'&&out.rgbaSha256!==policy.cameraMatrix.preparation[id].expectedCameraRgbaSha256)throw Error('historical07 browser pixel mismatch');if(!out.ended||!out.videoDetached)throw Error('preflight camera leak');
  }finally{await c.close();await browser.close();}
 }
 // Freeze browser PNG normalization pixels before any SDK module is imported.
 const browser=await launch();const {context:c}=await context(browser,srv.origin);
 try{const p=await c.newPage();await p.goto(srv.origin);for(const id of Object.keys(fixtures)){const obs=await p.evaluate(async id=>{const b=await(await fetch('/fixtures/'+id+'.png')).blob();const img=await createImageBitmap(b);const cv=document.createElement('canvas');cv.width=img.width;cv.height=img.height;const cx=cv.getContext('2d',{willReadFrequently:true});cx.drawImage(img,0,0);img.close();const d=cx.getImageData(0,0,cv.width,cv.height).data;return {width:cv.width,height:cv.height,rgbaSha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',d))].map(x=>x.toString(16).padStart(2,'0')).join('')};},id);fixtures[id].browser=obs;if(obs.rgbaSha256!==fixtures[id].rgbaSha256)throw Error('browser image pixel mismatch '+id);}}finally{await c.close();await browser.close();}
}finally{await srv.close();}
const packed=await json(join(stage,'packed-inventory.json')),assets={};
async function files(dir,base=dir){const result=[];for(const d of await readdir(dir,{withFileTypes:true})){const p=join(dir,d.name);if(d.isDirectory())result.push(...await files(p,base));else if(d.name.endsWith('.js'))result.push({path:relative(base,p).replaceAll('\\','/'),...await digest(p)});}return result;}
for(const v of ['baseline','candidate']){
 const dir=join(stage,'consumers',v,'package'),selected={};
 for(const rel of ['dist/browser/qrgen.js','dist/browser/qrgen.iife.js','dist/wasm/zxing_reader.wasm','dist/wasm/zxing_writer.wasm','diagnostic-reader-provenance.json']){const d=await digest(join(dir,rel));const old=packed.variants[v].files.find(f=>f.path==='package/'+rel);if(old&&old.sha256!==d.sha256)throw Error('packed asset mismatch '+v+'/'+rel);selected[rel]=d;}
 const generated=await readFile(join(stage,v,'src/generated/worker-source.ts'),'utf8');const worker=JSON.parse(generated.match(/WORKER_SOURCE: string = ([\s\S]*);\s*$/)[1]);const workerBytes=Buffer.from(worker);
 const graphBase=v==='baseline'?join(stage,v,'node_modules/zxing-wasm/dist/es'):join(stage,v,'src/engine/candidate');
 assets[v]={consumerRelative:'staged-sdk-study-v1/consumers/'+v+'/package',files:selected,generatedWorkerTs:await digest(join(stage,v,'src/generated/worker-source.ts')),embeddedWorker:{bytes:workerBytes.length,sha256:hash(workerBytes)},readerGraph:await files(graphBase),readerGraphKind:v==='baseline'?'official released dependency ES graph (includes official writer/share entries)':'matched private candidate ES graph',diagnosticProvenance:await json(join(dir,'diagnostic-reader-provenance.json'))};
}
const binding={frozenAt:new Date().toISOString(),beforeAnyStagedSdkDecode:true,policySha256:hash(await readFile(policyPath)),amendmentSha256:hash(await readFile(join(root,'predecode-amendment.json'))),sourceHead:policy.productSourceHead,provenanceReceipts:{sourceInventory:await digest(join(stage,'predecode-source-inventory.json')),sourceProvenance:await digest(join(stage,'source-provenance.json')),packedInventory:await digest(join(stage,'packed-inventory.json'))},conversionHelper:await digest(helper),fixtures,camera,assets,noEsbuildMetafileAvailable:true,preflight:'Bare real Chromium video/canvas only; no SDK imported or decoder called; each browser/context/track closed.',corruptReader:{utf8:'QRGEN deliberately corrupt non-WASM diagnostic v1\n',sha256:hash(Buffer.from('QRGEN deliberately corrupt non-WASM diagnostic v1\n'))}};
await save(join(root,'assets-and-inputs.json'),binding);console.log(JSON.stringify({binding:await digest(join(root,'assets-and-inputs.json')),camera,assetBundles:Object.fromEntries(Object.entries(assets).map(([k,v])=>[k,v.files['dist/browser/qrgen.js']]))},null,2));

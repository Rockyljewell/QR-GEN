// Download only pinned public ZXing fixtures; validate every source and generated camera hash.
// Run from the pinned QR-GEN checkout after npm ci && npm run build.
import {createRequire} from 'node:module';
import{readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,unlinkSync}from'node:fs';
import{join,dirname,relative,sep}from'node:path';import{fileURLToPath}from'node:url';
import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';
import{writeImageCamera}from'./image-camera.mjs';
const metadataDir=dirname(fileURLToPath(import.meta.url));
const outputDir=process.env.QRGEN_COMPARISON_OUTPUT??metadataDir;
const repository=process.env.QRGEN_COMPARISON_REPO??process.cwd();
const manifest=JSON.parse(readFileSync(join(metadataDir,'corpus-manifest.json'),'utf8'));
const prepared=JSON.parse(readFileSync(join(metadataDir,'fixture-preparation.json'),'utf8'));
const proof=JSON.parse(readFileSync(join(metadataDir,'qrgen-build-proof.json'),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const base='https://raw.githubusercontent.com/'+manifest.repository+'/'+manifest.commit+'/';
mkdirSync(outputDir,{recursive:true});
async function obtain(url,local,expected){
 const path=join(outputDir,local);if(existsSync(path)&&hash(readFileSync(path))===expected)return path;
 const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Download failed '+response.status+' '+url);
 const bytes=Buffer.from(await response.arrayBuffer());if(hash(bytes)!==expected)throw new Error('Pinned download hash mismatch: '+local);
 mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);return path;
}
if(hash(readFileSync(join(metadataDir,'image-camera.mjs')))!==prepared.helperSha256)throw new Error('Camera conversion helper changed');
const licenses={'ZXING-LICENSE.txt':'LICENSE','ZXING-NOTICE.txt':'NOTICE','ZXING-REUSE-dep5.txt':'.reuse/dep5','ZXING-BLACKBOX-README.txt':'core/src/test/resources/blackbox/README'};
for(const license of manifest.license.retained)await obtain(base+licenses[license.local],license.local,license.sha256);
const checks=[];const transient=join(outputDir,'preparation-only.y4m');
try{
 for(const item of manifest.cases){
  const imagePath=await obtain(item.image.url,item.image.local,item.image.sha256);
  if(item.groundTruth?.url){const truth=await obtain(item.groundTruth.url,'ground-truth/'+item.id+'.txt',item.groundTruth.sha256);if(readFileSync(truth,'utf8')!==item.expected[0].data)throw new Error('Exact ground truth differs: '+item.id);}
  const fixture=await writeImageCamera(transient,imagePath);const frozen=prepared.cases.find(c=>c.id===item.id);
  if(fixture.y4mSha256!==frozen.fixture.y4mSha256)throw new Error('Camera conversion differs: '+item.id);
  await obtain(frozen.testDefinition.url,'test-definitions/'+frozen.testDefinition.path.split('/').at(-1),frozen.testDefinition.sha256);
  checks.push({id:item.id,imageSha256:fixture.imageSha256,y4mSha256:fixture.y4mSha256});
 }
}finally{try{unlinkSync(transient);}catch{}}
if(!process.argv.includes('--fixtures-only')){
 const head=execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim();
 if(head!==proof.sourceCommit)throw new Error('Build a separate clean checkout at '+proof.sourceCommit+' before recording build proof');
 execFileSync('git',['diff','--quiet','HEAD','--','packages/sdk/src','site/src','site/scripts'],{cwd:repository});
 function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);}
 const dist=join(repository,'site/dist');const assets=Object.fromEntries(walk(dist).filter(p=>/\.(?:js|wasm)$/.test(p)).map(p=>{const bytes=readFileSync(p);return['/QR-GEN/'+relative(dist,p).split(sep).join('/'),{sha256:hash(bytes),bytes:bytes.length}];}));
 for(const[path,expected]of Object.entries(proof.siteAssets))if(assets[path]?.sha256!==expected.sha256)throw new Error('Built asset differs from recorded candidate: '+path);
 writeFileSync(join(outputDir,'qrgen-build-proof.json'),JSON.stringify({...proof,reproducedAt:new Date().toISOString(),siteAssets:assets},null,2)+'\n');
}
const result={preparedAt:new Date().toISOString(),sourceRepository:manifest.repository,sourceCommit:manifest.commit,cases:checks,decoderCalls:0};
writeFileSync(join(outputDir,'reproduction-preparation.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({preparedCases:checks.length,decoderCalls:0,buildProofChecked:!process.argv.includes('--fixtures-only')}));

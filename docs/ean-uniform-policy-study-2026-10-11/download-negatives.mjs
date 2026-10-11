// Only pinned public no-code sources. No decoder or repository writes.
import{readFileSync,writeFileSync,mkdirSync,existsSync}from'node:fs';
import{join,dirname,resolve,relative,isAbsolute,sep}from'node:path';
import{fileURLToPath}from'node:url';import{tmpdir}from'node:os';import{createHash}from'node:crypto';
const packageRoot=dirname(fileURLToPath(import.meta.url)),manifest=JSON.parse(readFileSync(join(packageRoot,'negative-manifest.json')));
const cacheRoot=resolve(process.env.QRGEN_EAN_STUDY_CACHE_DIR??join(tmpdir(),'qrgen-ean-study-5bdcab8035-315'));
const rel=relative(packageRoot,cacheRoot);if(!rel||!(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)))throw Error('Cache must be outside this package');
const sha=b=>createHash('sha256').update(b).digest('hex');
for(const item of manifest.cases){
 if(!item.negative)throw Error('Expected frozen no-code case');
 const path=join(cacheRoot,'uniform-negative',item.image.local);
 if(!existsSync(path)){const response=await fetch(item.image.url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Pinned negative download failed: '+response.status);const bytes=Buffer.from(await response.arrayBuffer());if(sha(bytes)!==item.image.sha256)throw Error('Pinned source hash mismatch');mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);}
 if(sha(readFileSync(path))!==item.image.sha256)throw Error('Cached source hash mismatch; existing files were not overwritten');
}
console.log(JSON.stringify({verifiedSources:manifest.cases.length,decoderReads:0,cache:cacheRoot}));

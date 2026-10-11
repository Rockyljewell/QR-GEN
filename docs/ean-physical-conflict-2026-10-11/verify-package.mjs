import {readFileSync,readdirSync} from 'node:fs';
import {dirname,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const here=dirname(fileURLToPath(import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
export function verifyPackage(){
 const manifest=JSON.parse(readFileSync(join(here,'package-manifest.json'))),listed=new Set();
 for(const e of manifest.files){
  if(!e.path||e.path.includes('\\')||e.path.startsWith('/')||e.path.split('/').includes('..')||listed.has(e.path))throw Error('Invalid or duplicated manifest path');listed.add(e.path);
  const b=readFileSync(join(here,e.path));if(b.length!==e.bytes||sha(b)!==e.sha256)throw Error('Package hash mismatch '+e.path);
  if(e.uncompressedSha256){const plain=gunzipSync(b);if(plain.length!==e.uncompressedBytes||sha(plain)!==e.uncompressedSha256)throw Error('Original gzip record mismatch '+e.path);}
 }
 const walk=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(p,e.name)):[relative(here,join(p,e.name)).split(sep).join('/')]);
 const extra=walk(here).filter(p=>p!=='package-manifest.json'&&!listed.has(p));if(extra.length)throw Error('Unlisted package files '+extra.join(','));
 const original=JSON.parse(readFileSync(join(here,'original-evidence-hashes.json'))),controls=JSON.parse(readFileSync(join(here,'derived-control-rasters.json')));
 if(controls.originalControlManifestSha256!==original.originalFiles['control-rasters.json'].sha256)throw Error('Derived control source identity mismatch');
 for(const c of controls.manifest.controls)if(sha(readFileSync(join(here,c.path)))!==c.pngSha256)throw Error('Frozen control PNG mismatch '+c.id);
 console.log(JSON.stringify({status:'package-integrity-passed',files:listed.size,scope:'Hash/gzip verification only; no SDK or image decoder execution'}));return manifest;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])verifyPackage();

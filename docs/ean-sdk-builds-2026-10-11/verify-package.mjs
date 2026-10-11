import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
const here=dirname(fileURLToPath(import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
export async function verifyPackage(){
 const manifest=JSON.parse(readFileSync(join(here,'package-manifest.json'))),listed=new Set(),failures=[];
 for(const r of manifest.files){if(r.path.startsWith('/')||r.path.includes('\\')||r.path.split('/').includes('..')||listed.has(r.path))throw Error('Invalid inventory path');listed.add(r.path);const b=readFileSync(join(here,r.path));if(b.length!==r.bytes||sha(b)!==r.sha256)failures.push(r.path);if(r.uncompressedSha256){const raw=gunzipSync(b);if(sha(raw)!==r.uncompressedSha256||r.uncompressedBytes!==undefined&&raw.length!==r.uncompressedBytes)failures.push(r.path+' gunzip');}}
 const walk=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(d,e.name)):[relative(here,join(d,e.name)).split(sep).join('/')]);
 const extra=walk(here).filter(p=>p!=='package-manifest.json'&&!listed.has(p));if(failures.length||extra.length)throw Error('Package integrity failed '+JSON.stringify({failures,extra}));
 console.log(JSON.stringify({status:'package-integrity-passed',files:listed.size,scope:'Hash verification only; no SDK/native/browser decoder rerun'}));return{files:listed.size};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await verifyPackage();

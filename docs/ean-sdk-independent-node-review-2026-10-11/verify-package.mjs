import {readFileSync,readdirSync} from 'node:fs';
import {dirname,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const here=dirname(fileURLToPath(import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
export function verifyPackage(){
 const manifest=JSON.parse(readFileSync(join(here,'package-manifest.json'))),listed=new Set();
 for(const e of manifest.files){if(!e.path||e.path.includes('\\')||e.path.startsWith('/')||e.path.split('/').includes('..')||listed.has(e.path))throw Error('Invalid inventory path');listed.add(e.path);const b=readFileSync(join(here,e.path));if(b.length!==e.bytes||sha(b)!==e.sha256)throw Error('Package hash mismatch '+e.path);if(e.uncompressedSha256){const raw=gunzipSync(b);if(raw.length!==e.uncompressedBytes||sha(raw)!==e.uncompressedSha256)throw Error('Gzip content mismatch '+e.path);}}
 const walk=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(p,e.name)):[relative(here,join(p,e.name)).split(sep).join('/')]);if(walk(here).some(p=>p!=='package-manifest.json'&&!listed.has(p)))throw Error('Unlisted package file');
 console.log(JSON.stringify({status:'independent-review-package-integrity-passed',files:listed.size,scope:'No SDK import, image decoder or barcode recognition'}));return manifest;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])verifyPackage();

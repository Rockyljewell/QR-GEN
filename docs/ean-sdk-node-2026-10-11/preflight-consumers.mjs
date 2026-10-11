// File/hash validation only. Never imports an SDK or an external reader module.
import { readFileSync, realpathSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const here=dirname(fileURLToPath(import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const within=(root,path)=>{const rel=relative(root,path);return rel===''||!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep);};
const leaves=value=>typeof value==='string'?[value]:Object.values(value).flatMap(leaves);
export function preflightConsumers(){
 const inventory=JSON.parse(readFileSync(join(here,'staged-build/packed-inventory.json'))),external=JSON.parse(readFileSync(join(here,'external-baseline-es-fingerprints.json'))),roots={},entries={},reports={};
 for(const label of['baseline','candidate']){
  const prefix='QRGEN_STAGED_'+label.toUpperCase(),rootArg=process.env[prefix+'_ROOT'];if(!rootArg)throw Error('Required extracted consumer root '+prefix+'_ROOT');
  const root=realpathSync(resolve(rootArg)),entry=realpathSync(resolve(process.env[prefix+'_ENTRY']??join(root,'dist/node.js'))),expected=inventory.variants[label];
  const expectedFiles=new Set();
  for(const record of expected.files){if(!record.path.startsWith('package/'))throw Error('Invalid historical inventory path');const rel=record.path.slice('package/'.length);if(rel.startsWith('/')||rel.includes('\\')||rel.split('/').includes('..'))throw Error('Unsafe historical inventory path');const path=realpathSync(join(root,rel));if(!within(root,path))throw Error('SDK file escapes supplied consumer root '+rel);const bytes=readFileSync(path);if(bytes.length!==record.bytes||sha(bytes)!==record.sha256)throw Error('Consumer SDK hash mismatch '+label+'/'+rel);expectedFiles.add(rel);}
  const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>dir===root&&e.name==='node_modules'?[]:e.isDirectory()?walk(join(dir,e.name)):e.isFile()?[relative(root,join(dir,e.name)).split(sep).join('/')]:[relative(root,join(dir,e.name)).split(sep).join('/')]);
  const actualFiles=walk(root);if(actualFiles.length!==expectedFiles.size||actualFiles.some(p=>!expectedFiles.has(p)))throw Error('Extracted SDK file set differs from historical inventory '+label);
  const pkg=JSON.parse(readFileSync(join(root,'package.json'))),targets=leaves(pkg.exports);if(targets.length!==expected.exportsVerified)throw Error('Export leaf count mismatch '+label);
  for(const target of targets){if(!target.startsWith('./'))throw Error('Unexpected package export');const p=realpathSync(resolve(root,target));if(!within(root,p)||!expectedFiles.has(relative(root,p).split(sep).join('/')))throw Error('Export escapes verified package '+target);}
  const nodeExport=pkg.exports['./node'];if(entry!==realpathSync(resolve(root,nodeExport.import)))throw Error('Supplied ESM entry is not verified public Node export inside consumer root');const cjs=realpathSync(resolve(root,nodeExport.require));if(!within(root,entry)||!within(root,cjs))throw Error('Public Node entry escapes consumer root');
  const reader=readFileSync(join(root,'dist/wasm/zxing_reader.wasm')),writer=readFileSync(join(root,'dist/wasm/zxing_writer.wasm'));if(sha(reader)!==expected.readerWasmSha256||sha(writer)!==expected.writerWasmSha256)throw Error('Known reader/writer asset mismatch');
  const report={sdkFiles:expectedFiles.size,exports:targets.length,version:pkg.version,esmEntrySha256:sha(readFileSync(entry)),cjsEntrySha256:sha(readFileSync(cjs)),readerSha256:sha(reader),writerSha256:sha(writer),externalDependencies:'Not a complete node_modules integrity/compatibility check'};
  if(label==='baseline'){
   const req=createRequire(entry),resolved=req.resolve('zxing-wasm/reader'),es=resolve(dirname(resolved),'../../es');
   for(const record of external.files){const path=join(es,record.path),bytes=readFileSync(path);if(bytes.length!==record.bytes||sha(bytes)!==record.sha256)throw Error('Baseline external released reader ES graph mismatch '+record.path);}
   report.frozenExternalEsFiles=external.files.length;report.externalCjsGraph='No historical complete CJS dependency-graph inventory was retained; not verified by this ES check';
  }
  roots[label]=root;entries[label]=entry;reports[label]=report;
 }
 return{roots,entries,reports,scope:'Pre-import historical 95-file SDK/export/asset validation plus retained baseline external ES graph hashes; no SDK execution and no complete external dependency attestation'};
}

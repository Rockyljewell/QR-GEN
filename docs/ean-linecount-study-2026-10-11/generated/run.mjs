import {join} from 'node:path';
import {packageRoot,dependencyRequire,cacheRoot,readJson,checked,sha256,loadReader,rawResult,writeReport} from '../common.mjs';
const manifest=readJson(join(packageRoot,'generated/manifest.json')),{PNG}=dependencyRequire('pngjs'),{reader,wasmSha256}=await loadReader();
const report={scope:manifest.scope,recordedAt:new Date().toISOString(),readerVersion:reader.ZXING_WASM_VERSION,wasmSha256,repeats:manifest.repeats,optionsBase:manifest.readerOptions,cases:[]};
for(const item of manifest.cases){
 const bytes=checked(join(cacheRoot,'generated',item.local),item.sha256),png=PNG.sync.read(bytes),pixels={width:png.width,height:png.height,data:png.data};if(sha256(pixels.data)!==item.rgbaSha256)throw Error('Pixels changed');
 const recorded={id:item.id,runs:[]};
 for(const tryHarder of manifest.tryHarder)for(const minLineCount of manifest.thresholds)for(const inputType of manifest.inputTypes){
  const reads=[];for(let i=0;i<manifest.repeats;i++)reads.push((await reader.readBarcodes(inputType==='encoded-PNG'?bytes:pixels,{...manifest.readerOptions,tryHarder,minLineCount})).map(rawResult));
  const unique=[...new Set(reads.map(r=>JSON.stringify(r)))].map(r=>JSON.parse(r)),valid=reads[0].filter(r=>r.isValid),exact=valid.some(r=>r.text===item.expected&&r.format==='EAN13'),wrong=valid.some(r=>r.text!==item.expected||r.format!=='EAN13');
  const classification=item.expected===null?(valid.length?'false-positive-control':'correct-control'):wrong?(exact?'exact-and-wrong':'wrong'):exact?'exact':'miss';
  recorded.runs.push({tryHarder,minLineCount,inputType,repetitions:reads.length,stable:unique.length===1,classification,unique});
 }
 report.cases.push(recorded);
}
writeReport('generated-results.json',report);

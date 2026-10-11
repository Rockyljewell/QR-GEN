// Read frozen cached rasters only. The Chrome PNG is referenced, not duplicated.
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {manifest,packageRoot,dependencyRequire,cacheRoot,checked,sha256,loadReader,optionsBase,rawResult,writeReport} from './common.mjs';
const {reader,wasmSha256}=await loadReader(),sharp=dependencyRequire('sharp'),{PNG}=dependencyRequire('pngjs');
const chromePath=process.env.QRGEN_EAN_CHROME_PNG?resolve(process.env.QRGEN_EAN_CHROME_PNG):join(packageRoot,'../ean-browser-diagnostic-2026-10-11/fixtures/ean13-2-07-full.png');
const items=[...manifest.cases];if(existsSync(chromePath))items.push(manifest.supplement);
else console.log('Chrome supplement absent; set QRGEN_EAN_CHROME_PNG to include it. Photo corpus will still run.');
const report={scope:manifest.scope,recordedAt:new Date().toISOString(),readerVersion:reader.ZXING_WASM_VERSION,cppCommit:reader.ZXING_CPP_COMMIT,wasmSha256,optionsBase,sourceCases:manifest.cases.length,chromeSupplementIncluded:items.length>manifest.cases.length,runs:[]};
for(const item of items)for(const raster of item.rasters){
 let pixels;
 if(raster.pipeline==='original-RGBA-white-sRGB'){const bytes=checked(join(cacheRoot,item.localImage),item.sourceSha256),raw=await sharp(bytes).flatten({background:'#ffffff'}).removeAlpha().toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});pixels={width:raw.info.width,height:raw.info.height,data:raw.data};}
 else{const bytes=checked(item===manifest.supplement?chromePath:join(cacheRoot,raster.local),raster.pngSha256),png=PNG.sync.read(bytes);pixels={width:png.width,height:png.height,data:png.data};}
 if(sha256(pixels.data)!==raster.pixelsSha256)throw Error('Pixels changed');
 for(const tryHarder of [false,true])for(const minLineCount of [2,3,4]){
  let results=[],error=null;try{results=(await reader.readBarcodes(pixels,{...optionsBase,tryHarder,minLineCount})).map(rawResult);}catch(e){error=String(e);}
  const exactPresent=results.some(r=>r.text===item.truth),mismatchPresent=results.some(r=>r.text!==item.truth);
  report.runs.push({id:item.id,pipeline:raster.pipeline,tryHarder,minLineCount,status:error?'error':mismatchPresent?'companion-mismatch':exactPresent?'exact':'miss',exactPresent,mismatchPresent,error,results});
 }
}
writeReport('photo-results.json',report);

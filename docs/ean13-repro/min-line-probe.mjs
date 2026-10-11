// Single-read setting diagnostic; does not change SDK/camera defaults.
import {manifest,dependencyRequire,loadReader,fixtureBytes,rawResult,baseOptions,writeReport} from './common.mjs';
const {reader,wasmSha256}=await loadReader(),{PNG}=dependencyRequire('pngjs');
const report={scope:'Two-fixture threshold diagnostic; no default changes or general recall claim',recordedAt:new Date().toISOString(),zxingWasmVersion:reader.ZXING_WASM_VERSION,wasmSha256,runs:[]};
for(const item of manifest.fixtures){
 const bytes=fixtureBytes(item),png=PNG.sync.read(bytes),pixels={width:png.width,height:png.height,data:png.data};
 for(const minLineCount of [2,3,4])for(const maxNumberOfSymbols of [1,255]){
  const options={...baseOptions,tryHarder:true,minLineCount,maxNumberOfSymbols};
  report.runs.push({pipeline:item.pipeline,sha256:item.sha256,options,encoded:(await reader.readBarcodes(bytes,options)).map(rawResult),pixels:(await reader.readBarcodes(pixels,options)).map(rawResult)});
 }
}
writeReport('min-line-results.json',report);

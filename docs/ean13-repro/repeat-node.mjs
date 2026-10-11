// Read-only fixtures; local reader and optional SDK; reports go to temp/output env.
import {readFileSync} from 'node:fs';
import {manifest,dependencyRequire,loadReader,loadSdk,sdkPath,sha256,checksum,fixtureBytes,repeatSummary,rawResult,baseOptions,writeReport} from './common.mjs';
const {reader,wasmSha256}=await loadReader(),sdk=await loadSdk(),{PNG}=dependencyRequire('pngjs');
const report={scope:'Static two-fixture diagnostic; no public-demo wrong-payload observation',recordedAt:new Date().toISOString(),zxingWasmVersion:reader.ZXING_WASM_VERSION,zxingCppCommit:reader.ZXING_CPP_COMMIT,wasmSha256,node:process.version,sdkEngineVersion:sdk?.ENGINE_VERSION??null,sdkNodeEntrySha256:sdk?sha256(readFileSync(sdkPath)):null,runs:[]};
for(const item of manifest.fixtures){
 const bytes=fixtureBytes(item),png=PNG.sync.read(bytes),pixels={width:png.width,height:png.height,data:png.data};
 for(const tryHarder of [false,true]){
  const options={...baseOptions,tryHarder},encoded=[],rawPixels=[],sdkResults=[];
  for(let repeat=0;repeat<5;repeat++){
   encoded.push((await reader.readBarcodes(bytes,options)).map(rawResult));
   rawPixels.push((await reader.readBarcodes(pixels,options)).map(rawResult));
   if(sdk)sdkResults.push((await sdk.scanImage(bytes,{symbologies:['ean13'],tryHarder,tryInvert:false,maxResults:1})).map(b=>({data:b.data,symbology:b.symbology,location:b.location,checksumValid:checksum(b.data)})));
  }
  report.runs.push({pipeline:item.pipeline,sha256:item.sha256,width:png.width,height:png.height,truth:item.truth,options,rawEncoded:repeatSummary(encoded),rawPixels:repeatSummary(rawPixels),sdk:sdk?repeatSummary(sdkResults):null});
 }
}
writeReport('node-results.json',report);

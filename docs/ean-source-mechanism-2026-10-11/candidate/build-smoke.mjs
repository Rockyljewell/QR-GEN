import{readFileSync,writeFileSync}from'node:fs';import{resolve}from'node:path';import{pathToFileURL}from'node:url';import{createHash}from'node:crypto';
const[modulePath,wasmPath,variant,output]=process.argv.slice(2);if(!output)throw Error('module wasm variant output required');
const reader=await import(pathToFileURL(resolve(modulePath)).href),wasm=readFileSync(wasmPath),sha=b=>createHash('sha256').update(b).digest('hex');
if(reader.ZXING_WASM_VERSION!=='3.1.5'||reader.ZXING_CPP_COMMIT!=='2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4')throw Error('Unexpected rebuilt release metadata');
reader.prepareZXingModule({overrides:{wasmBinary:wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength)},fireImmediately:false});
const result=await reader.readBarcodes({width:3,height:3,data:new Uint8ClampedArray(3*3*4).fill(255)},{formats:['EAN13'],tryInvert:false});
if(result.length)throw Error('Blank rebuild smoke produced a barcode');
const evidence={scope:'Isolated rebuild and blank-image smoke only. Not corpus validation or production code.',recordedAt:new Date().toISOString(),variant,node:process.version,readerVersion:reader.ZXING_WASM_VERSION,cppCommit:reader.ZXING_CPP_COMMIT,wasmSha256:sha(wasm),matchedWrapperSha256:sha(readFileSync(modulePath)),releasedReaderWasmSha256:'aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931',blankResult:result};
evidence.matchesReleasedWasm=evidence.wasmSha256===evidence.releasedReaderWasmSha256;writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));


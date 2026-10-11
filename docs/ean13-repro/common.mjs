import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,existsSync,mkdirSync,mkdtempSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const fixtureRoot=dirname(fileURLToPath(import.meta.url));
export const manifest=JSON.parse(readFileSync(join(fixtureRoot,'fixtures.json'),'utf8'));
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const checksum=text=>/^\d{12,13}$/.test(text)&&[...text.slice(0,-1)].reverse().reduce((sum,c,i)=>sum+Number(c)*(i%2?1:3),Number(text.at(-1)))%10===0;

// A monorepo can have a newer reader nested under packages/sdk/node_modules.
// Resolve from that package, not from the monorepo's potentially older root copy.
const requested=resolve(process.env.QRGEN_REPRO_DEPENDENCY_ROOT??process.env.QRGEN_COMPARISON_REPO??process.cwd());
const sdkInRepo=join(requested,'packages/sdk');
export const dependencyRoot=existsSync(join(sdkInRepo,'package.json'))?sdkInRepo:requested;
export const dependencyRequire=createRequire(join(dependencyRoot,'package.json'));
export const sdkPath=join(dependencyRoot,'dist/node.js');
export const outputRoot=process.env.QRGEN_REPRO_OUTPUT_DIR?resolve(process.env.QRGEN_REPRO_OUTPUT_DIR):mkdtempSync(join(tmpdir(),'qrgen-ean13-repro-'));
mkdirSync(outputRoot,{recursive:true});
if(outputRoot===fixtureRoot)throw Error('Choose an output directory outside the reproduction package');

export function writeReport(name,report){
 const path=join(outputRoot,name);writeFileSync(path,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:path,version:report.zxingWasmVersion??null,runs:report.runs?.length??0,scope:report.scope}));
}
export function fixtureBytes(item){
 const bytes=readFileSync(join(fixtureRoot,item.local));
 if(sha256(bytes)!==item.sha256)throw Error('Fixture hash mismatch: '+item.local);
 return bytes;
}
export function repeatSummary(values){
 const unique=[...new Set(values.map(value=>JSON.stringify(value)))].map(value=>JSON.parse(value));
 return {repetitions:values.length,stable:unique.length===1,unique};
}
export async function loadReader(){
 const reader=dependencyRequire('zxing-wasm/reader');
 const wasm=readFileSync(dependencyRequire.resolve('zxing-wasm/reader/zxing_reader.wasm'));
 reader.prepareZXingModule({overrides:{wasmBinary:wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength)},fireImmediately:false});
 return {reader,wasmSha256:sha256(wasm)};
}
export async function loadSdk(){return existsSync(sdkPath)?await import(pathToFileURL(sdkPath)):null;}
export const rawResult=r=>({text:r.text,format:r.format,isValid:r.isValid,error:r.error,lineCount:r.lineCount,position:r.position,bytesHex:Buffer.from(r.bytes).toString('hex'),checksumValid:checksum(r.text)});
export const baseOptions={formats:['EAN13'],tryRotate:true,tryDownscale:true,tryInvert:false,maxNumberOfSymbols:1,textMode:'HRI',binarizer:'LocalAverage',minLineCount:2,returnErrors:false,eanAddOnSymbol:'Ignore'};

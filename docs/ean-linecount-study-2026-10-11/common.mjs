import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {dirname,join,resolve,relative,isAbsolute,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const packageRoot=dirname(fileURLToPath(import.meta.url));
const requested=resolve(process.env.QRGEN_REPRO_DEPENDENCY_ROOT??process.env.QRGEN_COMPARISON_REPO??process.cwd());
export const dependencyRoot=existsSync(join(requested,'packages/sdk/package.json'))?join(requested,'packages/sdk'):requested;
export const dependencyRequire=createRequire(join(dependencyRoot,'package.json'));
export const cacheRoot=resolve(process.env.QRGEN_EAN_STUDY_CACHE_DIR??join(tmpdir(),'qrgen-ean-study-5bdcab8035-315'));
export const outputRoot=resolve(process.env.QRGEN_EAN_STUDY_OUTPUT_DIR??join(cacheRoot,'results'));
function outsidePackage(path){const rel=relative(packageRoot,path);if(!rel||!(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)))throw Error('Cache/output must be outside the documentation package');}
outsidePackage(cacheRoot);outsidePackage(outputRoot);mkdirSync(cacheRoot,{recursive:true});mkdirSync(outputRoot,{recursive:true});
export const readJson=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
export const manifest=readJson(join(packageRoot,'manifest.json'));
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function checked(path,hash){const bytes=readFileSync(path);if(sha256(bytes)!==hash)throw Error('Frozen hash mismatch: '+path);return bytes;}
export function writeReport(name,report){const path=join(outputRoot,name);writeFileSync(path,JSON.stringify(report)+'\n');console.log(JSON.stringify({report:path}));}
export async function loadReader(){const reader=dependencyRequire('zxing-wasm/reader');if(reader.ZXING_WASM_VERSION!=='3.1.5')throw Error('Expected local zxing-wasm3.1.5');const wasm=readFileSync(dependencyRequire.resolve('zxing-wasm/reader/zxing_reader.wasm'));reader.prepareZXingModule({overrides:{wasmBinary:wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength)},fireImmediately:false});return {reader,wasmSha256:sha256(wasm)};}
export const optionsBase={formats:['EAN13'],tryRotate:true,tryDownscale:true,tryInvert:false,maxNumberOfSymbols:255,textMode:'HRI',binarizer:'LocalAverage',returnErrors:false,eanAddOnSymbol:'Ignore'};
export const rawResult=r=>({text:r.text,format:r.format,isValid:r.isValid,error:r.error,lineCount:r.lineCount,position:r.position});

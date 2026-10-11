// Public SDK only. Each observation retained; no repeat-until-pass or source/build edits.
import {readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {root,hash,json,save,digest,server,launch,context} from './common.mjs';
const protocol=await json(join(root,'original-protocol.json')),binding=await json(join(root,'assets-and-inputs.json'));
const runName=process.argv[2]??'late-cleanup-01';const outdir=join(root,runName);await mkdir(outdir); // fail if run already exists
const script=await readFile(join(root,'cleanup-harness.js'),'utf8');
const runnerPin={frozenBeforeDecodeAt:new Date().toISOString(),policySha256:await digest(join(root,'original-protocol.json')),bindingSha256:await digest(join(root,'assets-and-inputs.json')),scripts:{run:await digest(new URL(import.meta.url)),browser:await digest(join(root,'cleanup-harness.js')),common:await digest(join(root,'common.mjs'))},scope:'Isolated staged SDK public API validation; no product promotion, raw reader calls or historical aggregate change.'};await save(join(outdir,'runner-freeze.json'),runnerPin);
for(const variant of ['baseline','candidate'])for(const [rel,pin]of Object.entries(binding.assets[variant].files)){const actual=await digest(join(root,'..','staged-sdk-study-v1','consumers',variant,'package',rel));if(actual.sha256!==pin.sha256)throw Error('Pre-import asset mismatch '+variant+'/'+rel);}
const srv=await server(),summary={startedAt:new Date().toISOString(),runName,sourceHead:binding.sourceHead,results:[],harnessFailures:[],guards:[],browserVersions:[],allContextsClosed:true,serverClosed:false};
for(const variant of ['baseline','candidate'])for(const transport of ['URL','binary']){const opposite=variant==='baseline'?'candidate':'baseline';const expected=binding.assets[variant].files['dist/wasm/zxing_reader.wasm'].sha256;const proposed=binding.assets[opposite].files['dist/wasm/zxing_reader.wasm'].sha256;summary.guards.push({variant,transport,expected,proposed,diagnosticGuardRejected:expected!==proposed,sdkCalled:false,scope:'Harness inventory guard only; SDK does not authenticate valid same-ABI binaries.'});}
function knownAsset(path){const m=path.match(/^\/staged\/(baseline|candidate)\/(.+)$/);return m?binding.assets[m[1]].files[m[2]]:null;}
async function session(variant,id,fixture,work){
 const browser=await launch(fixture?join(root,'fixtures',fixture+'.y4m'):undefined);summary.browserVersions.push(browser.version());const {context:c,blocked}=await context(browser,srv.origin);const page=await c.newPage();const errors=[],consoleMessages=[],http=[],pending=[],workerEvents=[];const workers=new Set();
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')consoleMessages.push({type:m.type(),text:m.text()});});page.on('worker',w=>{workers.add(w);workerEvents.push({type:'created',url:w.url()});w.on('close',()=>{workers.delete(w);workerEvents.push({type:'closed',url:w.url()});});});
 c.on('response',r=>{pending.push((async()=>{try{if(r.url().startsWith(srv.origin+'/')){const b=await r.body();const path=new URL(r.url()).pathname;const record={path,status:r.status(),bytes:b.length,sha256:hash(b),offlineAtResponse:!!sessionOffline};const pin=knownAsset(path);if(pin)record.pinMatched=pin.sha256===record.sha256;http.push(record);}}catch(e){http.push({path:new URL(r.url()).pathname,bodyError:String(e)});}})());});let sessionOffline=false;
 c.on('requestfailed',r=>http.push({path:r.url().startsWith(srv.origin)?new URL(r.url()).pathname:r.url(),failed:r.failure()?.errorText,offline:sessionOffline}));
 const result={variant,id,fixture,startedAt:new Date().toISOString()};
 try{await page.addInitScript({content:script});await page.goto(srv.origin);await work(page,result,async()=>{sessionOffline=true;result.offlineTransitionAt=new Date().toISOString();await c.setOffline(true);});result.platform=await page.evaluate(()=>finishEvidence());}
 catch(e){result.harnessFailure={name:e.name,message:e.message,stack:e.stack};summary.harnessFailures.push({variant,id,...result.harnessFailure});}
 finally{await Promise.allSettled(pending);result.http=http;result.blockedExternalRequests=blocked;result.pageErrors=errors;result.console=consoleMessages;result.workerEventsBeforeContextClose=workerEvents.slice();result.sharedWorkersRetainedBeforeContextClose=workers.size;await c.close();await browser.close();await new Promise(r=>setTimeout(r,0));result.workerEvents=workerEvents;result.liveWorkersAfterContextClose=workers.size;result.browserClosed=!browser.isConnected();result.completedAt=new Date().toISOString();await save(join(outdir,variant+'-'+id+'.json'),result);summary.results.push({variant,id,record:variant+'-'+id+'.json',harnessFailure:!!result.harnessFailure,pageErrors:errors.length,consoleMessages:consoleMessages.length,liveWorkersAfterContextClose:workers.size});console.log(JSON.stringify(summary.results.at(-1)));}
}
const configureUrl=variant=>({variant,transport:'url',fixtures:[]});
try{
 for(const variant of ['baseline','candidate']){
  for(const row of protocol.transportMatrix.rows.filter(x=>['T04-cold-reader-url-offline','T05-corrupt-reader-url'].includes(x.id))){await session(variant,row.id,'retailMixedY4M',async(p,r,offline)=>{
   const binary=row.id==='T02-online-binary-subviews'||row.id==='T03-preloaded-binary-offline',negative=row.id==='T04-cold-reader-url-offline'||row.id==='T05-corrupt-reader-url';
   r.bootstrap=await p.evaluate(x=>globalThis.bootstrap(x),{variant,transport:binary?'binary':row.id==='T01-relative-selfhost'?'relative':row.id==='T05-corrupt-reader-url'?'corrupt':'url',fixtures:['cleanEAN','retailMixedY4M-preflight'],preloadBinary:binary});
   if(row.id==='T03-preloaded-binary-offline'||row.id==='T04-cold-reader-url-offline')await offline();
   if(row.id!=='T04-cold-reader-url-offline')r.writer=await p.evaluate(()=>globalThis.writerCase());
   if(row.id!=='T03-preloaded-binary-offline')r.image=await p.evaluate(async({relative})=>{try{return {outputs:plain(await sdk.scanImage(relative?'/fixtures/cleanEAN.png':inputs.cleanEAN.blob,{symbologies:['ean13'],tryHarder:true,tryInvert:true,maxResults:1}))};}catch(e){return {error:err(e)};}},{relative:row.id==='T01-relative-selfhost'});
   r.camera=await p.evaluate(x=>globalThis.cameraCase(x),{id:row.id,options:{...protocol.cameraMatrix.options,symbologies:['qr','ean13'],worker:true},expectedPixels:'retailMixedY4M-preflight',expectedEngine:'worker',pauseControl:false,expectedFailure:negative});
  });}
 }
}finally{await srv.close();summary.serverClosed=true;summary.completedAt=new Date().toISOString();summary.actualServerResponses=srv.requests;await save(join(outdir,'summary.json'),summary);}
console.log(JSON.stringify({completedAt:summary.completedAt,sessions:summary.results.length,harnessFailures:summary.harnessFailures,serverClosed:summary.serverClosed}));

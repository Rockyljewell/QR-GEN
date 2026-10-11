// Offline assertions only; never imports an SDK or runs a decoder.
import {readFile,readdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=process.argv[2]??dirname(fileURLToPath(import.meta.url));
const json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
const binding=await json(join(root,'assets-and-inputs.json'));
let checks=0;const failures=[];
function check(ok,label){checks++;if(!ok)failures.push(label);}
const pairs=xs=>xs.map(x=>x.symbology+':'+x.data).sort();
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const clean=['ean13:5901234123457','qr:QRGEN-RETAIL-DOM-20261011'].sort();
const expectedImages={
 baseline:[['ean13:0798884816632'],['ean13:0798884816632'],['ean13:0798884816632'],['upca:798884816632'],['ean13:5030159003930','ean13:7034759003930'],['ean13:5030159003930','ean13:7034759003930'],['ean13:5901234123457'],['qr:QRGEN-RAW-READER-CONTROL-20261011'],['upca:012345678905'],[],['ean13:0798884816632','qr:QRGEN-RAW-READER-CONTROL-20261011'],['ean13:5901234123457','qr:QRGEN-RAW-READER-CONTROL-20261011']],
 candidate:[[],[],[],['upca:798884816632'],['ean13:5030159003930','ean13:7034759003930'],['ean13:5030159003930','ean13:7034759003930'],['ean13:5901234123457'],['qr:QRGEN-RAW-READER-CONTROL-20261011'],['upca:012345678905'],[],['qr:QRGEN-RAW-READER-CONTROL-20261011'],['ean13:5901234123457','qr:QRGEN-RAW-READER-CONTROL-20261011']]
};
const original=await json(join(root,'run-01/summary.json'));
check(original.results.length===28,'original28sessions');check(original.serverClosed,'originalserverclosed');check(original.harnessFailures.length===0,'originalnoharnessfailure');
const writerHashes=[];const rows=[];
for(const folder of ['run-01','late-cleanup-01']){
 const summary=await json(join(root,folder,'summary.json'));check(summary.serverClosed,folder+'serverclosed');check(summary.harnessFailures.length===0,folder+'noharnessfailures');
 for(const meta of summary.results){
  const d=await json(join(root,folder,meta.record)),label=folder+'/'+meta.record,v=d.variant,negative=d.id.startsWith('T04')||d.id.startsWith('T05');
  check(!d.harnessFailure,label+'noharnessfailure');check(d.pageErrors.length===0,label+'nopageerrors');check(d.blockedExternalRequests.length===0,label+'noexternalrequests');check(d.liveWorkersAfterContextClose===0&&d.browserClosed,label+'contextbrowserworkerclosed');
  if(!negative)check(d.console.length===0,label+'nopositiveconsoleerrors');
  for(const r of d.http)if(r.pinMatched!==undefined)check(r.pinMatched,label+'loadedassetpin:'+r.path);
  for(const blob of d.platform.workerBlobs)check(blob.sha256===binding.assets[v].embeddedWorker.sha256,label+'workerblobpin');
  for(const [id,x]of Object.entries(d.platform.binaryBefore)){const after=d.platform.binaryAfter[id];check(after.sha256===x.sha256&&after.paddedAfterSha256===x.paddedBeforeSha256,label+'callerbinaryunchanged:'+id);check(x.sha256===binding.assets[v].files['dist/wasm/zxing_'+id+'.wasm'].sha256,label+'preloadedbinarypin:'+id);}
  if(d.id==='T03-preloaded-binary-offline')check(!d.http.some(x=>x.failed)&&['reader','writer'].every(id=>d.http.filter(x=>x.path.endsWith('/zxing_'+id+'.wasm')).length===1),label+'preloadedbinaryworksOfflineNoAdditionalEngineRequests');
  if(d.cases){check(d.cases.length===12,label+'12imagecalls');for(let i=0;i<12;i++){check(!d.cases[i].error,label+'image-noerror:'+i);check(equal(pairs(d.cases[i].outputs),expectedImages[v][i]),label+'frozenobservedimagecontract:'+i);}}
  if(d.writer){for(const w of d.writer){check(!w.error&&!!w.png,label+'publicwritergenerated:'+w.id);writerHashes.push({variant:v,id:w.id,svg:w.svgSha256,png:w.png.sha256,matrix:w.matrix.sha256});if(!negative&&w.id==='qr')check(equal(pairs(w.roundTrip),['qr:QRGEN-STAGED-SDK-20261011']),label+'writerQRroundtrip');}}
  if(d.image){if(negative)check(d.image.error?.code==='engine-load-failed',label+'negativeimageerror');else check(equal(pairs(d.image.outputs),['ean13:5901234123457']),label+'transportimageexact');}
  const c=d.camera;
  if(c){check(c.cleanup.liveCameraTracks===0&&c.cleanup.videoSrcObjectNull&&c.cleanup.ownedVideoDetached,label+'immediatecameracleanup');
   if(negative){check(c.startError?.code==='engine-load-failed'&&c.frames.length===0&&c.scans.length===0&&c.ready===null,label+'expectedloadfailure');check(d.platform.workers.length===1,label+'onefailedworkerinit');}
   else{
    check(c.frames.length===10&&!c.observationTimeout&&!c.setupFailure&&!c.startError,label+'10framesready');check(c.ready.engine===c.expectedEngine&&c.statsBeforeCleanup.engine===c.expectedEngine,label+'actualengine');check(c.ready.exactPixelBytesMatch&&c.ready.rgbaSha256===binding.camera[d.fixture].rgbaSha256,label+'capturedreadyraster');check(c.errors.length===0,label+'noscannererrors');
    let expected=clean;if(d.id.startsWith('C01'))expected=v==='baseline'?['ean13:0798884816632']:[];if(d.id.startsWith('C02'))expected=['upca:798884816632'];if(d.id.startsWith('C03'))expected=['ean13:5030159003930','ean13:7034759003930'];
    for(const f of c.frames)check(equal(pairs(f.barcodes),expected),label+'perframeobservedcontract');
    if(c.pause)check(c.pause.before===5&&c.pause.after===5&&c.pause.stable&&c.pause.pausedState==='paused',label+'pause/resumecontrol');
    check(d.platform.workers.length===(c.expectedEngine==='worker'?1:0),label+'boundedworkerpool');
    for(const w of d.platform.workers){const decode=w.posts.filter(x=>x.type==='decode');check(decode.length===10,label+'10realworkerposts');check(w.messages.filter(x=>x.type==='result').length===10,label+'10realworkerresults');for(const post of decode)check(post.sha256===binding.camera[d.fixture].rgbaSha256,label+'workerpostedpixelpin');for(const init of w.posts.filter(x=>x.type==='init'))if(init.sha256)check(init.sha256===binding.assets[v].files['dist/wasm/zxing_reader.wasm'].sha256,label+'workerinitbinarypin');}
   }
   if(c.lateCleanup){const x=c.lateCleanup;check(x.allNativeGetUserMediaSettled&&x.promiseCalls.length===1&&x.promiseCalls.every(p=>p.settled)&&x.tracks.length===1&&x.tracks.every(t=>t.readyState==='ended')&&x.liveCameraTracks===0&&x.videos.every(v=>!v.connected&&v.srcObjectNull&&v.attachedLiveStreams===0),label+'latepermissioncameraquiescent');}
  }
  rows.push({folder,variant:v,id:d.id,pageErrors:d.pageErrors.length,consoleMessages:d.console.length,frames:c?.frames.length??null,engine:c?.ready?.engine??null,liveWorkersAfterContextClose:d.liveWorkersAfterContextClose});
 }
}
for(const id of ['qr','ean13']){const h=writerHashes.filter(x=>x.id===id);check(h.every(x=>x.svg===h[0].svg&&x.png===h[0].png&&x.matrix===h[0].matrix),'identicalofficialwriter:'+id);}
for(const x of original.guards)check(x.diagnosticGuardRejected&&x.sdkCalled===false,'harnessguardonly:'+x.variant+x.transport);
const iifeSummary=await json(join(root,'iife-01/summary.json'));check(iifeSummary.sessions.length===2&&iifeSummary.serverClosed,'iife2sessionsclosed');
for(const meta of iifeSummary.sessions){const d=await json(join(root,'iife-01',meta.record)),o=d.observations,label='iife/'+meta.record;check(!d.harnessFailure&&d.pageErrors.length===0&&d.console.length===0&&d.blockedExternalRequests.length===0,label+'noerrors');check(d.browserClosed&&o.platform.liveCameraTracks===0&&o.platform.workers.length===0,label+'cleanup');check(o.globalName==='window.QRGen',label+'classicglobal');for(const r of d.http)if(r.pinMatched!==undefined)check(r.pinMatched,label+'actualassetpin');for(const px of o.inputPixels)check(px.rgbaSha256===binding.fixtures[px.id].rgbaSha256,label+'inputpixelpin');check(equal(pairs(o.images[0].outputs),['qr:QRGEN-RAW-READER-CONTROL-20261011']),label+'QRexact');check(equal(pairs(o.images[1].outputs),['ean13:5901234123457']),label+'EANexact');check(equal(pairs(o.images[2].outputs),d.variant==='baseline'?['ean13:0798884816632']:[]),label+'07observedcontract');for(const w of o.writer){const reference=writerHashes.find(x=>x.id===w.id);check(!w.error&&w.svgSha256===reference.svg&&w.png.sha256===reference.png&&w.matrix.sha256===reference.matrix,label+'writerunchanged');}}
console.log(JSON.stringify({checks,failures,originalSessions:28,cleanupOnlySessions:4,iifeEntrypointSessions:2,notes:'Assertions describe frozen observed outputs, including known nontruths/misses. They are integration/provenance checks, not accuracy passes. Supplements remain separate.',rows},null,2));
if(failures.length)process.exitCode=1;

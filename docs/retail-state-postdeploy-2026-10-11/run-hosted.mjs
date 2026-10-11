import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const repo=resolve(process.env.QRGEN_COMPARISON_REPO??process.cwd());
const output=resolve(process.env.QRGEN_HOSTED_OUTPUT??join(root,'hosted-results.json'));
assert.ok(!existsSync(output),'Use a fresh QRGEN_HOSTED_OUTPUT; recorded results are immutable');
const proof=JSON.parse(readFileSync(process.env.QRGEN_DEPLOY_PROOF??join(root,'proof.json'),'utf8'));
const require=createRequire(join(repo,'site/package.json'));
const {chromium}=require('playwright');
const {writeFakeCamera}=await import(pathToFileURL(join(repo,'site/scripts/fake-camera.mjs')));
const revision=proof.revision;
assert.equal(revision,'6d3728f569f1cd5031fa8ca40ec090c8ff6bdf5b');assert.equal(proof.deploymentRun,38152103868);assert.equal(proof.deploymentConclusion,'success');
const base='https://rockyljewell.github.io/QR-GEN/';
const sdkUrl=new URL('sdk/qrgen.js',base).href;
const payload='QRGEN-RETAIL-DOM-20261011';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceFiles=['packages/sdk/src/scanner.ts','packages/sdk/src/tracker.ts','packages/sdk/src/elements/scanner-element.ts','site/scripts/fake-camera.mjs'];
const sourceHashes=()=>Object.fromEntries(sourceFiles.map(p=>[p,hash(readFileSync(join(repo,p)))]));
const fixture=join(root,'retail-qr-ean.y4m');
const codes=[{data:payload,symbology:'qr',x:70,y:100,module:5},{data:'5901234123457',symbology:'ean13',x:170,y:350,module:3}];
await writeFakeCamera(fixture,codes);
const evidence={schemaVersion:1,startedAt:new Date().toISOString(),status:'running',baseUrl:base,revision,sourceHashesAtStart:sourceHashes(),deploymentArtifact:{run:proof.deploymentRun,id:proof.artifactId,tarSha256:proof.artifactTarSha256,githubReportedZipDigest:proof.artifactZipDigestAsReportedByGitHub},fixture:{file:'retail-qr-ean.y4m',sha256:hash(readFileSync(fixture)),width:640,height:480,frames:30,codes},standaloneSdkProbe:[],cases:[],limitations:['Desktop Chromium synthetic static camera feed; no physical-device, latency or Scandit parity claim.','Fake front/back devices provide the same fixture pixels.','Behavior uses the compiled deployed demo element; standalone SDK is imported separately only for asset verification.','#39 real camera failure retry/stop was verified in the separate local integration run and is not repeated here.']};
let browser;
const save=()=>writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');
async function mainHead(){const response=await fetch('https://api.github.com/repos/Rockyljewell/QR-GEN/commits/main',{headers:{'User-Agent':'QRGen-retail-state-deployment'},signal:AbortSignal.timeout(15000)});assert.ok(response.ok,`GitHub main HTTP ${response.status}`);return(await response.json()).sha;}
async function withPage(name,fn){if(process.env.QRGEN_HOSTED_CASE&&name!==process.env.QRGEN_HOSTED_CASE)return;
 const item={name,startedAt:new Date().toISOString(),status:'running',pageErrors:[],consoleErrors:[],loadedAssets:[]};evidence.cases.push(item);const page=await browser.newPage({viewport:{width:1360,height:960}});const pending=[];
 page.on('pageerror',e=>item.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')item.consoleErrors.push(m.text());});
 page.on('response',response=>{const url=new URL(response.url());if(url.origin===new URL(base).origin&&/\.(js|wasm)$/.test(url.pathname))pending.push((async()=>{const bytes=await response.body();item.loadedAssets.push({path:url.pathname,status:response.status(),sha256:hash(bytes),bytes:bytes.length,matchesDeploymentArtifact:hash(bytes)===proof.assets[url.pathname]?.sha256});})());});
 await page.addInitScript(()=>{window.__mediaTracks=[];const native=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async(...args)=>{const stream=await native(...args);window.__mediaTracks.push(...stream.getTracks());return stream;};});
 try{
  const navigation=await page.goto(new URL(`demo/?retail-state=${revision.slice(0,7)}-${Date.now()}`,base).href,{waitUntil:'networkidle',timeout:30000});assert.ok(navigation.ok(),`demo HTTP ${navigation.status()}`);await page.waitForFunction(()=>customElements.get('qrgen-scanner'),null,{timeout:15000});
  const sdkImport=await page.evaluate(async url=>{const before=customElements.get('qrgen-scanner');await import(url);return{sameElementConstructor:before===customElements.get('qrgen-scanner')};},sdkUrl+`?retail-state=${revision.slice(0,7)}`);assert.ok(sdkImport.sameElementConstructor,'Standalone SDK replaced demo element');item.demoConstructorPreserved=true;
  await page.evaluate(()=>{window.subject=document.querySelector('#demo-scanner');window.__hostSelection=[];window.__selectEvents=[];window.__exactScans=[];subject.addEventListener('select',e=>{window.__hostSelection=e.detail.selection.map(b=>({id:b.id,data:b.data}));window.__selectEvents.push({custom:e instanceof CustomEvent,bubbles:e.bubbles,composed:e.composed,detail:{barcode:e.detail.barcode?.data??null,selected:e.detail.selected,selection:window.__hostSelection}});});subject.addEventListener('scan',e=>window.__exactScans.push(...e.detail.barcodes.map(b=>b.data)));});
  item.observations=await fn(page);
  assert.deepEqual(item.pageErrors,[]);assert.deepEqual(item.consoleErrors,[]);item.status='passed';
 }catch(e){item.status='failed';item.error=e.stack??e.message;item.failureSnapshot=await page.evaluate(()=>({state:window.subject?.state,stats:window.subject?.scanner?.stats,error:window.subject?.shadowRoot.querySelector('.msg')?.textContent,tracked:window.subject?.tracked.map(b=>({id:b.id,data:b.data,symbology:b.symbology})),selection:window.subject?.selection,rows:[...window.subject?.shadowRoot.querySelectorAll('.result')??[]].map(b=>({id:b.dataset.id,text:b.textContent,pressed:b.getAttribute('aria-pressed')})),hostSelection:window.__hostSelection,events:window.__selectEvents,steps:window.__steps})).catch(()=>null);}
 finally{
  try{item.cleanup=await page.evaluate(()=>{for(const el of document.querySelectorAll('qrgen-scanner'))el.stop();return{liveMediaTracks:window.__mediaTracks.filter(t=>t.readyState==='live').length,attachedElementVideoStreams:[...document.querySelectorAll('qrgen-scanner')].filter(el=>el.scanner?.video.srcObject).length};});assert.equal(item.cleanup.liveMediaTracks,0);assert.equal(item.cleanup.attachedElementVideoStreams,0);}catch(e){item.status='failed';item.cleanupError=e.message;}
  const responses=await Promise.allSettled(pending);for(const response of responses)if(response.status==='rejected'){item.status='failed';item.responseReadError=String(response.reason);}
  try{assert.ok(item.loadedAssets.some(a=>a.path.includes('/_astro/')&&a.path.endsWith('.js')),'No compiled deployed module captured');assert.ok(item.loadedAssets.some(a=>a.path==='/QR-GEN/sdk/qrgen.js'),'No standalone SDK response captured');assert.ok(item.loadedAssets.some(a=>a.path==='/QR-GEN/sdk/wasm/zxing_reader.wasm'),'No worker reader WASM response captured');for(const asset of item.loadedAssets){assert.equal(asset.status,200);assert.ok(asset.matchesDeploymentArtifact,`Not deployment artifact: ${asset.path}`);}}catch(e){item.status='failed';item.assetVerificationError=e.message;}
  item.finishedAt=new Date().toISOString();await page.close();save();console.log(`${name}: ${item.status}`);
 }
}
async function configureAndStart(page,syms='qr,ean13'){
 await page.click('[data-mode="batch"]');await page.evaluate(syms=>{subject.symbologies=syms;subject.beep=false;subject.vibrate=false;subject.resolution='sd';subject.scanArea={x:0,y:0,width:1,height:1};},syms);
 await page.locator('#demo-scanner').locator('[data-a="start"]').click();await page.waitForFunction(()=>subject.state==='scanning'&&subject.scanner.stats.engine==='worker',null,{timeout:15000});
}
const waitTracks=(page,n=1)=>page.waitForFunction(n=>subject.tracked.length===n,n,{timeout:15000});
async function selectFirst(page){await page.locator('#demo-scanner').locator('.result').first().focus();await page.keyboard.press('Enter');}
const snapshot=page=>page.evaluate(()=>({state:subject.state,engine:subject.scanner?.stats.engine,tracked:subject.tracked.map(b=>({id:b.id,symbology:b.symbology,data:b.data,firstSeen:b.firstSeen,lastSeen:b.lastSeen,count:b.count})),snapshotAt:Date.now(),trackerTimeout:subject.scanner?.tracker.timeout,selection:subject.selection.map(b=>({id:b.id,data:b.data})),hostSelection:window.__hostSelection,count:subject.shadowRoot.querySelector('.count').textContent,countHidden:subject.shadowRoot.querySelector('.count').hidden,rows:[...subject.shadowRoot.querySelectorAll('.result')].map(b=>({id:Number(b.dataset.id),pressed:b.getAttribute('aria-pressed'),text:b.textContent})),selectEvents:window.__selectEvents,exactScans:window.__exactScans}));
try{
 evidence.mainAtStart=await mainHead();assert.equal(evidence.mainAtStart,revision,'Main advanced before hosted smoke');
 let verified=false;for(let i=0;i<3;i++){const url=sdkUrl+`?retail-state-probe=${revision.slice(0,7)}-${Date.now()}`;const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});const bytes=Buffer.from(await response.arrayBuffer());evidence.standaloneSdkProbe.push({at:new Date().toISOString(),status:response.status,sha256:hash(bytes),bytes:bytes.length});if(response.ok&&hash(bytes)===proof.assets['/QR-GEN/sdk/qrgen.js'].sha256){verified=true;break;}if(i<2)await new Promise(r=>setTimeout(r,15000));}assert.ok(verified,'Hosted SDK did not match successful Pages artifact');
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-video-capture=${fixture}`]});evidence.chromiumVersion=browser.version();
 await withPage('37-hosted-worker-QR-EAN-paused-pruning-and-deselection',async page=>{
  await configureAndStart(page);await waitTracks(page,2);const initial=await snapshot(page);await page.evaluate(initial=>window.__steps={initial},initial);assert.ok(initial.exactScans.includes(payload));assert.ok(initial.exactScans.includes('5901234123457'));assert.equal(initial.engine,'worker');
  await page.locator('#demo-scanner').locator('[data-a="pause"]').click();const qrId=initial.tracked.find(b=>b.symbology==='qr').id;const eanId=initial.tracked.find(b=>b.symbology==='ean13').id;
  await page.locator('#demo-scanner').locator(`.result[data-id="${qrId}"]`).focus();await page.keyboard.press('Enter');await page.evaluate(()=>subject.symbologies='ean13');
  const narrowed=await snapshot(page);await page.evaluate(narrowed=>window.__steps.narrowed=narrowed,narrowed);assert.equal(narrowed.state,'paused');assert.equal(narrowed.tracked.length,1);assert.equal(narrowed.tracked[0].id,eanId);assert.equal(narrowed.count,'1 barcode in view');assert.equal(narrowed.rows.length,2);assert.equal(narrowed.selection[0].id,qrId);assert.match(narrowed.rows.find(r=>r.id===qrId).text,/out of view/);
  await page.locator('#demo-scanner').locator(`.result[data-id="${qrId}"]`).focus();await page.keyboard.press('Enter');const deselected=await snapshot(page);assert.equal(deselected.selection.length,0);assert.equal(deselected.hostSelection.length,0);assert.equal(deselected.rows.length,1);
  await page.locator('#demo-scanner').locator('[data-a="pause"]').click();await page.waitForFunction(lastSeen=>subject.tracked[0]?.lastSeen>lastSeen,narrowed.tracked[0].lastSeen,{timeout:10000});const resumed=await snapshot(page);assert.equal(resumed.tracked.length,1);assert.equal(resumed.tracked[0].symbology,'ean13');assert.equal(resumed.tracked[0].data,'5901234123457');if(resumed.tracked[0].id!==eanId){assert.ok(resumed.tracked[0].firstSeen-narrowed.tracked[0].lastSeen>resumed.trackerTimeout,'Fresh ID before natural wall-clock expiry');resumed.identityOutcome='fresh ID after documented wall-clock expiry';}else resumed.identityOutcome='surviving ID refreshed before expiry';return{initial,narrowed,deselected,resumed};
 });
 await withPage('38-hosted-CustomEvent-mode-reset-pause-and-cosmetic-callback',async page=>{
  await configureAndStart(page,'qr');await waitTracks(page);const cases=[];
  for(const initialState of ['scanning','paused']){if(initialState==='paused')await page.evaluate(()=>subject.pause());await selectFirst(page);await page.evaluate(()=>{window.__resetHandler=e=>{if(e.detail.barcode===null)subject.pause();};subject.addEventListener('select',window.__resetHandler);subject.mode='continuous';});const reset=await snapshot(page);assert.equal(reset.state,'paused');assert.equal(reset.selection.length,0);assert.equal(reset.hostSelection.length,0);assert.ok(reset.selectEvents.at(-1).custom&&reset.selectEvents.at(-1).bubbles&&reset.selectEvents.at(-1).composed);cases.push({initialState,reset});await page.evaluate(()=>{subject.removeEventListener('select',window.__resetHandler);subject.mode='batch';});await waitTracks(page);}
  await page.evaluate(()=>subject.pause());await selectFirst(page);await page.evaluate(()=>{subject.addEventListener('select',e=>{if(e.detail.barcode===null)subject.hint='Continue with updated hint';});subject.mode='continuous';});const cosmetic=await snapshot(page);assert.equal(cosmetic.state,'scanning');assert.equal(cosmetic.hostSelection.length,0);return{cases,cosmetic};
 });
 await withPage('38-hosted-source-reset-hint-accent-latest-camera-new-worker-QR',async page=>{
  await configureAndStart(page,'qr');await waitTracks(page);await selectFirst(page);await page.evaluate(()=>{window.__oldScanner=subject.scanner;window.__oldTrack=subject.scanner.camera.track;window.__resetCount=0;subject.addEventListener('select',e=>{if(e.detail.barcode!==null)return;window.__resetCount++;subject.hint='Next camera ready';subject.accent='#005aee';subject.camera='back';});subject.camera='front';});
  await page.waitForFunction(()=>subject.scanner!==window.__oldScanner&&subject.state==='scanning'&&subject.tracked.some(b=>b.data==='QRGEN-RETAIL-DOM-20261011'),null,{timeout:15000});const result=await snapshot(page);const ownership=await page.evaluate(()=>({differentScanner:subject.scanner!==window.__oldScanner,oldTrackState:window.__oldTrack.readyState,oldStream:window.__oldScanner.camera.stream,resetCount:window.__resetCount,camera:subject.options.camera,hint:subject.hint,accent:subject.accent}));assert.ok(ownership.differentScanner);assert.equal(ownership.oldTrackState,'ended');assert.equal(ownership.oldStream,null);assert.equal(ownership.resetCount,1);assert.equal(ownership.camera,'back');assert.equal(result.hostSelection.length,0);assert.equal(result.selection.length,0);assert.equal(result.tracked[0].data,payload);assert.equal(result.engine,'worker');return{result,ownership};
 });
 evidence.mainAtFinish=await mainHead();assert.equal(evidence.mainAtFinish,revision,'Main advanced during hosted smoke');evidence.sourceHashesAtFinish=sourceHashes();assert.deepEqual(evidence.sourceHashesAtFinish,evidence.sourceHashesAtStart);evidence.status=evidence.cases.length===(process.env.QRGEN_HOSTED_CASE?1:3)&&evidence.cases.every(c=>c.status==='passed')?'passed':'failed';
}catch(e){evidence.status='failed';evidence.error=e.stack??e.message;process.exitCode=1;}
finally{if(browser){await browser.close();evidence.browserClosed=true;}evidence.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:evidence.status,mainAtStart:evidence.mainAtStart,mainAtFinish:evidence.mainAtFinish,artifact:evidence.deploymentArtifact,cases:evidence.cases.map(c=>({name:c.name,status:c.status,error:c.error,assetVerificationError:c.assetVerificationError})),error:evidence.error}));}
if(evidence.status!=='passed')process.exitCode=1;





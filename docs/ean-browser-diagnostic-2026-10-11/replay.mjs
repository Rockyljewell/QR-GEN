import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync,mkdtempSync} from 'node:fs';
import {join,dirname,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {writeImageCamera} from './image-camera.mjs';
const artifact=dirname(fileURLToPath(import.meta.url));
const repo=process.env.QRGEN_COMPARISON_REPO??process.cwd();
const out=process.env.QRGEN_DIAGNOSTIC_OUT??mkdtempSync(join(tmpdir(),'qrgen-ean-camera-'));if(out===artifact)throw Error('Choose an output directory outside this review package');mkdirSync(out,{recursive:true});
const req=createRequire(join(repo,'package.json'));
const {chromium}=req('playwright');const sharp=req('sharp');
const hash=b=>createHash('sha256').update(b).digest('hex');
const prepared=JSON.parse(readFileSync(join(artifact,'fixture-manifest.json')));
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true}).trim();
const assetMap={};function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())walk(p);else if(/\.(js|wasm)$/.test(p))assetMap['/QR-GEN/'+relative(join(repo,'site/dist'),p).replaceAll('\\','/')]=hash(readFileSync(p));}}
walk(join(repo,'site/dist'));
const report={startedAt:new Date().toISOString(),purpose:'Separate diagnostic of three historical EAN no-exact observations; no Scandit, parity or latency benchmark',source:{head:git('rev-parse','HEAD'),dirty:git('--no-optional-locks','status','--short'),sdkPackageSha256:hash(readFileSync(join(repo,'packages/sdk/package.json'))),lockSha256:hash(readFileSync(join(repo,'package-lock.json'))),builtAssets:assetMap},settings:{viewport:{width:1360,height:960},workerPhaseMs:2500,formats:['ean13'],maxResults:1,tryInvertCamera:'alternate'},results:[],status:'running'};
const save=()=>writeFileSync(join(out,'evidence.json'),JSON.stringify(report,null,2)+'\n');save();
const port=Number(process.env.QRGEN_DIAGNOSTIC_PORT??4348),base='http://127.0.0.1:'+port+'/QR-GEN/demo/';
let log='';const server=spawn(process.execPath,[join(dirname(req.resolve('astro/package.json')),'bin/astro.mjs'),'preview','--host','127.0.0.1','--port',String(port),'--ignore-lock'],{cwd:join(repo,'site'),windowsHide:true,stdio:['ignore','pipe','pipe']});
for(const s of [server.stdout,server.stderr])s.on('data',b=>log=(log+b).slice(-3000));
try{
  for(let i=0;;i++){try{if((await fetch(base)).ok)break;}catch{}if(i>=60)throw Error('Server: '+log);await new Promise(r=>setTimeout(r,500));}
  for(const id of ['ean13-2-01','ean13-2-07','ean13-2-21']){
    const item=prepared.cases.find(c=>c.id===id),image=join(out,id+'-source.png'),y4m=join(out,id+'.y4m');
    if(!existsSync(image)){const response=await fetch(item.image.url);if(!response.ok)throw Error('Fixture download '+response.status);writeFileSync(image,Buffer.from(await response.arrayBuffer()));}
    if(hash(readFileSync(image))!==item.image.sha256)throw Error('Source image hash mismatch');
    const fixture=await writeImageCamera(y4m,image);const frozen=prepared.cases.find(c=>c.id===id).fixture;
    if(fixture.y4mSha256!==frozen.y4mSha256)throw Error('Frozen fixture mismatch '+id);
    const row={id,expected:id.endsWith('21')?'9784872348880':'9780804816632',startedAt:new Date().toISOString(),fixture,loadedAssets:[],pageErrors:[],consoleErrors:[]};report.results.push(row);save();
    const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??chromium.executablePath(),args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-video-capture='+y4m]});
    const context=await browser.newContext({viewport:report.settings.viewport});const page=await context.newPage();const pending=[];
    page.on('pageerror',e=>row.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')row.consoleErrors.push(m.text());});
    page.on('response',r=>{if(r.url().startsWith('http://127.0.0.1:'+port)&&/\.(js|wasm)(\?|$)/.test(r.url()))pending.push((async()=>{try{const sha256=hash(await r.body()),path=new URL(r.url()).pathname;row.loadedAssets.push({path,sha256,matchesBuild:assetMap[path]===sha256});}catch(e){row.loadedAssets.push({url:r.url(),error:String(e)});}})());});
    try{
      await page.route('**/__diagnostic_source.png',route=>route.fulfill({contentType:'image/png',body:readFileSync(image)}));
      await page.goto(base,{waitUntil:'load',timeout:30000});
      await page.getByText('Scanner settings',{exact:true}).click();const inputs=page.locator('[data-sym-grid] input');
      for(let i=0;i<await inputs.count();i++)await inputs.nth(i).setChecked(await inputs.nth(i).inputValue()==='ean13');
      await page.getByText('Scanner settings',{exact:true}).click();await page.locator('#demo-scanner').locator('button[data-a="start"]').click();
      await page.waitForFunction(()=>{const e=document.querySelector('#demo-scanner'),v=e?.shadowRoot?.querySelector('video');return e?.scanner?.state==='scanning'&&e.scanner.stats.engine==='worker'&&v?.videoWidth===640&&v?.readyState>=2;},{},{timeout:30000});
      await page.waitForTimeout(250);
      const captures=await page.evaluate(async()=>{
        const e=document.querySelector('#demo-scanner'),s=e.scanner,v=e.shadowRoot.querySelector('video');s.pause();
        const opts=structuredClone(s.options),a=opts.scanArea,W=v.videoWidth,H=v.videoHeight;
        const sx=Math.max(0,Math.round(a.x*W)),sy=Math.max(0,Math.round(a.y*H)),sw=Math.min(W-sx,Math.round(a.width*W)),sh=Math.min(H-sy,Math.round(a.height*H));
        const full=document.createElement('canvas');full.width=W;full.height=H;full.getContext('2d',{willReadFrequently:true}).drawImage(v,0,0);
        const roi=document.createElement('canvas');roi.width=sw;roi.height=sh;roi.getContext('2d',{willReadFrequently:true}).drawImage(v,sx,sy,sw,sh,0,0,sw,sh);
        const f=full.getContext('2d').getImageData(0,0,W,H),r=roi.getContext('2d').getImageData(0,0,sw,sh);
        window.__eanDiagnostic={full:f,roi:r,originalROI:a};
        const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('');
        return {options:opts,engine:s.stats.engine,frame:{width:W,height:H},preview:e.shadowRoot.querySelector('.preview').getBoundingClientRect().toJSON(),crop:{sx,sy,sw,sh},full:{png:full.toDataURL('image/png'),rgbaSha256:await digest(f.data)},roi:{png:roi.toDataURL('image/png'),rgbaSha256:await digest(r.data)}};
      });
      row.camera={options:captures.options,engine:captures.engine,frame:captures.frame,preview:captures.preview,crop:captures.crop};
      for(const kind of ['full','roi']){const bytes=Buffer.from(captures[kind].png.split(',')[1],'base64'),path=join(out,id+'-'+kind+'.png');writeFileSync(path,bytes);row.camera[kind]={pngFile:id+'-'+kind+'.png',pngSha256:hash(bytes),rgbaSha256:captures[kind].rgbaSha256};}
      const rgba=await sharp(join(out,id+'-full.png')).ensureAlpha().raw().toBuffer();if(hash(rgba)!==captures.full.rgbaSha256)throw Error('Browser/PNG pixel mismatch');
      const raw=readFileSync(y4m),offset=raw.indexOf(10)+1+6;let rawErr=0,expandedErr=0,rgErr=0,min=255,max=0;
      for(let i=0;i<640*480;i++){const Y=raw[offset+i],R=rgba[4*i];rawErr+=Math.abs(R-Y);expandedErr+=Math.abs(R-Math.max(0,Math.min(255,Math.round((Y-16)*255/219))));rgErr+=Math.abs(R-rgba[4*i+1]);min=Math.min(min,R);max=Math.max(max,R);}
      row.camera.pixelRange={paddingPixel:Array.from(rgba.subarray(0,4)),minR:min,maxR:max,maeVsStoredY:rawErr/(640*480),maeVsLimitedYExpansion:expandedErr/(640*480),maeRvsG:rgErr/(640*480)};
      row.static=await page.evaluate(async()=>{
        const sdk=await import('/QR-GEN/sdk/qrgen.js');sdk.configure({wasmBaseUrl:'/QR-GEN/sdk/wasm/'});
        const orig=await (await fetch('/__diagnostic_source.png')).blob();const rows=[];
        for(const [raster,input] of [['original-photo',orig],['browser-camera-full',window.__eanDiagnostic.full],['browser-camera-roi',window.__eanDiagnostic.roi]])for(const tryHarder of [false,true])for(const tryInvert of [false,true]){
          const b=await sdk.scanImage(input,{symbologies:['ean13'],maxResults:1,tryHarder,tryInvert});rows.push({raster,tryHarder,tryInvert,barcodes:b.map(x=>({data:x.data,symbology:x.symbology,location:x.location}))});
        }return {engineVersion:sdk.ENGINE_VERSION,rows};
      });
      row.worker=[];
      for(const region of ['aiming-roi','full-frame'])for(const tryHarder of [false,true]){
        row.worker.push(await page.evaluate(async({region,tryHarder,duration})=>{
          const s=document.querySelector('#demo-scanner').scanner;s.pause();
          s.setOptions({scanArea:region==='aiming-roi'?window.__eanDiagnostic.originalROI:{x:0,y:0,width:1,height:1},tryHarder,tryInvert:'alternate',maxResults:1,beep:false,vibrate:false});
          const phase={region,tryHarder,startedAt:new Date().toISOString(),optionsStart:structuredClone(s.options),frames:0,nonemptyFrames:0,barcodes:[]};
          const seen=new Set(),off=s.on('frame',evt=>{phase.frames++;if(evt.barcodes.length)phase.nonemptyFrames++;for(const b of evt.barcodes){const k=JSON.stringify([b.data,b.symbology]);if(!seen.has(k)){seen.add(k);phase.barcodes.push({data:b.data,symbology:b.symbology,location:b.location});}}});
          s.resume();await new Promise(r=>setTimeout(r,duration));s.pause();off();phase.endedAt=new Date().toISOString();phase.optionsEnd=structuredClone(s.options);phase.engine=s.stats.engine;return phase;
        },{region,tryHarder,duration:report.settings.workerPhaseMs}));save();
      }
      row.status='complete';
    }catch(e){row.status='error';row.error=String(e);}
    finally{await Promise.allSettled(pending);await context.close();await browser.close();row.completedAt=new Date().toISOString();save();}
    console.log(JSON.stringify({id,status:row.status,error:row.error,engine:row.static?.engineVersion,crop:row.camera?.crop,pixels:row.camera?.pixelRange,static:row.static?.rows.map(r=>({raster:r.raster,hard:r.tryHarder,invert:r.tryInvert,results:r.barcodes.map(b=>b.data)})),worker:row.worker?.map(p=>({region:p.region,hard:p.tryHarder,frames:p.frames,results:p.barcodes.map(b=>b.data)})),pageErrors:row.pageErrors,consoleErrors:row.consoleErrors}));
  }
  report.status=report.results.every(r=>r.status==='complete')?'complete':'incomplete';
}catch(e){report.status='error';report.error=String(e);}
finally{server.kill();report.completedAt=new Date().toISOString();save();console.log('Evidence: '+join(out,'evidence.json'));}

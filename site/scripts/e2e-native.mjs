// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

// Actual React Native scanner component/public ref and ScanSession, rendered by
// ReactDOM. Native camera/platform/views and overlay are boundary stubs; these
// tests establish callback ordering, not device or camera-driver behavior.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const dependency = createRequire(new URL("../../packages/sdk/package.json", import.meta.url));
const { build } = dependency("esbuild");
const adapter = fileURLToPath(new URL("../../packages/react-native/src/QRGenScanner.tsx", import.meta.url));
const root = fileURLToPath(new URL("../../", import.meta.url));
const react = JSON.stringify(dependency.resolve("react"));
const native = `
  import React from ${react};
  export const View = ({children}) => React.createElement('div', null, children);
  export const Text = View, Pressable = View;
  export const Platform = {OS:'ios',Version:'17.4'};
  export const StyleSheet = {create:x=>x,absoluteFill:{}};
  export const AppState = {currentState:'active',addEventListener:()=>({remove(){}})};
  export const Dimensions = {get:()=>({width:390,height:844})};
  export const Linking = {openSettings:()=>Promise.resolve()};
  export const Vibration = {vibrate(){}};
`;
const camera = `
  import React,{useCallback,useLayoutEffect,useMemo,useRef} from ${react};
  const back={id:'back',position:'back',hasTorch:true};
  const front={id:'front',position:'front',hasTorch:true};
  const permission={hasPermission:true,requestPermission:()=>Promise.resolve(true)};
  export function useCameraPermission(){return permission}
  export function useCameraDevices(){return [back,front]}
  export function useCameraDevice(position){return position==='front'?front:back}
  // Mirror VisionCamera 4.7.3's stable hook callback without loading native code.
  export function useCodeScanner({onCodeScanned,...options}){
    const ref=useRef(onCodeScanned);ref.current=onCodeScanned;
    const callback=useCallback((codes,frame)=>ref.current(codes,frame),[]);
    return useMemo(()=>({...options,onCodeScanned:callback}),[JSON.stringify(options),callback]);
  }
  export function Camera(props){
    useLayoutEffect(()=>{window.cameraProps=props;return()=>{window.cameraProps=null}});
    return React.createElement('div',{'data-camera':true,'data-active':String(props.isActive)});
  }
`;
const app = `
  import React,{createRef} from ${react};
  import {createRoot} from ${JSON.stringify(dependency.resolve("react-dom/client"))};
  import {flushSync} from ${JSON.stringify(dependency.resolve("react-dom"))};
  import {QRGenScanner} from ${JSON.stringify(adapter)};
  const ref=createRef();const root=createRoot(document.getElementById('app'));
  let calls=[],tracks=[],events=[],scanSnapshots=[],trackSnapshots=[],mode='single',action,duplicateFilter=0,key=0,accentColor='#2EC1CE';
  const scan=codes=>{
    calls.push(codes.map(c=>c.data));
    scanSnapshots.push(JSON.parse(JSON.stringify(codes)));
    events.push({type:'scan',data:codes.map(c=>c.data)});
    if(action?.startsWith('batch-')){
      const next=action;action=null;
      events.push({type:'action',name:next});
      if(next==='batch-reset')ref.current.reset();
      else if(next==='batch-reset-next'){ref.current.reset();window.probe.frame('B')}
      else if(next==='batch-next')window.probe.frame('B');
      else if(next==='batch-empty-next')window.probe.emptyFrame();
      else if(next==='batch-expired-empty-next'){window.clock.set(501,1_800_000_000_501);window.probe.emptyFrame()}
      else if(next==='batch-unmount')flushSync(()=>root.unmount());
      else if(next==='batch-mode'){mode='continuous';flushSync(render)}
      else if(next==='batch-mode-queued'){mode='continuous';render()}
      else if(next==='batch-accent'){accentColor='#ABCDEF';flushSync(render)}
      else ref.current[next.slice(6)]();
    }
    else if(action==='mode'){mode='continuous';render()}
    else if(action==='unmount')root.unmount();
    else if(action)ref.current[action]();
  };
  const track=list=>{trackSnapshots.push(JSON.parse(JSON.stringify(list)));const data=list.map(c=>c.data);tracks.push(data);events.push({type:'track',data})};
  function render(){root.render(React.createElement(QRGenScanner,{
    key,ref,mode,symbologies:['qr'],duplicateFilter,beep:false,vibrate:false,
    accentColor,showToast:false,showHighlights:false,onScan:scan,onTrack:track,
  }))}
  window.probe={
    mount(nextAction,windowMs=0){calls=[];tracks=[];events=[];mode='single';action=nextAction;duplicateFilter=windowMs;key++;flushSync(render)},
    mountBatch(nextAction){calls=[];tracks=[];events=[];mode='batch';action=nextAction;duplicateFilter=-1;key++;flushSync(render)},
    frame(value){flushSync(()=>window.cameraProps.codeScanner.onCodeScanned([
      {type:'qr',value,corners:[{x:20,y:20},{x:120,y:20},{x:120,y:120},{x:20,y:120}]}
    ],{width:720,height:1280}))},
    emptyFrame(){flushSync(()=>window.cameraProps.codeScanner.onCodeScanned([],{width:720,height:1280}))},
    mountClock(nextMode,windowMs=1000){calls=[];tracks=[];events=[];scanSnapshots=[];trackSnapshots=[];mode=nextMode;action=null;duplicateFilter=windowMs;key++;flushSync(render)},
    clockTick(){flushSync(()=>window.clock.tick())},
    clockReset(){flushSync(()=>ref.current.reset())},
    clockState(){return {scans:JSON.parse(JSON.stringify(scanSnapshots)),tracks:JSON.parse(JSON.stringify(trackSnapshots)),clock:window.clock.state()}},
    snapshot(){return {calls:[...calls],cameraActive:window.cameraProps?.isActive??false,attached:!!ref.current}},
    batchState(){return {...this.snapshot(),tracks:[...tracks],events:[...events]}},
    unmount(){flushSync(()=>root.unmount())},
  };
`;
const bundle = await build({
  stdin: { contents: app, resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "native-camera-boundaries", setup(builder) {
    builder.onResolve({ filter: /^react(?:\/jsx(?:-dev)?-runtime)?$/ }, args => ({ path: dependency.resolve(args.path) }));
    builder.onResolve({ filter: /^react-native$/ }, () => ({ path: "native", namespace: "boundary" }));
    builder.onResolve({ filter: /^react-native-vision-camera$/ }, () => ({ path: "camera", namespace: "boundary" }));
    builder.onResolve({ filter: /\.\/ScannerOverlay$/ }, () => ({ path: "overlay", namespace: "boundary" }));
    builder.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => ({
      loader: "js", resolveDir: root,
      contents: path === "native" ? native : path === "camera" ? camera : "export function ScannerOverlay(){return null}",
    }));
  } }],
});

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  async function test(name, run, { controlledClock = false } = {}) {
    const context = await browser.newContext();
    const errors = [], requests = [];
    try {
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      context.on("request", request => requests.push(request.url()));
      await context.route("**/*", route => route.abort());
      await page.setContent('<!doctype html><div id="app"></div>');
      if (controlledClock) await page.evaluate(base => {
        let elapsed=0,wall=base,nextId=1;const intervals=new Map();
        Date.now=()=>wall;
        Object.defineProperty(performance,'now',{value:()=>elapsed,configurable:true});
        window.setInterval=(callback,milliseconds)=>{const id=nextId++;intervals.set(id,{callback,milliseconds});return id};
        window.clearInterval=id=>intervals.delete(id);
        window.clock={
          set(nextElapsed,nextWall){elapsed=nextElapsed;wall=nextWall},
          tick(){for(const entry of [...intervals.values()])entry.callback()},
          state(){return {elapsed:performance.now(),wall:Date.now(),intervals:intervals.size,periods:[...intervals.values()].map(x=>x.milliseconds)}}
        };
      }, 1_800_000_000_000);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await run(page);
      await page.evaluate(() => window.probe.unmount());
      assert.equal(await page.evaluate(() => window.cameraProps === null), true);
      if (controlledClock) assert.equal(await page.evaluate(() => window.clock.state().intervals), 0);
      assert.deepEqual(errors, []);
      assert.deepEqual(requests, []);
      console.log(`  ✓ ${name}`);
    } finally { await context.close(); }
  }
  const mount = async (page, action, windowMs = 0) => {
    await page.evaluate(([nextAction, duplicate]) => window.probe.mount(nextAction, duplicate), [action, windowMs]);
    await page.waitForSelector('[data-active="true"]', { state: "attached" });
  };
  const frame = (page, value) => page.evaluate(value => window.probe.frame(value), value);
  const state = page => page.evaluate(() => window.probe.snapshot());
  const mountBatch = async (page, action) => {
    await page.evaluate(nextAction => window.probe.mountBatch(nextAction), action);
    await page.waitForSelector('[data-active="true"]', { state: "attached" });
  };
  const batchState = page => page.evaluate(() => window.probe.batchState());

  await test("native single scan stops when the callback does not restart", async page => {
    await mount(page, null);
    await frame(page, "A");
    await frame(page, "B");
    assert.deepEqual(await state(page), { calls: [["A"]], cameraActive: false, attached: true });
  });
  for (const action of ["start", "resume", "reset"]) {
    await test(`native single onScan ${action} owns the next scan`, async page => {
      await mount(page, action);
      await frame(page, "A");
      assert.deepEqual(await state(page), { calls: [["A"]], cameraActive: true, attached: true });
      await frame(page, "B");
      assert.deepEqual(await state(page), { calls: [["A"], ["B"]], cameraActive: true, attached: true });
    });
  }
  for (const action of ["start", "resume"]) {
    await test(`native callback ${action} preserves once-per-session duplicate history`, async page => {
      await mount(page, action, -1);
      await frame(page, "A");
      await frame(page, "A");
      await frame(page, "B");
      assert.deepEqual(await state(page), { calls: [["A"], ["B"]], cameraActive: true, attached: true });
    });
  }
  await test("native callback reset clears once-per-session duplicate history", async page => {
    await mount(page, "reset", -1);
    await frame(page, "A");
    await frame(page, "A");
    assert.deepEqual(await state(page), { calls: [["A"], ["A"]], cameraActive: true, attached: true });
  });
  await test("native callback mode change retains the newer continuous session", async page => {
    await mount(page, "mode");
    await frame(page, "A");
    await page.waitForSelector('[data-active="true"]', { state: "attached" });
    await frame(page, "B");
    assert.deepEqual(await state(page), { calls: [["A"], ["B"]], cameraActive: true, attached: true });
  });
  await test("native callback stop retains the explicit stopped state", async page => {
    await mount(page, "stop");
    await frame(page, "A");
    await frame(page, "B");
    assert.deepEqual(await state(page), { calls: [["A"]], cameraActive: false, attached: true });
  });
  await test("native callback unmount detaches the camera component and public ref", async page => {
    await mount(page, "unmount");
    await frame(page, "A");
    assert.deepEqual(await state(page), { calls: [["A"]], cameraActive: false, attached: false });
  });
  await test("native batch reset cancels the old track snapshot and accepts the next same code", async page => {
    await mountBatch(page, "batch-reset");
    await frame(page, "A");
    assert.deepEqual((await batchState(page)).tracks, []);
    await frame(page, "A");
    assert.deepEqual(await batchState(page), {
      calls: [["A"], ["A"]], cameraActive: true, attached: true, tracks: [["A"]],
      events: [{ type: "scan", data: ["A"] }, { type: "action", name: "batch-reset" },
        { type: "scan", data: ["A"] }, { type: "track", data: ["A"] }],
    });
  });
  await test("native batch reset and a nested frame retain only the newer track snapshot", async page => {
    await mountBatch(page, "batch-reset-next");
    await frame(page, "A");
    assert.deepEqual(await batchState(page), {
      calls: [["A"], ["B"]], cameraActive: true, attached: true, tracks: [["B"]],
      events: [{ type: "scan", data: ["A"] }, { type: "action", name: "batch-reset-next" },
        { type: "scan", data: ["B"] }, { type: "track", data: ["B"] }],
    });
  });
  await test("native batch nested frame supersedes the earlier track snapshot without resetting history", async page => {
    await mountBatch(page, "batch-next");
    await frame(page, "A");
    assert.deepEqual(await batchState(page), {
      calls: [["A"], ["B"]], cameraActive: true, attached: true, tracks: [["A", "B"]],
      events: [{ type: "scan", data: ["A"] }, { type: "action", name: "batch-next" },
        { type: "scan", data: ["B"] }, { type: "track", data: ["A", "B"] }],
    });
    await frame(page, "A");
    await frame(page, "B");
    assert.deepEqual((await batchState(page)).calls, [["A"], ["B"]]);
  });
  await test("native batch synchronous unmount cancels the old track callback", async page => {
    await mountBatch(page, "batch-unmount");
    await frame(page, "A");
    assert.deepEqual(await batchState(page), {
      calls: [["A"]], cameraActive: false, attached: false, tracks: [],
      events: [{ type: "scan", data: ["A"] }, { type: "action", name: "batch-unmount" }],
    });
  });
  await test("native batch committed mode change cancels the old track callback", async page => {
    await mountBatch(page, "batch-mode");
    await frame(page, "A");
    await frame(page, "B");
    assert.deepEqual(await batchState(page), {
      calls: [["A"], ["B"]], cameraActive: true, attached: true, tracks: [],
      events: [{ type: "scan", data: ["A"] }, { type: "action", name: "batch-mode" },
        { type: "scan", data: ["B"] }],
    });
  });
  for (const action of [null, "batch-accent", "batch-start", "batch-resume", "batch-mode-queued"]) {
    await test(`native batch ${action ?? "unchanged"} preserves the current track callback and duplicate history`, async page => {
      await mountBatch(page, action);
      await frame(page, "A");
      assert.deepEqual((await batchState(page)).tracks, [["A"]]);
      await frame(page, "A");
      assert.deepEqual((await batchState(page)).calls, [["A"]]);
      assert.equal((await batchState(page)).cameraActive, true);
    });
  }

  await test("native batch nested empty frame preserves the still-current initial track callback", async page => {
    await mountBatch(page, "batch-empty-next");
    await frame(page, "A");
    assert.deepEqual(await batchState(page), {
      calls: [["A"]], cameraActive: true, attached: true, tracks: [["A"]],
      events: [{ type: "scan", data: ["A"] }, { type: "action", name: "batch-empty-next" },
        { type: "track", data: ["A"] }],
    });
  }, { controlledClock: true });
  await test("native batch nested expired empty frame replaces the old track callback", async page => {
    await mountBatch(page, "batch-expired-empty-next");
    await frame(page, "A");
    assert.deepEqual(await batchState(page), {
      calls: [["A"]], cameraActive: true, attached: true, tracks: [[]],
      events: [{ type: "scan", data: ["A"] }, { type: "action", name: "batch-expired-empty-next" },
        { type: "track", data: [] }],
    });
  }, { controlledClock: true });

  // Independent wall/elapsed clocks; native boundaries still use the modeled hook.
  {
    const base=1_800_000_000_000;
    const cases = [];
    const add = (name, regression, run) => cases.push({ name, regression, run });
    const frame = page => page.evaluate(() => window.probe.frame('A'));
    const tick = page => page.evaluate(() => window.probe.clockTick());
    const state = page => page.evaluate(() => window.probe.clockState());
    const setTime = (page, elapsed, step = 0) => page.evaluate(({elapsed,wall}) => window.clock.set(elapsed,wall), {elapsed,wall:base+elapsed+step});
    const mount = async (page, mode, duplicate = 1000) => {
      await page.evaluate(({mode,duplicate}) => window.probe.mountClock(mode,duplicate), {mode,duplicate});
      await page.waitForSelector('[data-active="true"]', { state: 'attached' });
      assert.equal((await state(page)).clock.intervals, mode === 'batch' ? 1 : 0);
    };
    for (const scenario of [
      {name:'rollback',elapsed:2000,step:-60_000,expire:true,report:true},
      {name:'forward',elapsed:100,step:60_000,expire:false,report:false},
    ]) {
      add(`continuous duplicate ${scenario.name}`, true, async page => {
        await mount(page,'continuous');await frame(page);
        await setTime(page,scenario.elapsed,scenario.step);await frame(page);
        const result=await state(page);
        assert.equal(result.scans.length,scenario.report?2:1);
        assert.equal(result.scans[0][0].timestamp,base);
        if(scenario.report)assert.equal(result.scans[1][0].timestamp,base+scenario.elapsed+scenario.step);
      });
      add(`batch frame expiry and metadata ${scenario.name}`, true, async page => {
        await mount(page,'batch');await frame(page);
        await setTime(page,scenario.elapsed,scenario.step);await frame(page);
        const result=await state(page),item=result.tracks.at(-1)[0];
        assert.equal(result.scans.length,scenario.report?2:1);
        assert.equal(item.count,scenario.expire?1:2);
        assert.equal(item.firstSeen,scenario.expire?base+scenario.elapsed+scenario.step:base);
        assert.equal(item.lastSeen,base+scenario.elapsed+scenario.step);
        assert.equal(item.timestamp,base+scenario.elapsed+scenario.step);
      });
      add(`batch timer expiry ${scenario.name}`, true, async page => {
        await mount(page,'batch');await frame(page);
        await setTime(page,scenario.elapsed,scenario.step);await tick(page);
        const result=await state(page);
        assert.equal(result.tracks.length,scenario.expire?2:1);
        assert.equal(result.tracks.at(-1).length,scenario.expire?0:1);
        assert.equal(result.scans.length,1);
      });
    }
    add('continuous exact duplicate boundary',false,async page=>{
      await mount(page,'continuous');await frame(page);
      await setTime(page,999);await frame(page);assert.equal((await state(page)).scans.length,1);
      await setTime(page,1000);await frame(page);assert.equal((await state(page)).scans.length,2);
    });
    add('batch timer exact expiry boundary',false,async page=>{
      await mount(page,'batch');await frame(page);
      await setTime(page,500);await tick(page);assert.equal((await state(page)).tracks.length,1);
      await setTime(page,501);await tick(page);assert.deepEqual((await state(page)).tracks.at(-1),[]);
    });
    add('batch normal epoch metadata',false,async page=>{
      await mount(page,'batch');await frame(page);
      await setTime(page,100);await frame(page);
      const item=(await state(page)).tracks.at(-1)[0];
      assert.equal(item.count,2);assert.equal(item.firstSeen,base);
      assert.equal(item.lastSeen,base+100);assert.equal(item.timestamp,base+100);
    });
    add('duplicate zero reports every frame across rollback',false,async page=>{
      await mount(page,'continuous',0);await frame(page);
      await setTime(page,2000,-60_000);await frame(page);
      assert.equal((await state(page)).scans.length,2);
    });
    add('once-per-session survives wall jumps and public reset clears it',false,async page=>{
      await mount(page,'continuous',-1);await frame(page);
      await setTime(page,2000,-60_000);await frame(page);
      await setTime(page,3000,60_000);await frame(page);
      assert.equal((await state(page)).scans.length,1);
      await page.evaluate(()=>window.probe.clockReset());await frame(page);
      assert.equal((await state(page)).scans.length,2);
    });
    add('no scan or track callback is fabricated by an empty continuous timer set',false,async page=>{
      await mount(page,'continuous');await setTime(page,2000,-60_000);await tick(page);
      const result=await state(page);assert.deepEqual(result.scans,[]);assert.deepEqual(result.tracks,[]);
    });
    for (const item of cases) await test(`native component clock ${item.name}`, item.run, { controlledClock: true });
  }
} finally { await browser.close(); }

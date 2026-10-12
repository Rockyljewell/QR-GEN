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
  // A parent restoring a saved torch preference once, from its own mount effect.
  function TorchRestore({camera}){
    React.useEffect(()=>{ref.current.setTorch(true)},[]);
    return React.createElement(QRGenScanner,{ref,camera,symbologies:['qr'],beep:false,vibrate:false,showToast:false,showHighlights:false});
  }
  window.probe={
    mountTorchRestore(camera='back'){flushSync(()=>root.render(React.createElement(TorchRestore,{camera})))},
    torch(){return window.cameraProps?.torch??null},
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

  await test("native ref setTorch from a parent mount effect survives initial configuration", async page => {
    await page.evaluate(() => window.probe.mountTorchRestore());
    await page.waitForSelector('[data-active="true"]', { state: "attached" });
    assert.equal(await page.evaluate(() => window.probe.torch()), "on");
    await page.evaluate(() => window.probe.mountTorchRestore("front"));
    assert.equal(await page.evaluate(() => window.probe.torch()), "on");
  });
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

// Optional spatial component contracts. Native platform/Camera/overlay are
// test boundaries; each saved Camera transport reads its own current props.
// The hook model preserves VC4.7.3 stable-callback aliasing. A sensitivity
// control catches the insufficient parent-hook/key-only-Camera architecture.
// Blank transport cases do not claim native VC emits empty detection events.
{
const scanner=adapter;
function spatialBoundaries({ reactPath, hookPath }) {
  const react = JSON.stringify(reactPath.replaceAll('\\', '/'));
  const initialize = `
    (()=>{
      const instances=new Map(),hooks=new Map(),callbacks=new WeakMap();
      const logs=[];let nextCamera=0,nextHook=0;
      const back={id:'back',position:'back',hasTorch:true};
      const front={id:'front',position:'front',hasTorch:true};
      window.__nativeProbe={
        instances,hooks,callbacks,logs,devices:[back,front],permission:true,
        requestPermission:()=>Promise.resolve(window.__nativeProbe.permission),
        nextCamera:()=>++nextCamera,nextHook:()=>++nextHook,
        onCameraLayout:null,onHookLayout:null,layout:null,overlay:null,
        describe(props){return {device:props.device?.id??null,isActive:!!props.isActive,
          codeTypes:[...(props.codeScanner?.codeTypes??[])],hook:callbacks.get(props.codeScanner?.onCodeScanned)??null,
          torch:props.torch,resizeMode:props.resizeMode}},
        snapshot(){return {cameras:[...instances.values()].map(c=>({id:c.id,mounted:c.mounted,...this.describe(c.props)})),
          hooks:[...hooks.values()].map(h=>({id:h.id,mounted:h.mounted})),logs:[...logs],overlay:this.overlay}},
      };
    })();
  `;
  const native = `
    import React,{useLayoutEffect} from ${react};
    export function View({children,onLayout}){
      useLayoutEffect(()=>{
        if(!onLayout)return;
        window.__nativeProbe.layout=onLayout;
        return()=>{if(window.__nativeProbe.layout===onLayout)window.__nativeProbe.layout=null};
      },[onLayout]);
      return React.createElement('div',null,children);
    }
    export const Text=View,Pressable=View;
    export const Platform={OS:'ios',Version:'17.4'};
    export const StyleSheet={create:x=>x,absoluteFill:{}};
    export const AppState={currentState:'active',addEventListener:()=>({remove(){}})};
    export const Dimensions={get:()=>({width:390,height:844})};
    export const Linking={openSettings:()=>Promise.resolve()};
    export const Vibration={vibrate(){window.__nativeProbe.logs.push({kind:'vibrate'})}};
  `;
  const camera = `
    import React,{useCallback,useLayoutEffect,useMemo,useRef} from ${react};

    // Stable callback/ref behavior mirrors installed VisionCamera4.7.3.
    // Independent artifact checks separately execute the installed hook.
    function useModeledCodeScanner({onCodeScanned,...options}){
      const ref=useRef(onCodeScanned);ref.current=onCodeScanned;
      const callback=useCallback((codes,frame)=>ref.current(codes,frame),[]);
      return useMemo(()=>({...options,onCodeScanned:callback}),[JSON.stringify(options),callback]);
    }
    export function useCameraPermission(){const p=window.__nativeProbe;return {hasPermission:p.permission,requestPermission:p.requestPermission}}
    export function useCameraDevices(){return window.__nativeProbe.devices}
    export function useCameraDevice(position){return window.__nativeProbe.devices.find(d=>d.position===position)}
    export function useCodeScanner(options){
      const id=useRef(null);if(id.current===null)id.current=window.__nativeProbe.nextHook();
      const actual=useModeledCodeScanner(options);
      // Mapping a render is provisional; only layout marks this hook committed.
      window.__nativeProbe.callbacks.set(actual.onCodeScanned,id.current);
      useLayoutEffect(()=>{
        const p=window.__nativeProbe;
        p.hooks.set(id.current,{id:id.current,mounted:true,callback:actual.onCodeScanned});
        p.logs.push({kind:'hook-layout',id:id.current});
        p.onHookLayout?.({id:id.current,callback:actual.onCodeScanned});
      });
      useLayoutEffect(()=>()=>{
        const p=window.__nativeProbe,h=p.hooks.get(id.current);
        if(h)h.mounted=false;p.logs.push({kind:'hook-unmount',id:id.current});
      },[]);
      return actual;
    }
    export class Camera extends React.Component{
      constructor(props){
        super(props);this.id=window.__nativeProbe.nextCamera();this.mounted=false;
        // Each saved transport reads this instance, never a global latest-props object.
        this.frame=(codes,frame)=>this.props.codeScanner?.onCodeScanned(codes,frame);
        this.ready=()=>this.props.onInitialized?.();
        this.error=error=>this.props.onError?.(error);
        this.previewOrientation=value=>this.props.onPreviewOrientationChanged?.(value);
        this.outputOrientation=value=>this.props.onOutputOrientationChanged?.(value);
      }
      layout(kind){
        const p=window.__nativeProbe;
        p.logs.push({kind,id:this.id,...p.describe(this.props)});
        p.onCameraLayout?.(this,kind);
      }
      componentDidMount(){this.mounted=true;window.__nativeProbe.instances.set(this.id,this);this.layout('camera-mount')}
      componentDidUpdate(){this.layout('camera-update')}
      componentWillUnmount(){this.mounted=false;window.__nativeProbe.logs.push({kind:'camera-unmount',id:this.id})}
      render(){return React.createElement('div',{'data-camera-instance':this.id,'data-active':String(this.props.isActive)})}
    }
  `;
  const overlay = `
    import {useLayoutEffect} from ${react};
    export function ScannerOverlay(props){
      useLayoutEffect(()=>{
        window.__nativeProbe.overlay=JSON.parse(JSON.stringify(props));
        return()=>{window.__nativeProbe.overlay=null};
      });
      return null;
    }
  `;
  return { initialize, native, camera, overlay };
}

const boundaries=spatialBoundaries({reactPath:dependency.resolve("react")});
const app = `
  import React,{createRef} from ${react};
  import {createRoot} from ${JSON.stringify(dependency.resolve('react-dom/client').replaceAll('\\', '/'))};
  import {flushSync} from ${JSON.stringify(dependency.resolve('react-dom').replaceAll('\\', '/'))};
  import {QRGenScanner} from ${JSON.stringify(scanner.replaceAll('\\', '/'))};
  import {Camera,useCodeScanner} from 'react-native-vision-camera';
  const root=createRoot(document.getElementById('app')),ref=createRef();
  let props={},key=0,unmounted=false,events=[],feedback=[];
  const clone=value=>JSON.parse(JSON.stringify(value));
  const scan=codes=>{events.push({type:'scan',codes:clone(codes)});window.fixture.onScanAction?.(codes)};
  const track=list=>{events.push({type:'track',tracks:clone(list)});window.fixture.onTrackAction?.(list)};
  const error=value=>{events.push({type:'error',error:clone(value)});window.fixture.onErrorAction?.(value)};
  const ready=()=>{events.push({type:'ready'});window.fixture.onReadyAction?.()};
  function render(){root.render(React.createElement(QRGenScanner,{...props,key,ref,onScan:scan,onTrack:track,onError:error,onReady:ready}))}
  function current(){return [...window.__nativeProbe.instances.values()].filter(c=>c.mounted).at(-1)}
  function invoke(action){flushSync(action)}
  function Sensitivity({source}){
    const codeScanner=useCodeScanner({codeTypes:['qr'],onCodeScanned:codes=>events.push({type:'sensitivity',source,value:codes[0]?.value})});
    return React.createElement(Camera,{key:source,device:{id:source,position:source},isActive:true,codeScanner});
  }
  window.fixture={
    onScanAction:null,onTrackAction:null,onErrorAction:null,onReadyAction:null,
    mount(next={}){
      props={mode:'batch',symbologies:['qr'],duplicateFilter:-1,spatialTracking:true,
        trackMaxJump:3,trackMaxAssociationWork:250000,showToast:false,showHighlights:true,
        beep:()=>feedback.push('accepted'),vibrate:false,...next};
      key++;events=[];feedback=[];invoke(render);
    },
    update(next,synchronous=true){props={...props,...next};if(synchronous)invoke(render);else render()},
    currentCamera(){return current()?.id??null},
    currentHook(){return window.__nativeProbe.callbacks.get(current()?.props.codeScanner?.onCodeScanned)??null},
    setDevices(devices){window.__nativeProbe.devices=devices;this.update({})},
    setPermission(value){window.__nativeProbe.permission=value;this.update({})},
    frame(codes,frame={width:720,height:1280},id){const target=id===undefined?current():window.__nativeProbe.instances.get(id);invoke(()=>target?.frame(codes,frame))},
    directFrame(codes,frame={width:720,height:1280},id){const target=id===undefined?current():window.__nativeProbe.instances.get(id);target?.frame(codes,frame)},
    hookFrame(id,codes,frame={width:720,height:1280}){invoke(()=>window.__nativeProbe.hooks.get(id)?.callback(codes,frame))},
    empty(frame={width:720,height:1280}){this.frame([],frame)},
    ready(id){const target=id===undefined?current():window.__nativeProbe.instances.get(id);invoke(()=>target?.ready())},
    error(id){const target=id===undefined?current():window.__nativeProbe.instances.get(id);invoke(()=>target?.error({code:'device/camera-already-in-use',message:'boundary error'}))},
    orientation(value,id,output=false){const target=id===undefined?current():window.__nativeProbe.instances.get(id);invoke(()=>output?target?.outputOrientation(value):target?.previewOrientation(value))},
    layout(width,height){invoke(()=>window.__nativeProbe.layout?.({nativeEvent:{layout:{width,height}}}))},
    time(elapsed,step=0){window.clock.set(elapsed,1800000000000+elapsed+step)},
    tick(){invoke(()=>window.clock.tick())},
    control(name){invoke(()=>ref.current[name]())},
    directControl(name){ref.current[name]()},
    state(){return {events:clone(events),feedback:[...feedback],attached:!!ref.current,
      camera:this.currentCamera(),hook:this.currentHook(),boundary:window.__nativeProbe.snapshot(),clock:window.clock.state()}},
    sensitivity(source){invoke(()=>root.render(React.createElement(Sensitivity,{source})))},
    unmount(){if(!unmounted){unmounted=true;invoke(()=>root.unmount())}},
  };
`;

const cases = [];
const add = (name, oracle, run) => cases.push({ name, oracle, run });
const code = (value = 'A', x = 20, y = 20, size = 100) => ({ type: 'qr', value,
  corners: [{x,y},{x:x+size,y},{x:x+size,y:y+size},{x,y:y+size}] });
const frame = (page, codes = [code()], size) => page.evaluate(({codes,size}) => window.fixture.frame(codes,size), {codes,size});
const state = page => page.evaluate(() => window.fixture.state());
const scans = value => value.events.filter(e => e.type === 'scan').map(e => e.codes);
const tracks = value => value.events.filter(e => e.type === 'track').map(e => e.tracks);
const errors = value => value.events.filter(e => e.type === 'error');
const last = value => tracks(value).at(-1);
const ids = list => list.map(t => t.id);
const update = (page, next) => page.evaluate(next => window.fixture.update(next), next);
const settle = page => page.evaluate(() => new Promise(resolve => setTimeout(resolve,0)));
const mount = async (page, props = {}) => {
  await page.evaluate(props => window.fixture.mount(props), props);
  await page.waitForFunction(() => window.fixture.currentCamera() !== null, null, {timeout:5000});
};
const sameOwner = (before, after) => { assert.equal(after.camera,before.camera); assert.equal(after.hook,before.hook); };
const currentCamera = value => value.boundary.cameras.find(c => c.id === value.camera);

add('sensitivity: parent hook plus keyed Camera aliases a saved old callback', 'Expected leakage validates the actual-hook boundary, not QRGen.', async page => {
  await page.evaluate(() => window.fixture.sensitivity('back'));
  const before=await state(page);
  await page.evaluate(() => window.fixture.sensitivity('front'));
  const after=await state(page);
  assert.notEqual(after.camera,before.camera);assert.equal(after.hook,before.hook);
  await page.evaluate(({id,codes}) => window.fixture.hookFrame(id,codes), {id:before.hook,codes:[code()]});
  assert.deepEqual((await state(page)).events,[{type:'sensitivity',source:'front',value:'A'}]);
});

add('spatial equal payload observations and duplicate history', 'Two spatial tracks, one payload report under -1; small movement keeps both IDs.', async page => {
  await mount(page);await frame(page,[code('A',20),code('A',400)]);
  const before=await state(page);assert.equal(last(before).length,2);assert.equal(new Set(ids(last(before))).size,2);
  assert.equal(scans(before).length,1);assert.equal(scans(before)[0].length,1);
  await frame(page,[code('A',25),code('A',405)]);const after=await state(page);
  assert.deepEqual(ids(last(after)),ids(last(before)));assert.deepEqual(last(after).map(t=>t.count),[2,2]);assert.equal(scans(after).length,1);
});
add('spatial duplicate zero reports both equal payload detections', 'Payload duplicate policy remains independent of spatial identity.', async page => {
  await mount(page,{duplicateFilter:0});await frame(page,[code('A',20),code('A',400)]);
  const value=await state(page);assert.equal(last(value).length,2);assert.equal(scans(value)[0].length,2);
});
add('default aggregation and native identity survive default source/cosmetic/control updates', 'Legacy payload IDs and hook/Camera instance remain unchanged.', async page => {
  await mount(page,{spatialTracking:false});await frame(page,[code('A',20),code('A',400)]);
  const before=await state(page);assert.equal(last(before).length,1);assert.ok(!last(before)[0].id.startsWith('spatial-'));
  await update(page,{camera:'front',accentColor:'#ABCDEF'});await page.evaluate(()=>{window.fixture.control('start');window.fixture.control('resume')});
  const after=await state(page);sameOwner(before,after);assert.equal(currentCamera(after).device,'front');
  await frame(page,[code('A',30)]);assert.equal(last(await state(page))[0].id,last(before)[0].id);assert.equal(scans(await state(page)).length,1);
});
add('equal policy and same resolved source preserve spatial owner/IDs', 'Equal policy, alias-to-back and new same-ID device object do not clear or rekey.', async page => {
  await mount(page);await frame(page);const before=await state(page);
  await update(page,{spatialTracking:true,trackMaxJump:3,trackMaxAssociationWork:250000,camera:'unknown-id'});
  await page.evaluate(()=>window.fixture.setDevices([{id:'back',position:'back',hasTorch:true},{id:'front',position:'front',hasTorch:true}]));
  const after=await state(page);sameOwner(before,after);assert.equal(tracks(after).length,1);assert.deepEqual(ids(last(after)),ids(last(before)));
  await frame(page);assert.equal(last(await state(page))[0].count,2);
});
add('equal negative-zero positive-zero policy preserves pending delivery', 'Numerically equal policy commits are not tracker replacements or registration boundaries.', async page => {
  await mount(page,{trackMaxJump:-0});const before=await state(page);
  await page.evaluate(()=>window.fixture.onScanAction=()=>{window.fixture.onScanAction=null;window.fixture.update({trackMaxJump:0})});
  await frame(page);const after=await state(page);sameOwner(before,after);assert.deepEqual(last(after).map(t=>t.data),['A']);assert.equal(tracks(after).length,1);
  await update(page,{trackMaxJump:-0});await frame(page);const continued=await state(page);sameOwner(after,continued);assert.equal(last(continued)[0].id,last(after)[0].id);assert.equal(last(continued)[0].count,2);assert.equal(scans(continued).length,1);
});
add('changed rejection retries and equal rejection cosmetic commit stays deduplicated', 'Each genuinely changed rejected policy reports once; equal operational rejection and presentation commits do not repeat or block valid recovery.', async page => {
  await mount(page);await frame(page);const before=await state(page);
  await update(page,{trackMaxJump:-1});assert.equal(errors(await state(page)).length,1);
  await update(page,{trackMaxJump:-1,accentColor:'#ABCDEF'});assert.equal(errors(await state(page)).length,1);
  await update(page,{trackMaxJump:-2});assert.equal(errors(await state(page)).length,2);
  await update(page,{trackMaxJump:-1});assert.equal(errors(await state(page)).length,3);sameOwner(before,await state(page));
  await update(page,{trackMaxJump:3});await frame(page);assert.equal(last(await state(page))[0].id,last(before)[0].id);assert.equal(last(await state(page))[0].count,2);
  await update(page,{trackMaxJump:-1});assert.equal(errors(await state(page)).length,4);
});
add('policy-only replacement keeps Camera/hook but clears observations once', 'Fresh policy namespace, retained duplicate history, no native remount.', async page => {
  await mount(page);await frame(page);const before=await state(page);
  await update(page,{trackMaxJump:4});const changed=await state(page);sameOwner(before,changed);assert.deepEqual(tracks(changed).slice(1),[[]]);
  await frame(page);const after=await state(page);assert.notEqual(last(after)[0].id,last(before)[0].id);assert.equal(scans(after).length,1);
  await update(page,{trackMaxJump:4});sameOwner(after,await state(page));assert.equal(tracks(await state(page)).length,3);
});
add('accepted enable/disable rekeys exactly once each and retains duplicates', 'Opt-in source ownership differs from legacy default; IDs remain opaque.', async page => {
  await mount(page,{spatialTracking:false});await frame(page);const legacy=await state(page);
  await update(page,{spatialTracking:true});const enabled=await state(page);assert.notEqual(enabled.camera,legacy.camera);assert.notEqual(enabled.hook,legacy.hook);
  await frame(page);const spatial=await state(page);assert.equal(last(spatial).length,1);assert.equal(scans(spatial).length,1);
  await update(page,{spatialTracking:false});const disabled=await state(page);assert.notEqual(disabled.camera,enabled.camera);assert.notEqual(disabled.hook,enabled.hook);
  await frame(page);const after=await state(page);assert.equal(last(after)[0].id,last(legacy)[0].id);assert.equal(scans(after).length,1);
  assert.equal(after.boundary.cameras.length,3);
});

const invalids=[['jumpNaN','trackMaxJump',NaN],['jumpInfinity','trackMaxJump',Infinity],['jumpNegative','trackMaxJump',-1],['jumpNull','trackMaxJump',null],
  ['workZero','trackMaxAssociationWork',0],['workFraction','trackMaxAssociationWork',1.5],['workUnsafe','trackMaxAssociationWork',Number.MAX_SAFE_INTEGER+1],['workNull','trackMaxAssociationWork',null],
  ['enableNull','spatialTracking',null],['enableString','spatialTracking','true']];
for(const [name,field,value] of invalids) add(`invalid mixed proposal ${name}`, 'Reject all mixed changes; old source/UI/history still operate; one error; later valid proposal succeeds.', async page => {
  await mount(page);await page.evaluate(()=>window.fixture.layout(390,844));await frame(page);const before=await state(page);
  await page.evaluate(({field,value})=>window.fixture.update({camera:'front',mode:'continuous',duplicateFilter:0,maxResults:1,symbologies:['ean13'],
    scanArea:{x:.8,y:.8,width:.1,height:.1},[field]:value}),{field,value});await settle(page);
  const rejected=await state(page);sameOwner(before,rejected);assert.equal(currentCamera(rejected).device,'back');assert.deepEqual(currentCamera(rejected).codeTypes,['qr']);
  assert.deepEqual(tracks(rejected),tracks(before));assert.deepEqual(rejected.boundary.overlay,before.boundary.overlay);assert.equal(errors(rejected).length,1);
  await frame(page);const continued=await state(page);assert.equal(last(continued)[0].id,last(before)[0].id);assert.equal(last(continued)[0].count,2);assert.equal(scans(continued).length,1);
  await page.evaluate(()=>window.fixture.update({camera:'front',mode:'batch',duplicateFilter:-1,maxResults:20,symbologies:['qr'],scanArea:undefined,
    spatialTracking:true,trackMaxJump:3,trackMaxAssociationWork:250000}));
  const recovered=await state(page);assert.notEqual(recovered.camera,before.camera);assert.notEqual(recovered.hook,before.hook);assert.equal(currentCamera(recovered).device,'front');
});
add('isActive false stops the camera even when mixed with an invalid prop', 'A rejected proposal must not keep the camera running after the app asks it to stop.', async page => {
  await mount(page);await frame(page);const before=await state(page);assert.equal(currentCamera(before).isActive,true);
  await update(page,{isActive:false,trackMaxJump:NaN});await settle(page);const stopped=await state(page);
  assert.equal(errors(stopped).length,1);assert.equal(currentCamera(stopped).isActive,false);
});
add('rejected spatial enable retains legacy instance and payload identity', 'Invalid enable mixed with source/mode does not partially accept.', async page => {
  await mount(page,{spatialTracking:false});await frame(page);const before=await state(page);
  await update(page,{spatialTracking:true,trackMaxAssociationWork:null,camera:'front',mode:'continuous',duplicateFilter:0});
  const after=await state(page);sameOwner(before,after);assert.equal(errors(after).length,1);assert.equal(currentCamera(after).device,'back');
  await frame(page);const value=await state(page);assert.equal(last(value)[0].id,last(before)[0].id);assert.equal(last(value)[0].count,2);assert.equal(scans(value).length,1);
});
for(const field of ['spatialTracking','trackMaxJump','trackMaxAssociationWork'])add(`initial explicit null ${field}`, 'Initial validation errors observably before any Camera; a later valid proposal starts.', async page => {
  await page.evaluate(field=>window.fixture.mount({[field]:null}),field);await settle(page);const rejected=await state(page);
  assert.equal(rejected.camera,null);assert.equal(errors(rejected).length,1);assert.deepEqual(tracks(rejected),[]);assert.deepEqual(scans(rejected),[]);
  await update(page,{spatialTracking:true,trackMaxJump:3,trackMaxAssociationWork:250000});await page.waitForFunction(()=>window.fixture.currentCamera()!==null,null,{timeout:5000});
  await frame(page);assert.equal(last(await state(page)).length,1);
});

add('spatial old source transports and hook cannot mutate new owner', 'Saved old frame/ready/error/orientation/hook are rejected even at identical dimensions.', async page => {
  await mount(page);await frame(page);const before=await state(page);await update(page,{camera:'front'});const after=await state(page);
  assert.notEqual(after.camera,before.camera);assert.notEqual(after.hook,before.hook);assert.deepEqual(tracks(after).slice(1),[[]]);
  await page.evaluate(({camera,hook,codes})=>{
    window.fixture.frame(codes,undefined,camera);window.fixture.hookFrame(hook,codes);window.fixture.ready(camera);window.fixture.error(camera);
    window.fixture.orientation('landscape-left',camera);window.fixture.orientation('portrait-upside-down',camera,true);
  },{camera:before.camera,hook:before.hook,codes:[code('OLD')]});
  const ignored=await state(page);assert.deepEqual(ignored.events,after.events);assert.deepEqual(ignored.feedback,after.feedback);assert.deepEqual(ignored.boundary.overlay,after.boundary.overlay);sameOwner(after,ignored);
  await frame(page,[code('NEW')]);await page.evaluate(()=>window.fixture.ready());const current=await state(page);
  assert.equal(scans(current).at(-1)[0].data,'NEW');assert.equal(current.events.filter(e=>e.type==='ready').length,1);
});
add('new source Camera layout gap rejects current/old events and ticks before activation', 'Reachable layout boundary, not artificial interleaving after configure.', async page => {
  await mount(page);await frame(page);const before=await state(page);
  await page.evaluate(({old,codes})=>{
    window.__gapAttempts=0;
    window.__nativeProbe.onCameraLayout=(instance)=>{
      if(instance.props.device.id!=='front')return;
      window.__nativeProbe.onCameraLayout=null;window.__gapAttempts++;
      instance.frame(codes,{width:720,height:1280});instance.ready();instance.error({code:'device/camera-already-in-use',message:'gap'});
      instance.previewOrientation('landscape-left');window.__nativeProbe.instances.get(old).frame(codes,{width:720,height:1280});window.clock.tick();
    };
    window.fixture.update({camera:'front'});
  },{old:before.camera,codes:[code('GAP')]});
  const after=await state(page);assert.equal(await page.evaluate(()=>window.__gapAttempts),1);assert.equal(scans(after).length,1);assert.equal(errors(after).length,0);
  assert.equal(after.events.filter(e=>e.type==='ready').length,0);assert.deepEqual(tracks(after).slice(1),[[]]);
  await frame(page,[code('CURRENT')]);assert.equal(scans(await state(page)).at(-1)[0].data,'CURRENT');
});
add('same-key accepted policy publication re-registers before admission', 'Policy-only source token survives; new-frame admission remains gated during accepted layout.', async page => {
  await mount(page);await frame(page);const before=await state(page);
  await page.evaluate(codes=>{
    window.__gapAttempts=0;
    window.__nativeProbe.onCameraLayout=instance=>{
      if(!instance.props.codeScanner.codeTypes.includes('ean-13'))return;
      window.__nativeProbe.onCameraLayout=null;window.__gapAttempts++;
      instance.frame(codes,{width:720,height:1280});instance.ready();window.clock.tick();
    };
    window.fixture.update({trackMaxJump:4,symbologies:['qr','ean13'],maxResults:2});
  },[code('GAP')]);
  const after=await state(page);sameOwner(before,after);assert.equal(await page.evaluate(()=>window.__gapAttempts),1);assert.equal(scans(after).length,1);
  assert.deepEqual(tracks(after).slice(1),[[]]);assert.equal(after.events.filter(e=>e.type==='ready').length,0);
  await frame(page,[code('CURRENT')]);assert.equal(scans(await state(page)).at(-1)[0].data,'CURRENT');
});
add('ordinary same-source update in onScan preserves current delivery', 'ROI/max/window/feedback acceptance is not a track-delivery cancellation boundary.', async page => {
  await mount(page);const before=await state(page);
  await page.evaluate(()=>window.fixture.onScanAction=()=>{window.fixture.onScanAction=null;window.fixture.update({duplicateFilter:0,maxResults:1,scanArea:{x:0,y:0,width:.5,height:1},beep:false})});
  await frame(page);const current=await state(page);sameOwner(before,current);assert.equal(last(current)[0].data,'A');assert.equal(tracks(current).length,1);
  await frame(page,[code('LEFT',20),code('RIGHT',500)]);const next=await state(page);assert.deepEqual(scans(next).at(-1).map(c=>c.data),['LEFT']);assert.deepEqual(next.feedback,['accepted']);
});
add('cosmetic viewfinder commit in onScan preserves owner and pending delivery', 'Viewfinder presentation alone cannot quarantine or re-register the operational source.', async page => {
  await mount(page);const before=await state(page);
  await page.evaluate(()=>window.fixture.onScanAction=()=>{window.fixture.onScanAction=null;window.fixture.update({viewfinder:'none',accentColor:'#ABCDEF'})});
  await frame(page);const after=await state(page);sameOwner(before,after);assert.deepEqual(last(after).map(t=>t.data),['A']);
  assert.equal(after.boundary.overlay.viewfinder,'none');assert.equal(after.boundary.overlay.accentColor,'#ABCDEF');assert.equal(tracks(after).length,1);
});
add('consecutive accepted source/policy proposals coalesce pending clear', 'A newer layout-queued proposal cannot lose a genuine clear or restore an older source.', async page => {
  await mount(page);await frame(page);const before=await state(page);
  await page.evaluate(()=>{
    window.__consecutive=0;
    window.__nativeProbe.onCameraLayout=instance=>{
      if(instance.props.device.id!=='front')return;
      window.__nativeProbe.onCameraLayout=null;window.__consecutive++;
      window.fixture.update({camera:'back',trackMaxJump:4},false);
    };
    window.fixture.update({camera:'front'});
  });await settle(page);
  const after=await state(page);assert.equal(await page.evaluate(()=>window.__consecutive),1);assert.equal(currentCamera(after).device,'back');
  assert.notEqual(after.camera,before.camera);assert.equal(tracks(after).filter(t=>t.length===0).length,1);
  await frame(page);const fresh=await state(page);assert.notEqual(last(fresh)[0].id,last(before)[0].id);assert.equal(scans(fresh).length,1);
});
add('reset plus nested frame owns the pending spatial notification', 'No obsolete A after newer B; reset retains source but refreshes spatial observation ID and duplicate eligibility.', async page => {
  await mount(page);const before=await state(page);
  await page.evaluate(codes=>window.fixture.onScanAction=()=>{window.fixture.onScanAction=null;window.fixture.control('reset');window.fixture.frame(codes)},[code('B')]);
  await frame(page);const after=await state(page);sameOwner(before,after);assert.deepEqual(scans(after).map(s=>s.map(c=>c.data)),[['A'],['B']]);
  assert.deepEqual(last(after).map(t=>t.data),['B']);assert.ok(!tracks(after).some(t=>t.some(v=>v.data==='A')));
  await frame(page,[code('A')]);assert.deepEqual(scans(await state(page)).at(-1).map(c=>c.data),['A']);
});
for(const expired of [false,true])add(`nested ${expired?'expired':'no-change'} spatial blank`, 'No-change blank keeps pending notification; expired blank replaces it with one empty list.', async page => {
  await mount(page);
  await page.evaluate(expired=>window.fixture.onScanAction=()=>{window.fixture.onScanAction=null;if(expired)window.fixture.time(501);window.fixture.empty()},expired);
  await frame(page);const value=await state(page);assert.equal(scans(value).length,1);
  assert.deepEqual(tracks(value).map(t=>t.map(v=>v.data)),expired?[[]]:[['A']]);
});
add('nested rejected budget frame preserves pending history and novel report', 'Failed frame does not change delivery, consume B duplicate history or mutate IDs.', async page => {
  await mount(page,{trackMaxAssociationWork:1});
  await page.evaluate(codes=>window.fixture.onScanAction=()=>{window.fixture.onScanAction=null;window.fixture.frame(codes)},[code('A'),code('B',300)]);
  await frame(page);const failed=await state(page);assert.equal(errors(failed).length,1);assert.deepEqual(tracks(failed).map(t=>t.map(v=>v.data)),[['A']]);
  const id=last(failed)[0].id;await frame(page,[code('B',300)]);const after=await state(page);assert.equal(scans(after).at(-1)[0].data,'B');assert.equal(last(after)[0].id,id);
});
add('rejected nested frame onError reset cancels obsolete outer track', 'A failed nested frame alone preserves pending delivery; its synchronous reset callback explicitly supersedes it.', async page => {
  await mount(page,{trackMaxAssociationWork:1});
  await page.evaluate(codes=>{
    window.fixture.onErrorAction=()=>{window.fixture.onErrorAction=null;window.fixture.control('reset')};
    window.fixture.onScanAction=()=>{window.fixture.onScanAction=null;window.fixture.frame(codes)};
  },[code('A'),code('B',300)]);
  await frame(page);const reset=await state(page);assert.equal(errors(reset).length,1);assert.deepEqual(tracks(reset),[]);
  await frame(page,[code('B')]);const next=await state(page);assert.deepEqual(last(next).map(t=>t.data),['B']);assert.deepEqual(scans(next).map(s=>s.map(t=>t.data)),[['A'],['B']]);
});
for(const boundary of ['orientation','axis'])add(`throwing nested ROI preserves accepted owner but ${boundary} still resets coordinates`, 'Normalization rejection does not prevent real native preview/view-axis coordinate facts from clearing and rekeying accepted spatial observations.', async page => {
  await mount(page);await page.evaluate(()=>window.fixture.layout(390,844));await frame(page);await page.evaluate(()=>window.fixture.orientation('portrait'));const before=await state(page);
  await page.evaluate(()=>{const roi={y:0,width:1,height:1};Object.defineProperty(roi,'x',{get(){throw new Error('nested ROI getter rejected')}});window.fixture.update({camera:'front',scanArea:roi})});
  const rejected=await state(page);sameOwner(before,rejected);assert.equal(currentCamera(rejected).device,'back');assert.equal(errors(rejected).length,1);
  await frame(page);const continued=await state(page);assert.equal(last(continued)[0].id,last(before)[0].id);assert.equal(last(continued)[0].count,2);
  await page.evaluate(boundary=>boundary==='orientation'?window.fixture.orientation('portrait-upside-down'):window.fixture.layout(860,400),boundary);
  const changed=await state(page);assert.notEqual(changed.camera,before.camera,'External coordinate fact must replace spatial source even while ROI getter rejects');assert.deepEqual(last(changed),[]);assert.equal(tracks(changed).filter(t=>t.length===0).length,1);
  await frame(page,[code('A')],boundary==='axis'?{width:1280,height:720}:undefined);const fresh=await state(page);assert.notEqual(last(fresh)[0].id,last(before)[0].id);assert.equal(scans(fresh).length,1);
  await page.evaluate(()=>window.fixture.update({scanArea:undefined,camera:'front'}));const recovered=await state(page);assert.equal(currentCamera(recovered).device,'front');assert.notEqual(recovered.camera,fresh.camera);
  await frame(page,[code('RECOVERED')]);assert.equal(scans(await state(page)).at(-1)[0].data,'RECOVERED');
});
add('malformed frame preserves overlay dimensions, history and IDs', 'Frame UI updates only after successful spatial processing.', async page => {
  await mount(page);await page.evaluate(()=>window.fixture.layout(390,844));await frame(page);const before=await state(page);
  await frame(page,[code('B')],{width:0,height:1280});const rejected=await state(page);assert.equal(errors(rejected).length,1);assert.deepEqual(tracks(rejected),tracks(before));assert.deepEqual(rejected.boundary.overlay,before.boundary.overlay);
  await frame(page);const after=await state(page);assert.equal(last(after)[0].id,last(before)[0].id);assert.equal(last(after)[0].count,2);assert.equal(scans(after).length,1);
});
add('blank intrinsic resize is admitted with full upright dimensions', 'Blank changed dimensions clear observations without consuming duplicate history.', async page => {
  await mount(page);await frame(page);const before=await state(page);
  await page.evaluate(()=>window.fixture.empty({width:1440,height:2560}));assert.deepEqual(last(await state(page)),[]);
  await frame(page,[code('A',40,40,200)],{width:1440,height:2560});const after=await state(page);assert.notEqual(last(after)[0].id,last(before)[0].id);assert.equal(scans(after).length,1);
  assert.deepEqual(last(after)[0].frameSize,{width:1440,height:2560});
});
add('ROI keeps full-frame coordinates and excluded frame can expire tracks', 'ROI is selection, not crop coordinates; excluded frames retain source dimensions.', async page => {
  await mount(page,{scanArea:{x:0,y:0,width:.5,height:1}});await frame(page,[code('A',20),code('OUT',500)]);
  const before=await state(page);assert.deepEqual(last(before).map(t=>t.data),['A']);assert.deepEqual(last(before)[0].frameSize,{width:720,height:1280});assert.equal(last(before)[0].location.topLeft.x,20);
  await page.evaluate(()=>window.fixture.time(501));await frame(page,[code('OUT',500)]);assert.deepEqual(last(await state(page)),[]);assert.equal(scans(await state(page)).length,1);
});
add('source clear callback frames current source without a trailing empty', 'Pending clear is consumed before calling app code.', async page => {
  await mount(page);await frame(page);
  await page.evaluate(codes=>window.fixture.onTrackAction=list=>{if(list.length)return;window.fixture.onTrackAction=null;window.fixture.directFrame(codes)},[code('B')]);
  await update(page,{camera:'front'});const value=await state(page);assert.equal(tracks(value).filter(t=>t.length===0).length,1);assert.deepEqual(last(value).map(t=>t.data),['B']);
});
add('source clear callback reset and replacement frame supersede old continuation', 'Full reset owns history; a replacement list cannot be followed by an obsolete empty.', async page => {
  await mount(page);await frame(page);
  await page.evaluate(codes=>window.fixture.onTrackAction=list=>{
    if(list.length)return;window.fixture.onTrackAction=null;window.fixture.directControl('reset');window.fixture.directFrame(codes);
  },[code('B')]);
  await update(page,{camera:'front'});const after=await state(page);assert.equal(tracks(after).filter(t=>t.length===0).length,1);assert.deepEqual(last(after).map(t=>t.data),['B']);
  await frame(page);assert.deepEqual(scans(await state(page)).map(s=>s.map(c=>c.data)),[['A'],['B'],['A']]);
});
add('source clear callback can restore prior source under a new policy', 'Callback-owned queued replacement remains current after the old clear delivery returns.', async page => {
  await mount(page);await frame(page);const before=await state(page);
  await page.evaluate(()=>window.fixture.onTrackAction=list=>{if(list.length)return;window.fixture.onTrackAction=null;window.fixture.update({camera:'back',trackMaxJump:4},false)});
  await update(page,{camera:'front'});await settle(page);const restored=await state(page);assert.equal(currentCamera(restored).device,'back');assert.notEqual(restored.camera,before.camera);
  assert.equal(tracks(restored).filter(t=>t.length===0).length,1);await frame(page);const fresh=await state(page);assert.equal(scans(fresh).length,1);assert.notEqual(last(fresh)[0].id,last(before)[0].id);
});
add('rejection callback can queue a newer valid source proposal', 'Old rejection continuation cannot overwrite callback-owned accepted source.', async page => {
  await mount(page);await frame(page);
  await page.evaluate(()=>{window.fixture.onErrorAction=()=>{window.fixture.onErrorAction=null;window.fixture.update({camera:'front',trackMaxJump:4},false)};window.fixture.update({camera:'front',trackMaxJump:-1})});
  await settle(page);const value=await state(page);assert.equal(errors(value).length,1);assert.equal(currentCamera(value).device,'front');
  await frame(page,[code('B')]);assert.equal(scans(await state(page)).at(-1)[0].data,'B');
});
add('accepted source unavailability flushes one clear without a child', 'No-source commit cannot wait indefinitely for activation; initial absence fabricates nothing.', async page => {
  await mount(page);await frame(page);await page.evaluate(()=>window.fixture.setDevices([]));await settle(page);const unavailable=await state(page);
  assert.equal(unavailable.camera,null);assert.deepEqual(last(unavailable),[]);assert.equal(tracks(unavailable).filter(t=>t.length===0).length,1);
  await page.evaluate(()=>window.fixture.setDevices([]));assert.equal(tracks(await state(page)).filter(t=>t.length===0).length,1);
});
add('accepted device removal still gates source when a mixed policy proposal is invalid', 'External availability overrides rejected operational proposals; old callbacks stay rejected and one clear is delivered.', async page => {
  await mount(page);await frame(page);const before=await state(page);
  await page.evaluate(()=>{window.__nativeProbe.devices=[];window.fixture.update({camera:'front',trackMaxJump:null,duplicateFilter:0})});await settle(page);
  const unavailable=await state(page);assert.equal(unavailable.camera,null);assert.deepEqual(last(unavailable),[]);assert.equal(tracks(unavailable).filter(t=>t.length===0).length,1);
  await page.evaluate(({id,codes})=>window.fixture.frame(codes,undefined,id),{id:before.camera,codes:[code('OLD')]});assert.deepEqual((await state(page)).events,unavailable.events);
  await page.evaluate(()=>{window.__nativeProbe.devices=[{id:'back',position:'back',hasTorch:true},{id:'front',position:'front',hasTorch:true}];window.fixture.update({camera:'back',trackMaxJump:3,duplicateFilter:-1})});
  await frame(page);const recovered=await state(page);assert.equal(last(recovered).length,1);assert.notEqual(last(recovered)[0].id,last(before)[0].id);assert.equal(scans(recovered).length,1);
});
add('actual permission loss gates an accepted source despite invalid policy', 'Permission hook loss stops the native stand-in immediately, clears once, then permits recovery.', async page => {
  await mount(page);await frame(page);const before=await state(page);
  await page.evaluate(()=>{window.__nativeProbe.permission=false;window.fixture.update({camera:'front',trackMaxAssociationWork:null})});await settle(page);await settle(page);
  const denied=await state(page);assert.equal(denied.camera,null);assert.deepEqual(last(denied),[]);assert.equal(tracks(denied).filter(t=>t.length===0).length,1);
  assert.ok(errors(denied).some(e=>e.error.code==='camera-permission-denied'));
  await page.evaluate(({id,codes})=>window.fixture.frame(codes,undefined,id),{id:before.camera,codes:[code('OLD')]});assert.deepEqual((await state(page)).events,denied.events);
  await page.evaluate(()=>{window.__nativeProbe.permission=true;window.fixture.update({camera:'back',trackMaxAssociationWork:250000})});await settle(page);
  await page.waitForFunction(()=>window.fixture.currentCamera()!==null,null,{timeout:5000});await frame(page);
  const recovered=await state(page);assert.notEqual(last(recovered)[0].id,last(before)[0].id);assert.equal(scans(recovered).length,1);
});
add('initial missing device does not fabricate a track clear and later activates', 'No-source start has no pending clear to wait forever.', async page => {
  await page.evaluate(()=>{window.__nativeProbe.devices=[];window.fixture.mount()});await settle(page);const absent=await state(page);
  assert.equal(absent.camera,null);assert.deepEqual(tracks(absent),[]);assert.deepEqual(scans(absent),[]);
  await page.evaluate(()=>window.fixture.setDevices([{id:'back',position:'back',hasTorch:true},{id:'front',position:'front',hasTorch:true}]));
  await frame(page);assert.equal(last(await state(page)).length,1);
});
add('output orientation alone preserves scanner source and spatial identity', 'Installed native code-scanner coordinates follow preview orientation, not photo/video output orientation.', async page => {
  await mount(page);await frame(page);const before=await state(page);
  await page.evaluate(()=>window.fixture.orientation('landscape-left',undefined,true));const after=await state(page);
  sameOwner(before,after);assert.deepEqual(tracks(after),tracks(before));assert.deepEqual(after.boundary.overlay,before.boundary.overlay);
  await frame(page);const continued=await state(page);assert.equal(last(continued)[0].id,last(before)[0].id);assert.equal(last(continued)[0].count,2);
});
add('same-axis layout preserves IDs while true axis and orientation clear/rekey', 'Initial orientation establishes baseline; later same-dimension 180 change is a boundary.', async page => {
  await mount(page);await page.evaluate(()=>window.fixture.layout(390,844));await frame(page);await page.evaluate(()=>window.fixture.orientation('portrait'));const before=await state(page);
  await page.evaluate(()=>window.fixture.layout(400,860));await frame(page);const same=await state(page);sameOwner(before,same);assert.equal(last(same)[0].id,last(before)[0].id);
  await page.evaluate(()=>window.fixture.layout(860,400));const axis=await state(page);assert.notEqual(axis.camera,same.camera);assert.deepEqual(last(axis),[]);
  await frame(page,[code('A')],{width:1280,height:720});const newTrack=await state(page);assert.notEqual(last(newTrack)[0].id,last(before)[0].id);
  await page.evaluate(()=>window.fixture.orientation('portrait-upside-down'));const rotated=await state(page);assert.notEqual(rotated.camera,newTrack.camera);assert.deepEqual(last(rotated),[]);
  const count=rotated.boundary.cameras.length;await page.evaluate(()=>window.fixture.orientation('portrait-upside-down'));assert.equal((await state(page)).boundary.cameras.length,count);
});

const bundle=await build({absWorkingDir:root,stdin:{contents:app,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',metafile:true,
  define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'native-boundaries',setup(builder){
    builder.onResolve({filter:/^react(?:\/jsx(?:-dev)?-runtime)?$/},args=>({path:dependency.resolve(args.path)}));
    builder.onResolve({filter:/^react-native$/},()=>({path:'native',namespace:'boundary'}));
    builder.onResolve({filter:/^react-native-vision-camera$/},()=>({path:'camera',namespace:'boundary'}));
    builder.onResolve({filter:/\.\/ScannerOverlay$/},()=>({path:'overlay',namespace:'boundary'}));
    builder.onLoad({filter:/.*/,namespace:'boundary'},({path:name})=>({loader:'tsx',resolveDir:root,contents:boundaries[name]}));
  }}]});

const spatialBrowser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined});
try {
  for (const item of cases) {
    const context=await spatialBrowser.newContext();
    const page=await context.newPage(),errors=[],requests=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
    context.on('request',r=>requests.push(r.url()));
    try {
      await context.route('**/*',r=>r.abort());await page.setContent('<!doctype html><div id="app"></div>');
      await page.evaluate(()=>{let elapsed=0,wall=1800000000000,next=0;const intervals=new Map();Date.now=()=>wall;
        Object.defineProperty(performance,'now',{value:()=>elapsed,configurable:true});
        window.setInterval=(callback,ms)=>{const id=++next;intervals.set(id,{callback,ms});return id};window.clearInterval=id=>intervals.delete(id);
        window.clock={set:(e,w)=>{elapsed=e;wall=w},tick:()=>{for(const {callback}of[...intervals.values()])callback()},state:()=>({elapsed,wall,intervals:intervals.size})};});
      await page.addScriptTag({content:boundaries.initialize});await page.addScriptTag({content:bundle.outputFiles[0].text});
      await item.run(page);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
      console.log(`  ✓ native spatial ${item.name}`);
    } finally {
      try {
        await page.evaluate(()=>window.fixture?.unmount());
        assert.deepEqual(await page.evaluate(()=>({attached:window.fixture?.state().attached??false,
          mountedCameras:[...window.__nativeProbe.instances.values()].filter(c=>c.mounted).length,intervals:window.clock.state().intervals})),
          {attached:false,mountedCameras:0,intervals:0});
        assert.deepEqual(errors,[]);
      } finally { await context.close(); }
    }
  }
} finally { await spatialBrowser.close(); }
}

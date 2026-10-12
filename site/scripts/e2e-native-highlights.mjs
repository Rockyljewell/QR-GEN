// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
// Actual QRGenScanner/NativeCameraSource/session/core/ScannerOverlay via ReactDOM.
// Native platform/views/timers and a MODELED VisionCamera4.7.3 stable-ref hook
// are boundaries. The separate external fixture uses the installed hook.
// Controlled elapsed clocks invoke actual captured component timer callbacks;
// these checks establish rendered DOM/style and component behavior, not a phone,
// native camera-driver/event provenance, native pixels or decoder accuracy.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const source = fileURLToPath(new URL('../../', import.meta.url));
const dependency = createRequire(new URL('../../packages/sdk/package.json', import.meta.url));
const { build } = dependency('esbuild');
const scannerPath = path.join(source, 'packages/react-native/src/QRGenScanner.tsx');
const overlayPath = path.join(source, 'packages/react-native/src/ScannerOverlay.tsx');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = file => path.resolve(file).toLowerCase();

function createBoundaries({ reactPath }) {
  const react = JSON.stringify(reactPath.replaceAll('\\', '/'));
  const initialize = `
    (()=>{
      const instances=new Map(),hooks=new Map(),callbacks=new WeakMap(),appListeners=new Set();
      const logs=[];let nextCamera=0,nextHook=0,nextView=0,elapsed=0,nextTimer=0;
      const timers=new Map(),timerLog=[];
      Date.now=()=>1800000000000+elapsed;
      Object.defineProperty(performance,'now',{configurable:true,value:()=>elapsed});
      const schedule=(type,callback,delay,args)=>{
        if(typeof callback!=='function')throw new Error('String timer boundary is not supported');
        const ms=Math.max(0,Number(delay)||0),id=++nextTimer;
        timers.set(id,{id,type,callback,delay:ms,due:elapsed+ms,args});
        timerLog.push({action:'register',id,type,delay:ms,at:elapsed});return id;
      };
      const cancel=id=>{const timer=timers.get(id);if(timer){timerLog.push({action:'cancel',id,type:timer.type,at:elapsed});timers.delete(id)}};
      window.setTimeout=(callback,delay,...args)=>schedule('timeout',callback,delay,args);
      window.clearTimeout=cancel;
      window.setInterval=(callback,delay,...args)=>schedule('interval',callback,delay,args);
      window.clearInterval=cancel;
      const fire=id=>{
        const timer=timers.get(id);
        if(!timer||timer.due>elapsed)throw new Error('Timer is absent or not due: '+id);
        if(timer.type==='timeout')timers.delete(id);else timer.due=elapsed+timer.delay;
        timerLog.push({action:'fire',id,type:timer.type,delay:timer.delay,at:elapsed});
        timer.callback(...timer.args);
      };
      const p=window.__nativeProbe={
        instances,hooks,callbacks,appListeners,logs,layout:null,animations:0,
        devices:[{id:'back',position:'back',hasTorch:true},{id:'front',position:'front',hasTorch:true}],
        permission:true,requestPermission:()=>Promise.resolve(true),
        nextCamera:()=>++nextCamera,nextHook:()=>++nextHook,nextView:()=>++nextView,
        describe(props){return {device:props.device?.id??null,isActive:!!props.isActive,
          codeTypes:[...(props.codeScanner?.codeTypes??[])],hook:callbacks.get(props.codeScanner?.onCodeScanned)??null,
          torch:props.torch,resizeMode:props.resizeMode}},
        appState(value){for(const listener of [...appListeners])listener(value)},
        snapshot(){return {cameras:[...instances.values()].map(c=>({id:c.id,mounted:c.mounted,...this.describe(c.props)})),
          hooks:[...hooks.values()].map(h=>({id:h.id,mounted:h.mounted})),logs:[...logs],
          layoutAttached:typeof this.layout==='function',appListeners:appListeners.size,animations:this.animations,
          permission:this.permission,devices:this.devices.map(d=>({...d}))}},
      };
      window.clock={
        advanceTo(value){if(!Number.isFinite(value)||value<elapsed)throw new Error('Clock must advance monotonically');elapsed=value},
        fireInterval(id){const timer=timers.get(id);if(timer?.type!=='interval')throw new Error('Expected actual interval');fire(id)},
        fireDueTimeouts(){let count=0;for(;;){
          const timer=[...timers.values()].filter(t=>t.type==='timeout'&&t.due<=elapsed).sort((a,b)=>a.due-b.due||a.id-b.id)[0];
          if(!timer)return;if(++count>20)throw new Error('Unexpected unbounded timeout scheduling');fire(timer.id);
        }},
        state(){return {elapsed,wall:Date.now(),timers:[...timers.values()].map(({id,type,delay,due})=>({id,type,delay,due})),log:[...timerLog]}},
      };
    })();
  `;
  const native = `
    import React,{useLayoutEffect,useRef} from ${react};
    // Generic native style-array flattening, unrelated to barcode/highlight data.
    const flatten=style=>{
      const result={};const visit=value=>{if(Array.isArray(value)){value.forEach(visit);return}if(value&&typeof value==='object')Object.assign(result,value)};
      visit(style);return result;
    };
    export function View({children,onLayout,style,pointerEvents,...rest}){
      const id=useRef(null);if(id.current===null)id.current=window.__nativeProbe.nextView();
      useLayoutEffect(()=>{
        if(!onLayout)return;window.__nativeProbe.layout=onLayout;
        return()=>{if(window.__nativeProbe.layout===onLayout)window.__nativeProbe.layout=null};
      },[onLayout]);
      const applied=flatten(style);
      // Generic native View defaults: relative layout, solid zero-width borders,
      // and borders included in explicit dimensions. No geometry is invented.
      return React.createElement('div',{
        'data-native-view':id.current,'data-native-layout':onLayout?'true':undefined,
        'data-native-style':JSON.stringify(applied),style:{boxSizing:'border-box',position:'relative',borderStyle:'solid',borderWidth:0,...applied},
      },children);
    }
    export const Text=View,Pressable=View;
    export const Platform={OS:'ios',Version:'17.4'};
    export const StyleSheet={create:value=>value,flatten,
      absoluteFill:{position:'absolute',left:0,top:0,right:0,bottom:0}};
    export const AppState={currentState:'active',addEventListener(type,callback){
      if(type!=='change')throw new Error('Unexpected AppState event');
      const listeners=window.__nativeProbe.appListeners;listeners.add(callback);
      return {remove(){listeners.delete(callback)}};
    }};
    export const Dimensions={get:()=>({width:390,height:844})};
    export const Linking={openSettings:()=>Promise.resolve()};
    export const Vibration={vibrate(){throw new Error('Unexpected feedback branch')}};
    const unexpected=()=>{window.__nativeProbe.animations++;throw new Error('Unexpected Animated branch outside frozen highlight scope')};
    export const Animated={View,Value:class{constructor(){unexpected()}},
      timing:unexpected,sequence:unexpected,parallel:unexpected,delay:unexpected,loop:unexpected};
  `;
  const camera = `
    import React,{useCallback,useLayoutEffect,useMemo,useRef} from ${react};
    // Modeled VC4.7.3 hook only: stable wrapper forwards to the latest render ref.
    // The real QRGen scanner/child/overlay execute; no native dependency is loaded.
    function useModeledCodeScanner({onCodeScanned,...options}){
      const callbackRef=useRef(onCodeScanned);callbackRef.current=onCodeScanned;
      const onCodeScannedStable=useCallback((codes,frame)=>callbackRef.current(codes,frame),[]);
      return useMemo(()=>({...options,onCodeScanned:onCodeScannedStable}),[JSON.stringify(options),onCodeScannedStable]);
    }
    export function useCameraPermission(){const p=window.__nativeProbe;return {hasPermission:p.permission,requestPermission:p.requestPermission}}
    export function useCameraDevices(){return window.__nativeProbe.devices}
    export function useCameraDevice(position){return window.__nativeProbe.devices.find(d=>d.position===position)}
    export function useCodeScanner(options){
      const id=useRef(null);if(id.current===null)id.current=window.__nativeProbe.nextHook();
      const actual=useModeledCodeScanner(options);
      window.__nativeProbe.callbacks.set(actual.onCodeScanned,id.current);
      useLayoutEffect(()=>{
        const p=window.__nativeProbe;p.hooks.set(id.current,{id:id.current,mounted:true,callback:actual.onCodeScanned});
        p.logs.push({kind:'hook-layout',id:id.current});
      });
      useLayoutEffect(()=>()=>{
        const p=window.__nativeProbe,h=p.hooks.get(id.current);if(h)h.mounted=false;
        p.logs.push({kind:'hook-unmount',id:id.current});
      },[]);
      return actual;
    }
    export class Camera extends React.Component{
      constructor(props){
        super(props);this.id=window.__nativeProbe.nextCamera();this.mounted=false;
        // Saved transports remain per-instance and call the modeled stable-hook output.
        this.frame=(codes,frame)=>{
          window.__nativeProbe.logs.push({kind:'frame-delivery',id:this.id,mounted:this.mounted,at:performance.now(),values:codes.map(c=>c.value)});
          this.props.codeScanner?.onCodeScanned(codes,frame);
        };
        this.ready=()=>this.props.onInitialized?.();
      }
      componentDidMount(){this.mounted=true;window.__nativeProbe.instances.set(this.id,this);window.__nativeProbe.logs.push({kind:'camera-mount',id:this.id})}
      componentDidUpdate(){window.__nativeProbe.logs.push({kind:'camera-update',id:this.id})}
      componentWillUnmount(){this.mounted=false;window.__nativeProbe.logs.push({kind:'camera-unmount',id:this.id})}
      render(){return React.createElement('div',{'data-camera-instance':this.id,'data-active':String(this.props.isActive)})}
    }
  `;
  return { initialize, native, camera };
}

const requiredBundledSource = [
  "packages/react-native/src/QRGenScanner.tsx",
  "packages/react-native/src/ScannerOverlay.tsx",
  "packages/react-native/src/NativeCameraSource.tsx",
  "packages/react-native/src/session.ts",
  "packages/react-native/src/duplicateFilter.ts",
  "packages/react-native/src/tracker.ts",
  "packages/react-native/src/spatialAssociation.ts",
  "packages/react-native/src/durationClock.ts",
  "packages/react-native/src/geometry.ts",
  "packages/react-native/src/barcode.ts",
  "packages/react-native/src/visionCameraAdapter.ts",
  "packages/react-native/src/symbologies.ts",
  "packages/react-native/src/feedback.ts",
  "packages/react-native/src/color.ts",
  "packages/react-native/src/errors.ts",
  "packages/react-native/src/types.ts"
];
const expectedCaseIds = [
  "batch-immediate-hide-expiry-and-reenable-without-frame",
  "continuous-immediate-hide-before-real-linger",
  "batch-default-enabled-cosmetic-rebuild",
  "continuous-default-enabled-cosmetic-rebuild",
  "batch-initially-hidden-keeps-real-callbacks",
  "continuous-initially-hidden-keeps-real-callbacks",
  "batch-enabled-real-no-event-expiry",
  "continuous-enabled-real-linger-expiry",
  "batch-fresh-moved-detection-after-disabled-expiry-and-reenable",
  "continuous-fresh-moved-detection-after-real-linger-and-reenable",
  "batch-public-reset-clears-real-renderer",
  "continuous-public-reset-clears-real-renderer",
  "batch-public-stop-clears-real-renderer",
  "continuous-public-stop-clears-real-renderer"
];
const boundaries = createBoundaries({ reactPath: dependency.resolve('react') });
  const app = `
    import React,{createRef} from ${JSON.stringify(dependency.resolve('react'))};
    import {createRoot} from ${JSON.stringify(dependency.resolve('react-dom/client'))};
    import {flushSync} from ${JSON.stringify(dependency.resolve('react-dom'))};
    import {QRGenScanner} from ${JSON.stringify(scannerPath)};
    const root=createRoot(document.getElementById('app')),ref=createRef();
    const clone=value=>JSON.parse(JSON.stringify(value));
    let props={},events=[],unmounted=false;
    const scan=codes=>events.push({type:'scan',at:performance.now(),codes:clone(codes)});
    const track=tracks=>events.push({type:'track',at:performance.now(),tracks:clone(tracks)});
    const error=error=>events.push({type:'error',error:clone(error)});
    const ready=()=>events.push({type:'ready',at:performance.now()});
    const current=()=>[...window.__nativeProbe.instances.values()].filter(c=>c.mounted).at(-1);
    const commit=action=>flushSync(action);
    function render(){root.render(React.createElement(QRGenScanner,{...props,ref,onScan:scan,onTrack:track,onError:error,onReady:ready}))}
    function views(){
      const viewport=document.querySelector('[data-native-layout]'),base=viewport?.getBoundingClientRect();
      return {viewport:base?{x:base.x,y:base.y,width:base.width,height:base.height}:null,
        entries:[...document.querySelectorAll('[data-native-view]')].map(node=>{
          const style=JSON.parse(node.getAttribute('data-native-style')),rect=node.getBoundingClientRect(),computed=getComputedStyle(node);
          const ancestors=[];for(let parent=node.parentElement;parent;parent=parent.parentElement){
            const css=getComputedStyle(parent),bounds=parent.getBoundingClientRect();
            ancestors.push({display:css.display,visibility:css.visibility,opacity:css.opacity,overflowX:css.overflowX,overflowY:css.overflowY,
              rect:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}});
          }
          return {id:node.getAttribute('data-native-view'),style,
            rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
            relativeRect:base?{x:rect.x-base.x,y:rect.y-base.y,width:rect.width,height:rect.height}:null,
            ancestors,computed:{display:computed.display,visibility:computed.visibility,opacity:computed.opacity,overflow:computed.overflow,
              borderWidth:computed.borderTopWidth,borderStyle:computed.borderTopStyle,borderColor:computed.borderTopColor,
              backgroundColor:computed.backgroundColor,position:computed.position}};
        })};
    }
    window.fixture={
      mount(next={}){props={mode:'batch',symbologies:['qr'],duplicateFilter:0,showToast:false,viewfinder:'none',
        beep:false,vibrate:false,style:{width:390,height:844},...next};commit(render)},
      update(next){props={...props,...next};commit(render)},
      layout(){commit(()=>{if(!window.__nativeProbe.layout)throw new Error('No actual onLayout');window.__nativeProbe.layout({nativeEvent:{layout:{width:390,height:844}}})})},
      frame(codes,frame={width:390,height:844},id){commit(()=>{const camera=id===undefined?current():window.__nativeProbe.instances.get(id);if(!camera)throw new Error('No native Camera boundary');camera.frame(codes,frame)})},
      ready(){commit(()=>current().ready())},
      advanceTo(value){window.clock.advanceTo(value)},
      tick(){commit(()=>{const timers=window.clock.state().timers.filter(t=>t.type==='interval');if(timers.length!==1)throw new Error('Expected one actual interval');window.clock.fireInterval(timers[0].id)})},
      fireDueTimeouts(){commit(()=>window.clock.fireDueTimeouts())},
      control(name){commit(()=>ref.current[name]())},
      state(){const camera=current();return {events:clone(events),attached:!!ref.current,
        camera:camera?.id??null,hook:window.__nativeProbe.callbacks.get(camera?.props.codeScanner?.onCodeScanned)??null,
        boundary:window.__nativeProbe.snapshot(),clock:window.clock.state(),views:views()}},
      unmount(){if(!unmounted){unmounted=true;commit(()=>root.unmount())}},
      savedHookAfterUnmount(id,codes){commit(()=>window.__nativeProbe.hooks.get(id)?.callback(codes,{width:390,height:844}))},
    };
  `;
  const loaded = new Map();
  const bundle = await build({
    stdin: { contents: app, resolveDir: source, loader: 'tsx' }, absWorkingDir: source,
    metafile: true, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic',
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', useDefineForClassFields: true } },
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'capture-exact-consumed-file-bytes', setup(builder) {
      builder.onLoad({ filter: /\.(?:[cm]?[jt]sx?|json)$/, namespace: 'file' }, async value => {
        const bytes = await readFile(value.path), extension = path.extname(value.path).slice(1);
        const entry = { path: path.resolve(value.path), sha256: hash(bytes), bytes: bytes.length };
        const prior = loaded.get(identity(value.path));
        if (prior) assert.equal(prior.sha256, entry.sha256, 'Changed while loading: ' + value.path);
        loaded.set(identity(value.path), entry);
        return { contents: bytes, loader: extension === 'json' ? 'json' : extension === 'tsx' ? 'tsx' : extension === 'ts' ? 'ts' : extension === 'jsx' ? 'jsx' : 'js', resolveDir: path.dirname(value.path) };
      });
    } }, { name: 'native-boundaries-only', setup(builder) {
      builder.onResolve({ filter: /^react(?:\/jsx(?:-dev)?-runtime)?$/ }, value => ({ path: dependency.resolve(value.path) }));
      builder.onResolve({ filter: /^react-native$/ }, () => ({ path: 'native', namespace: 'rn-boundary' }));
      builder.onResolve({ filter: /^react-native-vision-camera$/ }, () => ({ path: 'camera', namespace: 'rn-boundary' }));
      builder.onLoad({ filter: /.*/, namespace: 'rn-boundary' }, ({ path: name }) => ({ loader: 'tsx', resolveDir: source, contents: boundaries[name] }));
    } }],
  });
  const emittedBytes = new Map();
  for (const details of Object.values(bundle.metafile.outputs)) {
    for (const [input, contribution] of Object.entries(details.inputs))
      emittedBytes.set(input, (emittedBytes.get(input) || 0) + contribution.bytesInOutput);
  }
  const closure = [];
  for (const [input, details] of Object.entries(bundle.metafile.inputs)) {
    if (input === '<stdin>' || input.startsWith('rn-boundary:')) continue;
    const captured = loaded.get(identity(path.resolve(source, input)));
    assert(captured, 'Metafile input was not captured before compilation: ' + input);
    assert.equal(details.bytes, captured.bytes, 'Metafile/captured byte count mismatch: ' + input);
    closure.push({ ...captured, metafileInput: input, metafileBytes: details.bytes, bytesInOutput: emittedBytes.get(input) || 0 });
  }
  closure.sort((a, b) => a.path.localeCompare(b.path));
  assert.equal(closure.length, loaded.size, 'Every consumed file must be reconciled');
  for (const file of requiredBundledSource.map(relative => path.join(source, relative))) {
    assert(loaded.has(identity(file)), 'Actual required implementation not bundled: ' + file);
    assert(closure.find(entry => identity(entry.path) === identity(file))?.bytesInOutput > 0,
      'Actual required implementation has no emitted bundle bytes: ' + file);
  }
  const verifyClosure = async () => {
    const hashes = {};
    for (const entry of closure) {
      hashes[entry.path] = hash(await readFile(entry.path));
      assert.equal(hashes[entry.path], entry.sha256, 'Consumed file changed: ' + entry.path);
    }
    return hashes;
  };
  const afterBundleHashes = await verifyClosure();
  const bundleBytes = Buffer.from(bundle.outputFiles[0].contents), bundleSha256 = hash(bundleBytes);
  const cases = [], add = (id, run, regression = null) => cases.push({ id, run, regression });
  const code = (value = 'A', x = 140, y = 340) => ({ type: 'qr', value,
    corners: [{ x, y }, { x: x + 80, y }, { x: x + 80, y: y + 80 }, { x, y: y + 80 }] });
  const A = code(), B = code('B', 250, 540);
  const aRect = { x: 136, y: 336, width: 88, height: 88 }, bRect = { x: 246, y: 536, width: 88, height: 88 };
  const state = page => page.evaluate(() => window.fixture.state());
  // Observe painted geometry generically; never inspect overlay props or payloads.
  const outlines = value => value.views.entries.filter(entry => {
    if (!(entry.style.position === 'absolute' && Number(entry.style.borderWidth) > 0
      && Number(entry.style.width) > 0 && Number(entry.style.height) > 0 && entry.rect.width > 0 && entry.rect.height > 0)) return false;
    if (entry.computed.display === 'none' || entry.computed.visibility === 'hidden' || Number(entry.computed.opacity) <= 0
      || entry.computed.borderStyle === 'none' || Number.parseFloat(entry.computed.borderWidth) <= 0) return false;
    let left = entry.rect.x, top = entry.rect.y, right = left + entry.rect.width, bottom = top + entry.rect.height;
    for (const ancestor of entry.ancestors) {
      if (ancestor.display === 'none' || ancestor.visibility === 'hidden' || Number(ancestor.opacity) <= 0) return false;
      if (['hidden', 'clip', 'scroll', 'auto'].includes(ancestor.overflowX)) {
        left = Math.max(left, ancestor.rect.x);right = Math.min(right, ancestor.rect.x + ancestor.rect.width);
      }
      if (['hidden', 'clip', 'scroll', 'auto'].includes(ancestor.overflowY)) {
        top = Math.max(top, ancestor.rect.y);bottom = Math.min(bottom, ancestor.rect.y + ancestor.rect.height);
      }
    }
    return right > left && bottom > top;
  });
  const count = value => outlines(value).length;
  const scans = value => value.events.filter(event => event.type === 'scan');
  const tracks = value => value.events.filter(event => event.type === 'track');
  const errors = value => value.events.filter(event => event.type === 'error');
  const owner = (before, after) => {
    assert.equal(after.camera, before.camera, 'Camera instance must remain');
    assert.equal(after.hook, before.hook, 'Modeled stable hook callback must remain');
    assert.deepEqual(after.boundary.devices, before.boundary.devices);
    assert.equal(after.boundary.permission, before.boundary.permission);
    assert.equal(after.boundary.cameras.length, before.boundary.cameras.length);
    assert.equal(after.boundary.hooks.length, before.boundary.hooks.length);
  };
  const positive = (value, expected = aRect) => {
    assert.equal(count(value), 1, 'Positive visible-outline precondition');
    const entry = outlines(value)[0], viewport = value.views.viewport;
    assert.deepEqual(viewport && { width: viewport.width, height: viewport.height }, { width: 390, height: 844 });
    assert.deepEqual(entry.relativeRect, expected, 'Actual emitted DOM bounds from identity-sized frame/view');
    assert.equal(entry.computed.borderWidth, '2px');
    assert.equal(entry.computed.borderStyle, 'solid');
    assert.notEqual(entry.computed.borderColor, 'rgba(0, 0, 0, 0)');
    assert.notEqual(entry.computed.display, 'none');assert.notEqual(entry.computed.visibility, 'hidden');
    assert(Number(entry.computed.opacity) > 0);
    assert(expected.x >= 0 && expected.y >= 0 && expected.x + expected.width <= viewport.width && expected.y + expected.height <= viewport.height);
    assert.equal(value.boundary.animations, 0);
  };
  const functional = (value, mode, payload = 'A') => {
    assert.deepEqual(errors(value), []);
    assert.equal(scans(value).at(-1)?.codes[0]?.data, payload, 'Actual onScan admission');
    if (mode === 'batch') assert.equal(tracks(value).at(-1)?.tracks[0]?.data, payload, 'Actual onTrack admission');
    else assert.deepEqual(tracks(value), [], 'Continuous mode does not invent batch callbacks');
  };
  const observe = async (page, evidence, stage) => {
    const value = await state(page);evidence.push({ stage, value });return value;
  };
  const mount = async (page, mode, extra = {}) => {
    await page.evaluate(props => window.fixture.mount(props), { mode, ...extra });
    await page.waitForFunction(() => window.fixture.state().camera !== null, null, { timeout: 5000 });
    await page.evaluate(() => { window.fixture.layout();window.fixture.ready() });
    const value = await state(page);
    assert(value.camera !== null && value.hook !== null && value.attached);
    assert.equal(value.boundary.appListeners, 1);assert(value.boundary.layoutAttached);
    assert.equal(value.boundary.cameras.filter(camera => camera.mounted).length, 1);
    assert.equal(value.boundary.hooks.filter(hook => hook.mounted).length, 1);
    assert.equal(value.events.filter(event => event.type === 'ready').length, 1);
    assert.deepEqual(errors(value), []);
  };
  const frame = (page, codes = [A]) => page.evaluate(codes => window.fixture.frame(codes), codes);
  const update = (page, props) => page.evaluate(props => window.fixture.update(props), props);
  const expireBatch = async page => {
    await page.evaluate(() => { window.fixture.advanceTo(501);window.fixture.tick() });
    const expired = await state(page);
    assert.deepEqual(tracks(expired).at(-1)?.tracks, [], 'Actual production session tick must emit empty tracks');
    assert.equal(tracks(expired).at(-1)?.at, 501);
    assert.equal(expired.clock.log.filter(item => item.action === 'fire' && item.type === 'interval').length, 1);
  };
  const expireLinger = async page => {
    await page.evaluate(() => { window.fixture.advanceTo(280);window.fixture.fireDueTimeouts() });
    const expired = await state(page);
    assert.equal(expired.clock.log.filter(item => item.action === 'fire' && item.type === 'timeout').length, 1, 'Execute actual scheduled linger callback');
    assert.equal(count(expired), 0, 'Actual eventual linger clearing control');
    assert.deepEqual(tracks(expired), []);
  };
  const finishHiddenLinger = async page => {
    await page.evaluate(() => { window.fixture.advanceTo(280);window.fixture.fireDueTimeouts() });
    const expired = await state(page), registrations = expired.clock.log.filter(item => item.action === 'register' && item.type === 'timeout');
    assert.equal(registrations.length, 1);assert.equal(registrations[0].delay, 280);
    const terminal = expired.clock.log.filter(item => item.id === registrations[0].id && ['cancel', 'fire'].includes(item.action));
    assert.equal(terminal.length, 1, 'Original linger is canceled on hide or safely fires by its deadline');
    assert.equal(expired.clock.timers.filter(timer => timer.type === 'timeout').length, 0);
    assert.equal(count(expired), 0);assert.deepEqual(tracks(expired), []);
  };

  add('batch-immediate-hide-expiry-and-reenable-without-frame', async (page, evidence) => {
    await mount(page, 'batch');await frame(page);
    const before = await observe(page, evidence, 'positive-baseline');positive(before);functional(before, 'batch');
    assert.equal(before.clock.timers.filter(timer => timer.type === 'timeout').length, 0);
    await update(page, { showHighlights: false });
    const hidden = await observe(page, evidence, 'disabled-committed-immediately');owner(before, hidden);
    assert.deepEqual(hidden.events, before.events);assert.equal(hidden.clock.elapsed, 0);
    await expireBatch(page);
    const expired = await observe(page, evidence, 'disabled-real-expiry-empty-track');owner(before, expired);
    await update(page, { showHighlights: true });
    const enabled = await observe(page, evidence, 'reenabled-without-frame-after-proven-expiry');owner(before, enabled);
    assert.deepEqual(enabled.events, expired.events);
    assert.equal(enabled.boundary.logs.filter(item => item.kind === 'frame-delivery').length, 1);
    assert.deepEqual([count(hidden), count(expired), count(enabled)], [0, 0, 0], 'HIGHLIGHT_BATCH_HIDE_COUNTS');
  }, { marker: 'HIGHLIGHT_BATCH_HIDE_COUNTS', actual: [1, 1, 1], expected: [0, 0, 0], operator: 'deepStrictEqual' });
  add('continuous-immediate-hide-before-real-linger', async (page, evidence) => {
    await mount(page, 'continuous');await frame(page);
    const before = await observe(page, evidence, 'positive-baseline');positive(before);functional(before, 'continuous');
    const timeout = before.clock.timers.filter(timer => timer.type === 'timeout');
    assert.equal(timeout.length, 1);assert.equal(timeout[0].delay, 280);assert.equal(timeout[0].due, 280);
    await page.evaluate(() => window.fixture.advanceTo(100));await update(page, { showHighlights: false });
    const hidden = await observe(page, evidence, 'disabled-committed-before-linger');owner(before, hidden);
    assert.equal(hidden.clock.elapsed, 100);assert.deepEqual(hidden.events, before.events);
    assert.equal(hidden.clock.log.filter(item => item.action === 'fire').length, 0);
    await finishHiddenLinger(page);await observe(page, evidence, 'old-linger-fired-or-canceled-safely');
    assert.equal(count(hidden), 0, 'HIGHLIGHT_CONTINUOUS_HIDE_COUNT');
  }, { marker: 'HIGHLIGHT_CONTINUOUS_HIDE_COUNT', actual: 1, expected: 0, operator: 'strictEqual' });
  for (const mode of ['batch', 'continuous']) add(mode + '-default-enabled-cosmetic-rebuild', async (page, evidence) => {
    await mount(page, mode);await frame(page);
    const before = await observe(page, evidence, 'default-enabled-visible');positive(before);functional(before, mode);
    await update(page, { accentColor: '#123456' });
    const after = await observe(page, evidence, 'enabled-cosmetic-commit');owner(before, after);positive(after);
    assert.deepEqual(after.events, before.events);assert.equal(outlines(after)[0].style.borderColor, '#123456');
    assert.equal(outlines(after)[0].computed.borderColor, 'rgb(18, 52, 86)');
  });
  for (const mode of ['batch', 'continuous']) add(mode + '-initially-hidden-keeps-real-callbacks', async (page, evidence) => {
    await mount(page, mode, { showHighlights: false });await frame(page);
    const hidden = await observe(page, evidence, 'initially-hidden-real-detection');functional(hidden, mode);
    assert.equal(count(hidden), 0);assert.equal(hidden.clock.timers.filter(timer => timer.type === 'timeout').length, 0);
  });
  add('batch-enabled-real-no-event-expiry', async (page, evidence) => {
    await mount(page, 'batch');await frame(page);
    const before = await observe(page, evidence, 'enabled-before-expiry');positive(before);functional(before, 'batch');
    await expireBatch(page);const expired = await observe(page, evidence, 'enabled-real-expiry');owner(before, expired);
    assert.equal(count(expired), 0);assert.equal(scans(expired).length, scans(before).length);
  });
  add('continuous-enabled-real-linger-expiry', async (page, evidence) => {
    await mount(page, 'continuous');await frame(page);
    const before = await observe(page, evidence, 'enabled-before-linger');positive(before);functional(before, 'continuous');
    await expireLinger(page);const expired = await observe(page, evidence, 'enabled-real-linger');owner(before, expired);
    assert.equal(scans(expired).length, scans(before).length);
  });
  add('batch-fresh-moved-detection-after-disabled-expiry-and-reenable', async (page, evidence) => {
    await mount(page, 'batch');await frame(page);const before = await state(page);positive(before);functional(before, 'batch');
    await update(page, { showHighlights: false });await expireBatch(page);await update(page, { showHighlights: true });
    await observe(page, evidence, 'after-proven-empty-expiry-before-fresh-frame');
    await frame(page, [B]);const moved = await observe(page, evidence, 'fresh-moved-B-only');owner(before, moved);positive(moved, bRect);functional(moved, 'batch', 'B');
    assert.deepEqual(tracks(moved).at(-1).tracks.map(track => track.data), ['B']);
    assert.equal(scans(moved).length, 2);assert.equal(moved.boundary.logs.filter(item => item.kind === 'frame-delivery').length, 2);
  });
  add('continuous-fresh-moved-detection-after-real-linger-and-reenable', async (page, evidence) => {
    await mount(page, 'continuous');await frame(page);const before = await state(page);positive(before);functional(before, 'continuous');
    await update(page, { showHighlights: false });await finishHiddenLinger(page);await update(page, { showHighlights: true });
    await frame(page, [B]);const moved = await observe(page, evidence, 'fresh-moved-B-after-old-linger');owner(before, moved);positive(moved, bRect);functional(moved, 'continuous', 'B');
    assert.equal(scans(moved).length, 2);
  });
  for (const mode of ['batch', 'continuous']) add(mode + '-public-reset-clears-real-renderer', async (page, evidence) => {
    await mount(page, mode);await frame(page);const before = await state(page);positive(before);functional(before, mode);
    await page.evaluate(() => window.fixture.control('reset'));
    const reset = await observe(page, evidence, 'public-reset-committed');owner(before, reset);assert.equal(count(reset), 0);
    assert.deepEqual(reset.events, before.events, 'Reset itself does not fabricate an empty onTrack callback');
    await frame(page, [B]);const moved = await observe(page, evidence, 'fresh-moved-B-after-reset');positive(moved, bRect);functional(moved, mode, 'B');owner(before, moved);
    if (mode === 'batch') assert.deepEqual(tracks(moved).at(-1).tracks.map(track => track.data), ['B']);
  });
  for (const mode of ['batch', 'continuous']) add(mode + '-public-stop-clears-real-renderer', async (page, evidence) => {
    await mount(page, mode);await frame(page);const before = await state(page);positive(before);functional(before, mode);
    await page.evaluate(() => window.fixture.control('stop'));
    const stopped = await observe(page, evidence, 'public-stop-committed-after-effects');owner(before, stopped);assert.equal(count(stopped), 0);
    assert.equal(stopped.boundary.cameras.find(camera => camera.id === stopped.camera).isActive, false);
    assert.equal(stopped.clock.timers.filter(timer => timer.type === 'interval').length, 0);
    await frame(page, [B]);const ignored = await observe(page, evidence, 'saved-native-delivery-while-stopped');
    assert.deepEqual(ignored.events, stopped.events);assert.equal(count(ignored), 0);
  });
  assert.deepEqual(cases.map(item => item.id), expectedCaseIds, 'Executed matrix must preserve the ordered14 regression/control cases');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const results = [];
  let browserVersion, browserClosed = false;
  try {
    browserVersion = browser.version();
    for (const test of cases) {
      const context = await browser.newContext(), pageErrors = [], requests = [], evidence = [];
      let failure = null, cleanupFailure = null, observations = null, cleanup = null, contextClosed = false;
      try {
        const page = await context.newPage();
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()) });
        context.on('request', request => requests.push(request.url()));
        await context.route('**/*', route => route.abort());
        try {
          await page.setContent('<!doctype html><html><head><style>html,body{margin:0;padding:0}</style></head><body><div id="app"></div></body></html>');
          await page.addScriptTag({ content: boundaries.initialize });
          await page.addScriptTag({ content: bundleBytes.toString('utf8') });
          await test.run(page, evidence);
        } catch (error) {
          failure = { name: error.name, code: error.code, operator: error.operator, message: error.message, actual: error.actual, expected: error.expected };
        } finally {
          try {
            observations = await state(page);
            const previousEvents = observations.events, savedCamera = observations.camera, savedHook = observations.hook;
            await page.evaluate(() => window.fixture.unmount());
            if (savedCamera !== null) await page.evaluate(({ savedCamera, savedHook, codes }) => {
              window.fixture.frame(codes, undefined, savedCamera);window.fixture.savedHookAfterUnmount(savedHook, codes);
              window.__nativeProbe.appState('background');
            }, { savedCamera, savedHook, codes: [code('AFTER_UNMOUNT')] });
            cleanup = await state(page);
            assert.equal(cleanup.attached, false);assert.equal(cleanup.camera, null);assert.equal(cleanup.hook, null);
            assert.equal(cleanup.boundary.cameras.filter(camera => camera.mounted).length, 0);
            assert.equal(cleanup.boundary.hooks.filter(hook => hook.mounted).length, 0);
            assert.equal(cleanup.boundary.layoutAttached, false);assert.equal(cleanup.boundary.appListeners, 0);
            assert.equal(cleanup.boundary.animations, 0);assert.deepEqual(cleanup.clock.timers, []);
            assert.deepEqual(cleanup.views.entries, []);assert.deepEqual(cleanup.events, previousEvents);
            assert.deepEqual(pageErrors, []);assert.deepEqual(requests, []);
          } catch (error) { cleanupFailure = { name: error.name, message: error.message, actual: error.actual, expected: error.expected } }
        }
      } finally { await context.close();contextClosed = true }
      try { assert.deepEqual(pageErrors, []);assert.deepEqual(requests, []) }
      catch (error) { cleanupFailure ??= { name: error.name, message: error.message, actual: error.actual, expected: error.expected, stage: 'after-context-close' } }
      let intendedRegression = false;
      if (failure && test.regression && !cleanupFailure && pageErrors.length === 0 && requests.length === 0) {
        try {
          assert.equal(failure.name, 'AssertionError');assert.equal(failure.code, 'ERR_ASSERTION');
          assert.equal(failure.operator, test.regression.operator);assert(failure.message.startsWith(test.regression.marker));
          assert.deepEqual(failure.actual, test.regression.actual);assert.deepEqual(failure.expected, test.regression.expected);
          intendedRegression = true;
        } catch { /* A load/API/precondition or different assertion cannot count as reproduction. */ }
      }
      results.push({ id: test.id, passed: !failure && !cleanupFailure, intendedRegression,
        failure, cleanupFailure, evidence, observations, cleanup, pageErrors, requests, contextClosed });
      console.log(`${failure || cleanupFailure ? 'FAIL' : 'PASS'} ${test.id}${intendedRegression ? ' [exact intended regression]' : ''}`);
    }
  } finally { await browser.close();browserClosed = true }

  const afterRuntimeHashes = await verifyClosure();
  assert.equal(hash(bundleBytes), bundleSha256, 'Executed bundle bytes remain stable');
  assert.equal(browserClosed, true);
  assert.equal(browser.isConnected(), false);
  for (const result of results) {
    assert.equal(result.contextClosed, true, 'Every isolated context must close');
    assert.deepEqual(result.pageErrors, [], 'No late page/console errors after browser close');
    assert.deepEqual(result.requests, [], 'No network requests, including during closure');
  }
  const failed = results.filter(result => !result.passed);
  for (const result of failed) console.error(JSON.stringify(result, null, 2));
  const versions = Object.fromEntries(await Promise.all(['react', 'react-dom', 'esbuild'].map(async name =>
    [name, JSON.parse(await readFile(dependency.resolve(name + '/package.json'), 'utf8')).version])));
  console.log(JSON.stringify({ suite:'native-highlight-visibility', passed:results.length-failed.length, failed:failed.length,
    total:results.length, cases:results.map(result=>result.id), hookBoundary:'modeled VisionCamera4.7.3 stable latest-ref hook',
    clockBoundary:'controlled elapsed time invoking actual captured component interval/timeout callbacks',
    actualScannerAndOverlay:true, bundleSha256, sourceFiles:closure.length,
    consumedClosureSha256:hash(Buffer.from(JSON.stringify(closure))),
    stableAfterBundle:Object.keys(afterBundleHashes).length, stableAfterRuntime:Object.keys(afterRuntimeHashes).length,
    allContextsClosed:results.every(result=>result.contextClosed), browserClosed,
    environment:{node:process.version,browserVersion,...versions},
    scope:'ReactDOM+native boundaries, no phone/native-driver/native-pixel/decoder claim'}));
  assert.equal(results.length, 14);
  assert.equal(failed.length, 0, 'Every native highlight regression and preservation control must pass');

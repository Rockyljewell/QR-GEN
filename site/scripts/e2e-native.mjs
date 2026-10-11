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
  import React,{useLayoutEffect} from ${react};
  const back={id:'back',position:'back',hasTorch:true};
  const front={id:'front',position:'front',hasTorch:true};
  const permission={hasPermission:true,requestPermission:()=>Promise.resolve(true)};
  export function useCameraPermission(){return permission}
  export function useCameraDevices(){return [back,front]}
  export function useCameraDevice(position){return position==='front'?front:back}
  export function useCodeScanner(options){return options}
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
  let calls=[],mode='single',action,duplicateFilter=0,key=0;
  const scan=codes=>{
    calls.push(codes.map(c=>c.data));
    if(action==='mode'){mode='continuous';render()}
    else if(action==='unmount')root.unmount();
    else if(action)ref.current[action]();
  };
  function render(){root.render(React.createElement(QRGenScanner,{
    key,ref,mode,symbologies:['qr'],duplicateFilter,beep:false,vibrate:false,
    showToast:false,showHighlights:false,onScan:scan,
  }))}
  window.probe={
    mount(nextAction,windowMs=0){calls=[];mode='single';action=nextAction;duplicateFilter=windowMs;key++;flushSync(render)},
    frame(value){flushSync(()=>window.cameraProps.codeScanner.onCodeScanned([
      {type:'qr',value,corners:[{x:20,y:20},{x:120,y:20},{x:120,y:120},{x:20,y:120}]}
    ],{width:720,height:1280}))},
    snapshot(){return {calls:[...calls],cameraActive:window.cameraProps?.isActive??false,attached:!!ref.current}},
    unmount(){flushSync(()=>root.unmount())},
  };
`;
const bundle = await build({
  stdin: { contents: app, resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "native-camera-boundaries", setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: dependency.resolve("react") }));
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
  async function test(name, run) {
    const context = await browser.newContext();
    const errors = [], requests = [];
    try {
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      context.on("request", request => requests.push(request.url()));
      await context.route("**/*", route => route.abort());
      await page.setContent('<!doctype html><div id="app"></div>');
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await run(page);
      await page.evaluate(() => window.probe.unmount());
      assert.equal(await page.evaluate(() => window.cameraProps === null), true);
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
} finally { await browser.close(); }

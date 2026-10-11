// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

// Real React/ReactDOM concurrent rendering and native DOM events. Only custom
// element registration is stubbed: this exercises adapter ownership, not decoding.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const sdkRequire = createRequire(new URL("../../packages/sdk/package.json", import.meta.url));
const { build } = sdkRequire("esbuild");
const adapter = fileURLToPath(new URL("../../packages/sdk/src/react/index.ts", import.meta.url));
const registrationStub = {
  name: "adapter-element-boundary",
  setup(builder) {
    builder.onResolve({ filter: /elements\/define\.js$/ }, () => ({ path: "registration", namespace: "adapter-test" }));
    builder.onLoad({ filter: /.*/, namespace: "adapter-test" }, () => ({ loader: "js", contents: `
      export function defineElements() {
        if (typeof customElements === "undefined" || customElements.get("qrgen-scanner")) return;
        customElements.define("qrgen-scanner", class extends HTMLElement {
          pauses = 0;
          listenerCounts = { added: {}, removed: {} };
          addEventListener(name, listener, options) {
            this.listenerCounts.added[name] = (this.listenerCounts.added[name] || 0) + 1;
            super.addEventListener(name, listener, options);
          }
          removeEventListener(name, listener, options) {
            this.listenerCounts.removed[name] = (this.listenerCounts.removed[name] || 0) + 1;
            super.removeEventListener(name, listener, options);
          }
          pause() { this.pauses++; }
          connectedCallback() {
            queueMicrotask(() => this.dispatchEvent(new CustomEvent("ready", { detail: { engine: "worker" } })));
          }
        });
      }
    ` }));
  },
};

// Server rendering must remain usable without window, a DOM, or element registration.
const serverBundle = await build({ entryPoints: [adapter], bundle: true, write: false, platform: "node", format: "cjs", external: ["react"], plugins: [registrationStub] });
const serverModule = { exports: {} };
new Function("module", "exports", "require", serverBundle.outputFiles[0].text)(serverModule, serverModule.exports, sdkRequire);
const React = sdkRequire("react");
const markup = sdkRequire("react-dom/server").renderToString(React.createElement(serverModule.exports.QRGenScanner, { hint: "server-render", autostart: false }));
assert.match(markup, /<qrgen-scanner/);
assert.match(markup, /hint="server-render"/);
assert.match(markup, /autostart="false"/);
console.log("  ✓ React adapter server rendering without browser globals");

const source = `
  import React, { StrictMode, Suspense, createRef, startTransition, useState } from ${JSON.stringify(sdkRequire.resolve("react"))};
  import { createRoot } from ${JSON.stringify(sdkRequire.resolve("react-dom/client"))};
  import { flushSync } from ${JSON.stringify(sdkRequire.resolve("react-dom"))};
  import { QRGenScanner } from ${JSON.stringify(adapter)};

  const calls = [];
  const attempted = {};
  const gates = new Map();
  const handle = createRef();
  const root = createRoot(document.getElementById("app"));
  const record = (event, phase, value) => calls.push({ event, phase, value });
  function Block({ phase }) {
    const gate = gates.get(phase);
    if (gate && !gate.released) { attempted[phase] = (attempted[phase] || 0) + 1; throw gate.promise; }
    return React.createElement("span", { "data-committed": phase }, phase);
  }
  let setPhase;
  function App() {
    const [phase, update] = useState("A");
    setPhase = update;
    return React.createElement(Suspense, { fallback: React.createElement("span", { "data-fallback": true }, "Loading") },
        React.createElement(QRGenScanner, {
          ref: handle, autostart: false, hint: phase,
          onScan: (barcodes, barcode) => record("scan", phase, [barcodes[0].data, barcode.data]),
          onTrack: update => record("track", phase, update.tracked[0].data),
          onSelect: detail => record("select", phase, detail.selected),
          onError: error => record("error", phase, error.code),
          onReady: detail => record("ready", phase, detail.engine),
          onStateChange: state => record("statechange", phase, state),
        }),
        React.createElement(Block, { phase }));
  }
  flushSync(() => root.render(React.createElement(StrictMode, null, React.createElement(App))));
  const initialElement = document.querySelector("qrgen-scanner");
  const initialHandle = handle.current;
  const barcode = { data: "CALLBACK-PROBE" };
  const events = {
    scan: { barcodes: [barcode], barcode }, track: { tracked: [barcode], added: [barcode], removed: [] },
    select: { barcode, selected: true, selection: [barcode] }, error: { code: "camera-error", message: "probe" },
    ready: { engine: "worker" }, statechange: { state: "paused" },
  };
  window.probe = {
    attempted,
    suspend(phase) {
      let release;
      const promise = new Promise(resolve => { release = resolve; });
      gates.set(phase, { promise, release, released: false });
      startTransition(() => setPhase(phase));
    },
    release(phase) { const gate = gates.get(phase); gate.released = true; gate.release(); },
    commit(phase) { flushSync(() => setPhase(phase)); },
    fire() {
      const start = calls.length;
      for (const [name, detail] of Object.entries(events)) initialElement.dispatchEvent(new CustomEvent(name, { detail }));
      return calls.slice(start);
    },
    snapshot() {
      return { calls: [...calls], hint: initialElement.getAttribute("hint"), committed: document.querySelector("[data-committed]")?.textContent,
        fallback: !!document.querySelector("[data-fallback]"), sameElement: document.querySelector("qrgen-scanner") === initialElement,
        sameHandle: handle.current === initialHandle, handleElement: handle.current?.element === initialElement };
    },
    pause() { handle.current.pause(); return initialElement.pauses; },
    listenerCounts() { return initialElement.listenerCounts; },
    unmount() { flushSync(() => root.unmount()); return { detached: !initialElement.isConnected, clearedRef: handle.current === null }; },
  };
`;
const bundle = await build({ stdin: { contents: source, resolveDir: fileURLToPath(new URL("../../", import.meta.url)), sourcefile: "react-concurrent-test.mjs" }, bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"development"' }, plugins: [registrationStub] });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || process.env.QRGEN_CHROMIUM_PATH || undefined });
const context = await browser.newContext();
const errors = [];
const requests = [];
try {
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  context.on("request", request => requests.push(request.url()));
  await context.route("**/*", route => route.abort());
  await page.setContent('<!doctype html><div id="app"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForFunction(() => window.probe?.snapshot().calls.some(call => call.event === "ready"));
  const counts = await page.evaluate(() => window.probe.listenerCounts());
  for (const event of ["scan", "track", "select", "error", "ready", "statechange"]) {
    assert.equal(counts.added[event], 2, "root StrictMode must actually replay native listener setup");
    assert.equal(counts.removed[event], 1, "StrictMode replay must clean up the first listener");
  }

  const expectCallbacks = async phase => {
    const calls = await page.evaluate(() => window.probe.fire());
    assert.deepEqual(calls, [
      { event: "scan", phase, value: ["CALLBACK-PROBE", "CALLBACK-PROBE"] },
      { event: "track", phase, value: "CALLBACK-PROBE" }, { event: "select", phase, value: true },
      { event: "error", phase, value: "camera-error" }, { event: "ready", phase, value: "worker" },
      { event: "statechange", phase, value: "paused" },
    ], "native events must use only the committed callbacks, exactly once");
  };
  const expectIdentity = async phase => {
    const { calls, ...state } = await page.evaluate(() => window.probe.snapshot());
    assert.deepEqual(state, { hint: phase, committed: phase, fallback: false, sameElement: true, sameHandle: true, handleElement: true });
  };

  await expectCallbacks("A");
  await page.evaluate(() => window.probe.suspend("B"));
  await page.waitForFunction(() => window.probe.attempted.B > 0);
  await expectIdentity("A");
  await expectCallbacks("A");
  console.log("  ✓ Suspended React transition retains committed native callbacks");

  await page.evaluate(() => window.probe.release("B"));
  await page.waitForSelector('[data-committed="B"]');
  await expectIdentity("B");
  await expectCallbacks("B");
  assert.equal(await page.evaluate(() => window.probe.pause()), 1);
  console.log("  ✓ Committed callbacks update without replacing the element or imperative handle");

  await page.evaluate(() => window.probe.suspend("C"));
  await page.waitForFunction(() => window.probe.attempted.C > 0);
  await expectIdentity("B");
  await expectCallbacks("B");
  await page.evaluate(() => window.probe.commit("D"));
  await expectIdentity("D");
  await expectCallbacks("D");
  await page.evaluate(() => window.probe.release("C"));
  // Allow the abandoned promise's retry to render; it cannot replace urgent D.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expectIdentity("D");
  await expectCallbacks("D");
  console.log("  ✓ Abandoned React transition cannot steal callbacks from the committed workflow");

  assert.deepEqual(await page.evaluate(() => window.probe.unmount()), { detached: true, clearedRef: true });
  assert.deepEqual(await page.evaluate(() => window.probe.fire()), [], "unmount must remove every native listener");
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log("  ✓ StrictMode native listeners fire once and are removed on unmount");
} finally {
  await context.close();
  await browser.close();
}

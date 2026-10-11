// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

const SCOPE = new URL("./", self.location.href);
const VERSION = new URL(self.location.href).searchParams.get("v");
let HASHES;
try { HASHES = JSON.parse(new URL(self.location.href).searchParams.get("hashes")); } catch { /* validated during install */ }
const PREFIX = `qrgen-offline:${SCOPE.pathname}:`;
const CACHE = `${PREFIX}${VERSION}`;
const resource = (path) => new URL(`${path}?v=${VERSION}`, SCOPE).href;
const ASSETS = [SCOPE.href, resource("client.js"), resource("../sdk/qrgen.js"), resource("../sdk/wasm/zxing_reader.wasm"), resource("../sdk/wasm/zxing_writer.wasm")];
const ASSET_SET = new Set(ASSETS.slice(1));

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    if (!/^[a-f0-9]{20}$/.test(VERSION ?? "")) throw new Error("An offline build version is required.");
    const keys = ["client", "sdk", "reader", "writer"];
    if (!HASHES || !keys.every((key) => /^[a-f0-9]{64}$/.test(HASHES[key] ?? ""))) throw new Error("Offline asset digests are required.");
    const existed = await caches.has(CACHE);
    try {
      // Fetch and validate everything before publishing a new cache. No user
      // inputs, uploaded images or arbitrary requests ever enter this cache.
      const responses = await Promise.all(ASSETS.map(async (url) => {
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), 30000);
        try {
          const response = await fetch(new Request(url, { cache: "no-store", credentials: "same-origin", signal: abort.signal }));
          if (!response.ok || response.redirected || response.type !== "basic") throw new Error("An offline asset could not be saved.");
          // Drain each body promptly: Chromium throttles install-time requests,
          // so waiting for every header first can leave later requests queued.
          const bytes = await response.arrayBuffer();
          // Fetch exposes decoded bytes; original gzip/br transfer metadata no
          // longer describes this reconstructed response's body.
          const headers = new Headers(response.headers);
          for (const name of ["content-encoding", "content-length", "transfer-encoding"]) headers.delete(name);
          return new Response(bytes, { status: response.status, headers });
        } finally { clearTimeout(timeout); }
      }));
      const shell = await responses[0].clone().text();
      if (!shell.includes(`data-offline-version="${VERSION}"`)) throw new Error("The offline page changed during installation. Reload online.");
      if (!/javascript|ecmascript/.test(responses[1].headers.get("content-type") ?? "") ||
        !/javascript|ecmascript/.test(responses[2].headers.get("content-type") ?? "")) throw new Error("An offline script has the wrong content type.");
      // Static hosts ignore version query strings. Verify actual bytes to reject
      // a partially deployed or mismatched SDK/engine, even when it compiles.
      await Promise.all(responses.slice(1).map(async (response, index) => {
        const digest = await crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer());
        const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
        if (hex !== HASHES[keys[index]]) throw new Error("An offline asset does not match this build.");
      }));
      await Promise.all(responses.slice(3).map(async (response) => WebAssembly.compile(await response.clone().arrayBuffer())));
      const cache = await caches.open(CACHE);
      await Promise.all(ASSETS.map((url, index) => cache.put(url, responses[index])));
    } catch (error) {
      // A failed replacement must not delete a cache belonging to an active worker.
      if (!existed) await caches.delete(CACHE);
      throw error;
    }
    // Updates wait for existing tabs to close, keeping an active app's assets together.
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin) return;
  // This worker controls /offline/ only. It never handles another page's navigation.
  if (request.mode === "navigate") {
    if (url.pathname !== SCOPE.pathname) return;
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) return response;
      } catch { /* use the installed shell */ }
      // Query parameters do not change this static tool. Fall back to the
      // canonical shell without storing the query URL or its contents.
      return (await (await caches.open(CACHE)).match(SCOPE.href)) ?? new Response("Offline tools have not been saved. Reopen this page online.", { status: 503, headers: { "content-type": "text/plain" } });
    })());
    return;
  }
  if (!ASSET_SET.has(url.href)) return;
  event.respondWith((async () => (await (await caches.open(CACHE)).match(url.href)) ?? fetch(request))());
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "QRGEN_OFFLINE_STATUS" || !event.ports[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const complete = (await Promise.all(ASSETS.map((url) => cache.match(url)))).every((response) => response?.ok);
    event.ports[0].postMessage({ version: VERSION, ready: complete });
  })());
});

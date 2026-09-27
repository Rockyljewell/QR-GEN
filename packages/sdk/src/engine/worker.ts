/// <reference lib="webworker" />
// Decoder worker. Bundled to a string by scripts/build-worker.mjs and started from a Blob URL,
// so it works with every bundler (and with no bundler at all).
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { toRawBarcodes, toReaderOptions, type WorkerRequest, type WorkerResponse } from "./protocol.js";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: WorkerResponse) => ctx.postMessage(msg);

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === "init") {
    try {
      await prepareZXingModule({
        overrides: msg.wasmBinary
          ? { wasmBinary: msg.wasmBinary }
          : { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? msg.wasmUrl : prefix + path) },
        fireImmediately: true,
      });
      post({ type: "ready" });
    } catch (err) {
      post({ type: "init-error", message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (msg.type === "decode") {
    try {
      const image = new ImageData(new Uint8ClampedArray(msg.buffer), msg.width, msg.height);
      const results = await readBarcodes(image, toReaderOptions(msg.params));
      post({ type: "result", id: msg.id, results: toRawBarcodes(results) });
    } catch (err) {
      post({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
};

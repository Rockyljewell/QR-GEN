// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DecodeParams } from "../src/engine/protocol";

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn((message: { type: string }) => {
    if (message.type === "init") queueMicrotask(() => this.onmessage?.({ data: { type: "ready" } }));
  });
  constructor() { FakeWorker.all.push(this); }
}

const params: DecodeParams = {
  formats: ["QRCode"], tryHarder: true, tryRotate: true,
  tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 1,
};
const frame = () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }) as ImageData;

describe("Worker failure recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    FakeWorker.all = [];
    vi.stubGlobal("Worker", FakeWorker);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each(["error", "messageerror", "timeout", "postMessage", "response"])("settles pending decodes and replaces the worker after %s", async (failure) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { createFrameDecoder } = await import("../src/engine/decoder");
    const decoder = await createFrameDecoder();
    const worker = FakeWorker.all[0]!;
    if (failure === "postMessage") worker.postMessage.mockImplementation(() => { throw new Error("send failed"); });
    let error: unknown;
    void decoder.decode(frame(), params).catch((e) => { error = e; });
    if (failure === "error") worker.onerror?.({ message: "worker crashed" });
    if (failure === "messageerror") worker.onmessageerror?.();
    if (failure === "response") {
      for (let id = 2; id <= 3; id++) void decoder.decode(frame(), params).catch(() => {});
      // The third consecutive failure (request 1) replaces the engine.
      for (const id of [2, 3, 1]) worker.onmessage?.({ data: { type: "error", id, message: "WASM failed" } });
    }
    await vi.advanceTimersByTimeAsync(20000);
    expect(error).toMatchObject({ code: "engine-load-failed" });
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(decoder.decode(frame(), params)).rejects.toMatchObject({ code: "engine-load-failed" });
    const replacement = await createFrameDecoder();
    expect(replacement).not.toBe(decoder);
    expect(FakeWorker.all).toHaveLength(2);
    replacement.dispose();
  });

  it("drops a single failed frame without replacing the shared worker", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { createFrameDecoder } = await import("../src/engine/decoder");
    const decoder = await createFrameDecoder();
    const worker = FakeWorker.all[0]!;
    for (let round = 0; round < 3; round++) {
      const bad = decoder.decode(frame(), params);
      worker.onmessage?.({ data: { type: "error", id: round * 2 + 1, message: "bad frame" } });
      const error = await bad.catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toMatchObject({ code: "engine-load-failed" });
      const good = decoder.decode(frame(), params);
      worker.onmessage?.({ data: { type: "result", id: round * 2 + 2, results: [] } });
      expect(await good).toEqual([]);
    }
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(await createFrameDecoder()).toBe(decoder);
    expect(vi.getTimerCount()).toBe(0);
    decoder.dispose();
  });

  it("clears successful request timers and supports multiple consumers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { createFrameDecoder } = await import("../src/engine/decoder");
    const decoder = await createFrameDecoder();
    expect(await createFrameDecoder()).toBe(decoder);
    const worker = FakeWorker.all[0]!;
    const first = decoder.decode(frame(), params);
    const second = decoder.decode(frame(), params);
    worker.onmessage?.({ data: { type: "result", id: 2, results: [] } });
    worker.onmessage?.({ data: { type: "result", id: 1, results: [] } });
    expect(await first).toEqual([]);
    expect(await second).toEqual([]);
    await vi.advanceTimersByTimeAsync(20000);
    expect(worker.terminate).not.toHaveBeenCalled();
    decoder.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

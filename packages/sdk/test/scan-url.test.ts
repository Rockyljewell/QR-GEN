// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { createServer, type RequestListener } from "node:http";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generatePNG, scanImage } from "../src/node";

async function withServer(handler: RequestListener, run: (url: string) => Promise<void>): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test server address");
    await run(`http://127.0.0.1:${address.port}/image`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("image URL response lifecycle", () => {
  let png: Buffer;
  beforeAll(async () => { png = await generatePNG("URL-IMAGE-REGRESSION"); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it.each([404, 503])("cancels unread HTTP %i bodies after repeated rejected scans", async (status) => {
    let opened = 0, closed = 0;
    await withServer((_req, response) => {
      opened++;
      response.once("close", () => closed++);
      response.writeHead(status, { "Content-Length": "10485760" });
      response.write("not an image"); // Keep the response open until the client cancels it.
    }, async (url) => {
      for (let i = 0; i < 3; i++) {
        await expect(scanImage(url)).rejects.toMatchObject({ code: "bad-request", message: expect.stringContaining(`HTTP ${status}`) });
      }
      await vi.waitFor(() => expect(closed).toBe(opened), { timeout: 1000, interval: 10 });
      expect(opened).toBe(3);
    });
  });

  it("keeps the HTTP error when response cancellation itself fails", async () => {
    const cancellation = new Error("stream cancellation failed");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ cancel() { throw cancellation; } }), { status: 503 })));
    await expect(scanImage("https://example.test/image")).rejects.toMatchObject({ code: "bad-request", message: expect.stringContaining("HTTP 503") });
  });

  it("wraps interrupted response reads with the original cause", async () => {
    await withServer((_req, response) => {
      response.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length + 100 });
      response.flushHeaders();
      response.write(png.subarray(0, 16));
      setTimeout(() => response.destroy(), 20);
    }, async (url) => {
      const error = await scanImage(url).then(() => undefined, (err: unknown) => err);
      expect(error).toMatchObject({ name: "QRGenError", code: "bad-request", message: expect.stringContaining("Could not read image response") });
      expect((error as { cause?: unknown }).cause).toBeInstanceOf(Error);
    });
  });

  it("decodes a complete response", async () => {
    await withServer((_req, response) => { response.end(png); }, async (url) => {
      expect((await scanImage(url)).map((barcode) => barcode.data)).toEqual(["URL-IMAGE-REGRESSION"]);
    });
  });

  it("preserves image validation errors after a complete response", async () => {
    await withServer((_req, response) => { response.end("not an image"); }, async (url) => {
      await expect(scanImage(url)).rejects.toMatchObject({ code: "bad-request", message: expect.stringContaining("Unsupported or corrupt image") });
    });
  });
});

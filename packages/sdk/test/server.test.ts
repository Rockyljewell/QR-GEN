// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate, generatePNG } from "../src/node";
import { createServer } from "../src/server";
import { toBase64 } from "../src/util";

let base = "";
const server = createServer();

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const boundary = "AuditBoundary71";
function multipart(parts: Buffer[], closing = `--${boundary}--\r\n`) {
  return Buffer.concat([...parts.flatMap((part) => [Buffer.from(`--${boundary}\r\n`), part, Buffer.from("\r\n")]), Buffer.from(closing)]);
}
function filePart(image: Uint8Array) {
  return Buffer.concat([Buffer.from('Content-Disposition: form-data; name="image"; filename="code.png"\r\nContent-Type: image/png\r\n\r\n'), image]);
}
function fieldPart(name: string, value: string) {
  return Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n${value}`);
}
function withPngText(png: Uint8Array, text: string) {
  // A CRC-valid ancillary chunk leaves the real generated QR pixels unchanged.
  const data = Buffer.from(`Comment\0${text}`);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length);
  header.write("tEXt", 4);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([header.subarray(4), data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([png.subarray(0, 33), header, data, checksum, png.subarray(33)]);
}

describe("REST API", () => {
  it("GET /health", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("GET /v1/symbologies", async () => {
    const body = await (await fetch(`${base}/v1/symbologies`)).json();
    expect(body.read).toContain("qr");
    expect(body.write).toContain("ean13");
  });

  it("POST /v1/scan with raw bytes, JSON base64 and multipart", async () => {
    const png = await generatePNG("https://example.com", { symbology: "qr" });
    const raw = await (await fetch(`${base}/v1/scan`, { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array(png) })).json();
    expect(raw.barcodes[0]).toMatchObject({ data: "https://example.com", symbology: "qr", parsed: { type: "url" } });
    const json = await (
      await fetch(`${base}/v1/scan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: `data:image/png;base64,${toBase64(new Uint8Array(png))}`, symbologies: ["qr"] }) })
    ).json();
    expect(json.barcodes).toHaveLength(1);
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(png)], { type: "image/png" }), "code.png");
    const mp = await (await fetch(`${base}/v1/scan`, { method: "POST", body: form })).json();
    expect(mp.barcodes[0].data).toBe("https://example.com");
  });

  it.each([
    `mid-line--${boundary}-inside-text`,
    `line-prefix\r\n--${boundary}-suffix-lookalike`,
    `closing-prefix\r\n--${boundary}--suffix-lookalike`,
  ])("preserves multipart PNG bytes containing %s", async (text) => {
    const image = withPngText(await generatePNG("HTTP-VALID-CONTROL"), text);
    const raw = await fetch(`${base}/v1/scan`, { method: "POST", headers: { "content-type": "image/png" }, body: image });
    expect(raw.status).toBe(200);
    expect((await raw.json()).barcodes).toEqual([expect.objectContaining({ data: "HTTP-VALID-CONTROL" })]);
    const response = await fetch(`${base}/v1/scan`, {
      method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body: multipart([filePart(image)]),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).barcodes).toEqual([expect.objectContaining({ data: "HTTP-VALID-CONTROL" })]);
  });

  it.each(["Application/JSON", "APPLICATION/JSON; charset=utf-8"])("accepts case-insensitive scan media type %s", async (contentType) => {
    const response = await fetch(`${base}/v1/scan`, {
      method: "POST", headers: { "content-type": contentType },
      body: JSON.stringify({ image: toBase64(await generatePNG("json-media-type")), parse: false }),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.barcodes).toEqual([expect.objectContaining({ data: "json-media-type" })]);
    expect(result.barcodes[0]).not.toHaveProperty("parsed");
  });

  it.each(["before", "after"])("accepts a quoted mixed-case boundary and options %s the file", async (placement) => {
    const image = filePart(await generatePNG("https://example.com/multipart-options"));
    const options = [fieldPart("symbologies", "qr"), fieldPart("parse", "false"), fieldPart("tryHarder", "false"), fieldPart("maxResults", "1")];
    const response = await fetch(`${base}/v1/scan?symbologies=ean13&parse=true&tryHarder=true&maxResults=0`, {
      method: "POST", headers: { "content-type": `Multipart/Form-Data; charset=utf-8; BOUNDARY = "${boundary}"; other=unused` },
      body: multipart(placement === "before" ? [...options, image] : [image, ...options]),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.barcodes).toEqual([expect.objectContaining({ data: "https://example.com/multipart-options", symbology: "qr" })]);
    expect(result.barcodes[0]).not.toHaveProperty("parsed");
  });

  it("does not confuse another quoted parameter with the boundary", async () => {
    const response = await fetch(`${base}/v1/scan`, {
      method: "POST", headers: { "content-type": `multipart/form-data; other="; boundary=decoy"; boundary="${boundary}"` },
      body: multipart([filePart(await generatePNG("quoted-parameter-control"))]),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).barcodes).toEqual([expect.objectContaining({ data: "quoted-parameter-control" })]);
  });

  it.each([
    ["ordinary", `--${boundary}--\r\n`],
    ["EOF", `--${boundary}--`],
    ["transport padding and epilogue", `--${boundary}-- \t\r\nepilogue ignored`],
  ])("accepts the %s multipart closing delimiter", async (_name, closing) => {
    const body = Buffer.concat([Buffer.from("preamble ignored\r\n"), multipart([filePart(await generatePNG("multipart-closing"))], closing)]);
    const response = await fetch(`${base}/v1/scan`, {
      method: "POST", headers: { "content-type": `multipart/form-data; boundary="${boundary}"` }, body,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).barcodes).toEqual([expect.objectContaining({ data: "multipart-closing" })]);
  });

  it.each([
    ["missing closing delimiter", ""],
    ["truncated closing delimiter", `--${boundary}-`],
    ["closing suffix lookalike", `--${boundary}--extra\r\n`],
    ["later truncated field", `--${boundary}\r\nContent-Disposition: form-data; name="parse"\r\n\r\nfalse`],
  ])("rejects %s instead of scanning a partial multipart body", async (_name, closing) => {
    const response = await fetch(`${base}/v1/scan`, {
      method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: multipart([filePart(await generatePNG("complete-image-in-incomplete-request"))], closing),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("bad-request");
  });

  it.each([
    ["missing boundary parameter", "multipart/form-data", Buffer.from("not multipart")],
    ["empty boundary parameter", 'multipart/form-data; boundary=""', Buffer.from("not multipart")],
    ["missing delimiter CRLF", `multipart/form-data; boundary=${boundary}`, Buffer.from(`--${boundary}not-a-line\r\n--${boundary}--\r\n`)],
    ["missing part header separator", `multipart/form-data; boundary=${boundary}`, multipart([Buffer.from("invalid part headers")])],
    ["no file", `multipart/form-data; boundary=${boundary}`, multipart([fieldPart("parse", "false")])],
  ])("rejects multipart with %s", async (_name, contentType, body) => {
    const response = await fetch(`${base}/v1/scan`, { method: "POST", headers: { "content-type": contentType }, body });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("bad-request");
  });

  it("GET and POST /v1/generate", async () => {
    const svg = await fetch(`${base}/v1/generate?data=hello&symbology=qr`);
    expect(svg.headers.get("content-type")).toContain("image/svg+xml");
    expect(await svg.text()).toContain("<svg");
    const png = await fetch(`${base}/v1/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: "5901234123457", symbology: "ean13", format: "png" }) });
    expect(png.headers.get("content-type")).toBe("image/png");
    expect((await png.arrayBuffer()).byteLength).toBeGreaterThan(100);
  });

  it("returns 413 for oversized bodies and 400 for non-images", async () => {
    const small = createServer({ maxBodyBytes: 1000 });
    await new Promise<void>((r) => small.listen(0, "127.0.0.1", () => r()));
    const url = `http://127.0.0.1:${(small.address() as AddressInfo).port}`;
    const big = await fetch(`${url}/v1/scan`, { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array(50_000) });
    expect(big.status).toBe(413);
    expect((await big.json()).error.code).toBe("payload-too-large");
    const junk = await fetch(`${base}/v1/scan`, { method: "POST", headers: { "content-type": "image/png" }, body: "not an image" });
    expect(junk.status).toBe(400);
    await new Promise<void>((r) => small.close(() => r()));
  });

  it.each(["null", "[]", "1", '"text"'])("rejects a non-object scan JSON body: %s", async (body) => {
    const response = await fetch(`${base}/v1/scan`, {
      method: "POST", headers: { "content-type": "application/json" }, body,
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("bad-request");
  });

  it("honors multipart parse=false", async () => {
    const png = await generatePNG("https://example.com");
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(png)], { type: "image/png" }), "code.png");
    form.append("parse", "false");
    const response = await fetch(`${base}/v1/scan`, { method: "POST", body: form });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.barcodes[0].data).toBe("https://example.com");
    expect(result.barcodes[0]).not.toHaveProperty("parsed");
  });

  it.each(["query", "json", "multipart"])("honors maxResults from %s on a two-code image", async (source) => {
    // Two real generated QR matrices in a portable graymap: no browser or image library.
    const codes = await Promise.all([generate("left"), generate("right")]);
    const side = codes[0]!.matrix.width + 8;
    const width = side * 8;
    const height = side * 4;
    const pixels = new Uint8Array(width * height).fill(255);
    codes.forEach(({ matrix }, i) => {
      for (let y = 0; y < matrix.height; y++) for (let x = 0; x < matrix.width; x++) {
        if (!matrix.modules[y * matrix.width + x]) continue;
        for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
          pixels[((y + 4) * 4 + dy) * width + (i * side + x + 4) * 4 + dx] = 0;
        }
      }
    });
    const image = Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), pixels]);
    const all = await (await fetch(`${base}/v1/scan`, { method: "POST", body: image })).json();
    expect(all.barcodes).toHaveLength(2);
    let body: BodyInit = image;
    let headers: Record<string, string> = {};
    let query = "";
    if (source === "query") query = "?maxResults=1";
    if (source === "json") {
      body = JSON.stringify({ image: image.toString("base64"), maxResults: 1 });
      headers = { "content-type": "application/json" };
    }
    if (source === "multipart") {
      const form = new FormData();
      form.append("image", new Blob([image]), "codes.pgm");
      form.append("maxResults", "1");
      body = form;
    }
    const response = await fetch(`${base}/v1/scan${query}`, { method: "POST", headers, body });
    expect(response.status).toBe(200);
    expect((await response.json()).barcodes).toHaveLength(1);
  });

  it.each(["NaN", "Infinity", "0", "256", "1.5"])("rejects invalid maxResults=%s", async (value) => {
    const response = await fetch(`${base}/v1/scan?maxResults=${value}`, {
      method: "POST", body: new Uint8Array(await generatePNG("limit")),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("bad-request");
  });

  it("POST /v1/parse and errors", async () => {
    const parsed = await (await fetch(`${base}/v1/parse`, { method: "POST", body: JSON.stringify({ data: "WIFI:S:Home;T:WPA;P:secret;;" }) })).json();
    expect(parsed).toMatchObject({ type: "wifi", ssid: "Home" });
    const bad = await fetch(`${base}/v1/generate?data=abc&symbology=ean13`);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("bad-request");
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});

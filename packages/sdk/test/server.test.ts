import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatePNG } from "../src/node";
import { createServer } from "../src/server";
import { toBase64 } from "../src/util";

let base = "";
const server = createServer();

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

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

  it("POST /v1/parse and errors", async () => {
    const parsed = await (await fetch(`${base}/v1/parse`, { method: "POST", body: JSON.stringify({ data: "WIFI:S:Home;T:WPA;P:secret;;" }) })).json();
    expect(parsed).toMatchObject({ type: "wifi", ssid: "Home" });
    const bad = await fetch(`${base}/v1/generate?data=abc&symbology=ean13`);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("bad-request");
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});

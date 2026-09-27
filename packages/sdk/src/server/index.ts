/**
 * REST API (docs/SPEC.md §6) so any language can scan and generate barcodes over HTTP.
 *
 * ```ts
 * import { createServer } from "qrgen-sdk/server";
 * createServer().listen(8080);
 * ```
 * or `npx qrgen serve --port 8080`, or `docker run -p 8080:8080 ghcr.io/rockyljewell/qr-gen`.
 */
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { QRGenError } from "../errors.js";
import { generate, type GenerateOptions } from "../generator.js";
import { scanImage } from "../image.js";
import { useLocalEngine } from "../node/index.js";
import { parseContent } from "../parsers/index.js";
import { ALL_SYMBOLOGIES, WRITABLE_SYMBOLOGIES, resolveSymbologies, SYMBOLOGIES } from "../symbologies.js";
import { fromBase64 } from "../util.js";
import { VERSION } from "../version.js";

export interface ServerOptions {
  /** Maximum request body in bytes. Default 15 MiB. */
  maxBodyBytes?: number;
  /** Value for Access-Control-Allow-Origin. Default "*". Set to false to disable CORS headers. */
  cors?: string | false;
  /** Log one line per request. Default false. */
  log?: boolean;
}

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  // Mounted behind a body parser (express.json(), express.raw(), …): use what it already read.
  const pre = (req as IncomingMessage & { body?: unknown }).body;
  if (pre !== undefined && (req.readableEnded || req.complete)) {
    const buf = Buffer.isBuffer(pre) ? pre : typeof pre === "string" ? Buffer.from(pre) : pre instanceof Uint8Array ? Buffer.from(pre) : Buffer.from(JSON.stringify(pre));
    if (buf.length > limit) return Promise.reject(new HttpError(413, "payload-too-large", `Body exceeds ${limit} bytes`));
    return Promise.resolve(buf);
  }
  if (req.readableEnded) return Promise.resolve(Buffer.alloc(0));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (c: Buffer) => {
      if (tooLarge) return;
      size += c.length;
      if (size > limit) {
        // Keep draining so the 413 response can still be delivered.
        tooLarge = true;
        chunks.length = 0;
        reject(new HttpError(413, "payload-too-large", `Body exceeds ${limit} bytes`));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

/** Extract the first file part (or the "image" field) from a multipart/form-data body. */
function multipartImage(body: Buffer, contentType: string): { image: Buffer; fields: Record<string, string> } {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) throw new HttpError(400, "bad-request", "multipart body without boundary");
  const boundary = Buffer.from(`--${m[1] ?? m[2]}`);
  const fields: Record<string, string> = {};
  let image: Buffer | undefined;
  let pos = body.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length + 2; // skip CRLF
    const next = body.indexOf(boundary, start);
    if (next === -1) break;
    const part = body.subarray(start, next - 2);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString("utf8");
      const content = part.subarray(headerEnd + 4);
      const name = /name="([^"]*)"/i.exec(headers)?.[1] ?? "";
      if (/filename=/i.test(headers) || name === "image" || name === "file") image ??= content;
      else fields[name] = content.toString("utf8");
    }
    pos = next;
  }
  if (!image) throw new HttpError(400, "bad-request", 'multipart body has no file part (use -F "image=@photo.jpg")');
  return { image, fields };
}

function send(res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8"): void {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.end(payload);
}

function list(v: unknown): string[] | undefined {
  if (v == null || v === "") return undefined;
  return Array.isArray(v) ? v.map(String) : String(v).split(",");
}

function truthy(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "boolean") return v;
  return !/^(0|false|no|off)$/i.test(String(v));
}

function generateOptions(src: Record<string, unknown>): GenerateOptions & { data: string; format: "svg" | "png" | "txt" } {
  const data = src.data ?? src.text ?? src.value;
  if (typeof data !== "string" || !data) throw new HttpError(400, "bad-request", 'Missing "data"');
  const format = String(src.format ?? "svg").toLowerCase();
  if (!["svg", "png", "txt"].includes(format)) throw new HttpError(400, "bad-request", 'format must be "svg", "png" or "txt"');
  const num = (v: unknown) => (v === undefined || v === "" ? undefined : Number(v));
  return {
    data,
    format: format as "svg" | "png" | "txt",
    symbology: (src.symbology as string) ?? "qr",
    scale: num(src.scale),
    ecLevel: (src.ecLevel ?? src.ec) as string | undefined,
    gs1: truthy(src.gs1),
    hrt: truthy(src.hrt),
    margin: truthy(src.margin),
    foreground: src.foreground as string | undefined,
    background: src.background as string | undefined,
    rotate: num(src.rotate) as GenerateOptions["rotate"],
  };
}

/** Create a request handler you can mount in any Node HTTP framework. */
export function createHandler(options: ServerOptions = {}): (req: IncomingMessage, res: ServerResponse) => void {
  useLocalEngine();
  const limit = options.maxBodyBytes ?? 15 * 1024 * 1024;
  const cors = options.cors === undefined ? "*" : options.cors;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const q = Object.fromEntries(url.searchParams.entries());
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method === "GET" && (path === "/" || path === "/health")) {
      send(res, 200, { ok: true, name: "qrgen", version: VERSION, docs: "https://rockyljewell.github.io/QR-GEN/docs/rest-api/" });
      return;
    }
    if (req.method === "GET" && path === "/v1/symbologies") {
      send(res, 200, { read: [...ALL_SYMBOLOGIES], write: [...WRITABLE_SYMBOLOGIES], details: SYMBOLOGIES.map(({ id, name, kind, aliases }) => ({ id, name, kind, aliases })) });
      return;
    }
    if (req.method === "POST" && path === "/v1/scan") {
      const body = await readBody(req, limit);
      const type = String(req.headers["content-type"] ?? "");
      let image: Uint8Array;
      let symbologies = list(q.symbologies);
      let tryHarder = truthy(q.tryHarder);
      let parse = truthy(q.parse) ?? true;
      if (type.includes("application/json")) {
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(body.toString("utf8"));
        } catch {
          throw new HttpError(400, "bad-request", "Invalid JSON body");
        }
        if (typeof json.image !== "string") throw new HttpError(400, "bad-request", 'JSON body needs "image" as base64 or a data URL');
        image = fromBase64(json.image);
        symbologies = list(json.symbologies) ?? symbologies;
        tryHarder = truthy(json.tryHarder) ?? tryHarder;
        parse = truthy(json.parse) ?? parse;
      } else if (type.includes("multipart/form-data")) {
        const mp = multipartImage(body, type);
        image = mp.image;
        symbologies = list(mp.fields.symbologies) ?? symbologies;
      } else {
        image = body;
      }
      if (!image.length) throw new HttpError(400, "bad-request", "Empty image");
      const barcodes = await scanImage(image, { symbologies: symbologies ? resolveSymbologies(symbologies) : undefined, tryHarder: tryHarder ?? true });
      send(res, 200, { barcodes: parse ? barcodes.map((b) => ({ ...b, parsed: parseContent(b.data, { symbology: b.symbology }) })) : barcodes });
      return;
    }
    if (path === "/v1/generate" && (req.method === "GET" || req.method === "POST")) {
      let src: Record<string, unknown> = q;
      if (req.method === "POST") {
        const body = await readBody(req, limit);
        try {
          src = { ...q, ...JSON.parse(body.toString("utf8") || "{}") };
        } catch {
          throw new HttpError(400, "bad-request", "Invalid JSON body");
        }
      }
      const { data, format, ...opts } = generateOptions(src);
      const out = await generate(data, opts);
      if (format === "png") {
        if (!out.png) throw new HttpError(500, "unknown", "PNG output unavailable");
        send(res, 200, Buffer.from(await out.png.arrayBuffer()), "image/png");
      } else if (format === "txt") {
        send(res, 200, out.text, "text/plain; charset=utf-8");
      } else {
        send(res, 200, out.svg, "image/svg+xml; charset=utf-8");
      }
      return;
    }
    if (req.method === "POST" && path === "/v1/parse") {
      const body = await readBody(req, limit);
      let data: unknown;
      try {
        data = JSON.parse(body.toString("utf8")).data;
      } catch {
        data = body.toString("utf8");
      }
      if (typeof data !== "string") throw new HttpError(400, "bad-request", 'Missing "data"');
      send(res, 200, parseContent(data));
      return;
    }
    throw new HttpError(404, "not-found", `No route for ${req.method} ${path}`);
  };

  return (req, res) => {
    const started = Date.now();
    if (cors) {
      res.setHeader("Access-Control-Allow-Origin", cors);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    handle(req, res)
      .catch((err: unknown) => {
        if (err instanceof HttpError) {
          if (err.status === 413) res.setHeader("Connection", "close");
          return send(res, err.status, { error: { code: err.code, message: err.message } });
        }
        if (err instanceof QRGenError) {
          const status = err.code === "bad-request" || err.code === "unsupported" ? 400 : 500;
          return send(res, status, { error: { code: err.code, message: err.message } });
        }
        send(res, 500, { error: { code: "unknown", message: err instanceof Error ? err.message : String(err) } });
      })
      .finally(() => {
        if (options.log) console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
      });
  };
}

/** Create an HTTP server exposing the QRGen REST API. Call `.listen(port)` on it. */
export function createServer(options: ServerOptions = {}): Server {
  return createHttpServer(createHandler(options));
}

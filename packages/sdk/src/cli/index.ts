// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { generate } from "../generator.js";
import { generateToFile, scan, useLocalEngine } from "../node/index.js";
import { parseContent } from "../parsers/index.js";
import { createServer } from "../server/index.js";
import { SYMBOLOGIES, WRITABLE_SYMBOLOGIES } from "../symbologies.js";
import type { GenerateOptions } from "../generator.js";
import { VERSION } from "../version.js";

const HELP = `qrgen ${VERSION}: scan, generate and parse barcodes

Usage
  qrgen scan <image...> [--symbologies qr,ean13] [--json] [--no-parse] [--fast]
  qrgen generate <data> [-o out.svg|out.png|out.txt] [--symbology qr] [--scale 4]
                        [--ec L|M|Q|H] [--gs1] [--hrt] [--no-margin] [--fg #000] [--bg #fff]
  qrgen parse <data> [--symbology upce]
  qrgen serve [--port 8080] [--host 0.0.0.0]
  qrgen symbologies

Aliases: decode = scan, encode = generate. Use "-" to read an image from stdin.

Examples
  qrgen scan label.jpg --json
  qrgen generate "https://example.com" -o qr.svg
  qrgen generate "(01)09501101530003(10)ABC123" --symbology data-matrix --gs1 -o dm.png
  qrgen serve --port 8080   # REST API: POST /v1/scan, GET|POST /v1/generate, POST /v1/parse

Docs: https://rockyljewell.github.io/QR-GEN/docs/cli/`;

async function readStdin(): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

function fail(message: string): never {
  process.stderr.write(`qrgen: ${message}\n`);
  process.exit(1);
}

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      json: { type: "boolean" },
      "no-parse": { type: "boolean" },
      symbologies: { type: "string", short: "s" },
      symbology: { type: "string", short: "t" },
      output: { type: "string", short: "o" },
      scale: { type: "string" },
      ec: { type: "string" },
      gs1: { type: "boolean" },
      hrt: { type: "boolean" },
      "no-margin": { type: "boolean" },
      fg: { type: "string" },
      bg: { type: "string" },
      port: { type: "string", short: "p" },
      host: { type: "string" },
      fast: { type: "boolean" },
    },
  });
  const [command, ...rest] = positionals;
  if (values.version) return void console.log(VERSION);
  if (values.help || !command) return void console.log(HELP);
  useLocalEngine();

  switch (command) {
    case "scan":
    case "decode":
    case "read": {
      if (!rest.length) fail("scan needs at least one image path (or - for stdin)");
      const all: { file: string; barcodes: unknown[] }[] = [];
      let found = 0;
      for (const file of rest) {
        const input = file === "-" ? await readStdin() : new Uint8Array(await readFile(file).catch(() => fail(`cannot read ${file}`)));
        const barcodes = await scan(input, { symbologies: values.symbologies, tryHarder: !values.fast });
        found += barcodes.length;
        const withParsed = values["no-parse"] ? barcodes : barcodes.map((b) => ({ ...b, parsed: parseContent(b.data, { symbology: b.symbology }) }));
        all.push({ file, barcodes: withParsed });
        if (!values.json) {
          if (rest.length > 1) console.log(`${file}:`);
          if (!barcodes.length) console.log("  (no barcode found)");
          for (const b of barcodes) console.log(`${rest.length > 1 ? "  " : ""}${b.symbologyName}\t${b.data}`);
        }
      }
      if (values.json) console.log(JSON.stringify(rest.length === 1 ? all[0]!.barcodes : all, null, 2));
      process.exitCode = found ? 0 : 2;
      return;
    }
    case "generate":
    case "encode":
    case "write": {
      const data = rest.join(" ");
      if (!data) fail('generate needs the data to encode, e.g. qrgen generate "hello"');
      const opts: GenerateOptions = {
        symbology: values.symbology ?? "qr",
        scale: values.scale ? Number(values.scale) : undefined,
        ecLevel: values.ec,
        gs1: values.gs1,
        hrt: values.hrt,
        margin: values["no-margin"] ? false : undefined,
        foreground: values.fg,
        background: values.bg,
      };
      if (values.output) {
        const out = await generateToFile(data, values.output, opts);
        console.log(`wrote ${values.output} (${out.symbology}, ${out.matrix.width}x${out.matrix.height} modules)`);
      } else {
        const out = await generate(data, opts);
        console.log(out.text);
      }
      return;
    }
    case "parse": {
      const data = rest.join(" ");
      if (!data) fail("parse needs the scanned text");
      console.log(JSON.stringify(parseContent(data, { symbology: values.symbology }), null, 2));
      return;
    }
    case "serve":
    case "server": {
      const port = Number(values.port ?? process.env.PORT ?? 8080);
      const host = values.host ?? process.env.HOST ?? "0.0.0.0";
      const server = createServer({ log: true });
      server.listen(port, host, () => console.log(`qrgen REST API listening on http://${host}:${port}  (GET /health)`));
      const stop = () => server.close(() => process.exit(0));
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      return;
    }
    case "symbologies": {
      if (values.json) return void console.log(JSON.stringify(SYMBOLOGIES, null, 2));
      for (const s of SYMBOLOGIES) console.log(`${s.id.padEnd(18)} ${s.name.padEnd(24)} ${WRITABLE_SYMBOLOGIES.includes(s.id) ? "read/write" : "read"}`);
      return;
    }
    default:
      fail(`unknown command "${command}". Run qrgen --help`);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));

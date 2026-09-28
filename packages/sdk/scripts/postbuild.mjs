// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
// Copies the zxing wasm binaries into dist/wasm (for self-hosting), fixes the IIFE global and
// makes sure every JS file in dist/ starts with the legal banner.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, chmodSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BANNER } from "./banner.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
mkdirSync(resolve(root, "dist/wasm"), { recursive: true });
for (const [spec, name] of [
  ["zxing-wasm/reader/zxing_reader.wasm", "zxing_reader.wasm"],
  ["zxing-wasm/writer/zxing_writer.wasm", "zxing_writer.wasm"],
]) {
  copyFileSync(require.resolve(spec), resolve(root, "dist/wasm", name));
}

// IIFE: make `QRGen` the namespace object itself (QRGen.scanImage, QRGen.BarcodeScanner…), not { default, ... }.
const iife = resolve(root, "dist/browser/qrgen.iife.js");
let code = readFileSync(iife, "utf8");
if (!code.includes("QRGen=Object.assign")) {
  code += '\n;if(typeof QRGen!=="undefined"&&QRGen.default){QRGen=Object.assign(QRGen.default,QRGen);}\n';
  writeFileSync(iife, code);
}

// Legal banner: tsup's rollup tree-shaking pass drops the esbuild banner from some ESM/CJS files.
// Put it back (after the CLI shebang) and shift those files' source maps down one line.
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
for (const file of walk(resolve(root, "dist")).filter((f) => /\.(c|m)?js$/.test(f))) {
  const text = readFileSync(file, "utf8");
  const shebang = text.startsWith("#!") ? text.slice(0, text.indexOf("\n") + 1) : "";
  const body = text.slice(shebang.length);
  if (body.startsWith(BANNER)) continue;
  writeFileSync(file, `${shebang}${BANNER}\n${body}`);
  if (existsSync(`${file}.map`)) {
    const map = JSON.parse(readFileSync(`${file}.map`, "utf8"));
    map.mappings = `;${map.mappings}`;
    writeFileSync(`${file}.map`, JSON.stringify(map));
  }
}
chmodSync(resolve(root, "dist/cli.js"), 0o755);

const size = (p) => `${(statSync(resolve(root, p)).size / 1024).toFixed(1)} KiB`;
console.log(`[qrgen] dist/browser/qrgen.js ${size("dist/browser/qrgen.js")}, qrgen.iife.js ${size("dist/browser/qrgen.iife.js")}, wasm copied`);

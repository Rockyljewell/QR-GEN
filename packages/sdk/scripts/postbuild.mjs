// Copies the zxing wasm binaries into dist/wasm (for self-hosting) and fixes the IIFE global.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, chmodSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
chmodSync(resolve(root, "dist/cli.js"), 0o755);

const size = (p) => `${(statSync(resolve(root, p)).size / 1024).toFixed(1)} KiB`;
console.log(`[qrgen] dist/browser/qrgen.js ${size("dist/browser/qrgen.js")}, qrgen.iife.js ${size("dist/browser/qrgen.iife.js")}, wasm copied`);

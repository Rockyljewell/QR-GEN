// Copies the built SDK into public/ so the site can self-host it:
//   public/sdk/qrgen.js, qrgen.iife.js      standalone browser builds (CDN usage)
//   public/sdk/wasm/*.wasm                   decoder/encoder engines
//   public/downloads/qrgen-sdk.tgz           `npm install <url>` before the npm release
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, "..");
const sdk = resolve(site, "../packages/sdk");
const dist = resolve(sdk, "dist");

if (!existsSync(resolve(dist, "browser/qrgen.js"))) {
  console.log("[site] building qrgen-sdk first…");
  execFileSync("npm", ["run", "build"], { cwd: sdk, stdio: "inherit" });
}

const out = resolve(site, "public/sdk");
mkdirSync(resolve(out, "wasm"), { recursive: true });
for (const f of ["qrgen.js", "qrgen.js.map", "qrgen.iife.js", "qrgen.iife.js.map"]) {
  copyFileSync(resolve(dist, "browser", f), resolve(out, f));
}
for (const f of readdirSync(resolve(dist, "wasm"))) copyFileSync(resolve(dist, "wasm", f), resolve(out, "wasm", f));

const downloads = resolve(site, "public/downloads");
rmSync(downloads, { recursive: true, force: true });
mkdirSync(downloads, { recursive: true });
const packed = execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", downloads, "--silent"], { cwd: sdk, encoding: "utf8" })
  .trim()
  .split("\n")
  .pop();
renameSync(resolve(downloads, packed), resolve(downloads, "qrgen-sdk.tgz"));
console.log(`[site] copied SDK bundles, wasm and ${packed} → public/downloads/qrgen-sdk.tgz`);

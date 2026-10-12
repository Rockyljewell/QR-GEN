// Exercise the real static build while rejecting network fetches. This catches
// prerender bundling that loses the Node entry's local WebAssembly setup.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve("astro/package.json")), "bin", "astro.mjs");
const originalFetch = globalThis.fetch;
let rejected = 0;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (/^https?:/i.test(url)) {
    rejected++;
    return Promise.reject(new Error("The static build must use local assets; a network fetch was attempted."));
  }
  return originalFetch(input, init);
};
process.env.ASTRO_TELEMETRY_DISABLED = "1";
process.on("exit", () => {
  if (rejected) {
    console.error(`Offline build rejected ${rejected} network fetch attempt(s).`);
    process.exitCode = 1;
  }
});
process.argv = [process.execPath, cli, "build", ...process.argv.slice(2)];
await import(pathToFileURL(cli).href);

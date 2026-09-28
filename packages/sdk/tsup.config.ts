// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "tsup";
import { BANNER } from "./scripts/banner.mjs";

// tsup's rollup tree-shaking pass can drop this banner from ESM/CJS files; scripts/postbuild.mjs
// puts it back so every JS file in dist/ starts with it.
const banner = { js: BANNER };

export default defineConfig([
  // npm package: ESM + CJS with types; zxing-wasm stays an external dependency.
  {
    entry: {
      index: "src/index.ts",
      elements: "src/elements/index.ts",
      react: "src/react/index.ts",
      vue: "src/vue/index.ts",
      parsers: "src/parsers/index.ts",
      node: "src/node/index.ts",
      server: "src/server/index.ts",
      bridge: "src/bridge/index.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    splitting: true,
    sourcemap: true,
    clean: true,
    target: "es2020",
    shims: true,
    treeshake: true,
    external: ["react", "vue", "zxing-wasm"],
    banner,
  },
  // CLI
  {
    entry: { cli: "src/cli/index.ts" },
    format: ["esm"],
    platform: "node",
    target: "node18",
    external: ["zxing-wasm"],
    banner: { js: `#!/usr/bin/env node\n${BANNER}` },
    clean: false,
  },
  // Standalone browser builds: <script type="module"> and classic <script>.
  {
    entry: { qrgen: "src/browser.ts" },
    outDir: "dist/browser",
    format: ["esm", "iife"],
    globalName: "QRGen",
    platform: "browser",
    target: "es2020",
    minify: true,
    sourcemap: true,
    noExternal: [/.*/],
    clean: false,
    banner,
    outExtension: ({ format }) => ({ js: format === "iife" ? ".iife.js" : ".js" }),
    footer: { js: "" },
  },
]);

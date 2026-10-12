import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

// GitHub Pages project site. Override with SITE / BASE env vars for other hosts
// (e.g. BASE=/ for a custom domain or Netlify/Vercel).
const site = process.env.SITE ?? "https://rockyljewell.github.io";
const base = process.env.BASE ?? "/QR-GEN";

export default defineConfig({
  site,
  base,
  trailingSlash: "always",
  integrations: [sitemap()],
  markdown: {
    shikiConfig: {
      theme: "github-dark-dimmed",
      wrap: false,
    },
  },
  vite: {
    server: { fs: { allow: [".."] } },
    // Build-time barcode rendering loads the wasm engine from node_modules.
    ssr: { external: ["qrgen-sdk", "zxing-wasm"] },
    environments: {
      // Astro prerenders in its own environment. Preserve the Node entry's
      // local engine initialization instead of tree-shaking it into the page.
      prerender: { resolve: { external: ["qrgen-sdk", "qrgen-sdk/node", "zxing-wasm"] } },
    },
  },
});

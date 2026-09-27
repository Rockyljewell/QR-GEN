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
  },
});

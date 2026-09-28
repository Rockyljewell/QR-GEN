// Verifies that every internal link and asset in dist/ resolves to a built file.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const dist = resolve(process.argv[2] ?? "dist");
const base = (process.env.BASE ?? "/QR-GEN").replace(/\/$/, "");
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".html")) files.push(p);
  }
})(dist);

const broken = [];
let checked = 0;
for (const file of files) {
  const html = readFileSync(file, "utf8").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<template[\s\S]*?<\/template>/g, "");
  const pageUrl = new URL(`http://x${base}/${relative(dist, file).replace(/index\.html$/, "").replace(/\\/g, "/")}`);
  for (const m of html.matchAll(/\s(?:href|src)="([^"#?]+)(?:[?#][^"]*)?"/g)) {
    const ref = m[1];
    if (/^(https?:|mailto:|tel:|sms:|data:|javascript:|blob:)/.test(ref) || ref.startsWith("//")) continue;
    const u = new URL(ref, pageUrl);
    if (!u.pathname.startsWith(`${base}/`)) {
      broken.push(`${relative(dist, file)} → ${ref} (outside base)`);
      continue;
    }
    const rel = decodeURIComponent(u.pathname.slice(base.length + 1));
    const target = join(dist, rel);
    checked++;
    const ok = existsSync(target) && (statSync(target).isFile() || existsSync(join(target, "index.html")));
    if (!ok) broken.push(`${relative(dist, file)} → ${ref}`);
  }
}
if (broken.length) {
  console.error(`✗ ${broken.length} broken internal links:\n  ${[...new Set(broken)].join("\n  ")}`);
  process.exit(1);
}
console.log(`✓ ${checked} internal links in ${files.length} pages resolve`);

// Turns the platform package READMEs into docs pages (src/content/docs/<slug>.md), so the
// website and the packages never drift apart. Relative links are rewritten to GitHub URLs.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const out = resolve(here, "../src/content/docs");
const GH = "https://github.com/Rockyljewell/QR-GEN";

const PAGES = [
  { pkg: "packages/ios", slug: "ios", title: "iOS & macOS (Swift)", label: "iOS", group: "Mobile & desktop", order: 1, badge: "Swift", status: "beta", description: "Scan barcodes and QR codes in iOS and macOS apps with QRGenKit: SwiftUI and UIKit scanner views on AVFoundation and Apple Vision, image scanning, generation and parsers." },
  { pkg: "packages/android", slug: "android", title: "Android (Kotlin)", label: "Android", group: "Mobile & desktop", order: 2, badge: "Kotlin", status: "beta", description: "Scan barcodes and QR codes in Android apps with QRGen: a CameraX + ML Kit scanner view, a Jetpack Compose component, image scanning, generation and parsers." },
  { pkg: "packages/react-native", slug: "react-native", title: "React Native", group: "Mobile & desktop", order: 3, badge: "TypeScript", status: "beta", description: "Scan barcodes in React Native and Expo apps with qrgen-react-native: native scanning on VisionCamera, or a zero-setup WebView scanner." },
  { pkg: "packages/flutter", slug: "flutter", title: "Flutter", group: "Mobile & desktop", order: 4, badge: "Dart", status: "beta", description: "Scan barcodes in Flutter apps with qrgen_flutter: a mobile_scanner-based widget and a WebView scanner that reads every QRGen symbology." },
  { pkg: "packages/dotnet", slug: "dotnet", title: ".NET, MAUI & Xamarin", label: ".NET & MAUI", group: "Mobile & desktop", order: 10, badge: "C#", status: "beta", description: "QRGen.Net for .NET: GS1/AAMVA/content parsers, a REST client, local encode/decode with ZXing.Net, and a .NET MAUI camera scanner page." },
  { pkg: "packages/python", slug: "python", title: "Python", group: "Server & Linux", order: 4, badge: "Python", status: "beta", description: "Scan images and webcams, generate barcodes, parse GS1 and driver licenses, and run the REST API with the qrgen-sdk Python package." },
];

function rewriteLinks(md, pkg) {
  return md.replace(/(\]\()([^)\s]+)(\))/g, (m, a, href, b) => {
    if (/^(https?:|mailto:|#)/.test(href)) return m;
    const [path, hash = ""] = href.split("#");
    const target = posix.normalize(posix.join(pkg, path));
    const isDir = !/\.[a-z0-9]+$/i.test(target);
    return `${a}${GH}/${isDir ? "tree" : "blob"}/main/${target}${hash ? `#${hash}` : ""}${b}`;
  });
}

let n = 0;
for (const p of PAGES) {
  const file = resolve(repo, p.pkg, "README.md");
  if (!existsSync(file)) continue;
  let md = readFileSync(file, "utf8");
  md = md.replace(/^# .*\n+/, ""); // the layout renders the title
  md = rewriteLinks(md, p.pkg);
  const fm = [
    "---",
    `title: ${JSON.stringify(p.title)}`,
    `description: ${JSON.stringify(p.description)}`,
    `group: ${JSON.stringify(p.group)}`,
    `order: ${p.order}`,
    p.label ? `label: ${JSON.stringify(p.label)}` : null,
    `badge: ${JSON.stringify(p.badge)}`,
    `status: ${p.status}`,
    "---",
    "",
    `> **Note:** This page is generated from [\`${p.pkg}/README.md\`](${GH}/blob/main/${p.pkg}/README.md). Source code: [\`${p.pkg}\`](${GH}/tree/main/${p.pkg}).`,
    "",
  ].filter((l) => l !== null);
  writeFileSync(resolve(out, `${p.slug}.md`), `${fm.join("\n")}\n${md}`);
  n++;
}
console.log(`[site] synced ${n} platform READMEs into the docs`);

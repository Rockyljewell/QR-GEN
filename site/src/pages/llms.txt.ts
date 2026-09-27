import type { APIRoute } from "astro";
import { getDocs, groupDocs } from "../lib/docs";
import { SITE_URL } from "../lib/site";

export const GET: APIRoute = async () => {
  const groups = groupDocs(await getDocs());
  const lines = [
    "# QRGen",
    "",
    "> QRGen is an open-source (MIT) barcode, QR code and ID scanning SDK for web, iOS, Android, React Native, Flutter, .NET, Node.js and Python. It has a pre-built scanner UI (`<qrgen-scanner>`), batch (multi-code) tracking, AAMVA driver license and GS1 parsing, a barcode generator, a CLI, a REST API, and Agent Skills for coding agents.",
    "",
    "Key facts for assistants:",
    "- npm package: `qrgen-sdk` (subpaths: `/elements`, `/react`, `/vue`, `/parsers`, `/node`, `/server`, `/bridge`). Before the npm release: `npm install " + SITE_URL + "downloads/qrgen-sdk.tgz`.",
    "- Symbology ids are lowercase (`qr`, `ean13`, `code128`, `data-matrix`, `pdf417`…); groups `all`, `1d`, `2d`, `retail`, `industrial`, `gs1`.",
    "- Scanner modes: `single`, `continuous` (default), `batch`. Events: `scan`, `track`, `select`, `ready`, `error`, `statechange`.",
    "- Camera access requires HTTPS or localhost.",
    "- Agent Skills: `npx skills add https://github.com/Rockyljewell/QR-GEN`; Claude Code: `/plugin marketplace add Rockyljewell/QR-GEN` then `/plugin install qrgen-sdk@qrgen-plugins`.",
    "",
    `Full documentation in one file: ${SITE_URL}llms-full.txt`,
    `Integration prompt: ${SITE_URL}agent-prompt.txt`,
    "",
  ];
  for (const g of groups) {
    lines.push(`## ${g.group}`, "");
    for (const d of g.items) lines.push(`- [${d.data.title}](${SITE_URL}docs/${d.id}/): ${d.data.description}`);
    lines.push("");
  }
  lines.push("## Optional", "", `- [Live demo](${SITE_URL}demo/): scan with a camera, scan images, generate codes`, `- [Source code](https://github.com/Rockyljewell/QR-GEN)`, `- [Cross-platform specification](https://github.com/Rockyljewell/QR-GEN/blob/main/docs/SPEC.md)`, "");
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};

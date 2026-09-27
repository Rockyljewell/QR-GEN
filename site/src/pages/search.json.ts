import type { APIRoute } from "astro";
import { getDocs } from "../lib/docs";
import { url } from "../lib/site";

const PAGES = [
  { title: "Home", description: "Open-source barcode, QR and ID scanning SDK.", url: "/" },
  { title: "Live demo", description: "Scan with your camera, scan images, generate codes.", url: "/demo/" },
  { title: "Barcode generator", description: "Create QR, Data Matrix, EAN, GS1-128 and more.", url: "/demo/#generate" },
  { title: "SDK & Frameworks", description: "Every platform and framework QRGen supports.", url: "/sdk/" },
  { title: "Agent Skills", description: "Install QRGen skills for Claude Code, Cursor, Codex and other agents.", url: "/agent-skills/" },
  { title: "Barcode Scanning", description: "26 symbologies with a pre-built UI.", url: "/products/barcode-scanning/" },
  { title: "Batch Scanning", description: "Track many barcodes at once.", url: "/products/batch-scanning/" },
  { title: "ID Scanning", description: "Driver licenses and age verification.", url: "/products/id-scanning/" },
  { title: "Barcode Generator product", description: "Print-ready barcodes everywhere.", url: "/products/barcode-generator/" },
  { title: "Solutions", description: "Retail, logistics, healthcare, manufacturing, events.", url: "/solutions/" },
  { title: "Pricing", description: "Free and MIT licensed.", url: "/pricing/" },
  { title: "About", description: "Mission, open source and privacy.", url: "/about/" },
];

const strip = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_`|[\]()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const GET: APIRoute = async () => {
  const docs = await getDocs();
  const entries = [
    ...PAGES.map((p) => ({ ...p, url: url(p.url), group: "Pages", text: "", headings: [] as string[] })),
    ...docs.map((d) => ({
      title: d.data.title,
      description: d.data.description,
      group: d.data.group,
      url: url(`/docs/${d.id}/`),
      headings: [...(d.body ?? "").matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1]!),
      text: strip(d.body ?? "").slice(0, 3000),
    })),
  ];
  return new Response(JSON.stringify(entries), { headers: { "Content-Type": "application/json" } });
};

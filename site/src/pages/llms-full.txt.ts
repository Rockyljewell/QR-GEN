import type { APIRoute } from "astro";
import { getDocs } from "../lib/docs";
import { SITE_URL } from "../lib/site";

export const GET: APIRoute = async () => {
  const docs = await getDocs();
  const parts = [
    "# QRGen documentation (full text)",
    "",
    `Source: ${SITE_URL}docs/ · Repository: https://github.com/Rockyljewell/QR-GEN · License: Apache-2.0 (created by Rockyljewell; keep NOTICE when redistributing)`,
    "",
  ];
  for (const d of docs) {
    parts.push("", "---", "", `# ${d.data.title}`, "", `URL: ${SITE_URL}docs/${d.id}/`, `Group: ${d.data.group}`, "", `> ${d.data.description}`, "", (d.body ?? "").trim(), "");
  }
  return new Response(parts.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};

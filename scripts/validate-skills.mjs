// Validates the Agent Skills and the Claude Code marketplace manifest:
// every skill folder has a SKILL.md with a matching `name` and a `description`,
// every path in .claude-plugin/marketplace.json exists, and every relative link resolves.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const skillsDir = join(root, "skills");
const names = [];

for (const dir of readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const file = join(skillsDir, dir.name, "SKILL.md");
  if (!existsSync(file)) {
    errors.push(`${dir.name}: missing SKILL.md`);
    continue;
  }
  const md = readFileSync(file, "utf8");
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(md)?.[1];
  if (!fm) {
    errors.push(`${dir.name}: missing YAML frontmatter`);
    continue;
  }
  const name = /^name:\s*(.+)$/m.exec(fm)?.[1]?.trim();
  const description = /^description:\s*(.+)$/m.exec(fm)?.[1]?.trim();
  if (name !== dir.name) errors.push(`${dir.name}: name "${name}" must match the folder name`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name ?? "") || (name ?? "").length > 64) errors.push(`${dir.name}: invalid name`);
  if (!description || description.length < 40 || description.length > 1024) errors.push(`${dir.name}: description must be 40-1024 characters`);
  names.push(name);
  const walk = (d) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (p.endsWith(".md")) {
        for (const m of readFileSync(p, "utf8").matchAll(/\]\((?!https?:|#|mailto:)([^)\s#]+)/g)) {
          if (!existsSync(resolve(dirname(p), m[1]))) errors.push(`${p.slice(root.length + 1)}: broken link ${m[1]}`);
        }
      }
    }
  };
  walk(join(skillsDir, dir.name));
}

const market = JSON.parse(readFileSync(join(root, ".claude-plugin/marketplace.json"), "utf8"));
for (const plugin of market.plugins ?? []) {
  const base = resolve(root, plugin.source ?? ".");
  for (const s of plugin.skills ?? []) {
    if (!existsSync(join(base, s, "SKILL.md"))) errors.push(`marketplace: ${plugin.name} lists missing skill ${s}`);
  }
  const listed = (plugin.skills ?? []).map((s) => s.split("/").pop());
  for (const n of names) if (!listed.includes(n)) errors.push(`marketplace: skill ${n} is not listed in plugin ${plugin.name}`);
}

if (errors.length) {
  console.error(`✗ ${errors.length} problem(s):\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
console.log(`✓ ${names.length} skills and the marketplace manifest are valid`);

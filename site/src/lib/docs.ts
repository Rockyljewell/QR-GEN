import { getCollection, type CollectionEntry } from "astro:content";

export const GROUPS = ["Get started", "Web", "Mobile & desktop", "Server & Linux", "Features", "Reference"] as const;

export type DocEntry = CollectionEntry<"docs">;

/** Packages whose README is synced into the docs (see scripts/sync-readmes.mjs). */
export const README_SOURCES: Record<string, string> = {
  ios: "packages/ios/README.md",
  android: "packages/android/README.md",
  "react-native": "packages/react-native/README.md",
  flutter: "packages/flutter/README.md",
  dotnet: "packages/dotnet/README.md",
  python: "packages/python/README.md",
};

export async function getDocs(): Promise<DocEntry[]> {
  const docs = await getCollection("docs");
  return docs.sort((a, b) => {
    const g = GROUPS.indexOf(a.data.group) - GROUPS.indexOf(b.data.group);
    return g !== 0 ? g : a.data.order - b.data.order || a.data.title.localeCompare(b.data.title);
  });
}

export function groupDocs(docs: DocEntry[]): { group: string; items: DocEntry[] }[] {
  return GROUPS.map((group) => ({ group, items: docs.filter((d) => d.data.group === group) })).filter((g) => g.items.length);
}

export function sourcePath(id: string): string {
  return README_SOURCES[id] ?? `site/src/content/docs/${id}.md`;
}

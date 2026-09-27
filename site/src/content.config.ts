import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const docs = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/docs" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    /** Sidebar group. */
    group: z.enum(["Get started", "Web", "Mobile & desktop", "Server & Linux", "Features", "Reference"]),
    order: z.number().default(100),
    /** Short sidebar label (defaults to title). */
    label: z.string().optional(),
    /** Platform badge shown next to the title, e.g. "Swift", "Kotlin". */
    badge: z.string().optional(),
    /** Package status for platform guides. */
    status: z.enum(["stable", "beta", "preview", "guide"]).optional(),
  }),
});

export const collections = { docs };

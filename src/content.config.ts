import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { newsSummarySchema } from "./content/news-summary";
import { contentPath } from "./site/content-dir";

const news = defineCollection({
  loader: glob({ base: contentPath("news"), pattern: "**/*.md" }),
  schema: newsSummarySchema,
});

export const collections = { news };

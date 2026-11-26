// Writes content entries into the content folder as Markdown files with YAML frontmatter.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ContentEntry } from "./types";

export async function writeEntries(contentDir: string, entries: ContentEntry[]): Promise<void> {
  for (const entry of entries) {
    const file = path.join(contentDir, entry.path);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, toMarkdown(entry));
  }
}

function toMarkdown(entry: ContentEntry): string {
  return `---\n${yamlLines(entry.data, "").join("\n")}\n---\n${entry.body.replace(/\n*$/, "\n")}`;
}

// Enough YAML for frontmatter: scalars, nested objects, lists, and lists of objects.
// Strings are written as JSON strings, which are valid double-quoted YAML scalars.
function yamlLines(value: object, indent: string): string[] {
  return Object.entries(value).flatMap(([key, field]) => {
    if (isObject(field)) {
      return Object.keys(field).length === 0 ? [`${indent}${key}: {}`] : [`${indent}${key}:`, ...yamlLines(field, `${indent}  `)];
    }
    if (!Array.isArray(field)) return [`${indent}${key}: ${scalar(field)}`];
    if (field.length === 0) return [`${indent}${key}: []`];
    return [
      `${indent}${key}:`,
      ...field.flatMap((item) => {
        if (typeof item !== "object" || item === null) return [`${indent}  - ${scalar(item)}`];
        const [first, ...rest] = yamlLines(item, `${indent}    `);
        return [`${indent}  - ${first!.trimStart()}`, ...rest];
      }),
    ];
  });
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalar(value: unknown): string {
  return JSON.stringify(value);
}

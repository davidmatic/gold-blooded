// The content store: content entries as Markdown files with YAML frontmatter in the content folder.
// Writes entries, reads one back, and reads one back held to its content schema.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "astro/zod";
import { parse as parseYaml } from "yaml";
import type { ContentEntry } from "./types";

export async function writeEntries(contentDir: string, entries: ContentEntry[]): Promise<void> {
  for (const entry of entries) {
    const file = path.join(contentDir, entry.path);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, toMarkdown(entry));
  }
}

/**
 * Reads one Markdown entry back: its frontmatter and its body. Undefined when the file doesn't
 * exist. Files may be hand-edited, so the frontmatter is parsed as any YAML.
 */
export async function readEntry(contentDir: string, entryPath: string): Promise<{ data: unknown; body: string } | undefined> {
  const text = await readFile(path.join(contentDir, entryPath), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (text === undefined) return undefined;
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error(`${entryPath} has no frontmatter`);
  return { data: parseYaml(match[1]!), body: match[2]! };
}

/**
 * Reads one entry back and holds its frontmatter to its schema. Undefined when the file doesn't
 * exist. A file that doesn't match (a broken hand edit) fails the run, saying what that stops,
 * rather than being overwritten by an update that would lose what it held.
 */
export async function readValid<T>(contentDir: string, file: string, schema: z.ZodType<T>, consequence: string): Promise<{ data: T; body: string } | undefined> {
  const entry = await readEntry(contentDir, file);
  if (!entry) return undefined;
  const parsed = schema.safeParse(entry.data);
  if (!parsed.success) throw new Error(`${file} doesn't match its schema, so ${consequence} (fix the file): ${schemaIssues(parsed.error, "frontmatter")}`);
  return { data: parsed.data, body: entry.body };
}

/** A schema failure's issues as one line: "quotes.0.source: ...; title: ...". `root` names an issue with no path. */
export function schemaIssues(error: z.ZodError, root: string): string {
  return error.issues.map((issue) => `${issue.path.join(".") || root}: ${issue.message}`).join("; ");
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

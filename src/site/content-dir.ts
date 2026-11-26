// Where the site reads its content (Markdown + data files) from.
// Defaults to `content/` at the repo root. The built-site tests point it at a fixture
// folder through GOLD_BLOODED_CONTENT_DIR, so content collections should build their
// loaders from this, e.g. `glob({ base: contentPath("news"), pattern: "**/*.md" })`.
import path from "node:path";

export function contentDir(): string {
  return path.resolve(process.env.GOLD_BLOODED_CONTENT_DIR ?? "content");
}

export function contentPath(...segments: string[]): string {
  return path.join(contentDir(), ...segments);
}

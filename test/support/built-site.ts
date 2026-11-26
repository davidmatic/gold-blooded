// Seam 2 of the spec: the built site.
// Runs the real Astro build against a fixture content folder and exposes the generated HTML.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixturesRoot = path.join(projectRoot, "test", "fixtures");

export const BASE_PATH = "/gold-blooded/";

export interface BuiltSite {
  outDir: string;
  /** Every generated HTML page, as a site path such as `/gold-blooded/` or `/gold-blooded/news/`. */
  pagePaths(): Promise<string[]>;
  /** The HTML for a site path, e.g. `html("/gold-blooded/")`. */
  html(sitePath: string): Promise<string>;
  /** Every generated file, relative to the output folder. */
  files(): Promise<string[]>;
  cleanup(): Promise<void>;
}

// Vitest puts Vite's env (BASE_URL, MODE, NODE_ENV=test, ...) into process.env.
// The child build would read them as its own, so drop them to build as `npm run build` does.
const VITEST_ENV = ["BASE_URL", "MODE", "DEV", "PROD", "SSR", "NODE_ENV", "TEST"];

function buildEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !VITEST_ENV.includes(key) && !key.startsWith("VITEST")),
  );
}

/**
 * Build the site against `test/fixtures/<fixture>` as its content folder.
 * The content folder is handed to the build through `GOLD_BLOODED_CONTENT_DIR`.
 */
export async function buildSite(fixture: string): Promise<BuiltSite> {
  const contentDir = path.join(fixturesRoot, fixture);
  const outDir = await mkdtemp(path.join(tmpdir(), "gold-blooded-build-"));
  const astro = path.join(projectRoot, "node_modules", ".bin", "astro");

  await run(astro, ["build", "--outDir", outDir, "--silent"], {
    cwd: projectRoot,
    env: { ...buildEnv(), GOLD_BLOODED_CONTENT_DIR: contentDir },
  });

  const files = async () =>
    (await readdir(outDir, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(outDir, path.join(entry.parentPath, entry.name)));

  const toFile = (sitePath: string) => {
    if (!sitePath.startsWith(BASE_PATH)) {
      throw new Error(`${sitePath} is outside the base path ${BASE_PATH}`);
    }
    const rel = sitePath.slice(BASE_PATH.length);
    return path.join(outDir, rel.endsWith(".html") ? rel : path.join(rel, "index.html"));
  };

  return {
    outDir,
    files,
    async pagePaths() {
      return (await files())
        .filter((file) => file.endsWith(".html"))
        .map((file) => BASE_PATH + file.replace(/(^|\/)index\.html$/, "$1"));
    },
    html: (sitePath) => readFile(toFile(sitePath), "utf8"),
    cleanup: () => rm(outDir, { recursive: true, force: true }),
  };
}

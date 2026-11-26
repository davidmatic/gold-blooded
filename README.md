# gold-blooded

Gold Blooded, an unofficial 49ers fan site. Static Astro site deployed to GitHub Pages at
https://davidmatic.github.io/gold-blooded/ (see `docs/adr/0001-static-site-with-scheduled-ai-content.md`).

## Local development

Requires Node 22.23.4+ (`.nvmrc` pins 24).

```sh
npm install
npm run dev      # local dev server
npm test         # vitest: built-site tests
npm run build    # static output in dist/
```

## Layout

- `src/pages/`: Astro routes. `[section].astro` renders placeholders for sections that don't have a page yet.
- `src/layouts/`, `src/components/`: shared layout, header nav, and the disclaimer footer.
- `src/site/`: plain TypeScript site config (sections, base-path links, content folder).
- `src/content/`: content type schemas (e.g. `news-summary.ts`), shared by the site's content
  collections (`src/content.config.ts`) and the publish pipeline.
- `src/pipeline/`: the publish pipeline. `publish()` in `publish.ts` is its single entry point (the
  spec's Seam 1); `runJob()` also writes the entries to the content folder when the run is published.
  `adapters/fixture.ts` holds the fixture source and writer adapters the workflows use for now.
- `scripts/publish.ts`: CLI the workflows run, e.g. `npx tsx scripts/publish.ts daily-news --date 2026-11-25`.
  Exits non-zero, writing nothing, when any publish check fails.
- `content/`: the content store (Markdown + data files). Override with `GOLD_BLOODED_CONTENT_DIR`.
  To fix or remove a published piece, edit or delete its file. News Summaries live in `content/news/`.
- `test/`: tests. `test/support/built-site.ts` builds the site against a fixture content folder in
  `test/fixtures/<name>/` and exposes the generated HTML (the spec's Seam 2). `test/support/fakes.ts`
  has the fake source and writer adapters for pipeline tests (Seam 1), which serve the recorded
  snapshots in `test/fixtures/snapshots/`. Tests never touch the network.

## Deploy

`.github/workflows/deploy.yml` tests, builds, and deploys to Pages on every push to `main`.
Pull requests run the tests and build only. Content workflows call it via `workflow_call` after
they commit, because pushes made with `GITHUB_TOKEN` don't trigger the push event.

`.github/workflows/daily-news.yml` runs the daily news job every morning. A published result is
committed to `main` and deployed; a rejected one fails the run (GitHub emails the owner) and commits
nothing. It uses the fixture adapters until the real ones land (#4).

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
  `adapters/real/` holds the real adapters: `sources.ts` fetches the Preferred Sources into a source
  snapshot (parsing lives in `parsers.ts`), and `claude-writer.ts` writes News Summaries with Claude.
  `adapters/fixture.ts` holds fixture adapters that serve recorded sources and canned drafts.
- `scripts/publish.ts`: CLI the workflows run, e.g.
  `npx tsx scripts/publish.ts daily-news --adapters real --date 2026-11-25` (`--adapters fixture`, the
  default, needs no network or key). Exits non-zero, writing nothing, when any publish check fails.
- `scripts/smoke-daily-news.ts`: manual smoke test for the real adapters (see below).
- `content/`: the content store (Markdown + data files). Override with `GOLD_BLOODED_CONTENT_DIR`.
  To fix or remove a published piece, edit or delete its file. News Summaries live in `content/news/`.
- `test/`: tests. `test/support/built-site.ts` builds the site against a fixture content folder in
  `test/fixtures/<name>/` and exposes the generated HTML (the spec's Seam 2). `test/support/fakes.ts`
  has the fake source and writer adapters for pipeline tests (Seam 1), which serve the recorded
  snapshots in `test/fixtures/snapshots/`. `test/fixtures/sources/` holds trimmed captures of the real
  source pages and feeds, which the parser and real-source tests read through a fake fetcher.
  Tests never touch the network or Claude.

## Sources

The daily news job (`adapters/real/sources.ts`) collects the job's day and the day before, in
Pacific time:

| Source | What | If it fails |
|---|---|---|
| 49ers.com `team/injury-report/` | the official injury report, as structured lines (`snapshot.injuryReport`) and as a document | run fails |
| 49ers.com `team/transactions/` | the day's transactions | run fails |
| 49ers.com `rss/news` | news articles, full text | run fails (one article that won't load falls back to its feed description) |
| 49ers.1rmg.com `transcripts/` | press conference transcripts, full text | run fails (one transcript that won't load is skipped) |
| NBC Sports Bay Area feed | articles, full text | skipped, run goes on |
| ESPN team news API (team 25) | 49ers stories, full text | skipped, run goes on |
| San Francisco Chronicle 49ers section | articles, full text | best effort: skipped when bot-blocked, run goes on |

Skipped outlets are listed in `snapshot.skipped`. Pro Football Reference is never scraped. Articles
already cited by a published News Summary are left out, so the same story isn't summarised twice.
Every fetch, and the source-link check, sends one honest User-Agent:
`gold-blooded-bot/1.0 (+https://davidmatic.github.io/gold-blooded/)`. The link check counts a link as
loading only on a 2xx with a body that isn't a bot-challenge page (ESPN answers some clients with an
empty 202).

## Claude writer

`adapters/real/claude-writer.ts` sends the snapshot to `claude-opus-5-5` through `@anthropic-ai/sdk`,
with a neutral news voice prompt and structured output matching the News Summary schema (including
the `injuries` and `quotes` the publish checks verify). It uses effort `medium`, caches the voice
prompt, and turns on the API's server-side refusal fallback (`fallbacks: "default"`). Transient
errors are retried twice; reaching the spend limit fails the run at once with a "spend limit
reached" error, and is never retried.

## Secrets and cost

The workflows read the Anthropic API key from the `ANTHROPIC_API_KEY` repository secret. To set it up:

1. In the [Claude Console](https://platform.claude.com/), create a dedicated workspace for Gold
   Blooded (the Default workspace can't have a spend limit), and create an API key in it.
2. Set its spend limit to **$20/month**: Console → Settings → Spend limits → Workspace limits.
3. Add the key to the repo: GitHub → Settings → Secrets and variables → Actions → New repository
   secret, name `ANTHROPIC_API_KEY`. Or: `gh secret set ANTHROPIC_API_KEY -R davidmatic/gold-blooded`.

One daily run sends roughly 30 documents (about 40K input tokens) and gets a few thousand tokens
back, a few tens of cents a day at Opus 5.5 prices, so it stays under the cap. When the cap is hit,
the API refuses requests; the daily job then fails with "Anthropic spend limit reached", commits
nothing, and the site keeps its previous version until the limit resets or is raised.

## Smoke test

The real adapters have no unit tests that touch the network or Claude. Check them by hand:

```sh
# Sources only (network, no key): prints every document, the injury report, and skipped outlets.
npx tsx scripts/smoke-daily-news.ts

# End to end: real sources, Claude, and every publish check. Writes nothing to content/.
ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/smoke-daily-news.ts --claude

# Optionally keep the published entries somewhere to look at them.
ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/smoke-daily-news.ts --claude --out /tmp/gb-news
```

Both take `--date YYYY-MM-DD` (default: today, Pacific). The full check is one real run of the daily
news workflow (Actions → Daily news → Run workflow): its News Summaries pass the checks, are
committed to `main`, and appear on the live site's News page.

## Deploy

`.github/workflows/deploy.yml` tests, builds, and deploys to Pages on every push to `main`.
Pull requests run the tests and build only. Content workflows call it via `workflow_call` after
they commit, because pushes made with `GITHUB_TOKEN` don't trigger the push event.

`.github/workflows/daily-news.yml` runs the daily news job every morning. A published result is
committed to `main` and deployed; a rejected one fails the run (GitHub emails the owner) and commits
nothing. It uses the real adapters and the `ANTHROPIC_API_KEY` secret.

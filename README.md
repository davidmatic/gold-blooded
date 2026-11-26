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
- `content/`: the content store (Markdown + data files). Override with `GOLD_BLOODED_CONTENT_DIR`.
- `test/`: tests. `test/support/built-site.ts` builds the site against a fixture content folder in
  `test/fixtures/<name>/` and exposes the generated HTML (the spec's Seam 2).

## Deploy

`.github/workflows/deploy.yml` tests, builds, and deploys to Pages on every push to `main`.
Pull requests run the tests and build only.

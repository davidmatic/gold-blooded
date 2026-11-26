import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '.claude/**'],
    // Built-site tests run real Astro builds, which share the project's .astro/ cache
    // (data store and prerender chunks), so concurrent builds clobber each other.
    fileParallelism: false,
  },
});

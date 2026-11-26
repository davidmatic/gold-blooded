// @ts-check
import { defineConfig } from "astro/config";

// Served from GitHub Pages as a project site: https://davidmatic.github.io/gold-blooded/
export default defineConfig({
  site: "https://davidmatic.github.io",
  base: "/gold-blooded/",
  trailingSlash: "always",
  output: "static",
});

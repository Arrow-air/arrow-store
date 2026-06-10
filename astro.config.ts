import node from '@astrojs/node';
import { defineConfig } from 'astro/config';

export default defineConfig({
  // Catalog pages are fully static; only the order intake API and the
  // confirmation page opt out of prerendering (`export const prerender = false`).
  output: 'static',
  adapter: node({ mode: 'standalone' }),
  // "build" (unlike the default "dist") is on the terraform-managed cspell
  // ignore list, keeping local `make cspell-test` runs clean.
  outDir: './build',
});

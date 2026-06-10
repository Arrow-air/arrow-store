import node from '@astrojs/node';
import { defineConfig } from 'astro/config';

export default defineConfig({
  // Catalog pages are fully static; only the order intake API and the
  // confirmation page opt out of prerendering (`export const prerender = false`).
  output: 'static',
  adapter: node({ mode: 'standalone' }),
  security: {
    checkOrigin: true,
    // Hosts the server trusts when reconstructing request URLs. Without an
    // entry here Astro ignores the Host header, computes a port-less origin,
    // and its CSRF check 403s every same-origin form POST (admin login,
    // order updates). Extend when the store gets a new domain.
    allowedDomains: [
      { hostname: 'localhost' },
      { hostname: '127.0.0.1' },
      { hostname: 'store.arrowair.com', protocol: 'https' },
    ],
  },
  // "build" (unlike the default "dist") is on the terraform-managed cspell
  // ignore list, keeping local `make cspell-test` runs clean.
  outDir: './build',
});

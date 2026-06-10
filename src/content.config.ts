import { glob } from 'astro/loaders';
import { defineCollection } from 'astro:content';

// Policy markdown comes from the synced catalog snapshot — run
// `npm run sync-catalog` before dev/check/build so .catalog/ exists.
const policies = defineCollection({
  loader: glob({ pattern: '*.md', base: './.catalog/policies' }),
});

export const collections = { policies };

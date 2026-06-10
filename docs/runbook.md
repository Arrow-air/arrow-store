# Arrow Store Runbook

## Local development

```sh
nvm use                  # Node 24+ (node:sqlite, native TS type stripping)
npm ci
npm run sync-catalog     # required once before dev/check/build
npm run dev              # http://localhost:4321
```

To develop against a local arrow-catalog checkout instead of GitHub:

```sh
ARROW_CATALOG_LOCAL_PATH=../arrow-catalog npm run sync-catalog
```

## Catalog sync & pinning

The catalog is pinned to a commit in `catalog.lock.json`. `npm run sync-catalog` fetches
`catalog/**` from GitHub at the pinned SHA into the gitignored `.catalog/` directory and
validates it (Zod schemas + cross-references). Validation failure fails the sync and the
build.

To bump the pin to the latest `main` of arrow-catalog:

```sh
node scripts/sync-catalog.ts --update
git add catalog.lock.json
git commit -m "chore: bump catalog pin"
```

Environment overrides: `ARROW_CATALOG_REPO`, `ARROW_CATALOG_REF`, `GITHUB_TOKEN` (raises
API rate limits; provided automatically in CI), `ARROW_CATALOG_LOCAL_PATH` (skips GitHub
entirely).

## Tests & checks

```sh
npm run check   # astro check (typecheck, includes .astro files)
npm test        # vitest: catalog validation, cart rules, order intake, e2e flow
make test       # terraform-provisioned sanity checks (editorconfig, cspell, markdown)
```

New vocabulary that trips cspell goes in `.cspell.project-words.txt`.

## Production build & run

```sh
npm run build               # sync-catalog + astro build
node ./build/server/entry.mjs
```

Run the server from the repo root: it reads the catalog snapshot from `./.catalog` and the
database from `./data/store.db` (override with `DB_PATH`). `HOST`/`PORT` env vars control
the listener. SQLite requires a persistent disk — deployment targets are VPS-style hosts,
not serverless (see docs/architecture.md).

## Admin workflow (manufacturers & store ops)

Admin views live under `/admin` (order list scoped by role, order detail with status /
payment / tracking updates and an audit trail). Authentication is access-key based:

```sh
node scripts/create-admin-user.ts --name "Thomas" --role manufacturer-admin --manufacturer thomas-texas
node scripts/create-admin-user.ts --name "Store Ops" --role store-admin
node scripts/create-admin-user.ts --list
node scripts/create-admin-user.ts --disable usr_...   # also revokes sessions
```

The access key is printed once and stored only as a hash — share it over a secure
channel. Users sign in at `/admin/login`; sessions last 30 days in an HttpOnly cookie.
`manufacturer-admin` users see only their manufacturer's orders; `store-admin` sees
everything. Every order change writes an `order_events` audit row with the actor.

Deploying to a new domain? Add it to `security.allowedDomains` in `astro.config.ts`,
or Astro's CSRF check will reject all form posts (403).

## Orders database

- Location: `data/store.db` (WAL mode; gitignored). Migrations apply automatically at
  startup from `src/server/migrations.ts`.
- Inspect: `sqlite3 data/store.db 'SELECT * FROM orders;'`
- **PII lives only in `order_contacts`.** Never add customer data to `orders`,
  `order_events`, logs, or API error messages.
- The customer's confirmation URL contains a raw access token; the DB stores only its
  SHA-256 hash. Treat confirmation URLs as secrets.
- Back up `data/` before any manual intervention. There is no admin UI yet (roadmap
  Phase 3); status updates happen via SQL until then.

## Secrets policy

No secrets are required for Phases 0-2. Never commit `.env` files. `GITHUB_TOKEN` in CI is
the ephemeral Actions token.

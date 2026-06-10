# Arrow Store Architecture

## Role

The store is a **frontend and private order workflow over canonical catalog data** — it is
not the source of truth for Arrow's products. Product, manufacturer, offer, and checkout
group records live in [arrow-catalog](https://github.com/Arrow-air/arrow-catalog) and are
consumed at build time. The store owns:

- cart and checkout intake
- private customer and order records (PII never leaves the store database)
- the payment handoff to manufacturer merchants of record (the store processes no payments)

## Stack

- **Astro 5** with static output. Catalog pages are build-time static HTML, which
  structurally enforces "the catalog is build-time truth". Only the order intake API
  (`POST /api/orders`) and the order confirmation page run on the server, via the Node
  adapter in standalone mode.
- **TypeScript (strict)** everywhere, including the catalog sync script (run directly with
  Node's native type stripping, Node >= 24).
- **Zod** does triple duty: catalog types (`z.infer`), build-time catalog validation, and
  checkout payload validation.
- **SQLite via `node:sqlite`** for the private orders database — zero native dependencies.
  All database access is isolated in `src/server/db.ts` so swapping to `better-sqlite3` or
  Postgres later is a one-module change.
- **No UI framework.** The cart is a small framework-free TypeScript module loaded as a
  client script.

## Catalog consumption

`npm run sync-catalog` (also the first step of `npm run build`) downloads `catalog/**` from
the arrow-catalog repo pinned to the commit recorded in `catalog.lock.json`, validates it
(schema + cross-references, mirroring arrow-catalog's `scripts/validate-catalog.py`), and
writes the snapshot to the gitignored `.catalog/` directory. A build fails on invalid
catalog data.

- Local development can point at a sibling checkout with `ARROW_CATALOG_LOCAL_PATH`.
- Bumping the pin: `node scripts/sync-catalog.ts --update`, then commit the lock file
  (`chore: bump catalog pin`).
- The resolved catalog commit SHA is stamped onto every order (`catalog_ref`) so any order
  can be traced to the exact catalog state it was created from — a prerequisite for the
  future order commitment hashes (roadmap Phase 4).

## Privacy model

Customer PII (name, email, phone, address) lives only in the `order_contacts` table, one
row per order, separate from the `orders` row. Order events (`order_events`) are an
append-only audit trail and never contain PII. This keeps the future Phase 4 commitment
hash (serialize `orders` + `order_items` + salted contact hash) possible without schema
surgery, and keeps PII out of logs, exports, and anything DAO-visible.

## Merchant-of-record boundary

A cart and therefore an order belongs to exactly **one checkout group** (one manufacturer
merchant of record). The client cart refuses to mix groups; the server re-validates this
plus offer existence, orderable status, and ship-country eligibility on every intake —
client data is never trusted for prices or IDs.

## Hosting constraint

SQLite implies a persistent-disk host (VPS / Fly / Render style), not serverless.
Deployment is out of scope for Phases 0-2; the build produces a host-agnostic standalone
Node server (`build/server/entry.mjs`).

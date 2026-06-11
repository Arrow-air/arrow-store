import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  CheckoutGroupSchema,
  ManifestSchema,
  ManufacturerSchema,
  ProductSchema,
  type Catalog,
  type CheckoutGroup,
  type Manufacturer,
  type Offer,
  type Product,
} from './schema.ts';
import { crossValidate } from './validate.ts';

export const DEFAULT_CATALOG_DIR = path.resolve(process.cwd(), '.catalog');

// Offer statuses a customer can act on right now. Everything else
// (waitlist, coming-soon, quote-required, out-of-stock) renders as
// informational and cannot be added to a cart.
const ORDERABLE_STATUSES: readonly string[] = ['available', 'limited-availability'];

let cache: { dir: string; catalog: Catalog } | null = null;

/**
 * Read, schema-validate, and cross-validate the synced catalog snapshot.
 * Throws with a descriptive error on any invalid data, even though the sync
 * script already validated — a hand-edited snapshot should still fail loudly.
 */
export function loadCatalog(dir: string = DEFAULT_CATALOG_DIR): Catalog {
  if (cache && cache.dir === dir) return cache.catalog;

  if (!existsSync(dir)) {
    throw new Error(
      `catalog snapshot not found at ${dir} — run \`npm run sync-catalog\` first`,
    );
  }

  const products = readJsonDir(path.join(dir, 'products')).map((entry) =>
    parseOrThrow(ProductSchema, entry),
  );
  const manufacturers = readJsonDir(path.join(dir, 'manufacturers')).map((entry) =>
    parseOrThrow(ManufacturerSchema, entry),
  );
  const checkoutGroups = readJsonDir(path.join(dir, 'checkout-groups')).map((entry) =>
    parseOrThrow(CheckoutGroupSchema, entry),
  );

  const policies: Record<string, string> = {};
  const policiesDir = path.join(dir, 'policies');
  if (existsSync(policiesDir)) {
    for (const file of readdirSync(policiesDir).filter((f) => f.endsWith('.md')).sort()) {
      policies[path.basename(file, '.md')] = readFileSync(path.join(policiesDir, file), 'utf8');
    }
  }

  const manifest = parseOrThrow(
    ManifestSchema,
    { path: path.join(dir, 'manifest.json'), data: readJson(path.join(dir, 'manifest.json')) },
  );

  const errors = crossValidate(products, manufacturers, checkoutGroups, new Set(Object.keys(policies)));
  if (errors.length > 0) {
    throw new Error(`catalog snapshot at ${dir} is invalid:\n  ${errors.join('\n  ')}`);
  }

  const catalog: Catalog = { products, manufacturers, checkoutGroups, policies, manifest };
  cache = { dir, catalog };
  return catalog;
}

export function clearCatalogCache(): void {
  cache = null;
}

export function getProductBySlug(slug: string, catalog: Catalog = loadCatalog()): Product | undefined {
  return catalog.products.find((product) => product.slug === slug);
}

export function getManufacturer(id: string, catalog: Catalog = loadCatalog()): Manufacturer | undefined {
  return catalog.manufacturers.find((manufacturer) => manufacturer.id === id);
}

export function getCheckoutGroup(id: string, catalog: Catalog = loadCatalog()): CheckoutGroup | undefined {
  return catalog.checkoutGroups.find((group) => group.id === id);
}

export interface OfferWithProduct {
  product: Product;
  offer: Offer;
}

export function findOfferById(offerId: string, catalog: Catalog = loadCatalog()): OfferWithProduct | undefined {
  for (const product of catalog.products) {
    const offer = product.offers.find((candidate) => candidate.id === offerId);
    if (offer) return { product, offer };
  }
  return undefined;
}

/** Offers a customer can see (everything except hidden). */
export function getVisibleOffers(product: Product): Offer[] {
  return product.offers.filter((offer) => offer.status !== 'hidden');
}

export function isOfferOrderable(offer: Offer): boolean {
  return ORDERABLE_STATUSES.includes(offer.status);
}

/** Other products that have an offer in the same checkout group (the v1 add-on heuristic). */
export function getAddOnProducts(product: Product, catalog: Catalog = loadCatalog()): Product[] {
  const groupIds = new Set(product.offers.map((offer) => offer.checkoutGroupId));
  return catalog.products.filter(
    (candidate) =>
      candidate.id !== product.id &&
      candidate.offers.some((offer) => offer.status !== 'hidden' && groupIds.has(offer.checkoutGroupId)),
  );
}

/**
 * Catalog seed data uses literal "TBD" (any casing) for unconfirmed values.
 * Map those, and missing values, to a graceful placeholder for display.
 */
export function displayValue(value: string | undefined, placeholder: string): string {
  if (!value || value.trim().toLowerCase() === 'tbd') return placeholder;
  return value;
}

interface RawEntry {
  path: string;
  data: unknown;
}

function readJsonDir(dir: string): RawEntry[] {
  if (!existsSync(dir)) {
    throw new Error(`catalog snapshot is missing directory ${dir} — re-run \`npm run sync-catalog\``);
  }
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const filePath = path.join(dir, file);
      return { path: filePath, data: readJson(filePath) };
    });
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${filePath}: failed to parse JSON: ${(error as Error).message}`);
  }
}

function parseOrThrow<Schema extends { safeParse: (data: unknown) => any }>(
  schema: Schema,
  entry: RawEntry,
): ReturnType<Schema['safeParse']> extends { data?: infer T } ? NonNullable<T> : never {
  const result = schema.safeParse(entry.data);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue: { path: PropertyKey[]; message: string }) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`${entry.path}: schema validation failed: ${issues}`);
  }
  return result.data;
}

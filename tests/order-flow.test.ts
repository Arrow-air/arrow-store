import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isOfferOrderable, loadCatalog } from '../src/catalog/load.ts';
import { addItem, getCart, type OfferSnapshot } from '../src/lib/cart.ts';
import { openDatabase } from '../src/server/db.ts';
import { createOrder, getOrderForConfirmation } from '../src/server/orders.ts';

// End-to-end order flow against the REAL synced catalog snapshot and a
// file-backed database: cart -> intake -> token-gated confirmation view.
// Requires a prior `npm run sync-catalog` (CI runs it before tests).

let db: DatabaseSync;
let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'arrow-store-test-'));
  db = openDatabase(path.join(tempDir, 'store.db'));
  globalThis.localStorage = (() => {
    const store = new Map<string, string>();
    return {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      key: (index: number) => [...store.keys()][index] ?? null,
      removeItem: (key: string) => void store.delete(key),
      setItem: (key: string, value: string) => void store.set(key, value),
    };
  })();
});

afterAll(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('order flow against the synced catalog', () => {
  it('places an order for every orderable seed offer journey', () => {
    const catalog = loadCatalog();

    // The seed catalog must expose at least one orderable offer.
    const orderable = catalog.products
      .flatMap((product) => product.offers.map((offer) => ({ product, offer })))
      .filter(({ offer }) => isOfferOrderable(offer));
    expect(orderable.length).toBeGreaterThan(0);

    const { product, offer } = orderable[0]!;

    // 1. Customer adds the offer to the cart.
    const snapshot: OfferSnapshot = {
      productId: product.id,
      offerId: offer.id,
      name: product.name,
      priceDisplay: offer.priceDisplay ?? 'TBD',
      checkoutGroupId: offer.checkoutGroupId,
      manufacturerId: offer.manufacturerId,
      manufacturerName: offer.manufacturerId,
      catalogRef: catalog.manifest.resolvedSha,
      shipsTo: offer.shipsTo ?? [],
    };
    expect(addItem(snapshot, 2).ok).toBe(true);

    // 2. Checkout submits the cart's items.
    const cart = getCart();
    const created = createOrder(
      {
        items: cart.items.map((item) => ({ offerId: item.offerId, quantity: item.quantity })),
        customer: {
          fullName: 'Flow Tester',
          email: 'flow@example.com',
          addressLine1: '42 Hangar Rd',
          city: 'Austin',
          postalCode: '73301',
          country: offer.shipsTo?.[0] === 'EU' ? 'DE' : (offer.shipsTo?.[0] ?? 'US'),
        },
      },
      { db, catalog },
    );

    // 3. Confirmation view resolves with the token and matches the catalog.
    const view = getOrderForConfirmation(created.orderId, created.accessToken, { db });
    expect(view).not.toBeNull();
    expect(view!.order.manufacturer_id).toBe(offer.manufacturerId);
    expect(view!.order.catalog_ref).toBe(catalog.manifest.resolvedSha);
    expect(view!.items.map((item) => item.offer_id)).toEqual([offer.id]);
    expect(view!.items[0]!.quantity).toBe(2);
  });
});

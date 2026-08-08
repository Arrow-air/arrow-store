import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Catalog } from '../src/catalog/schema.ts';
import { openDatabase } from '../src/server/db.ts';
import {
  createOrder,
  getOrderForConfirmation,
  OrderValidationError,
  type OrderInput,
} from '../src/server/orders.ts';

const catalog: Catalog = {
  manufacturers: [
    {
      id: 'thomas-texas',
      displayName: 'Thomas / Texas Workshop',
      companyName: 'TBD',
      regionLabel: 'Texas, USA',
      countryCode: 'US',
      approved: true,
      approvalStatus: 'trusted-mvp',
      merchantOfRecord: { legalName: 'TBD', jurisdiction: 'Texas, USA' },
      paymentCapabilities: ['card', 'usdc', 'invoice'],
      shipsFrom: ['Texas, USA'],
    },
    {
      id: 'julius-germany',
      displayName: 'Julius / Germany Workshop',
      companyName: 'TBD',
      regionLabel: 'Germany',
      countryCode: 'DE',
      approved: true,
      approvalStatus: 'trusted-mvp',
      merchantOfRecord: { legalName: 'TBD', jurisdiction: 'Germany / EU' },
      paymentCapabilities: ['card', 'usdc', 'invoice'],
      shipsFrom: ['Germany'],
    },
  ],
  checkoutGroups: [
    {
      id: 'thomas-store',
      manufacturerId: 'thomas-texas',
      mode: 'external-cart',
      supportsMultipleItems: true,
      supportsQuantities: true,
      supportedPaymentMethods: ['card', 'usdc', 'invoice'],
      merchantOfRecordName: 'TBD',
      immediatePayment: true,
    },
    {
      id: 'julius-store',
      manufacturerId: 'julius-germany',
      mode: 'external-cart',
      supportsMultipleItems: true,
      supportsQuantities: true,
      supportedPaymentMethods: ['card', 'usdc', 'invoice'],
      merchantOfRecordName: 'TBD',
      immediatePayment: true,
    },
  ],
  products: [
    {
      id: 'quiver-devkit-v0',
      slug: 'quiver-devkit',
      name: 'Quiver DevKit',
      category: 'aircraft-devkit',
      status: 'limited-availability',
      shortDescription: 'Devkit.',
      standards: [],
      supportPolicyId: 'support',
      warrantyPolicyId: 'warranty',
      updatedAt: '2026-06-07',
      offers: [
        {
          id: 'quiver-devkit-thomas-texas',
          manufacturerId: 'thomas-texas',
          checkoutGroupId: 'thomas-store',
          status: 'limited-availability',
          shipsTo: ['US'],
          priceDisplay: '$4,900 USD',
          price: { amount: 490000, currency: 'USD' },
          checkout: { mode: 'manufacturer-site', ctaLabel: 'Buy', immediatePayment: true },
        },
        {
          id: 'quiver-devkit-julius-germany',
          manufacturerId: 'julius-germany',
          checkoutGroupId: 'julius-store',
          status: 'available',
          shipsTo: ['EU'],
          priceDisplay: 'TBD',
          checkout: {
            mode: 'manufacturer-site',
            ctaLabel: 'Buy',
            immediatePayment: true,
            url: 'https://example.com/julius-checkout',
          },
        },
      ],
    },
    {
      id: 'quiver-spare-propellers-v0',
      slug: 'quiver-spare-propellers',
      name: 'Quiver Spare Propellers',
      category: 'part',
      status: 'coming-soon',
      shortDescription: 'Spares.',
      standards: [],
      supportPolicyId: 'support',
      warrantyPolicyId: 'warranty',
      updatedAt: '2026-06-07',
      offers: [
        {
          id: 'spare-propellers-thomas-texas',
          manufacturerId: 'thomas-texas',
          checkoutGroupId: 'thomas-store',
          status: 'coming-soon',
          shipsTo: ['US'],
          checkout: { mode: 'manufacturer-site', ctaLabel: 'Add', immediatePayment: true },
        },
      ],
    },
  ],
  policies: { support: '# Support', warranty: '# Warranty' },
  manifest: {
    repo: 'test',
    resolvedSha: 'cafebabe00000000000000000000000000000000',
    syncedAt: '2026-06-10T00:00:00Z',
    source: 'local',
  },
};

const customer = {
  fullName: 'Ada Lovelace',
  email: 'ada@example.com',
  addressLine1: '1 Engine Way',
  city: 'Austin',
  region: 'TX',
  postalCode: '73301',
  country: 'US',
};

function makeInput(overrides: Partial<OrderInput> = {}): OrderInput {
  return {
    items: [{ offerId: 'quiver-devkit-thomas-texas', quantity: 1 }],
    customer,
    customerNotes: 'Please pack carefully.',
    ...overrides,
  };
}

let db: DatabaseSync;

beforeEach(() => {
  db = openDatabase(':memory:');
});

describe('createOrder', () => {
  it('persists order, items, contact, and audit event', () => {
    const created = createOrder(makeInput(), { db, catalog });
    expect(created.orderId).toMatch(/^ord_[0-9A-Z]{26}$/);
    expect(created.accessToken.length).toBeGreaterThanOrEqual(32);

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(created.orderId) as Record<
      string,
      unknown
    >;
    expect(order.status).toBe('received');
    expect(order.manufacturer_id).toBe('thomas-texas');
    expect(order.checkout_group_id).toBe('thomas-store');
    expect(order.catalog_ref).toBe(catalog.manifest.resolvedSha);
    expect(order.ship_country).toBe('US');
    expect(order.payment_mode).toBe('manual-invoice');
    expect(order.payment_status).toBe('pending');

    const items = db
      .prepare('SELECT * FROM order_items WHERE order_id = ?')
      .all(created.orderId) as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]!.offer_id).toBe('quiver-devkit-thomas-texas');
    expect(items[0]!.product_id).toBe('quiver-devkit-v0');
    expect(items[0]!.name_snapshot).toBe('Quiver DevKit');

    const contact = db
      .prepare('SELECT * FROM order_contacts WHERE order_id = ?')
      .get(created.orderId) as Record<string, unknown>;
    expect(contact.email).toBe('ada@example.com');

    const events = db
      .prepare('SELECT * FROM order_events WHERE order_id = ?')
      .all(created.orderId) as Array<Record<string, unknown>>;
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe('order-created');
  });

  it('stores machine prices and the subtotal when the catalog provides them', () => {
    const created = createOrder(
      makeInput({ items: [{ offerId: 'quiver-devkit-thomas-texas', quantity: 2 }] }),
      { db, catalog },
    );
    const order = db
      .prepare('SELECT currency, subtotal_minor FROM orders WHERE id = ?')
      .get(created.orderId) as { currency: string | null; subtotal_minor: number | null };
    expect(order).toEqual({ currency: 'USD', subtotal_minor: 980000 });
    const item = db
      .prepare('SELECT unit_price_minor FROM order_items WHERE order_id = ?')
      .get(created.orderId) as { unit_price_minor: number | null };
    expect(item.unit_price_minor).toBe(490000);
  });

  it('leaves totals null when an offer has no machine price', () => {
    const created = createOrder(
      makeInput({
        items: [{ offerId: 'quiver-devkit-julius-germany', quantity: 1 }],
        customer: { ...customer, country: 'DE' },
      }),
      { db, catalog },
    );
    const order = db
      .prepare('SELECT currency, subtotal_minor FROM orders WHERE id = ?')
      .get(created.orderId) as { currency: string | null; subtotal_minor: number | null };
    expect(order).toEqual({ currency: null, subtotal_minor: null });
  });

  it('keeps PII out of the orders row and audit events', () => {
    const created = createOrder(makeInput(), { db, catalog });
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(created.orderId)!;
    const event = db
      .prepare('SELECT data_json FROM order_events WHERE order_id = ?')
      .get(created.orderId) as { data_json: string };
    const orderJson = JSON.stringify(order);
    for (const value of ['Ada', 'ada@example.com', 'Engine Way', '73301']) {
      expect(orderJson).not.toContain(value);
      expect(event.data_json).not.toContain(value);
    }
  });

  it('uses the external checkout link payment mode when the catalog has a URL', () => {
    const created = createOrder(
      makeInput({
        items: [{ offerId: 'quiver-devkit-julius-germany', quantity: 1 }],
        customer: { ...customer, country: 'DE' },
      }),
      { db, catalog },
    );
    const order = db.prepare('SELECT payment_mode FROM orders WHERE id = ?').get(created.orderId) as {
      payment_mode: string;
    };
    expect(order.payment_mode).toBe('manufacturer-site');
  });

  it('persists the chosen payment method (card/usdc) and defaults to null when absent', () => {
    // Nominal: card
    const cardOrder = createOrder(makeInput({ paymentMethod: 'card' }), { db, catalog });
    const card = db
      .prepare('SELECT payment_method FROM orders WHERE id = ?')
      .get(cardOrder.orderId) as { payment_method: string | null };
    expect(card.payment_method).toBe('card');

    // Nominal: usdc
    const usdcOrder = createOrder(makeInput({ paymentMethod: 'usdc' }), { db, catalog });
    const usdc = db
      .prepare('SELECT payment_method FROM orders WHERE id = ?')
      .get(usdcOrder.orderId) as { payment_method: string | null };
    expect(usdc.payment_method).toBe('usdc');

    // Absent → null (backward compatible)
    const noneOrder = createOrder(makeInput(), { db, catalog });
    const none = db
      .prepare('SELECT payment_method FROM orders WHERE id = ?')
      .get(noneOrder.orderId) as { payment_method: string | null };
    expect(none.payment_method).toBeNull();
  });

  it('expands the EU region token for ship-country checks', () => {
    const input = makeInput({
      items: [{ offerId: 'quiver-devkit-julius-germany', quantity: 1 }],
      customer: { ...customer, country: 'FR' },
    });
    expect(() => createOrder(input, { db, catalog })).not.toThrow();
  });

  it('rejects countries outside the offer shipsTo list', () => {
    const input = makeInput({ customer: { ...customer, country: 'DE' } });
    expect(() => createOrder(input, { db, catalog })).toThrow(OrderValidationError);
    expect(() => createOrder(input, { db, catalog })).toThrow(/does not ship to DE/);
  });

  it('rejects items from mixed checkout groups', () => {
    const input = makeInput({
      items: [
        { offerId: 'quiver-devkit-thomas-texas', quantity: 1 },
        { offerId: 'quiver-devkit-julius-germany', quantity: 1 },
      ],
    });
    expect(() => createOrder(input, { db, catalog })).toThrow(/one manufacturer checkout group/);
  });

  it('rejects non-orderable offers', () => {
    const input = makeInput({ items: [{ offerId: 'spare-propellers-thomas-texas', quantity: 1 }] });
    expect(() => createOrder(input, { db, catalog })).toThrow(/not currently orderable/);
  });

  it('rejects unknown offers', () => {
    const input = makeInput({ items: [{ offerId: 'made-up-offer', quantity: 1 }] });
    expect(() => createOrder(input, { db, catalog })).toThrow(/unknown offer/);
  });

  it('rejects duplicate offers and bad quantities', () => {
    expect(() =>
      createOrder(
        makeInput({
          items: [
            { offerId: 'quiver-devkit-thomas-texas', quantity: 1 },
            { offerId: 'quiver-devkit-thomas-texas', quantity: 2 },
          ],
        }),
        { db, catalog },
      ),
    ).toThrow(/duplicate offer/);
    expect(() =>
      createOrder(makeInput({ items: [{ offerId: 'quiver-devkit-thomas-texas', quantity: 0 }] }), {
        db,
        catalog,
      }),
    ).toThrow(/invalid quantity/);
  });

  it('rolls back everything when an insert fails mid-transaction', () => {
    db.exec('DROP TABLE order_contacts');
    expect(() => createOrder(makeInput(), { db, catalog })).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM orders').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM order_items').get()).toEqual({ n: 0 });
  });
});

describe('getOrderForConfirmation', () => {
  it('returns the order view for a valid token only', () => {
    const created = createOrder(makeInput(), { db, catalog });
    const view = getOrderForConfirmation(created.orderId, created.accessToken, { db });
    expect(view).not.toBeNull();
    expect(view!.order.id).toBe(created.orderId);
    expect(view!.items[0]!.name_snapshot).toBe('Quiver DevKit');
    expect(view!.contact.full_name).toBe('Ada Lovelace');
    expect(view!.order).not.toHaveProperty('access_token_hash');

    expect(getOrderForConfirmation(created.orderId, 'wrong-token', { db })).toBeNull();
    expect(getOrderForConfirmation('ord_DOESNOTEXIST00000000000000', created.accessToken, { db })).toBeNull();
  });
});

import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Catalog } from '../src/catalog/schema.ts';
import {
  applyOrderUpdate,
  getAdminOrder,
  listFeeReconciliation,
} from '../src/server/admin-orders.ts';
import { createAdminUser } from '../src/server/auth.ts';
import { computeCommitmentHash } from '../src/server/commitment.ts';
import { openDatabase } from '../src/server/db.ts';
import { createOrder } from '../src/server/orders.ts';

// JPL-shaped fixture: 20% percent-of-gross fee on the devkit, no fee on the
// pass-through propeller (mirrors the merged catalog config).
const catalog: Catalog = {
  manufacturers: [
    {
      id: 'thomas-texas',
      displayName: 'Javelina Propeller Laboratory',
      companyName: 'Javelina Propeller Laboratory LLC',
      regionLabel: 'Texas, USA',
      countryCode: 'US',
      approved: true,
      approvalStatus: 'trusted-mvp',
      merchantOfRecord: { legalName: 'Javelina Propeller Laboratory LLC', jurisdiction: 'Texas, USA' },
      paymentCapabilities: ['card', 'usdc', 'invoice'],
      shipsFrom: ['Texas, USA'],
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
      merchantOfRecordName: 'Javelina Propeller Laboratory LLC',
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
      updatedAt: '2026-06-11',
      offers: [
        {
          id: 'quiver-devkit-thomas-texas',
          manufacturerId: 'thomas-texas',
          checkoutGroupId: 'thomas-store',
          status: 'limited-availability',
          shipsTo: ['US'],
          priceDisplay: '$4,900 USD',
          price: { amount: 490000, currency: 'USD' },
          daoFee: { type: 'percent-of-gross', percent: 20, includedInPrice: true },
          checkout: { mode: 'manufacturer-site', ctaLabel: 'Buy', immediatePayment: true },
        },
      ],
    },
    {
      id: 'quiver-spare-propellers-v0',
      slug: 'quiver-spare-propellers',
      name: 'Quiver Spare Propeller (XRotor MFP 2480)',
      category: 'part',
      status: 'available',
      shortDescription: 'Spares.',
      standards: [],
      supportPolicyId: 'support',
      warrantyPolicyId: 'warranty',
      updatedAt: '2026-06-11',
      offers: [
        {
          id: 'spare-propellers-thomas-texas',
          manufacturerId: 'thomas-texas',
          checkoutGroupId: 'thomas-store',
          status: 'available',
          shipsTo: ['US'],
          priceDisplay: '$19.99 USD each',
          price: { amount: 1999, currency: 'USD' },
          checkout: { mode: 'manufacturer-site', ctaLabel: 'Add', immediatePayment: true },
        },
      ],
    },
  ],
  policies: { support: '# Support', warranty: '# Warranty' },
  manifest: {
    repo: 'test',
    resolvedSha: 'cafebabe00000000000000000000000000000000',
    syncedAt: '2026-06-11T00:00:00Z',
    source: 'local',
  },
};

const customer = {
  fullName: 'Ada Lovelace',
  email: 'ada@example.com',
  addressLine1: '1 Engine Way',
  city: 'Austin',
  postalCode: '73301',
  country: 'US',
};

let db: DatabaseSync;

beforeEach(() => {
  db = openDatabase(':memory:');
});

function placeMixedOrder(): string {
  return createOrder(
    {
      items: [
        { offerId: 'quiver-devkit-thomas-texas', quantity: 1 },
        { offerId: 'spare-propellers-thomas-texas', quantity: 2 },
      ],
      customer,
    },
    { db, catalog },
  ).orderId;
}

describe('dao fee computation at order intake', () => {
  it('freezes 20% of gross on the devkit and zero on pass-through parts', () => {
    const orderId = placeMixedOrder();
    const order = db
      .prepare('SELECT subtotal_minor, dao_fee_minor, dao_fee_status FROM orders WHERE id = ?')
      .get(orderId) as Record<string, unknown>;
    // subtotal 490000 + 2*1999 = 493998; fee = 20% of devkit line only = 98000
    expect(order).toEqual({ subtotal_minor: 493998, dao_fee_minor: 98000, dao_fee_status: 'pending' });

    const items = db
      .prepare('SELECT offer_id, dao_fee_bps, dao_fee_minor FROM order_items WHERE order_id = ? ORDER BY offer_id')
      .all(orderId) as Array<Record<string, unknown>>;
    expect(items).toEqual([
      { offer_id: 'quiver-devkit-thomas-texas', dao_fee_bps: 2000, dao_fee_minor: 98000 },
      { offer_id: 'spare-propellers-thomas-texas', dao_fee_bps: 0, dao_fee_minor: 0 },
    ]);
  });

  it('marks fee status none for zero-fee orders', () => {
    const created = createOrder(
      { items: [{ offerId: 'spare-propellers-thomas-texas', quantity: 1 }], customer },
      { db, catalog },
    );
    const order = db
      .prepare('SELECT dao_fee_minor, dao_fee_status FROM orders WHERE id = ?')
      .get(created.orderId) as Record<string, unknown>;
    expect(order).toEqual({ dao_fee_minor: 0, dao_fee_status: 'none' });
  });
});

describe('commitment hash', () => {
  it('is stored, versioned, and deterministic for the same inputs', () => {
    const orderId = placeMixedOrder();
    const order = db
      .prepare('SELECT * FROM orders WHERE id = ?')
      .get(orderId) as Record<string, any>;
    expect(order.commitment_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(order.commitment_version).toBe(1);

    // Recompute from stored data: identical inputs -> identical hash.
    const items = db
      .prepare(
        'SELECT product_id, offer_id, quantity, unit_price_minor, dao_fee_bps FROM order_items WHERE order_id = ?',
      )
      .all(orderId) as Array<Record<string, any>>;
    const recomputed = computeCommitmentHash(
      {
        orderId: order.id,
        createdAt: order.created_at,
        manufacturerId: order.manufacturer_id,
        checkoutGroupId: order.checkout_group_id,
        catalogRef: order.catalog_ref,
        shipCountry: order.ship_country,
        currency: order.currency,
        subtotalMinor: order.subtotal_minor,
        daoFeeMinor: order.dao_fee_minor,
        items: items.map((item) => ({
          productId: item.product_id,
          offerId: item.offer_id,
          quantity: item.quantity,
          unitPriceMinor: item.unit_price_minor,
          daoFeeBps: item.dao_fee_bps,
        })),
      },
      customer,
      order.contact_salt,
    );
    expect(recomputed).toBe(order.commitment_hash);
  });

  it('never embeds raw PII and changes with the salt', () => {
    const orderId = placeMixedOrder();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Record<string, any>;
    for (const value of ['Ada', 'ada@example.com', 'Engine Way', '73301']) {
      expect(order.commitment_hash).not.toContain(value);
    }
    const otherSalt = computeCommitmentHash(
      {
        orderId: order.id,
        createdAt: order.created_at,
        manufacturerId: order.manufacturer_id,
        checkoutGroupId: order.checkout_group_id,
        catalogRef: order.catalog_ref,
        shipCountry: order.ship_country,
        currency: order.currency,
        subtotalMinor: order.subtotal_minor,
        daoFeeMinor: order.dao_fee_minor,
        items: [],
      },
      customer,
      'different-salt',
    );
    expect(otherSalt).not.toBe(order.commitment_hash);
  });

  it('does not expose contact_salt through order views', () => {
    const orderId = placeMixedOrder();
    const { user } = createAdminUser({ displayName: 'Ops', role: 'store-admin' }, { db });
    const view = getAdminOrder(orderId, user, { db })!;
    expect(view.order).not.toHaveProperty('contact_salt');
    expect(view.order).not.toHaveProperty('access_token_hash');
  });
});

describe('fee reconciliation and remittance', () => {
  it('scopes rows, sums correctly, and stays PII-free', () => {
    const orderId = placeMixedOrder();
    const { user } = createAdminUser(
      { displayName: 'Thomas', role: 'manufacturer-admin', manufacturerId: 'thomas-texas' },
      { db },
    );
    const rows = listFeeReconciliation(user, { db });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(orderId);
    expect(rows[0]!.dao_fee_minor).toBe(98000);
    expect(JSON.stringify(rows)).not.toContain('ada@example.com');
  });

  it('marks fees remitted with an audited reference', () => {
    const orderId = placeMixedOrder();
    const { user } = createAdminUser(
      { displayName: 'Thomas', role: 'manufacturer-admin', manufacturerId: 'thomas-texas' },
      { db },
    );
    const written = applyOrderUpdate(
      orderId,
      { daoFeeStatus: 'remitted', daoFeeReference: 'usdc-tx-0xabc' },
      user,
      { db },
    );
    expect(written.sort()).toEqual(['dao-fee-reference-updated', 'dao-fee-status-changed']);

    const view = getAdminOrder(orderId, user, { db })!;
    expect(view.order.dao_fee_status).toBe('remitted');
    expect(view.order.dao_fee_reference).toBe('usdc-tx-0xabc');
    const feeEvent = view.events.find((event) => event.event_type === 'dao-fee-status-changed')!;
    expect(JSON.parse(feeEvent.data_json!)).toMatchObject({
      from: 'pending',
      to: 'remitted',
      actorName: 'Thomas',
    });
  });

  it('rejects invalid fee statuses', () => {
    const orderId = placeMixedOrder();
    const { user } = createAdminUser({ displayName: 'Ops', role: 'store-admin' }, { db });
    expect(() => applyOrderUpdate(orderId, { daoFeeStatus: 'forgiven' }, user, { db })).toThrow(
      /invalid dao fee status/,
    );
  });
});

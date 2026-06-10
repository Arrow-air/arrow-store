import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyOrderUpdate,
  canAccessOrder,
  getAdminOrder,
  listOrders,
  OrderUpdateError,
} from '../src/server/admin-orders.ts';
import {
  authenticate,
  createAdminUser,
  createSession,
  destroySession,
  disableAdminUser,
  getSessionUser,
} from '../src/server/auth.ts';
import { openDatabase } from '../src/server/db.ts';
import { createOrder } from '../src/server/orders.ts';
import type { Catalog } from '../src/catalog/schema.ts';

// Minimal two-manufacturer catalog (same shape as the orders tests).
const catalog: Catalog = {
  manufacturers: [],
  checkoutGroups: [],
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
          id: 'devkit-thomas',
          manufacturerId: 'thomas-texas',
          checkoutGroupId: 'thomas-store',
          status: 'available',
          shipsTo: ['US'],
          priceDisplay: 'TBD',
          checkout: { mode: 'manufacturer-site', ctaLabel: 'Buy', immediatePayment: true },
        },
        {
          id: 'devkit-julius',
          manufacturerId: 'julius-germany',
          checkoutGroupId: 'julius-store',
          status: 'available',
          shipsTo: ['EU'],
          priceDisplay: 'TBD',
          checkout: { mode: 'manufacturer-site', ctaLabel: 'Buy', immediatePayment: true },
        },
      ],
    },
  ],
  policies: {},
  manifest: {
    repo: 'test',
    resolvedSha: 'cafebabe',
    syncedAt: '2026-06-10T00:00:00Z',
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

function placeOrder(offerId: string, country: string): string {
  return createOrder(
    { items: [{ offerId, quantity: 1 }], customer: { ...customer, country } },
    { db, catalog },
  ).orderId;
}

beforeEach(() => {
  db = openDatabase(':memory:');
});

describe('admin users and sessions', () => {
  it('authenticates with the issued access key only', () => {
    const { user, accessKey } = createAdminUser(
      { displayName: 'Thomas', role: 'manufacturer-admin', manufacturerId: 'thomas-texas' },
      { db },
    );
    expect(accessKey).toMatch(/^ak_/);
    expect(authenticate(accessKey, { db })).toEqual(user);
    expect(authenticate('ak_wrong', { db })).toBeNull();
  });

  it('requires a manufacturer for manufacturer-admin users', () => {
    expect(() =>
      createAdminUser({ displayName: 'Nope', role: 'manufacturer-admin' }, { db }),
    ).toThrow(/manufacturerId/);
  });

  it('round-trips sessions and destroys them', () => {
    const { user } = createAdminUser({ displayName: 'Ops', role: 'store-admin' }, { db });
    const session = createSession(user.id, { db });
    expect(getSessionUser(session.token, { db })).toEqual(user);
    destroySession(session.token, { db });
    expect(getSessionUser(session.token, { db })).toBeNull();
  });

  it('rejects expired sessions', () => {
    const { user } = createAdminUser({ displayName: 'Ops', role: 'store-admin' }, { db });
    const session = createSession(user.id, { db });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 31 * 24 * 60 * 60 * 1000));
    expect(getSessionUser(session.token, { db })).toBeNull();
    vi.useRealTimers();
  });

  it('disabling a user revokes the key and all sessions', () => {
    const { user, accessKey } = createAdminUser({ displayName: 'Ops', role: 'store-admin' }, { db });
    const session = createSession(user.id, { db });
    expect(disableAdminUser(user.id, { db })).toBe(true);
    expect(authenticate(accessKey, { db })).toBeNull();
    expect(getSessionUser(session.token, { db })).toBeNull();
  });
});

describe('order scoping', () => {
  it('manufacturer admins only see their own orders', () => {
    const thomasOrder = placeOrder('devkit-thomas', 'US');
    const juliusOrder = placeOrder('devkit-julius', 'DE');

    const { user: thomas } = createAdminUser(
      { displayName: 'Thomas', role: 'manufacturer-admin', manufacturerId: 'thomas-texas' },
      { db },
    );
    const { user: storeAdmin } = createAdminUser(
      { displayName: 'Ops', role: 'store-admin' },
      { db },
    );

    expect(listOrders(thomas, { db }).map((order) => order.id)).toEqual([thomasOrder]);
    expect(listOrders(storeAdmin, { db }).map((order) => order.id).sort()).toEqual(
      [thomasOrder, juliusOrder].sort(),
    );

    expect(getAdminOrder(juliusOrder, thomas, { db })).toBeNull();
    expect(getAdminOrder(juliusOrder, storeAdmin, { db })).not.toBeNull();
    expect(canAccessOrder(thomas, { manufacturer_id: 'thomas-texas' })).toBe(true);
    expect(canAccessOrder(thomas, { manufacturer_id: 'julius-germany' })).toBe(false);
  });
});

describe('applyOrderUpdate', () => {
  it('updates fields and writes one audit event per change', () => {
    const orderId = placeOrder('devkit-thomas', 'US');
    const { user } = createAdminUser(
      { displayName: 'Thomas', role: 'manufacturer-admin', manufacturerId: 'thomas-texas' },
      { db },
    );

    const written = applyOrderUpdate(
      orderId,
      {
        status: 'awaiting-payment',
        paymentStatus: 'pending',
        paymentReference: 'INV-001',
        trackingNumber: '',
        note: 'Sent the invoice.',
      },
      user,
      { db },
    );
    expect(written.sort()).toEqual(
      ['note-added', 'payment-reference-updated', 'status-changed'].sort(),
    );

    const view = getAdminOrder(orderId, user, { db })!;
    expect(view.order.status).toBe('awaiting-payment');
    expect(view.order.payment_reference).toBe('INV-001');
    const types = view.events.map((event) => event.event_type);
    expect(types).toContain('order-created');
    expect(types).toContain('status-changed');
    const statusEvent = view.events.find((event) => event.event_type === 'status-changed')!;
    expect(JSON.parse(statusEvent.data_json!)).toMatchObject({
      from: 'received',
      to: 'awaiting-payment',
      actorName: 'Thomas',
    });
  });

  it('is a no-op when nothing changed', () => {
    const orderId = placeOrder('devkit-thomas', 'US');
    const { user } = createAdminUser({ displayName: 'Ops', role: 'store-admin' }, { db });
    expect(applyOrderUpdate(orderId, { status: 'received', note: '' }, user, { db })).toEqual([]);
  });

  it('rejects invalid statuses and cross-manufacturer updates', () => {
    const orderId = placeOrder('devkit-thomas', 'US');
    const { user: storeAdmin } = createAdminUser({ displayName: 'Ops', role: 'store-admin' }, { db });
    const { user: julius } = createAdminUser(
      { displayName: 'Julius', role: 'manufacturer-admin', manufacturerId: 'julius-germany' },
      { db },
    );

    expect(() => applyOrderUpdate(orderId, { status: 'teleported' }, storeAdmin, { db })).toThrow(
      OrderUpdateError,
    );
    expect(() => applyOrderUpdate(orderId, { status: 'paid' }, julius, { db })).toThrow(
      /order not found/,
    );
  });
});

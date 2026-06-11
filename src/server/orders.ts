import type { DatabaseSync } from 'node:sqlite';
import { findOfferById, loadCatalog } from '../catalog/load.ts';
import type { Catalog } from '../catalog/schema.ts';
import { expandShipsTo } from '../lib/regions.ts';
import { getDb } from './db.ts';
import {
  accessTokenMatches,
  generateAccessToken,
  hashAccessToken,
  orderEventId,
  orderId,
  orderItemId,
} from './ids.ts';

// Order intake re-validates everything against the canonical catalog — the
// client is never trusted for IDs, prices, status, group, or region.
// Validation error messages must stay PII-free; they are returned to the
// client and may be logged.

export interface CustomerInput {
  fullName: string;
  email: string;
  phone?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
}

export interface OrderInput {
  items: Array<{ offerId: string; quantity: number }>;
  customer: CustomerInput;
  customerNotes?: string;
}

export interface CreatedOrder {
  orderId: string;
  accessToken: string;
}

export class OrderValidationError extends Error {}

interface Options {
  db?: DatabaseSync;
  catalog?: Catalog;
}

export function createOrder(input: OrderInput, options: Options = {}): CreatedOrder {
  const db = options.db ?? getDb();
  const catalog = options.catalog ?? loadCatalog();

  if (input.items.length === 0) {
    throw new OrderValidationError('order must contain at least one item');
  }

  const seenOffers = new Set<string>();
  const resolved = input.items.map((item) => {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new OrderValidationError(`invalid quantity for offer ${item.offerId}`);
    }
    if (seenOffers.has(item.offerId)) {
      throw new OrderValidationError(`duplicate offer in order: ${item.offerId}`);
    }
    seenOffers.add(item.offerId);

    const match = findOfferById(item.offerId, catalog);
    if (!match) {
      throw new OrderValidationError(`unknown offer: ${item.offerId}`);
    }
    const { offer } = match;
    if (offer.status !== 'available' && offer.status !== 'limited-availability') {
      throw new OrderValidationError(`offer ${offer.id} is not currently orderable`);
    }
    return { ...match, quantity: item.quantity };
  });

  const checkoutGroupId = resolved[0]!.offer.checkoutGroupId;
  const manufacturerId = resolved[0]!.offer.manufacturerId;
  for (const { offer } of resolved) {
    if (offer.checkoutGroupId !== checkoutGroupId) {
      throw new OrderValidationError(
        'all items in an order must share one manufacturer checkout group',
      );
    }
  }

  const country = input.customer.country.toUpperCase();
  for (const { offer } of resolved) {
    const countries = expandShipsTo(offer.shipsTo ?? []);
    if (!countries.includes(country)) {
      throw new OrderValidationError(`offer ${offer.id} does not ship to ${country}`);
    }
  }

  // Payment handoff: a manufacturer checkout endpoint (handoff convention)
  // or per-offer checkout link when the catalog provides one, otherwise the
  // manufacturer follows up with an invoice.
  const group = catalog.checkoutGroups.find((candidate) => candidate.id === checkoutGroupId);
  const hasHandoff = group?.mode === 'external-cart' && Boolean(group.baseUrl);
  const paymentMode =
    hasHandoff || resolved.some(({ offer }) => offer.checkout.url)
      ? 'manufacturer-site'
      : 'manual-invoice';

  // Machine-readable totals when every offer carries a catalog price in one
  // currency (nullable until the catalog provides prices — Phase 4 commitment
  // hashes consume these).
  const currencies = new Set(
    resolved.map(({ offer }) => offer.price?.currency).filter(Boolean),
  );
  const fullyPriced = resolved.every(({ offer }) => offer.price) && currencies.size === 1;
  const currency = fullyPriced ? [...currencies][0]! : null;
  const subtotalMinor = fullyPriced
    ? resolved.reduce((sum, { offer, quantity }) => sum + offer.price!.amount * quantity, 0)
    : null;

  const id = orderId();
  const accessToken = generateAccessToken();
  const now = new Date().toISOString();

  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO orders (
        id, created_at, status, manufacturer_id, checkout_group_id, catalog_ref,
        ship_country, payment_mode, payment_status, currency, subtotal_minor,
        access_token_hash, customer_notes
      ) VALUES (?, ?, 'received', ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    ).run(
      id,
      now,
      manufacturerId,
      checkoutGroupId,
      catalog.manifest.resolvedSha,
      country,
      paymentMode,
      currency,
      subtotalMinor,
      hashAccessToken(accessToken),
      input.customerNotes ?? null,
    );

    const insertItem = db.prepare(
      `INSERT INTO order_items (
        id, order_id, product_id, offer_id, quantity, unit_price_minor,
        price_display, name_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const { product, offer, quantity } of resolved) {
      insertItem.run(
        orderItemId(),
        id,
        product.id,
        offer.id,
        quantity,
        offer.price?.amount ?? null,
        offer.priceDisplay ?? 'TBD',
        product.name,
      );
    }

    db.prepare(
      `INSERT INTO order_contacts (
        order_id, full_name, email, phone, address_line1, address_line2,
        city, region, postal_code, country
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.customer.fullName,
      input.customer.email,
      input.customer.phone ?? null,
      input.customer.addressLine1,
      input.customer.addressLine2 ?? null,
      input.customer.city,
      input.customer.region ?? null,
      input.customer.postalCode,
      country,
    );

    db.prepare(
      'INSERT INTO order_events (id, order_id, created_at, event_type, data_json) VALUES (?, ?, ?, ?, ?)',
    ).run(
      orderEventId(),
      id,
      now,
      'order-created',
      JSON.stringify({
        manufacturerId,
        checkoutGroupId,
        itemCount: resolved.length,
        catalogRef: catalog.manifest.resolvedSha,
      }),
    );

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { orderId: id, accessToken };
}

export interface OrderRecord {
  id: string;
  created_at: string;
  status: string;
  manufacturer_id: string;
  checkout_group_id: string;
  catalog_ref: string;
  ship_country: string;
  payment_mode: string;
  payment_status: string;
  currency: string | null;
  subtotal_minor: number | null;
  customer_notes: string | null;
}

export interface OrderItemRecord {
  product_id: string;
  offer_id: string;
  quantity: number;
  unit_price_minor: number | null;
  price_display: string;
  name_snapshot: string;
}

export interface OrderContactRecord {
  full_name: string;
  email: string;
  phone: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  region: string | null;
  postal_code: string;
  country: string;
}

export interface OrderView {
  order: OrderRecord;
  items: OrderItemRecord[];
  contact: OrderContactRecord;
}

/** Token-gated lookup for the confirmation page; returns null on any mismatch. */
export function getOrderForConfirmation(
  id: string,
  accessToken: string,
  options: Options = {},
): OrderView | null {
  const db = options.db ?? getDb();

  const row = db
    .prepare('SELECT *, access_token_hash FROM orders WHERE id = ?')
    .get(id) as (OrderRecord & { access_token_hash: string }) | undefined;
  if (!row || !accessTokenMatches(accessToken, row.access_token_hash)) {
    return null;
  }

  const items = db
    .prepare(
      'SELECT product_id, offer_id, quantity, unit_price_minor, price_display, name_snapshot FROM order_items WHERE order_id = ?',
    )
    .all(id) as unknown as OrderItemRecord[];
  const contact = db
    .prepare('SELECT * FROM order_contacts WHERE order_id = ?')
    .get(id) as unknown as OrderContactRecord;

  const { access_token_hash: _hash, ...order } = row;
  return { order, items, contact };
}

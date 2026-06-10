import type { DatabaseSync } from 'node:sqlite';
import type { AdminUser } from './auth.ts';
import { getDb } from './db.ts';
import { orderEventId } from './ids.ts';
import type { OrderContactRecord, OrderItemRecord, OrderRecord } from './orders.ts';

// Manufacturer/admin order workflow (roadmap Phase 3). Every change appends
// an order_events audit row recording the actor and the old/new values.
// manufacturer-admin users are hard-scoped to their manufacturer's orders.

export const ORDER_STATUSES = [
  'received',
  'awaiting-payment',
  'paid',
  'in-production',
  'shipped',
  'delivered',
  'cancelled',
] as const;

export const PAYMENT_STATUSES = ['pending', 'paid', 'refunded', 'cancelled'] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface AdminOrderRecord extends OrderRecord {
  payment_reference: string | null;
  tracking_number: string | null;
}

export interface OrderSummary {
  id: string;
  created_at: string;
  status: string;
  payment_status: string;
  manufacturer_id: string;
  ship_country: string;
  item_count: number;
  unit_count: number;
  customer_name: string;
}

export interface OrderEventRecord {
  id: string;
  created_at: string;
  event_type: string;
  data_json: string | null;
}

export interface AdminOrderView {
  order: AdminOrderRecord;
  items: OrderItemRecord[];
  contact: OrderContactRecord;
  events: OrderEventRecord[];
}

interface Options {
  db?: DatabaseSync;
}

export function canAccessOrder(user: AdminUser, order: { manufacturer_id: string }): boolean {
  return user.role === 'store-admin' || user.manufacturerId === order.manufacturer_id;
}

/** Orders visible to the given user, newest first. */
export function listOrders(user: AdminUser, options: Options = {}): OrderSummary[] {
  const db = options.db ?? getDb();
  const scope = user.role === 'store-admin' ? '' : 'WHERE o.manufacturer_id = ?';
  const params = user.role === 'store-admin' ? [] : [user.manufacturerId];
  return db
    .prepare(
      `SELECT o.id, o.created_at, o.status, o.payment_status, o.manufacturer_id, o.ship_country,
        COUNT(i.id) AS item_count, COALESCE(SUM(i.quantity), 0) AS unit_count,
        c.full_name AS customer_name
        FROM orders o
        JOIN order_contacts c ON c.order_id = o.id
        LEFT JOIN order_items i ON i.order_id = o.id
        ${scope}
        GROUP BY o.id
        ORDER BY o.created_at DESC`,
    )
    .all(...params) as unknown as OrderSummary[];
}

/** Full order view for the admin detail page; null if missing or not accessible. */
export function getAdminOrder(
  id: string,
  user: AdminUser,
  options: Options = {},
): AdminOrderView | null {
  const db = options.db ?? getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as
    | (AdminOrderRecord & { access_token_hash: string })
    | undefined;
  if (!order || !canAccessOrder(user, order)) return null;

  const { access_token_hash: _hash, ...safeOrder } = order;
  const items = db
    .prepare(
      'SELECT product_id, offer_id, quantity, price_display, name_snapshot FROM order_items WHERE order_id = ?',
    )
    .all(id) as unknown as OrderItemRecord[];
  const contact = db
    .prepare('SELECT * FROM order_contacts WHERE order_id = ?')
    .get(id) as unknown as OrderContactRecord;
  const events = db
    .prepare(
      'SELECT id, created_at, event_type, data_json FROM order_events WHERE order_id = ? ORDER BY created_at, id',
    )
    .all(id) as unknown as OrderEventRecord[];

  return { order: safeOrder, items, contact, events };
}

export interface OrderUpdate {
  status?: string;
  paymentStatus?: string;
  paymentReference?: string;
  trackingNumber?: string;
  note?: string;
}

export class OrderUpdateError extends Error {}

/**
 * Apply an admin update to an order, recording one audit event per change.
 * Returns the list of event types written (empty when nothing changed).
 */
export function applyOrderUpdate(
  orderId: string,
  update: OrderUpdate,
  actor: AdminUser,
  options: Options = {},
): string[] {
  const db = options.db ?? getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as
    | AdminOrderRecord
    | undefined;
  if (!order || !canAccessOrder(actor, order)) {
    throw new OrderUpdateError('order not found');
  }

  if (update.status !== undefined && !ORDER_STATUSES.includes(update.status as OrderStatus)) {
    throw new OrderUpdateError(`invalid order status: ${update.status}`);
  }
  if (
    update.paymentStatus !== undefined &&
    !PAYMENT_STATUSES.includes(update.paymentStatus as PaymentStatus)
  ) {
    throw new OrderUpdateError(`invalid payment status: ${update.paymentStatus}`);
  }

  const changes: Array<{ eventType: string; column: string; from: unknown; to: string }> = [];
  if (update.status !== undefined && update.status !== order.status) {
    changes.push({ eventType: 'status-changed', column: 'status', from: order.status, to: update.status });
  }
  if (update.paymentStatus !== undefined && update.paymentStatus !== order.payment_status) {
    changes.push({
      eventType: 'payment-status-changed',
      column: 'payment_status',
      from: order.payment_status,
      to: update.paymentStatus,
    });
  }
  if (
    update.paymentReference !== undefined &&
    update.paymentReference !== (order.payment_reference ?? '')
  ) {
    changes.push({
      eventType: 'payment-reference-updated',
      column: 'payment_reference',
      from: order.payment_reference,
      to: update.paymentReference,
    });
  }
  if (update.trackingNumber !== undefined && update.trackingNumber !== (order.tracking_number ?? '')) {
    changes.push({
      eventType: 'tracking-updated',
      column: 'tracking_number',
      from: order.tracking_number,
      to: update.trackingNumber,
    });
  }

  const note = update.note?.trim();
  if (changes.length === 0 && !note) return [];

  const now = new Date().toISOString();
  const insertEvent = db.prepare(
    'INSERT INTO order_events (id, order_id, created_at, event_type, data_json) VALUES (?, ?, ?, ?, ?)',
  );

  db.exec('BEGIN');
  try {
    for (const change of changes) {
      db.prepare(`UPDATE orders SET ${change.column} = ? WHERE id = ?`).run(change.to, orderId);
      insertEvent.run(
        orderEventId(),
        orderId,
        now,
        change.eventType,
        JSON.stringify({
          from: change.from,
          to: change.to,
          actorId: actor.id,
          actorName: actor.displayName,
        }),
      );
    }
    if (note) {
      insertEvent.run(
        orderEventId(),
        orderId,
        now,
        'note-added',
        JSON.stringify({ note, actorId: actor.id, actorName: actor.displayName }),
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return [...changes.map((change) => change.eventType), ...(note ? ['note-added'] : [])];
}

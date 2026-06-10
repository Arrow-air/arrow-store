// Migrations are embedded as strings (not .sql files) so the bundled server
// needs no filesystem access to its own source tree. Append new entries; never
// edit an applied migration.

export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: '0001_init',
    // PII lives exclusively in order_contacts (1:1 with orders) so the future
    // Phase 4 commitment hash can serialize orders + order_items plus a salted
    // contact hash without schema surgery. order_events payloads must never
    // contain PII. Price columns are nullable while catalog prices are TBD;
    // price_display snapshots what the customer saw.
    sql: `
      CREATE TABLE orders (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'received'
          CHECK (status IN (
            'received', 'awaiting-payment', 'paid', 'in-production',
            'shipped', 'delivered', 'cancelled'
          )),
        manufacturer_id TEXT NOT NULL,
        checkout_group_id TEXT NOT NULL,
        catalog_ref TEXT NOT NULL,
        ship_country TEXT NOT NULL,
        payment_mode TEXT NOT NULL CHECK (payment_mode IN ('manufacturer-site', 'manual-invoice')),
        payment_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (payment_status IN ('pending', 'paid', 'refunded', 'cancelled')),
        currency TEXT,
        subtotal_minor INTEGER,
        access_token_hash TEXT NOT NULL,
        commitment_hash TEXT,
        commitment_version INTEGER,
        customer_notes TEXT
      );

      CREATE TABLE order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id),
        product_id TEXT NOT NULL,
        offer_id TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price_minor INTEGER,
        price_display TEXT NOT NULL,
        name_snapshot TEXT NOT NULL
      );

      CREATE TABLE order_contacts (
        order_id TEXT PRIMARY KEY REFERENCES orders(id),
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        address_line1 TEXT NOT NULL,
        address_line2 TEXT,
        city TEXT NOT NULL,
        region TEXT,
        postal_code TEXT NOT NULL,
        country TEXT NOT NULL
      );

      CREATE TABLE order_events (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id),
        created_at TEXT NOT NULL,
        event_type TEXT NOT NULL,
        data_json TEXT
      );

      CREATE INDEX idx_order_items_order ON order_items(order_id);
      CREATE INDEX idx_order_events_order ON order_events(order_id);
      CREATE INDEX idx_orders_manufacturer ON orders(manufacturer_id);
    `,
  },
  {
    id: '0002_admin',
    // Manufacturer/admin workflow (roadmap Phase 3). Access keys and session
    // tokens are stored as SHA-256 hashes only. manufacturer-admin users are
    // hard-scoped to one manufacturer; store-admin sees everything.
    sql: `
      CREATE TABLE admin_users (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('store-admin', 'manufacturer-admin')),
        manufacturer_id TEXT,
        access_key_hash TEXT NOT NULL UNIQUE,
        disabled INTEGER NOT NULL DEFAULT 0,
        CHECK (role != 'manufacturer-admin' OR manufacturer_id IS NOT NULL)
      );

      CREATE TABLE admin_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES admin_users(id),
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE INDEX idx_admin_sessions_user ON admin_sessions(user_id);

      ALTER TABLE orders ADD COLUMN payment_reference TEXT;
      ALTER TABLE orders ADD COLUMN tracking_number TEXT;
    `,
  },
];

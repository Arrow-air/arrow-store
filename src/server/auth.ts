import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { getDb } from './db.ts';
import { ulid } from './ids.ts';

// Access-key authentication for the admin views (v1: a handful of trusted
// users provisioned via scripts/create-admin-user.ts). Keys and session
// tokens are random secrets shown once and stored only as SHA-256 hashes.
// The role model (store-admin vs manufacturer-admin scoped to one
// manufacturer) is independent of the login mechanism, so a later move to
// OAuth or Sign-In-With-Ethereum replaces this module, not the pages.

export const SESSION_COOKIE = 'arrow_admin_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type AdminRole = 'store-admin' | 'manufacturer-admin';

export interface AdminUser {
  id: string;
  displayName: string;
  role: AdminRole;
  manufacturerId: string | null;
}

interface Options {
  db?: DatabaseSync;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createAdminUser(
  input: { displayName: string; role: AdminRole; manufacturerId?: string },
  options: Options = {},
): { user: AdminUser; accessKey: string } {
  const db = options.db ?? getDb();
  if (input.role === 'manufacturer-admin' && !input.manufacturerId) {
    throw new Error('manufacturer-admin users need a manufacturerId');
  }
  const accessKey = `ak_${randomBytes(24).toString('base64url')}`;
  const user: AdminUser = {
    id: `usr_${ulid()}`,
    displayName: input.displayName,
    role: input.role,
    manufacturerId: input.role === 'manufacturer-admin' ? input.manufacturerId! : null,
  };
  db.prepare(
    `INSERT INTO admin_users (id, created_at, display_name, role, manufacturer_id, access_key_hash)
      VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    user.id,
    new Date().toISOString(),
    user.displayName,
    user.role,
    user.manufacturerId,
    sha256(accessKey),
  );
  return { user, accessKey };
}

interface AdminUserRow {
  id: string;
  display_name: string;
  role: AdminRole;
  manufacturer_id: string | null;
  disabled: number;
}

function toUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    displayName: row.display_name,
    role: row.role,
    manufacturerId: row.manufacturer_id,
  };
}

/** Exchange an access key for the matching active user, or null. */
export function authenticate(accessKey: string, options: Options = {}): AdminUser | null {
  const db = options.db ?? getDb();
  const row = db
    .prepare('SELECT * FROM admin_users WHERE access_key_hash = ? AND disabled = 0')
    .get(sha256(accessKey)) as AdminUserRow | undefined;
  return row ? toUser(row) : null;
}

export function createSession(
  userId: string,
  options: Options = {},
): { token: string; expiresAt: Date } {
  const db = options.db ?? getDb();
  const token = `st_${randomBytes(24).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  db.prepare(
    `INSERT INTO admin_sessions (id, user_id, token_hash, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)`,
  ).run(`ses_${ulid()}`, userId, sha256(token), new Date().toISOString(), expiresAt.toISOString());
  return { token, expiresAt };
}

/** Resolve a session token to its active, non-expired user, or null. */
export function getSessionUser(token: string, options: Options = {}): AdminUser | null {
  const db = options.db ?? getDb();
  const row = db
    .prepare(
      `SELECT u.* FROM admin_sessions s
        JOIN admin_users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`,
    )
    .get(sha256(token), new Date().toISOString()) as AdminUserRow | undefined;
  return row ? toUser(row) : null;
}

export function destroySession(token: string, options: Options = {}): void {
  const db = options.db ?? getDb();
  db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(token));
}

export function disableAdminUser(userId: string, options: Options = {}): boolean {
  const db = options.db ?? getDb();
  const result = db.prepare('UPDATE admin_users SET disabled = 1 WHERE id = ?').run(userId);
  db.prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(userId);
  return result.changes > 0;
}

export function listAdminUsers(options: Options = {}): Array<AdminUser & { disabled: boolean }> {
  const db = options.db ?? getDb();
  const rows = db
    .prepare('SELECT * FROM admin_users ORDER BY created_at')
    .all() as unknown as AdminUserRow[];
  return rows.map((row) => ({ ...toUser(row), disabled: row.disabled === 1 }));
}

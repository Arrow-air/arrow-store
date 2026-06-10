import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Stable, time-ordered identifiers (Crockford-encoded ULIDs) for order data.
// IDs are never derived from customer data; catalog IDs are stored verbatim as
// the external references. Server-only module (node:crypto).

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(timestamp: number = Date.now()): string {
  let time = '';
  let remaining = timestamp;
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[remaining % 32] + time;
    remaining = Math.floor(remaining / 32);
  }
  // 256 is divisible by 32, so byte % 32 is uniform.
  const random = randomBytes(16);
  let suffix = '';
  for (let i = 0; i < 16; i += 1) {
    suffix += CROCKFORD[random[i]! % 32];
  }
  return time + suffix;
}

export const orderId = (): string => `ord_${ulid()}`;
export const orderItemId = (): string => `itm_${ulid()}`;
export const orderEventId = (): string => `evt_${ulid()}`;

/** Raw token goes only into the customer's confirmation URL; the DB stores its hash. */
export function generateAccessToken(): string {
  return randomBytes(24).toString('base64url');
}

export function hashAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function accessTokenMatches(token: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashAccessToken(token));
  const expected = Buffer.from(storedHash);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

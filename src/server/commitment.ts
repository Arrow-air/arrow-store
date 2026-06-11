import { createHash, randomBytes } from 'node:crypto';
import type { CustomerInput } from './orders.ts';

// Order commitment hash (roadmap Phase 4): a deterministic digest of the
// order's governed facts that can later be published (e.g. on-chain per
// AIP-009) to prove an order existed as recorded — without exposing the
// customer. PII enters only as sha256(salt || canonical contact payload);
// the salt is random per order and stays in the private database.

export const COMMITMENT_VERSION = 1;

export interface CommitmentOrderData {
  orderId: string;
  createdAt: string;
  manufacturerId: string;
  checkoutGroupId: string;
  catalogRef: string;
  shipCountry: string;
  currency: string | null;
  subtotalMinor: number | null;
  daoFeeMinor: number | null;
  items: Array<{
    productId: string;
    offerId: string;
    quantity: number;
    unitPriceMinor: number | null;
    daoFeeBps: number | null;
  }>;
}

export function generateContactSalt(): string {
  return randomBytes(16).toString('hex');
}

/** Canonical, key-ordered serialization of the contact payload. */
function canonicalContact(contact: CustomerInput): string {
  return JSON.stringify({
    addressLine1: contact.addressLine1,
    addressLine2: contact.addressLine2 ?? null,
    city: contact.city,
    country: contact.country,
    email: contact.email,
    fullName: contact.fullName,
    phone: contact.phone ?? null,
    postalCode: contact.postalCode,
    region: contact.region ?? null,
  });
}

export function computeCommitmentHash(
  order: CommitmentOrderData,
  contact: CustomerInput,
  contactSalt: string,
): string {
  const contactHash = createHash('sha256')
    .update(contactSalt)
    .update(canonicalContact(contact))
    .digest('hex');

  const payload = JSON.stringify({
    version: COMMITMENT_VERSION,
    orderId: order.orderId,
    createdAt: order.createdAt,
    manufacturerId: order.manufacturerId,
    checkoutGroupId: order.checkoutGroupId,
    catalogRef: order.catalogRef,
    shipCountry: order.shipCountry,
    currency: order.currency,
    subtotalMinor: order.subtotalMinor,
    daoFeeMinor: order.daoFeeMinor,
    items: order.items.map((item) => ({
      productId: item.productId,
      offerId: item.offerId,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      daoFeeBps: item.daoFeeBps,
    })),
    contactHash,
  });

  return createHash('sha256').update(payload).digest('hex');
}

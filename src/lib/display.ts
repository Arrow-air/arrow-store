// Human-readable labels for catalog enum values, plus TBD-tolerant display
// helpers. Catalog seed data intentionally carries "TBD" placeholders; the
// storefront must never print a raw "TBD".

export const OFFER_STATUS_LABELS: Record<string, string> = {
  'available': 'Available',
  'limited-availability': 'Limited availability',
  'waitlist': 'Waitlist',
  'quote-required': 'Quote required',
  'out-of-stock': 'Out of stock',
  'coming-soon': 'Coming soon',
  'hidden': 'Hidden',
};

export const PRODUCT_STATUS_LABELS: Record<string, string> = {
  'available': 'Available',
  'limited-availability': 'Limited availability',
  'quote-required': 'Quote required',
  'waitlist': 'Waitlist',
  'coming-soon': 'Coming soon',
  'out-of-stock': 'Out of stock',
};

export const PRODUCT_CATEGORY_LABELS: Record<string, string> = {
  'aircraft-devkit': 'Aircraft DevKit',
  'part': 'Part',
  'pcb': 'PCB',
  'attachment': 'Attachment',
  'tooling': 'Tooling',
  'service': 'Service',
};

export const LIFECYCLE_STAGE_LABELS: Record<string, string> = {
  devkit: 'DevKit',
  beta: 'Beta',
  production: 'Production',
  deprecated: 'Deprecated',
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  'card': 'Card',
  'usdc': 'USDC',
  'bank-transfer': 'Bank transfer',
  'wire': 'Wire',
  'crypto-other': 'Crypto (other)',
  'invoice': 'Invoice',
};

export function statusLabel(status: string): string {
  return OFFER_STATUS_LABELS[status] ?? status;
}

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  'received': 'Received',
  'awaiting-payment': 'Awaiting payment',
  'paid': 'Paid',
  'in-production': 'In production',
  'shipped': 'Shipped',
  'delivered': 'Delivered',
  'cancelled': 'Cancelled',
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  paid: 'Paid',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
};

/** Message shown instead of an add-to-cart button for non-orderable offers. */
export const NON_ORDERABLE_MESSAGES: Record<string, string> = {
  'waitlist': 'This offer is waitlist-only for now.',
  'coming-soon': 'This offer is not yet orderable.',
  'quote-required': 'This offer requires a quote from the manufacturer.',
  'out-of-stock': 'This offer is currently out of stock.',
};

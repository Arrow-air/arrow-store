// Checkout handoff convention (arrow-catalog docs/checkout-handoff.md):
// hand a cart to a manufacturer-owned checkout endpoint as
//   {baseUrl}?items=offerId:qty,...&ref=<orderRef>
// One payment per order, manufacturer as merchant of record, no PII.

export interface HandoffItem {
  offerId: string;
  quantity: number;
}

export interface HandoffReturnUrls {
  /** Absolute URL for after a successful payment (origin-allowlisted by the endpoint). */
  returnUrl?: string;
  /** Absolute URL for an abandoned payment. */
  cancelUrl?: string;
}

export function buildCheckoutHandoffUrl(
  baseUrl: string,
  items: ReadonlyArray<HandoffItem>,
  ref: string,
  { returnUrl, cancelUrl }: HandoffReturnUrls = {},
): string {
  const url = new URL(baseUrl);
  url.searchParams.set(
    'items',
    items.map((item) => `${item.offerId}:${item.quantity}`).join(','),
  );
  url.searchParams.set('ref', ref);
  if (returnUrl) url.searchParams.set('return', returnUrl);
  if (cancelUrl) url.searchParams.set('cancel', cancelUrl);
  return url.toString();
}

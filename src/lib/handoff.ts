// Checkout handoff convention (arrow-catalog docs/checkout-handoff.md):
// hand a cart to a manufacturer-owned checkout endpoint as
//   {baseUrl}?items=offerId:qty,...&ref=<orderRef>
// One payment per order, manufacturer as merchant of record, no PII.

export interface HandoffItem {
  offerId: string;
  quantity: number;
}

export function buildCheckoutHandoffUrl(
  baseUrl: string,
  items: ReadonlyArray<HandoffItem>,
  ref: string,
): string {
  const url = new URL(baseUrl);
  url.searchParams.set(
    'items',
    items.map((item) => `${item.offerId}:${item.quantity}`).join(','),
  );
  url.searchParams.set('ref', ref);
  return url.toString();
}

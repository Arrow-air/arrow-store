// Framework-free client cart, persisted in localStorage.
//
// Invariant: a cart belongs to exactly ONE checkout group (one manufacturer
// merchant of record). addItem refuses cross-group adds; mixed state is not
// representable. Item fields beyond the IDs are display snapshots only — the
// server re-validates IDs, status, group, and region at order intake.

const STORAGE_KEY = 'arrow-store.cart.v1';

export interface CartItem {
  productId: string;
  offerId: string;
  quantity: number;
  name: string;
  priceDisplay: string;
  shipsTo: string[];
}

export interface CartState {
  version: 1;
  checkoutGroupId: string | null;
  manufacturerId: string | null;
  manufacturerName: string | null;
  catalogRef: string | null;
  items: CartItem[];
}

/** Everything an add-to-cart button knows about its offer. */
export interface OfferSnapshot {
  productId: string;
  offerId: string;
  name: string;
  priceDisplay: string;
  checkoutGroupId: string;
  manufacturerId: string;
  manufacturerName: string;
  catalogRef: string;
  shipsTo: string[];
}

export type AddResult =
  | { ok: true; cart: CartState }
  | { ok: false; reason: 'group-conflict'; currentManufacturerName: string };

function emptyCart(): CartState {
  return {
    version: 1,
    checkoutGroupId: null,
    manufacturerId: null,
    manufacturerName: null,
    catalogRef: null,
    items: [],
  };
}

export function getCart(): CartState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyCart();
    const parsed = JSON.parse(raw) as CartState;
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) return emptyCart();
    return parsed;
  } catch {
    return emptyCart();
  }
}

function save(cart: CartState): CartState {
  // An emptied cart releases its checkout-group lock.
  if (cart.items.length === 0) cart = emptyCart();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cart:changed', { detail: cart }));
  }
  return cart;
}

export function addItem(snapshot: OfferSnapshot, quantity = 1): AddResult {
  const cart = getCart();

  if (cart.checkoutGroupId !== null && cart.checkoutGroupId !== snapshot.checkoutGroupId) {
    return {
      ok: false,
      reason: 'group-conflict',
      currentManufacturerName: cart.manufacturerName ?? cart.manufacturerId ?? 'another manufacturer',
    };
  }

  const next: CartState = {
    version: 1,
    checkoutGroupId: snapshot.checkoutGroupId,
    manufacturerId: snapshot.manufacturerId,
    manufacturerName: snapshot.manufacturerName,
    catalogRef: snapshot.catalogRef,
    items: [...cart.items],
  };

  const existing = next.items.find((item) => item.offerId === snapshot.offerId);
  if (existing) {
    existing.quantity += quantity;
  } else {
    next.items.push({
      productId: snapshot.productId,
      offerId: snapshot.offerId,
      quantity,
      name: snapshot.name,
      priceDisplay: snapshot.priceDisplay,
      shipsTo: snapshot.shipsTo,
    });
  }

  return { ok: true, cart: save(next) };
}

/** Discard the current cart and start over with this item (conflict resolution). */
export function startNewCartWith(snapshot: OfferSnapshot, quantity = 1): CartState {
  save(emptyCart());
  const result = addItem(snapshot, quantity);
  if (!result.ok) throw new Error('unreachable: empty cart cannot conflict');
  return result.cart;
}

export function setQuantity(offerId: string, quantity: number): CartState {
  const cart = getCart();
  if (quantity <= 0) return removeItem(offerId);
  const item = cart.items.find((candidate) => candidate.offerId === offerId);
  if (item) item.quantity = quantity;
  return save(cart);
}

export function removeItem(offerId: string): CartState {
  const cart = getCart();
  cart.items = cart.items.filter((item) => item.offerId !== offerId);
  return save(cart);
}

export function clearCart(): CartState {
  return save(emptyCart());
}

export function itemCount(cart: CartState): number {
  return cart.items.reduce((sum, item) => sum + item.quantity, 0);
}

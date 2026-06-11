import { beforeEach, describe, expect, it } from 'vitest';
import {
  addItem,
  clearCart,
  getCart,
  itemCount,
  removeItem,
  setQuantity,
  startNewCartWith,
  type OfferSnapshot,
} from '../src/lib/cart.ts';

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, value),
  };
}

const devkitThomas: OfferSnapshot = {
  productId: 'quiver-devkit-v0',
  offerId: 'quiver-devkit-thomas-texas',
  name: 'Quiver DevKit',
  priceDisplay: 'Pricing to be announced',
  checkoutGroupId: 'thomas-store',
  manufacturerId: 'thomas-texas',
  manufacturerName: 'Thomas / Texas Workshop',
  catalogRef: 'abc123',
  shipsTo: ['US'],
};

const propellersThomas: OfferSnapshot = {
  ...devkitThomas,
  productId: 'quiver-spare-propellers-v0',
  offerId: 'spare-propellers-thomas-texas',
  name: 'Quiver Spare Propellers',
};

const devkitJulius: OfferSnapshot = {
  ...devkitThomas,
  offerId: 'quiver-devkit-julius-germany',
  checkoutGroupId: 'julius-store',
  manufacturerId: 'julius-germany',
  manufacturerName: 'Julius / Germany Workshop',
  shipsTo: ['EU'],
};

beforeEach(() => {
  globalThis.localStorage = memoryStorage();
});

describe('cart', () => {
  it('locks the checkout group on first add', () => {
    const result = addItem(devkitThomas);
    expect(result.ok).toBe(true);
    const cart = getCart();
    expect(cart.checkoutGroupId).toBe('thomas-store');
    expect(cart.manufacturerId).toBe('thomas-texas');
    expect(cart.items).toHaveLength(1);
  });

  it('merges quantities for repeated adds of the same offer', () => {
    addItem(devkitThomas);
    addItem(devkitThomas, 2);
    const cart = getCart();
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]!.quantity).toBe(3);
  });

  it('allows additional items from the same checkout group', () => {
    addItem(devkitThomas);
    const result = addItem(propellersThomas);
    expect(result.ok).toBe(true);
    expect(getCart().items).toHaveLength(2);
  });

  it('cannot mix checkout groups (merchant-of-record boundary)', () => {
    addItem(devkitThomas);
    const result = addItem(devkitJulius);
    expect(result).toEqual({
      ok: false,
      reason: 'group-conflict',
      currentManufacturerName: 'Thomas / Texas Workshop',
    });
    const cart = getCart();
    expect(cart.items).toHaveLength(1);
    expect(cart.checkoutGroupId).toBe('thomas-store');
  });

  it('can start a new cart with the conflicting item', () => {
    addItem(devkitThomas);
    startNewCartWith(devkitJulius);
    const cart = getCart();
    expect(cart.checkoutGroupId).toBe('julius-store');
    expect(cart.items.map((item) => item.offerId)).toEqual(['quiver-devkit-julius-germany']);
  });

  it('releases the group lock when the cart empties', () => {
    addItem(devkitThomas);
    removeItem(devkitThomas.offerId);
    expect(getCart().checkoutGroupId).toBeNull();
    const result = addItem(devkitJulius);
    expect(result.ok).toBe(true);
    expect(getCart().checkoutGroupId).toBe('julius-store');
  });

  it('removes an item when quantity is set to zero', () => {
    addItem(devkitThomas);
    addItem(propellersThomas);
    setQuantity(devkitThomas.offerId, 0);
    expect(getCart().items.map((item) => item.offerId)).toEqual([propellersThomas.offerId]);
  });

  it('counts total units across items', () => {
    addItem(devkitThomas, 1);
    addItem(propellersThomas, 4);
    expect(itemCount(getCart())).toBe(5);
  });

  it('clears the cart entirely', () => {
    addItem(devkitThomas);
    clearCart();
    expect(getCart().items).toEqual([]);
    expect(getCart().checkoutGroupId).toBeNull();
  });

  it('recovers from corrupted storage', () => {
    localStorage.setItem('arrow-store.cart.v1', '{not json');
    expect(getCart().items).toEqual([]);
  });
});

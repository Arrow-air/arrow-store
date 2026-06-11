import { describe, expect, it } from 'vitest';
import {
  CheckoutGroupSchema,
  ManufacturerSchema,
  ProductSchema,
  type CheckoutGroup,
  type Manufacturer,
  type Product,
} from '../src/catalog/schema.ts';
import { crossValidate } from '../src/catalog/validate.ts';

const manufacturer: Manufacturer = {
  id: 'thomas-texas',
  displayName: 'Thomas / Texas Workshop',
  companyName: 'TBD',
  regionLabel: 'Texas, USA',
  countryCode: 'US',
  approved: true,
  approvalStatus: 'trusted-mvp',
  merchantOfRecord: { legalName: 'TBD', jurisdiction: 'Texas, USA' },
  paymentCapabilities: ['card', 'usdc', 'invoice'],
  shipsFrom: ['Texas, USA'],
};

const checkoutGroup: CheckoutGroup = {
  id: 'thomas-store',
  manufacturerId: 'thomas-texas',
  mode: 'external-cart',
  supportsMultipleItems: true,
  supportsQuantities: true,
  supportedPaymentMethods: ['card', 'usdc', 'invoice'],
  merchantOfRecordName: 'TBD',
  immediatePayment: true,
};

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'quiver-devkit-v0',
    slug: 'quiver-devkit',
    name: 'Quiver DevKit',
    category: 'aircraft-devkit',
    status: 'limited-availability',
    shortDescription: 'A developer-focused Quiver kit.',
    standards: [],
    supportPolicyId: 'devkit-manufacturer-first-support',
    warrantyPolicyId: 'one-year-workmanship-devkit',
    offers: [
      {
        id: 'quiver-devkit-thomas-texas',
        manufacturerId: 'thomas-texas',
        checkoutGroupId: 'thomas-store',
        status: 'limited-availability',
        checkout: { mode: 'manufacturer-site', ctaLabel: 'Buy', immediatePayment: true },
      },
    ],
    updatedAt: '2026-06-07',
    ...overrides,
  };
}

const policyIds = new Set(['devkit-manufacturer-first-support', 'one-year-workmanship-devkit']);

describe('crossValidate', () => {
  it('accepts a consistent catalog', () => {
    expect(crossValidate([makeProduct()], [manufacturer], [checkoutGroup], policyIds)).toEqual([]);
  });

  it('rejects duplicate product ids', () => {
    const errors = crossValidate(
      [makeProduct(), makeProduct({ offers: [] })],
      [manufacturer],
      [checkoutGroup],
      policyIds,
    );
    expect(errors).toContain('duplicate product id: quiver-devkit-v0');
  });

  it('rejects duplicate offer ids across products', () => {
    const second = makeProduct({ id: 'other-product', slug: 'other' });
    const errors = crossValidate([makeProduct(), second], [manufacturer], [checkoutGroup], policyIds);
    expect(errors).toContain('duplicate offer id: quiver-devkit-thomas-texas');
  });

  it('rejects offers pointing at unknown checkout groups', () => {
    const product = makeProduct();
    product.offers[0]!.checkoutGroupId = 'missing-store';
    const errors = crossValidate([product], [manufacturer], [checkoutGroup], policyIds);
    expect(errors).toContain('offer quiver-devkit-thomas-texas: unknown checkoutGroupId missing-store');
  });

  it('rejects offers whose checkout group belongs to another manufacturer', () => {
    const otherGroup: CheckoutGroup = { ...checkoutGroup, id: 'julius-store', manufacturerId: 'julius-germany' };
    const otherManufacturer: Manufacturer = { ...manufacturer, id: 'julius-germany' };
    const product = makeProduct();
    product.offers[0]!.checkoutGroupId = 'julius-store';
    const errors = crossValidate(
      [product],
      [manufacturer, otherManufacturer],
      [checkoutGroup, otherGroup],
      policyIds,
    );
    expect(errors.some((error) => error.includes('belongs to julius-germany'))).toBe(true);
  });

  it('rejects unknown policy references', () => {
    const errors = crossValidate([makeProduct()], [manufacturer], [checkoutGroup], new Set());
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('unknown supportPolicyId');
  });

  it('requires immediate payment for purchasable offers', () => {
    const product = makeProduct();
    product.offers[0]!.checkout.immediatePayment = false;
    const errors = crossValidate([product], [manufacturer], [checkoutGroup], policyIds);
    expect(errors).toContain(
      'offer quiver-devkit-thomas-texas: available offers must support immediate payment',
    );
  });

  it('allows waitlist offers without immediate payment', () => {
    const product = makeProduct();
    product.offers[0]!.status = 'waitlist';
    product.offers[0]!.checkout.immediatePayment = false;
    expect(crossValidate([product], [manufacturer], [checkoutGroup], policyIds)).toEqual([]);
  });
});

describe('schemas', () => {
  it('rejects manufacturers with unknown fields (strict upstream schema)', () => {
    expect(ManufacturerSchema.safeParse({ ...manufacturer, surprise: true }).success).toBe(false);
  });

  it('accepts products with unknown fields (loose upstream schema)', () => {
    const result = ProductSchema.safeParse({ ...makeProduct(), compatibleWith: ['quiver-devkit-v0'] });
    expect(result.success).toBe(true);
  });

  it('rejects products with a missing required field', () => {
    const { slug: _slug, ...rest } = makeProduct();
    expect(ProductSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects checkout groups with an invalid mode', () => {
    expect(CheckoutGroupSchema.safeParse({ ...checkoutGroup, mode: 'telepathy' }).success).toBe(false);
  });
});

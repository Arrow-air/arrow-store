import { z } from 'zod';

// Zod mirrors of arrow-catalog's catalog/schema/*.schema.json.
// Products use loose objects (additionalProperties: true upstream) so future
// catalog fields like `compatibleWith` or `storeRole` never break the sync;
// manufacturers and checkout groups are strict (additionalProperties: false).

export const PAYMENT_METHODS = [
  'card',
  'usdc',
  'bank-transfer',
  'wire',
  'crypto-other',
  'invoice',
] as const;

export const PRODUCT_CATEGORIES = [
  'aircraft-devkit',
  'part',
  'pcb',
  'attachment',
  'tooling',
  'service',
] as const;

export const PRODUCT_STATUSES = [
  'available',
  'limited-availability',
  'quote-required',
  'waitlist',
  'coming-soon',
  'out-of-stock',
] as const;

export const OFFER_STATUSES = [
  'available',
  'limited-availability',
  'waitlist',
  'quote-required',
  'out-of-stock',
  'hidden',
  'coming-soon',
] as const;

// Offers with one of these statuses may omit immediate payment; everything
// else is purchasable now and must support it (mirrors validate-catalog.py).
export const NON_IMMEDIATE_OFFER_STATUSES: readonly string[] = [
  'quote-required',
  'waitlist',
  'coming-soon',
  'out-of-stock',
  'hidden',
];

export const LineItemSchema = z.looseObject({
  label: z.string(),
  quantity: z.union([z.number(), z.string()]).optional(),
  notes: z.string().optional(),
});

export const StandardSchema = z.looseObject({
  id: z.string(),
  label: z.string(),
  url: z.string(),
  kind: z.string(),
  required: z.boolean(),
  description: z.string().optional(),
});

export const OfferCheckoutSchema = z.looseObject({
  mode: z.string(),
  ctaLabel: z.string(),
  url: z.string().optional(),
  immediatePayment: z.boolean(),
  customerNotice: z.string().optional(),
});

export const OfferSchema = z.looseObject({
  id: z.string(),
  manufacturerId: z.string(),
  checkoutGroupId: z.string(),
  status: z.enum(OFFER_STATUSES),
  regionLabel: z.string().optional(),
  shipsFrom: z.string().optional(),
  shipsTo: z.array(z.string()).optional(),
  priceDisplay: z.string().optional(),
  leadTimeDisplay: z.string().optional(),
  inventoryDisplay: z.string().optional(),
  paymentMethods: z.array(z.string()).optional(),
  checkout: OfferCheckoutSchema,
  merchantOfRecordName: z.string().optional(),
  daoFee: z
    .looseObject({
      type: z.string(),
      includedInPrice: z.boolean().optional(),
      remittance: z.string().optional(),
      publicLabel: z.string().optional(),
    })
    .optional(),
  notes: z.string().optional(),
});

export const ProductSchema = z.looseObject({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  category: z.enum(PRODUCT_CATEGORIES),
  status: z.enum(PRODUCT_STATUSES),
  lifecycleStage: z.enum(['devkit', 'beta', 'production', 'deprecated']).optional(),
  shortDescription: z.string(),
  included: z.array(LineItemSchema).optional(),
  notIncluded: z.array(LineItemSchema).optional(),
  requiredSeparately: z.array(LineItemSchema).optional(),
  standards: z.array(StandardSchema),
  supportPolicyId: z.string(),
  warrantyPolicyId: z.string(),
  offers: z.array(OfferSchema),
  tags: z.array(z.string()).optional(),
  updatedAt: z.string(),
});

export const ManufacturerSchema = z.strictObject({
  id: z.string(),
  displayName: z.string(),
  companyName: z.string(),
  regionLabel: z.string(),
  countryCode: z.string(),
  website: z.string().optional(),
  supportEmail: z.string().optional(),
  supportUrl: z.string().optional(),
  approved: z.boolean(),
  approvalStatus: z.enum(['trusted-mvp', 'approved', 'paused', 'removed']),
  merchantOfRecord: z.strictObject({
    legalName: z.string(),
    jurisdiction: z.string(),
    termsUrl: z.string().optional(),
    privacyUrl: z.string().optional(),
  }),
  paymentCapabilities: z.array(z.enum(PAYMENT_METHODS)),
  shipsFrom: z.array(z.string()),
  notes: z.string().optional(),
});

export const CheckoutGroupSchema = z.strictObject({
  id: z.string(),
  manufacturerId: z.string(),
  mode: z.enum([
    'external-cart',
    'external-payment-link',
    'manufacturer-site',
    'embedded-checkout',
    'crypto-checkout',
    'quote-form',
  ]),
  supportsMultipleItems: z.boolean(),
  supportsQuantities: z.boolean(),
  supportedPaymentMethods: z.array(z.enum(PAYMENT_METHODS)),
  baseUrl: z.string().optional(),
  merchantOfRecordName: z.string(),
  immediatePayment: z.boolean(),
  notes: z.string().optional(),
});

export const ManifestSchema = z.looseObject({
  repo: z.string(),
  resolvedSha: z.string(),
  syncedAt: z.string(),
  source: z.enum(['github', 'local']),
});

export type LineItem = z.infer<typeof LineItemSchema>;
export type Standard = z.infer<typeof StandardSchema>;
export type Offer = z.infer<typeof OfferSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type Manufacturer = z.infer<typeof ManufacturerSchema>;
export type CheckoutGroup = z.infer<typeof CheckoutGroupSchema>;
export type CatalogManifest = z.infer<typeof ManifestSchema>;

export interface Catalog {
  products: Product[];
  manufacturers: Manufacturer[];
  checkoutGroups: CheckoutGroup[];
  /** Policy id (markdown filename stem) -> raw markdown. */
  policies: Record<string, string>;
  manifest: CatalogManifest;
}

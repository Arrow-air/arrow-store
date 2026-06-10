import {
  NON_IMMEDIATE_OFFER_STATUSES,
  type CheckoutGroup,
  type Manufacturer,
  type Product,
} from './schema.ts';

// Cross-reference checks ported from arrow-catalog's scripts/validate-catalog.py.
// Schema-shape validation happens separately via the Zod schemas; this assumes
// structurally valid records and checks referential integrity between them.
export function crossValidate(
  products: Product[],
  manufacturers: Manufacturer[],
  checkoutGroups: CheckoutGroup[],
  policyIds: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];

  const manufacturerIds = collectUniqueIds('manufacturer', manufacturers, errors);
  const groupById = new Map<string, CheckoutGroup>();
  for (const group of checkoutGroups) {
    if (groupById.has(group.id)) {
      errors.push(`duplicate checkout group id: ${group.id}`);
    }
    groupById.set(group.id, group);
  }
  collectUniqueIds('product', products, errors);

  for (const group of checkoutGroups) {
    if (!manufacturerIds.has(group.manufacturerId)) {
      errors.push(`checkout group ${group.id}: unknown manufacturerId ${group.manufacturerId}`);
    }
  }

  const offerIds = new Set<string>();
  for (const product of products) {
    if (!policyIds.has(product.supportPolicyId)) {
      errors.push(`product ${product.id}: unknown supportPolicyId ${product.supportPolicyId}`);
    }
    if (!policyIds.has(product.warrantyPolicyId)) {
      errors.push(`product ${product.id}: unknown warrantyPolicyId ${product.warrantyPolicyId}`);
    }

    for (const offer of product.offers) {
      if (offerIds.has(offer.id)) {
        errors.push(`duplicate offer id: ${offer.id}`);
      }
      offerIds.add(offer.id);

      if (!manufacturerIds.has(offer.manufacturerId)) {
        errors.push(`offer ${offer.id}: unknown manufacturerId ${offer.manufacturerId}`);
      }
      const group = groupById.get(offer.checkoutGroupId);
      if (!group) {
        errors.push(`offer ${offer.id}: unknown checkoutGroupId ${offer.checkoutGroupId}`);
      } else if (group.manufacturerId !== offer.manufacturerId) {
        errors.push(
          `offer ${offer.id}: checkout group ${offer.checkoutGroupId} belongs to ` +
            `${group.manufacturerId}, not ${offer.manufacturerId}`,
        );
      }
      if (
        !NON_IMMEDIATE_OFFER_STATUSES.includes(offer.status) &&
        offer.checkout.immediatePayment !== true
      ) {
        errors.push(`offer ${offer.id}: available offers must support immediate payment`);
      }
    }
  }

  return errors;
}

function collectUniqueIds(
  kind: string,
  items: ReadonlyArray<{ id: string }>,
  errors: string[],
): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) {
      errors.push(`duplicate ${kind} id: ${item.id}`);
    }
    ids.add(item.id);
  }
  return ids;
}

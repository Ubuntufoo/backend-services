/** Quantity evidence must be complete and valid before a published group can change. */
export function hasAtLeastTwoSellableVariations(quantities: Iterable<number>): boolean {
  let sellable = 0;
  for (const quantity of quantities) {
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2_147_483_647) return false;
    if (quantity > 0) sellable++;
  }
  return sellable >= 2;
}

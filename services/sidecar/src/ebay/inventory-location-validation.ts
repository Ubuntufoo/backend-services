export interface InventoryLocationValidation {
  hasPostalAddress: boolean;
  hasRegionalAddress: boolean;
  returnedMerchantLocationKey: string | null;
  status: string | null;
  valid: boolean;
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function validateVariationListingMerchantLocation(
  location: unknown,
  merchantLocationKey: string
): InventoryLocationValidation {
  const record = asRecord(location);
  const returnedMerchantLocationKey = hasText(record?.merchantLocationKey)
    ? record.merchantLocationKey.trim()
    : null;
  const status = hasText(record?.merchantLocationStatus)
    ? record.merchantLocationStatus.trim().toUpperCase()
    : null;
  const address = asRecord(asRecord(record?.location)?.address);
  const hasCountry = hasText(address?.country);
  const hasPostalAddress = hasCountry && hasText(address?.postalCode);
  const hasRegionalAddress = hasCountry && hasText(address?.city) && hasText(address?.stateOrProvince);

  return {
    hasPostalAddress,
    hasRegionalAddress,
    returnedMerchantLocationKey,
    status,
    valid:
      returnedMerchantLocationKey === merchantLocationKey &&
      status === 'ENABLED' &&
      (hasPostalAddress || hasRegionalAddress),
  };
}

export interface OfferDiagnostic {
  availableQuantity?: number;
  categoryId?: string;
  format?: string;
  listingId?: string;
  marketplaceId?: string;
  offerId?: string;
  sku?: string;
  status?: string;
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function getOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function buildOfferDiagnostic(offer: unknown): OfferDiagnostic {
  if (typeof offer !== 'object' || offer === null) {
    return {};
  }

  const value = offer as Record<string, unknown>;

  return {
    availableQuantity: getOptionalNumber(value.availableQuantity),
    categoryId: getOptionalString(value.categoryId),
    format: getOptionalString(value.format),
    listingId: getOptionalString(value.listingId),
    marketplaceId: getOptionalString(value.marketplaceId),
    offerId: getOptionalString(value.offerId),
    sku: getOptionalString(value.sku),
    status: getOptionalString(value.status),
  };
}

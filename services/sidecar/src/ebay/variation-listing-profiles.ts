export type VariationListingProfileCode = 'BSKBL' | 'BSBL' | 'OTHER';

export type VariationListingTrustedCommonEbayAspects = Record<
  string,
  string | readonly string[]
>;

export interface ConfiguredVariationListingProfile {
  skuCategoryCode: 'BSKBL' | 'BSBL';
  label: string;
  categoryId: string;
  creationEnabled: true;
  trustedCommonEbayAspects: VariationListingTrustedCommonEbayAspects;
}

export interface UnconfiguredVariationListingProfile {
  skuCategoryCode: 'OTHER';
  label: string;
  categoryId: null;
  creationEnabled: false;
  trustedCommonEbayAspects: VariationListingTrustedCommonEbayAspects;
}

export type VariationListingProfile =
  | ConfiguredVariationListingProfile
  | UnconfiguredVariationListingProfile;

const PROFILES: Record<VariationListingProfileCode, VariationListingProfile> = {
  BSKBL: {
    skuCategoryCode: 'BSKBL',
    label: 'Basketball sports cards',
    categoryId: '261328',
    creationEnabled: true,
    trustedCommonEbayAspects: { Sport: ['Basketball'] },
  },
  BSBL: {
    skuCategoryCode: 'BSBL',
    label: 'Baseball sports cards',
    categoryId: '261328',
    creationEnabled: true,
    trustedCommonEbayAspects: { Sport: ['Baseball'] },
  },
  OTHER: {
    skuCategoryCode: 'OTHER',
    label: 'Other / non-sports (not configured)',
    categoryId: null,
    creationEnabled: false,
    trustedCommonEbayAspects: {},
  },
};

function cloneAspects(
  aspects: VariationListingTrustedCommonEbayAspects
): Record<string, string | string[]> {
  const clone: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(aspects)) {
    clone[key] = typeof value === 'string' ? value : Array.from(value);
  }
  return clone;
}

export function getVariationListingProfile(
  skuCategoryCode: string
): VariationListingProfile | null {
  if (!Object.prototype.hasOwnProperty.call(PROFILES, skuCategoryCode)) return null;
  const profile = PROFILES[skuCategoryCode as VariationListingProfileCode]!;
  return {
    ...profile,
    trustedCommonEbayAspects: cloneAspects(profile.trustedCommonEbayAspects),
  } as VariationListingProfile;
}

export function requireVariationListingCreationProfile(
  skuCategoryCode: string
): ConfiguredVariationListingProfile {
  const profile = getVariationListingProfile(skuCategoryCode);
  if (!profile || !profile.creationEnabled || profile.categoryId === null) {
    throw new Error(
      `Variation listing profile ${JSON.stringify(skuCategoryCode)} is not configured for new bucket creation.`
    );
  }
  return profile;
}

export function getVariationListingTrustedCommonEbayAspects(input: {
  skuCategoryCode: string;
  categoryId: string;
}): Record<string, string | string[]> {
  const profile = getVariationListingProfile(input.skuCategoryCode);
  if (
    !profile ||
    !profile.creationEnabled ||
    profile.categoryId === null ||
    profile.categoryId !== input.categoryId
  ) {
    return {};
  }
  return cloneAspects(profile.trustedCommonEbayAspects);
}

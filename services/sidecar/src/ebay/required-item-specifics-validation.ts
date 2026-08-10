import type { Json, ListingRow } from '@ebay-inventory/data';
import {
  PublishRequiredItemSpecificsValidationError,
  type PublishRequiredItemSpecificIssue,
} from '@/ebay/publish-validation.js';
import {
  getRawCardConditionDisplayLabel,
  normalizeRawCardConditionToken,
  TRADING_CARD_CONDITION_ASPECT_KEY,
} from '@/listings/trading-card-conditions.js';
import { readAuthorizedGeneratedDraftYearMetadata } from '@/pricing/generated-draft-metadata.js';
import { createLogger } from '@/utils/logger.js';

const INTERNAL_ITEM_SPECIFIC_KEYS = new Set([
  '__draft_metadata',
  'categorysuggestion',
  'conditionsuggestion',
  'pricingmodifieroptions',
  'skucategorycode',
]);
const requiredItemSpecificsLogger = createLogger('RequiredItemSpecificsValidation');
const LOT_PLAYER_RULE_BY_CATEGORY_ID: Record<string, string[]> = {
  '183050': ['Player/Athlete', 'Player', 'Athlete'],
};
const LOT_ITEM_SPECIFIC_DEFAULT_VALUE = 'Various';
const SINGLE_CARD_CATEGORY_IDS = new Set(['183050', '183454', '261328']);
const YEAR_ASPECT_NAMES = ['year manufactured', 'year'] as const;

type TaxonomyAspectMode = 'FREE_TEXT' | 'SELECTION_ONLY';
type TaxonomyAspectUsage = 'OPTIONAL' | 'RECOMMENDED';
type TaxonomyAspectCardinality = 'MULTI' | 'SINGLE';

export interface TaxonomyAspectMetadata {
  allowedValues: string[];
  cardinality?: TaxonomyAspectCardinality;
  dataType?: string;
  inputMode?: TaxonomyAspectMode;
  localizedName: string;
  required: boolean;
  usage?: TaxonomyAspectUsage;
}

export type NormalizedOutboundItemSpecifics = Record<string, string[]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeAspectKey(value: string): string {
  return value.trim().toLowerCase();
}

function readOptionalEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  field: string,
  aspectName: string
): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string' && allowedValues.includes(value as T)) {
    return value as T;
  }

  throw new Error(
    `Taxonomy item aspects response has invalid ${field} for "${aspectName}".`
  );
}

function hasMeaningfulAspectValue(value: Json): boolean {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => typeof entry === 'string' && entry.trim().length > 0);
  }

  return false;
}

export function getCategoryTreeIdFromTaxonomyResponse(response: unknown): string {
  if (
    !isRecord(response) ||
    typeof response.categoryTreeId !== 'string' ||
    !response.categoryTreeId.trim()
  ) {
    throw new Error('Taxonomy default category tree response is missing categoryTreeId.');
  }

  return response.categoryTreeId.trim();
}

export function getTaxonomyAspectMetadata(response: unknown): TaxonomyAspectMetadata[] {
  if (!isRecord(response) || !Array.isArray(response.aspects)) {
    throw new Error('Taxonomy item aspects response is missing aspects.');
  }

  const aspects: TaxonomyAspectMetadata[] = [];

  for (const aspect of response.aspects) {
    if (
      !isRecord(aspect) ||
      typeof aspect.localizedAspectName !== 'string' ||
      !aspect.localizedAspectName.trim()
    ) {
      throw new Error('Taxonomy item aspects response contains an invalid aspect name.');
    }

    if (!isRecord(aspect.aspectConstraint)) {
      throw new Error(
        `Taxonomy item aspects response is missing constraints for "${aspect.localizedAspectName.trim()}".`
      );
    }

    const aspectName = aspect.localizedAspectName.trim();
    const constraint = aspect.aspectConstraint;
    const aspectRequired = constraint.aspectRequired;
    if (aspectRequired !== undefined && typeof aspectRequired !== 'boolean') {
      throw new Error(
        `Taxonomy item aspects response has invalid aspectRequired for "${aspectName}".`
      );
    }

    const aspectValues = aspect.aspectValues;
    if (aspectValues !== undefined && !Array.isArray(aspectValues)) {
      throw new Error(
        `Taxonomy item aspects response has invalid aspectValues for "${aspectName}".`
      );
    }

    const allowedValues = (aspectValues ?? []).map((aspectValue) => {
      if (
        !isRecord(aspectValue) ||
        typeof aspectValue.localizedValue !== 'string' ||
        !aspectValue.localizedValue.trim()
      ) {
        throw new Error(
          `Taxonomy item aspects response contains an invalid allowed value for "${aspectName}".`
        );
      }

      return aspectValue.localizedValue.trim();
    });
    const dataType = constraint.aspectDataType;
    if (dataType !== undefined && (typeof dataType !== 'string' || !dataType.trim())) {
      throw new Error(
        `Taxonomy item aspects response has invalid aspectDataType for "${aspectName}".`
      );
    }

    aspects.push({
      allowedValues,
      cardinality: readOptionalEnum(
        constraint.itemToAspectCardinality,
        ['MULTI', 'SINGLE'],
        'itemToAspectCardinality',
        aspectName
      ),
      dataType: typeof dataType === 'string' ? dataType.trim() : undefined,
      inputMode: readOptionalEnum(
        constraint.aspectMode,
        ['FREE_TEXT', 'SELECTION_ONLY'],
        'aspectMode',
        aspectName
      ),
      localizedName: aspectName,
      required: aspectRequired === true,
      usage: readOptionalEnum(
        constraint.aspectUsage,
        ['OPTIONAL', 'RECOMMENDED'],
        'aspectUsage',
        aspectName
      ),
    });
  }

  return aspects;
}

export function getRequiredAspectNames(
  aspects: readonly TaxonomyAspectMetadata[]
): string[] {
  const requiredAspectNames: string[] = [];
  const seenNames = new Set<string>();

  for (const aspect of aspects) {
    const normalizedName = normalizeAspectKey(aspect.localizedName);
    if (aspect.required && !seenNames.has(normalizedName)) {
      requiredAspectNames.push(aspect.localizedName);
      seenNames.add(normalizedName);
    }
  }

  return requiredAspectNames;
}

export function getRequiredAspectNamesFromTaxonomyResponse(response: unknown): string[] {
  return getRequiredAspectNames(getTaxonomyAspectMetadata(response));
}

export function hasRequiredAspectValue(
  itemSpecifics: ListingRow['item_specifics'],
  aspectName: string
): boolean {
  if (!isRecord(itemSpecifics)) {
    return false;
  }

  const normalizedAspectName = normalizeAspectKey(aspectName);
  if (!normalizedAspectName || INTERNAL_ITEM_SPECIFIC_KEYS.has(normalizedAspectName)) {
    return false;
  }

  for (const [key, value] of Object.entries(itemSpecifics)) {
    if (
      INTERNAL_ITEM_SPECIFIC_KEYS.has(normalizeAspectKey(key)) ||
      normalizeAspectKey(key) !== normalizedAspectName
    ) {
      continue;
    }

    return hasMeaningfulAspectValue(value as Json);
  }

  return false;
}

function getTaxonomyAspectByName(
  aspectsByName: ReadonlyMap<string, TaxonomyAspectMetadata>,
  names: readonly string[]
): TaxonomyAspectMetadata | undefined {
  for (const name of names) {
    const aspect = aspectsByName.get(normalizeAspectKey(name));
    if (aspect) {
      return aspect;
    }
  }

  return undefined;
}

function getPersistedAspectValue(
  itemSpecifics: Record<string, unknown>,
  aspectName: string
): unknown {
  const normalizedName = normalizeAspectKey(aspectName);
  return Object.entries(itemSpecifics).find(
    ([key]) => normalizeAspectKey(key) === normalizedName
  )?.[1];
}

function normalizeOutboundAspectValue(
  value: unknown,
  metadata: TaxonomyAspectMetadata
): string[] | null {
  const rawValues =
    typeof value === 'string'
      ? [value]
      : Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : [];
  const values: string[] = [];
  const seenValues = new Set<string>();

  for (const rawValue of rawValues) {
    const trimmed = rawValue.trim();
    const normalized = trimmed.toLowerCase();
    if (trimmed && !seenValues.has(normalized)) {
      values.push(trimmed);
      seenValues.add(normalized);
    }
  }

  if (values.length === 0 || (metadata.cardinality === 'SINGLE' && values.length !== 1)) {
    return null;
  }

  const normalizedValues =
    metadata.inputMode === 'SELECTION_ONLY'
      ? (() => {
          const allowedValues = new Map(
            metadata.allowedValues.map((allowedValue) => [allowedValue.toLowerCase(), allowedValue])
          );
          const matched = values
            .map((candidate) => allowedValues.get(candidate.toLowerCase()))
            .filter((candidate): candidate is string => candidate !== undefined);

          return matched.length === values.length ? matched : [];
        })()
      : values;

  return normalizedValues.length > 0 ? normalizedValues : null;
}

function isCanonicalSingleCardListing(
  listing: Pick<ListingRow, 'capture_mode' | 'category_id'>
): boolean {
  const categoryId = listing.category_id?.trim();
  return (
    listing.capture_mode !== 'lot_3_image' &&
    categoryId !== undefined &&
    SINGLE_CARD_CATEGORY_IDS.has(categoryId)
  );
}

export function normalizeSingleCardOutboundItemSpecifics({
  conditionDescriptorsPresent,
  listing,
  taxonomyAspects,
}: {
  conditionDescriptorsPresent: boolean;
  listing: ListingRow;
  taxonomyAspects: readonly TaxonomyAspectMetadata[];
}): NormalizedOutboundItemSpecifics | null {
  if (!isCanonicalSingleCardListing(listing)) {
    return null;
  }

  const itemSpecifics = isRecord(listing.item_specifics) ? listing.item_specifics : {};
  const aspectsByName = new Map<string, TaxonomyAspectMetadata>();
  for (const aspect of taxonomyAspects) {
    const normalizedName = normalizeAspectKey(aspect.localizedName);
    if (!aspectsByName.has(normalizedName)) {
      aspectsByName.set(normalizedName, aspect);
    }
  }

  const categoryId = listing.category_id!.trim();
  const playerAspect =
    categoryId === '261328'
      ? getTaxonomyAspectByName(aspectsByName, ['Player/Athlete'])
      : undefined;
  const teamAspect =
    categoryId === '261328' ? getTaxonomyAspectByName(aspectsByName, ['Team']) : undefined;
  const yearAspect = getTaxonomyAspectByName(aspectsByName, YEAR_ASPECT_NAMES);
  const outbound: NormalizedOutboundItemSpecifics = {};

  for (const [key, rawValue] of Object.entries(itemSpecifics)) {
    const normalizedKey = normalizeAspectKey(key);
    if (
      INTERNAL_ITEM_SPECIFIC_KEYS.has(normalizedKey) ||
      normalizedKey === 'year' ||
      (conditionDescriptorsPresent &&
        normalizedKey === normalizeAspectKey(TRADING_CARD_CONDITION_ASPECT_KEY)) ||
      (playerAspect && normalizedKey === 'player') ||
      (teamAspect && normalizedKey === 'franchise')
    ) {
      continue;
    }

    const taxonomyAspect = aspectsByName.get(normalizedKey);
    if (!taxonomyAspect || outbound[taxonomyAspect.localizedName]) {
      continue;
    }

    const valueForNormalization =
      normalizedKey === normalizeAspectKey(TRADING_CARD_CONDITION_ASPECT_KEY)
        ? (() => {
            const token = normalizeRawCardConditionToken(rawValue);
            return token ? getRawCardConditionDisplayLabel(token) : rawValue;
          })()
        : rawValue;
    const normalizedValue = normalizeOutboundAspectValue(valueForNormalization, taxonomyAspect);
    if (normalizedValue) {
      outbound[taxonomyAspect.localizedName] = normalizedValue;
    }
  }

  if (playerAspect && !outbound[playerAspect.localizedName]) {
    const normalizedValue = normalizeOutboundAspectValue(
      getPersistedAspectValue(itemSpecifics, 'Player'),
      playerAspect
    );
    if (normalizedValue) {
      outbound[playerAspect.localizedName] = normalizedValue;
    }
  }

  if (teamAspect && !outbound[teamAspect.localizedName]) {
    const normalizedValue = normalizeOutboundAspectValue(
      getPersistedAspectValue(itemSpecifics, 'Franchise'),
      teamAspect
    );
    if (normalizedValue) {
      outbound[teamAspect.localizedName] = normalizedValue;
    }
  }

  const authorizedYear = readAuthorizedGeneratedDraftYearMetadata(itemSpecifics)?.year;
  if (yearAspect && authorizedYear) {
    const normalizedValue = normalizeOutboundAspectValue(authorizedYear, yearAspect);
    if (normalizedValue) {
      outbound[yearAspect.localizedName] = normalizedValue;
    }
  }

  const deterministicType =
    categoryId === '261328'
      ? 'Sports Trading Card'
      : categoryId === '183050'
        ? 'Non-Sport Trading Card'
        : null;
  const typeAspect = deterministicType
    ? getTaxonomyAspectByName(aspectsByName, ['Type'])
    : undefined;
  if (typeAspect && deterministicType) {
    const normalizedValue = normalizeOutboundAspectValue(deterministicType, typeAspect);
    if (normalizedValue) {
      outbound[typeAspect.localizedName] = normalizedValue;
    }
  }

  return outbound;
}

function hasRequiredAspectValueForKeys(
  itemSpecifics: ListingRow['item_specifics'],
  acceptedKeys: readonly string[]
): boolean {
  return acceptedKeys.some((key) => hasRequiredAspectValue(itemSpecifics, key));
}

export function getEffectiveItemSpecificsForCategoryValidation(
  listing: Pick<ListingRow, 'capture_mode' | 'category_id' | 'item_specifics'>
): ListingRow['item_specifics'] {
  const categoryId = listing.category_id?.trim();
  const playerKeys = categoryId ? LOT_PLAYER_RULE_BY_CATEGORY_ID[categoryId] : undefined;

  if (listing.capture_mode !== 'lot_3_image' || !playerKeys) {
    return listing.item_specifics;
  }

  if (hasRequiredAspectValueForKeys(listing.item_specifics, playerKeys)) {
    return listing.item_specifics;
  }

  const baseItemSpecifics = isRecord(listing.item_specifics) ? listing.item_specifics : {};
  return {
    ...baseItemSpecifics,
    'Player/Athlete': LOT_ITEM_SPECIFIC_DEFAULT_VALUE,
  };
}

function createMissingAspectField(aspectName: string): PublishRequiredItemSpecificIssue {
  return {
    acceptedKeys: [aspectName],
    aspectName,
    field: `item_specifics.${aspectName}`,
    message: `${aspectName} is required for this eBay category before publishing.`,
    scope: 'listing',
  };
}

export function validateRequiredItemSpecificsForCategory({
  listing,
  outboundItemSpecifics,
  requiredAspectNames,
  satisfiedAspectNames = [],
}: {
  listing: ListingRow;
  outboundItemSpecifics?: NormalizedOutboundItemSpecifics;
  requiredAspectNames: string[];
  satisfiedAspectNames?: string[];
}): void {
  const satisfiedNames = new Set(satisfiedAspectNames.map(normalizeAspectKey));
  const effectiveItemSpecifics =
    outboundItemSpecifics ?? getEffectiveItemSpecificsForCategoryValidation(listing);
  const missingFields = requiredAspectNames
    .filter((aspectName) => {
      const normalizedName = normalizeAspectKey(aspectName);
      return (
        !satisfiedNames.has(normalizedName) &&
        !hasRequiredAspectValue(effectiveItemSpecifics, aspectName)
      );
    })
    .map((aspectName) => createMissingAspectField(aspectName));

  if (missingFields.length === 0) {
    return;
  }

  requiredItemSpecificsLogger.warn('Listing missing required eBay item specifics.', {
    category_id: listing.category_id,
    listing_id: listing.listing_id,
    missing_aspects: missingFields.map((field) => field.aspectName),
    required_aspects: requiredAspectNames,
  });

  throw new PublishRequiredItemSpecificsValidationError(listing.listing_id, missingFields);
}

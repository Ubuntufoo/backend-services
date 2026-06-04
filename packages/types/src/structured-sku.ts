export const SKU_CATEGORY_CODES = ['BSKBL', 'BSBL', 'OTHER'] as const;

export type SkuCategoryCode = (typeof SKU_CATEGORY_CODES)[number];

export const SKU_LISTING_TYPES = ['Single', 'Lot'] as const;

export type SkuListingType = (typeof SKU_LISTING_TYPES)[number];

export const SKU_SEQUENCE_WIDTH = 6;

export interface ParsedBaseSku {
  listingType: SkuListingType;
  sequence: string;
}

export interface ParsedStructuredSku extends ParsedBaseSku {
  categoryCode: SkuCategoryCode;
  baseSku: string;
  structuredSku: string;
}

export interface FormatStructuredSkuInput {
  categoryCode: SkuCategoryCode;
  baseSku: string;
}

const SKU_CATEGORY_CODE_SET = new Set<string>(SKU_CATEGORY_CODES);
const SKU_LISTING_TYPE_SET = new Set<string>(SKU_LISTING_TYPES);
const SKU_SEQUENCE_PATTERN = `\\d{${SKU_SEQUENCE_WIDTH}}`;
const BASE_SKU_PATTERN = new RegExp(
  `^(${SKU_LISTING_TYPES.join('|')})-(${SKU_SEQUENCE_PATTERN})$`
);
const STRUCTURED_SKU_PATTERN = new RegExp(
  `^(${SKU_CATEGORY_CODES.join('|')})-(${SKU_LISTING_TYPES.join('|')})-(${SKU_SEQUENCE_PATTERN})$`
);
const ZERO_SKU_SEQUENCE = '0'.repeat(SKU_SEQUENCE_WIDTH);

function assertNonEmptyString(input: string, label: string): string {
  if (input.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return input;
}

function isValidSkuSequence(sequence: string): boolean {
  return /^\d{6}$/.test(sequence) && sequence !== ZERO_SKU_SEQUENCE;
}

export function isSkuCategoryCode(input: string): input is SkuCategoryCode {
  return SKU_CATEGORY_CODE_SET.has(input);
}

export function isSkuListingType(input: string): input is SkuListingType {
  return SKU_LISTING_TYPE_SET.has(input);
}

export function normalizeSkuCategoryCode(input: unknown): SkuCategoryCode | null {
  if (typeof input !== 'string') {
    return null;
  }

  const normalized = input.trim().toUpperCase();

  return isSkuCategoryCode(normalized) ? normalized : null;
}

export function parseBaseSku(input: string): ParsedBaseSku {
  const value = assertNonEmptyString(input, 'Base SKU');
  const match = BASE_SKU_PATTERN.exec(value);

  if (!match || !isValidSkuSequence(match[2])) {
    throw new Error(
      `Invalid base SKU "${value}". Expected format: <${SKU_LISTING_TYPES.join('|')}>-${'0'.repeat(
        SKU_SEQUENCE_WIDTH
      )}.`
    );
  }

  return {
    listingType: match[1] as SkuListingType,
    sequence: match[2],
  };
}

export function formatBaseSku(listingType: SkuListingType, sequence: number | string): string {
  if (!isSkuListingType(listingType)) {
    throw new Error(
      `Invalid SKU listing type "${listingType}". Expected one of: ${SKU_LISTING_TYPES.join(', ')}.`
    );
  }

  const sequenceText =
    typeof sequence === 'number'
      ? Number.isInteger(sequence) && sequence >= 1
        ? String(sequence).padStart(SKU_SEQUENCE_WIDTH, '0')
        : null
      : sequence;

  if (typeof sequenceText !== 'string' || !isValidSkuSequence(sequenceText)) {
    throw new Error(
      `Invalid SKU sequence "${String(sequence)}". Expected exactly ${SKU_SEQUENCE_WIDTH} digits.`
    );
  }

  return `${listingType}-${sequenceText}`;
}

export function parseStructuredSku(input: string): ParsedStructuredSku {
  const value = assertNonEmptyString(input, 'Structured SKU');
  const match = STRUCTURED_SKU_PATTERN.exec(value);

  if (!match || !isValidSkuSequence(match[3])) {
    throw new Error(
      `Invalid structured SKU "${value}". Expected format: <${SKU_CATEGORY_CODES.join(
        '|'
      )}>-<${SKU_LISTING_TYPES.join('|')}>-${'0'.repeat(SKU_SEQUENCE_WIDTH)}.`
    );
  }

  const categoryCode = match[1] as SkuCategoryCode;
  const listingType = match[2] as SkuListingType;
  const sequence = match[3];
  const baseSku = formatBaseSku(listingType, sequence);

  return {
    categoryCode,
    listingType,
    sequence,
    baseSku,
    structuredSku: `${categoryCode}-${baseSku}`,
  };
}

export function formatStructuredSku(input: FormatStructuredSkuInput): string {
  const categoryCode = input.categoryCode;

  if (!isSkuCategoryCode(categoryCode)) {
    throw new Error(
      `Invalid SKU category code "${categoryCode}". Expected one of: ${SKU_CATEGORY_CODES.join(', ')}.`
    );
  }

  const baseSku = parseBaseSku(input.baseSku);

  return `${categoryCode}-${formatBaseSku(baseSku.listingType, baseSku.sequence)}`;
}

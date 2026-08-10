import type { GeneratedListingDraft } from './contracts.js';

export const GENERATED_YEAR_EVIDENCE_SOURCE_TYPES = [
  'copyright_line',
  'manufacture_line',
  'production_line',
  'explicit_release_year',
] as const;

type AspectRecord = Record<string, string | string[]>;
type AspectValue = string | string[] | null | undefined;

export interface NormalizeGeneratedDraftYearFieldsOptions {
  authorizedYear?: string;
  imageCount?: number;
}

interface NormalizeGeneratedDraftYearFieldsInput {
  aspects: AspectRecord;
  title: string;
  warnings: string[];
  yearEvidence: GeneratedListingDraft['yearEvidence'];
}

const SUPPORTED_YEAR_PATTERN = /^(?:19\d{2}|20\d{2})$/u;
const YEAR_CLAIM_PATTERN = /\b(19\d{2}|20\d{2})(?:\s*[-/]\s*(\d{2}|\d{4}))?\b/giu;
const CARD_NUMBER_TOKEN_PATTERN = '[A-Za-z]{0,4}\\d{1,4}[A-Za-z]{0,4}';
const TITLE_CARD_NUMBER_PATTERNS = [
  new RegExp(`(?:^|[\\s([{])#\\s*${CARD_NUMBER_TOKEN_PATTERN}\\b`, 'giu'),
  new RegExp(`\\bNo\\.?\\s*#?\\s*${CARD_NUMBER_TOKEN_PATTERN}\\b`, 'giu'),
  new RegExp(`\\bCard\\s+#\\s*${CARD_NUMBER_TOKEN_PATTERN}\\b`, 'giu'),
  new RegExp(`\\bCard\\s+${CARD_NUMBER_TOKEN_PATTERN}\\b`, 'giu'),
  new RegExp(`\\bCard\\s+No\\.?\\s*#?\\s*${CARD_NUMBER_TOKEN_PATTERN}\\b`, 'giu'),
  new RegExp(`\\bCard\\s+Number\\s+${CARD_NUMBER_TOKEN_PATTERN}\\b`, 'giu'),
] as const;
const MANUFACTURER_ASPECT_KEYS = ['Manufacturer', 'Card Manufacturer'] as const;
const PLAYER_ASPECT_KEYS = ['Player', 'Player/Athlete', 'Athlete'] as const;

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\(\s*\)/gu, ' ')
    .replace(/\[\s*\]/gu, ' ')
    .replace(/\{\s*\}/gu, ' ')
    .replace(/\s+([,.:;)\]])/gu, '$1')
    .replace(/([([{])\s+/gu, '$1')
    .replace(/\s{2,}/gu, ' ')
    .trim();
}

function getAspectStringValues(value: AspectValue): string[] {
  if (typeof value === 'string') {
    const normalized = trimToNull(value);
    return normalized ? [normalized] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((entry) => (typeof entry === 'string' ? [entry] : []))
    .map((entry) => trimToNull(entry))
    .filter((entry): entry is string => entry !== null);
}

function setAspectValue(aspects: AspectRecord, key: string, values: string[]): void {
  if (values.length === 0) {
    delete aspects[key];
    return;
  }

  aspects[key] = values.length === 1 ? values[0] : values;
}

function dedupeNormalizedValues(values: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(value);
  }

  return deduped;
}

function getProtectedTitleSpans(title: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];

  for (const pattern of TITLE_CARD_NUMBER_PATTERNS) {
    pattern.lastIndex = 0;

    for (const match of title.matchAll(pattern)) {
      const start = match.index ?? -1;
      if (start < 0) {
        continue;
      }

      spans.push([start, start + match[0].length]);
    }
  }

  return spans;
}

function isProtectedTitleSpan(
  start: number,
  end: number,
  protectedSpans: Array<[number, number]>
): boolean {
  return protectedSpans.some(([protectedStart, protectedEnd]) => {
    return start < protectedEnd && end > protectedStart;
  });
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}]/u.test(value);
}

function findTitlePhrase(
  title: string,
  phrase: string
): { end: number; start: number } | null {
  const normalizedPhrase = trimToNull(phrase);
  if (!normalizedPhrase) {
    return null;
  }

  const lowerTitle = title.toLocaleLowerCase();
  const lowerPhrase = normalizedPhrase.toLocaleLowerCase();
  let start = lowerTitle.indexOf(lowerPhrase);

  while (start >= 0) {
    const end = start + normalizedPhrase.length;
    if (!isWordCharacter(title[start - 1]) && !isWordCharacter(title[end])) {
      return { end, start };
    }

    start = lowerTitle.indexOf(lowerPhrase, start + 1);
  }

  return null;
}

function findAspectTitlePhrase(
  title: string,
  aspects: AspectRecord,
  aspectKeys: readonly string[]
): { end: number; start: number } | null {
  let earliestMatch: { end: number; start: number } | null = null;

  for (const key of aspectKeys) {
    for (const value of getAspectStringValues(aspects[key])) {
      const match = findTitlePhrase(title, value);
      if (match && (!earliestMatch || match.start < earliestMatch.start)) {
        earliestMatch = match;
      }
    }
  }

  return earliestMatch;
}

function ensureCanonicalTitleYear(title: string, canonicalYear: string, aspects: AspectRecord): string {
  const protectedSpans = getProtectedTitleSpans(title);
  let foundCanonicalYear = false;
  let changed = false;
  let result = '';
  let lastIndex = 0;

  YEAR_CLAIM_PATTERN.lastIndex = 0;

  for (const match of title.matchAll(YEAR_CLAIM_PATTERN)) {
    const start = match.index ?? -1;
    if (start < 0 || match[1] !== canonicalYear) {
      continue;
    }

    const end = start + match[0].length;
    if (isProtectedTitleSpan(start, end, protectedSpans)) {
      continue;
    }

    if (!foundCanonicalYear) {
      foundCanonicalYear = true;
      continue;
    }

    result += title.slice(lastIndex, start);
    result += ' ';
    lastIndex = end;
    changed = true;
  }

  if (foundCanonicalYear) {
    if (!changed) {
      return title;
    }

    result += title.slice(lastIndex);
    return normalizeWhitespace(result);
  }

  const manufacturerMatch = findAspectTitlePhrase(title, aspects, MANUFACTURER_ASPECT_KEYS);
  if (manufacturerMatch) {
    return normalizeWhitespace(
      `${title.slice(0, manufacturerMatch.start)}${canonicalYear} ${title.slice(manufacturerMatch.start)}`
    );
  }

  const playerMatch = findAspectTitlePhrase(title, aspects, PLAYER_ASPECT_KEYS);
  if (playerMatch) {
    return normalizeWhitespace(
      `${title.slice(0, playerMatch.end)} ${canonicalYear}${title.slice(playerMatch.end)}`
    );
  }

  return normalizeWhitespace(`${canonicalYear} ${title}`);
}

function hasUnprotectedTitleYear(title: string): boolean {
  const protectedSpans = getProtectedTitleSpans(title);
  YEAR_CLAIM_PATTERN.lastIndex = 0;

  for (const match of title.matchAll(YEAR_CLAIM_PATTERN)) {
    const start = match.index ?? -1;
    if (start < 0) {
      continue;
    }

    const end = start + match[0].length;
    if (!isProtectedTitleSpan(start, end, protectedSpans)) {
      return true;
    }
  }

  return false;
}

function hasYearLikeSetValue(value: AspectValue): boolean {
  return getAspectStringValues(value).some((entry) =>
    /\b(?:19\d{2}|20\d{2})(?:\s*[-/]\s*(?:\d{2}|\d{4}))?\b/u.test(entry)
  );
}

function deleteSeason(aspects: AspectRecord): void {
  delete aspects.Season;
}

export function isSupportedCardYear(value: unknown): value is string {
  return typeof value === 'string' && SUPPORTED_YEAR_PATTERN.test(value.trim());
}

export function parseExplicitSellerYearDirectives(value: unknown): string[] {
  if (typeof value !== 'string') {
    return [];
  }

  const years = value.split(/\r?\n/u).flatMap((line) => {
    const match = /^\s*year\s*:\s*((?:19|20)\d{2})\s*$/iu.exec(line);
    return match?.[1] ? [match[1]] : [];
  });

  return [...new Set(years)];
}

export function containsStandaloneYear(text: string, year: string): boolean {
  return new RegExp(`\\b${year}\\b`, 'u').test(text);
}

export function sanitizeTitleYearClaims(
  title: string,
  options: { allowedYear?: string | null } = {}
): string {
  const protectedSpans = getProtectedTitleSpans(title);
  const allowedYear = trimToNull(options.allowedYear);
  let changed = false;
  let result = '';
  let lastIndex = 0;

  YEAR_CLAIM_PATTERN.lastIndex = 0;

  for (const match of title.matchAll(YEAR_CLAIM_PATTERN)) {
    const start = match.index ?? -1;
    if (start < 0) {
      continue;
    }

    const end = start + match[0].length;
    if (isProtectedTitleSpan(start, end, protectedSpans)) {
      continue;
    }

    const year = match[1] ?? '';
    const rangeEnd = match[2];

    let replacement = ' ';
    if (allowedYear && year === allowedYear && !rangeEnd) {
      continue;
    }

    if (allowedYear && year === allowedYear && rangeEnd) {
      replacement = allowedYear;
    }

    result += title.slice(lastIndex, start);
    result += replacement;
    lastIndex = end;
    changed = true;
  }

  if (!changed) {
    return normalizeWhitespace(title);
  }

  result += title.slice(lastIndex);
  return normalizeWhitespace(result);
}

export function sanitizeSetYearClaims(value: string): string | null {
  const normalized = normalizeWhitespace(value);
  if (normalized.length === 0) {
    return null;
  }

  YEAR_CLAIM_PATTERN.lastIndex = 0;
  const sanitized = normalizeWhitespace(normalized.replace(YEAR_CLAIM_PATTERN, ' '));
  return sanitized.length > 0 ? sanitized : null;
}

export function sanitizeSetAspectValue(value: AspectValue): string | string[] | undefined {
  const values = dedupeNormalizedValues(
    getAspectStringValues(value)
    .map((entry) => sanitizeSetYearClaims(entry))
    .filter((entry): entry is string => entry !== null)
  );

  if (values.length === 0) {
    return undefined;
  }

  return values.length === 1 ? values[0] : values;
}

function isValidImageIndex(imageIndex: number, imageCount?: number): boolean {
  return imageIndex >= 0 && (imageCount === undefined || imageIndex < imageCount);
}

export function normalizeGeneratedDraftYearFields(
  input: NormalizeGeneratedDraftYearFieldsInput,
  options: NormalizeGeneratedDraftYearFieldsOptions = {}
): NormalizeGeneratedDraftYearFieldsInput {
  let { title, yearEvidence } = input;
  const aspects: AspectRecord = { ...input.aspects };
  const warnings = [...input.warnings];
  const originalYearValues = getAspectStringValues(aspects.Year);
  const originalSeasonValues = getAspectStringValues(aspects.Season);
  const originalSetValue = aspects.Set;
  const hadYearSignals =
    hasUnprotectedTitleYear(title) ||
    originalYearValues.length > 0 ||
    originalSeasonValues.length > 0 ||
    hasYearLikeSetValue(originalSetValue);

  let invalidReason: string | null = null;
  const authorizedYear = isSupportedCardYear(options.authorizedYear)
    ? options.authorizedYear
    : null;

  if (yearEvidence && !authorizedYear) {
    const { year, sourceType, visibleText, imageIndex } = yearEvidence;

    if (!isSupportedCardYear(year)) {
      invalidReason = `year "${year}" is invalid.`;
    } else if (!GENERATED_YEAR_EVIDENCE_SOURCE_TYPES.includes(sourceType)) {
      invalidReason = `sourceType "${sourceType}" is unsupported.`;
    } else if (!trimToNull(visibleText)) {
      invalidReason = 'visibleText is missing.';
    } else if (!containsStandaloneYear(visibleText, year)) {
      invalidReason = `visibleText does not contain year "${year}".`;
    } else if (!isValidImageIndex(imageIndex, options.imageCount)) {
      invalidReason = 'imageIndex must reference a supplied image.';
    }
  }

  if (invalidReason) {
    warnings.push(`Gemini exact year discarded: ${invalidReason}`);
    yearEvidence = null;
  }

  if (authorizedYear || yearEvidence) {
    const canonicalYear = authorizedYear ?? yearEvidence!.year;

    if (authorizedYear) {
      yearEvidence = null;
    }

    title = sanitizeTitleYearClaims(title, { allowedYear: canonicalYear });
    title = ensureCanonicalTitleYear(title, canonicalYear, aspects);

    if (originalYearValues.some((value) => value !== canonicalYear)) {
      warnings.push(
        `Gemini aspect "Year" conflicted with the authorized year "${canonicalYear}"; normalized it.`
      );
    }

    aspects.Year = canonicalYear;
    deleteSeason(aspects);

    const sanitizedSet = sanitizeSetAspectValue(originalSetValue);
    if (sanitizedSet === undefined) {
      delete aspects.Set;
    } else {
      aspects.Set = sanitizedSet;
    }
  } else {
    title = sanitizeTitleYearClaims(title);
    delete aspects.Year;
    deleteSeason(aspects);

    const sanitizedSet = sanitizeSetAspectValue(originalSetValue);
    if (sanitizedSet === undefined) {
      delete aspects.Set;
    } else {
      aspects.Set = sanitizedSet;
    }

    if (!invalidReason && hadYearSignals) {
      warnings.push('Gemini exact year discarded: missing qualifying visible year evidence.');
    }
  }

  if (Array.isArray(aspects.Year)) {
    setAspectValue(aspects, 'Year', getAspectStringValues(aspects.Year));
  }

  if (Array.isArray(aspects.Set)) {
    setAspectValue(aspects, 'Set', getAspectStringValues(aspects.Set));
  }

  return {
    title,
    aspects,
    warnings,
    yearEvidence,
  };
}

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
  seasonEvidence: GeneratedListingDraft['seasonEvidence'];
}

const SUPPORTED_YEAR_PATTERN = /^(?:19\d{2}|20\d{2})$/u;
const YEAR_CLAIM_PATTERN = /\b(19\d{2}|20\d{2})(?:\s*[-/]\s*(\d{2}|\d{4}))?\b/giu;
const SPORTS_SEASON_RANGE_PATTERN = /^(19\d{2}|20\d{2})\s*[-/]\s*(\d{2}|\d{4})$/u;
const CARD_NUMBER_TOKEN_PATTERN = '[A-Za-z]{0,4}\\d{1,4}[A-Za-z]{0,4}';
const TITLE_CARD_NUMBER_PATTERNS = [
  new RegExp(`(?:^|[\\s([{])#\\s*${CARD_NUMBER_TOKEN_PATTERN}\\b`, 'giu'),
  new RegExp(`\\bNo\\.?\\s*#?\\s*${CARD_NUMBER_TOKEN_PATTERN}\\b`, 'giu'),
  new RegExp(`\\bCard\\s+#\\s*${CARD_NUMBER_TOKEN_PATTERN}\\b`, 'giu'),
  new RegExp(`\\bCard\\s+${CARD_NUMBER_TOKEN_PATTERN}\\b`, 'giu'),
  new RegExp(`\\bCard\\s+No\\.?\\s*#?\\s*${CARD_NUMBER_TOKEN_PATTERN}\\b`, 'giu'),
  new RegExp(`\\bCard\\s+Number\\s+${CARD_NUMBER_TOKEN_PATTERN}\\b`, 'giu'),
] as const;

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

function isValidatedLeadingYearRange(match: RegExpExecArray | null, canonicalYear: string): boolean {
  if (!match || match[1] !== '-' || match[2]?.length !== 2) {
    return false;
  }

  const expectedSuffix = String((Number(canonicalYear) + 1) % 100).padStart(2, '0');
  return match[2] === expectedSuffix;
}

/** Normalize an adjacent sports season range to the preferred hyphen/short-end form. */
export function normalizeSportsSeasonRange(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const match = SPORTS_SEASON_RANGE_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }

  const start = match[1]!;
  const end = match[2]!;
  const expectedFullEnd = String(Number(start) + 1);
  const expectedShortEnd = expectedFullEnd.slice(-2);
  if (end !== expectedFullEnd && end !== expectedShortEnd) {
    return null;
  }

  return `${start}-${expectedShortEnd}`;
}

function seasonRangeClaims(text: string): Array<{ raw: string; normalized: string | null }> {
  const claims: Array<{ raw: string; normalized: string | null }> = [];
  const pattern = /\b(?:19|20)\d{2}\s*[-/]\s*(?:\d{2}|\d{4})\b/gu;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0] ?? '';
    claims.push({ raw, normalized: normalizeSportsSeasonRange(raw) });
  }
  return claims;
}

function normalizeSeasonEvidence(
  value: GeneratedListingDraft['seasonEvidence'],
  imageCount: number | undefined
): GeneratedListingDraft['seasonEvidence'] {
  if (!value) {
    return null;
  }

  const season = normalizeSportsSeasonRange(value.season);
  const visibleText = value.visibleText.trim();
  if (!season || visibleText.length === 0 || !isValidImageIndex(value.imageIndex, imageCount)) {
    return null;
  }

  const claims = seasonRangeClaims(visibleText);
  if (claims.length !== 1 || claims[0]?.normalized !== season) {
    return null;
  }

  return { season, visibleText, imageIndex: value.imageIndex };
}

function ensureCanonicalTitleSeason(title: string, season: string): string {
  const normalizedTitle = normalizeWhitespace(title);
  const leadingRange = new RegExp(
    `^\\s*${season.slice(0, 4)}\\s*[-/]\\s*(?:${season.slice(5)}|${String(Number(season.slice(0, 4)) + 1)})\\b`,
    'u'
  ).exec(normalizedTitle);
  if (leadingRange) {
    const remainder = normalizedTitle.slice(leadingRange[0].length).trim();
    return normalizeWhitespace(`${season} ${remainder}`);
  }

  return normalizeWhitespace(`${season} ${normalizedTitle}`);
}

function ensureCanonicalTitleYear(title: string, canonicalYear: string): string {
  const protectedSpans = getProtectedTitleSpans(title);
  const leadingRangeMatch = new RegExp(
    `^\\s*${canonicalYear}\\s*([-/]?)\\s*(\\d{2}|\\d{4})\\b`,
    'u'
  ).exec(title);
  const leadingRangeStart = leadingRangeMatch?.index ?? -1;
  const leadingRangeEnd = leadingRangeMatch
    ? leadingRangeStart + leadingRangeMatch[0].length
    : -1;
  const preserveLeadingRange =
    isValidatedLeadingYearRange(leadingRangeMatch, canonicalYear) &&
    !isProtectedTitleSpan(leadingRangeStart, leadingRangeEnd, protectedSpans);
  let foundCanonicalYear = false;
  let preservedLeadingRange = false;
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

    if (preserveLeadingRange && start === leadingRangeStart && !preservedLeadingRange) {
      foundCanonicalYear = true;
      preservedLeadingRange = true;
      continue;
    }

    result += title.slice(lastIndex, start);
    result += ' ';
    lastIndex = end;
    foundCanonicalYear = true;
  }

  if (foundCanonicalYear) {
    result += title.slice(lastIndex);
    const withoutCanonicalYear = normalizeWhitespace(result);
    if (preserveLeadingRange) {
      return withoutCanonicalYear;
    }
    return normalizeWhitespace(`${canonicalYear} ${withoutCanonicalYear}`);
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
  options: { allowedYear?: string | null; allowedSeason?: string | null } = {}
): string {
  const protectedSpans = getProtectedTitleSpans(title);
  const allowedYear = trimToNull(options.allowedYear);
  const allowedSeason = normalizeSportsSeasonRange(options.allowedSeason);
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
    if (allowedSeason && rangeEnd) {
      const normalizedRange = normalizeSportsSeasonRange(match[0]);
      const leadingSeason = title.slice(0, start).trim().length === 0;
      if (normalizedRange === allowedSeason && leadingSeason) {
        continue;
      }
      replacement = ' ';
    } else if (allowedYear && year === allowedYear && !rangeEnd) {
      continue;
    }

    if (allowedYear && year === allowedYear && rangeEnd) {
      const leadingRangeMatch = new RegExp(
        `^\\s*${allowedYear}\\s*([-/]?)\\s*(\\d{2}|\\d{4})\\b`,
        'u'
      ).exec(title);
      if (
        title.slice(0, start).trim().length === 0 &&
        isValidatedLeadingYearRange(leadingRangeMatch, allowedYear)
      ) {
        continue;
      }
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

export function deriveAuthorizedSportsSeasonFromSet(
  value: unknown,
  authorizedYear: string
): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = normalizeWhitespace(value);
  const range = /^((?:19|20)\d{2})\s*[-/]\s*(\d{2}|\d{4})(?=\s|$)/u.exec(normalized);
  if (!range || range[1] !== authorizedYear) {
    return null;
  }

  const expectedFullEnd = String(Number(authorizedYear) + 1);
  const remainingSetName = normalized.slice(range[0].length).trim();
  if (
    (range[2] !== expectedFullEnd && range[2] !== expectedFullEnd.slice(-2)) ||
    !/[\p{L}\p{N}]/u.test(remainingSetName) ||
    /\b\d{4}\b/u.test(remainingSetName) ||
    /^[-/]\s*\d{2,4}\b/u.test(remainingSetName)
  ) {
    return null;
  }

  return `${range[1]}-${range[2]}`;
}

function sanitizeAuthorizedSetAspectValue(
  value: AspectValue,
  authorizedYear: string
): string | string[] | undefined {
  const values = dedupeNormalizedValues(
    getAspectStringValues(value).flatMap((entry) => {
      const normalized = normalizeWhitespace(entry);
      if (deriveAuthorizedSportsSeasonFromSet(normalized, authorizedYear)) {
        return [normalized];
      }

      const sanitized = sanitizeSetYearClaims(normalized)?.replace(/^[-/]\s*\d{2,4}\b/u, '').trim();
      return sanitized ? [sanitized] : [];
    })
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
  let { title, yearEvidence, seasonEvidence } = input;
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

  if (seasonEvidence) {
    const normalizedSeasonEvidence = normalizeSeasonEvidence(seasonEvidence, options.imageCount);
    if (!normalizedSeasonEvidence) {
      warnings.push('Gemini exact season discarded: malformed, non-adjacent, ambiguous, or unverified visible evidence.');
      seasonEvidence = null;
    } else {
      seasonEvidence = normalizedSeasonEvidence;
    }
  }

  const canonicalSeason = seasonEvidence?.season ?? null;

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

    if (canonicalSeason) {
      title = sanitizeTitleYearClaims(title, { allowedSeason: canonicalSeason });
      title = ensureCanonicalTitleSeason(title, canonicalSeason);
    } else {
      title = sanitizeTitleYearClaims(title, { allowedYear: canonicalYear });
      title = ensureCanonicalTitleYear(title, canonicalYear);
    }

    if (originalYearValues.some((value) => value !== canonicalYear)) {
      warnings.push(
        `Gemini aspect "Year" conflicted with the authorized year "${canonicalYear}"; normalized it.`
      );
    }

    aspects.Year = canonicalYear;
    if (canonicalSeason) {
      aspects.Season = canonicalSeason;
    } else {
      deleteSeason(aspects);
    }

    const sanitizedSet = sanitizeAuthorizedSetAspectValue(originalSetValue, canonicalYear);
    if (sanitizedSet === undefined) {
      delete aspects.Set;
    } else {
      aspects.Set = sanitizedSet;
    }
  } else {
    title = canonicalSeason
      ? ensureCanonicalTitleSeason(sanitizeTitleYearClaims(title, { allowedSeason: canonicalSeason }), canonicalSeason)
      : sanitizeTitleYearClaims(title);
    delete aspects.Year;
    if (canonicalSeason) {
      aspects.Season = canonicalSeason;
    } else {
      deleteSeason(aspects);
    }

    const sanitizedSet = sanitizeSetAspectValue(originalSetValue);
    if (sanitizedSet === undefined) {
      delete aspects.Set;
    } else {
      aspects.Set = sanitizedSet;
    }

    if (!invalidReason && hadYearSignals && !canonicalSeason) {
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
    seasonEvidence,
  };
}

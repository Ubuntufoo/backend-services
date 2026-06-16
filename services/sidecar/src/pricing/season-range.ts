const SEASON_RANGE_PATTERN = /\b(\d{2}|\d{4})\s*-\s*(\d{2}|\d{4})\b/g;

export interface NormalizeSeasonRangesOptions {
  targetYear?: string | null;
}

export function normalizeSeasonRanges(value: string, options: NormalizeSeasonRangesOptions = {}): string {
  return value.replace(SEASON_RANGE_PATTERN, (match, start: string, end: string, offset: number, source: string) => {
    if (isHashPrefixed(source, offset)) {
      return match;
    }

    const startYear = normalizeSeasonStartYear(start, end, options.targetYear ?? null);
    return startYear ?? match;
  });
}

export function extractSeasonStartYear(value: string, targetYear?: string | null): string | null {
  SEASON_RANGE_PATTERN.lastIndex = 0;

  for (const match of value.matchAll(SEASON_RANGE_PATTERN)) {
    if (isHashPrefixed(value, match.index ?? 0)) {
      continue;
    }

    const startYear = normalizeSeasonStartYear(match[1] ?? '', match[2] ?? '', targetYear ?? null);
    if (startYear) {
      return startYear;
    }
  }

  return null;
}

function normalizeSeasonStartYear(start: string, end: string, targetYear: string | null): string | null {
  if (start.length === 4) {
    return start;
  }

  if (start.length !== 2 || end.length !== 2) {
    return null;
  }

  const startValue = Number.parseInt(start, 10);
  const endValue = Number.parseInt(end, 10);
  if (![startValue, endValue].every(Number.isFinite)) {
    return null;
  }

  const targetValue = targetYear && /^\d{4}$/.test(targetYear) ? Number.parseInt(targetYear, 10) : null;
  if (targetValue !== null) {
    const targetSuffix = targetValue % 100;
    if (targetSuffix === startValue) {
      return String(targetValue);
    }

    if (targetSuffix === endValue) {
      return String(targetValue - 1);
    }
  }

  return String((startValue <= 49 ? 2000 : 1900) + startValue);
}

function isHashPrefixed(source: string, offset: number): boolean {
  for (let index = offset - 1; index >= 0; index -= 1) {
    const char = source[index];
    if (!char || /\s/.test(char)) {
      continue;
    }

    return char === '#';
  }

  return false;
}

import { parseExplicitSellerYearDirectives } from './year-normalization.js';

const NATURAL_LANGUAGE_YEAR_PATTERN = /^\s*year\s+is\s+((?:19|20)\d{2})\s*[.!]?\s*$/iu;

export function parseAuthorizedSellerYears(value: unknown): string[] {
  const years = new Set(parseExplicitSellerYearDirectives(value));

  if (typeof value !== 'string') {
    return [...years];
  }

  for (const line of value.split(/\r?\n/u)) {
    const match = NATURAL_LANGUAGE_YEAR_PATTERN.exec(line);
    if (match?.[1]) {
      years.add(match[1]);
    }
  }

  return [...years];
}

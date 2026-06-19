function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildProviderPattern(term: string): string {
  return `\\b${escapeRegex(term).replace(/ /g, '[\\s-]+')}\\b`;
}

export const GRADED_PROVIDER_TERMS = [
  'PSA',
  'BGS',
  'BVG',
  'AGC',
  'SGC',
  'CGC',
  'CSG',
  'TAG',
  'HGA',
  'MBA',
  'GMA',
  'KSA',
  'ISA',
  'WCG',
  'BCCG',
  'Beckett',
  'AGS',
  'Arena Club',
  'Rare Edition',
  'MNT',
  'ACE',
  'PCA',
  'ARS',
  'BRG',
  'TCG Grading',
  'DSG',
  'FCG',
  'MGC',
  'GSG',
] as const;

const AMBIGUOUS_GRADED_PROVIDER_TERMS = ['Beckett', 'ACE'] as const;

export const CORE_GRADED_PROVIDER_NEGATIVES = [
  '-grade',
  '-graded',
  '-slab',
  '-slabbed',
  '-PSA',
  '-BGS',
  '-SGC',
  '-CGC',
  '-CSG',
  '-Beckett',
] as const;

const UNAMBIGUOUS_GRADED_PROVIDER_TITLE_PATTERN = new RegExp(
  Array.from(
    GRADED_PROVIDER_TERMS.filter(
      (term): term is Exclude<(typeof GRADED_PROVIDER_TERMS)[number], (typeof AMBIGUOUS_GRADED_PROVIDER_TERMS)[number]> =>
        !AMBIGUOUS_GRADED_PROVIDER_TERMS.includes(term as (typeof AMBIGUOUS_GRADED_PROVIDER_TERMS)[number])
    )
  )
    .sort((left: string, right: string) => right.length - left.length)
    .map(buildProviderPattern)
    .join('|'),
  'i',
);

const GRADE_SCORE_TITLE_PATTERN = /\bgrade[\s-]*[:#-]?[\s-]*\d{1,2}(?:\.\d+)?\b/i;
const GRADED_LANGUAGE_PATTERN = /\bgraded\b|\bslab(?:bed)?\b/i;
const AMBIGUOUS_PROVIDER_CORROBORATION_PATTERNS = AMBIGUOUS_GRADED_PROVIDER_TERMS.map((term) => ({
  after: new RegExp(`${buildProviderPattern(term)}[\\s:#-]*(?:grade[\\s:#-]*)?\\d{1,2}(?:\\.\\d+)?\\b`, 'i'),
  before: new RegExp(`\\b(?:grade[\\s:#-]*)?\\d{1,2}(?:\\.\\d+)?[\\s:#-]*${buildProviderPattern(term)}`, 'i'),
  gradedAfter: new RegExp(`${buildProviderPattern(term)}[\\s-]+(?:graded|slab(?:bed)?)\\b`, 'i'),
  gradedBefore: new RegExp(`\\b(?:graded|slab(?:bed)?)[\\s-]+${buildProviderPattern(term)}`, 'i'),
  providerAfter: new RegExp(`${buildProviderPattern(term)}[\\s-]+${UNAMBIGUOUS_GRADED_PROVIDER_TITLE_PATTERN.source}`, 'i'),
  providerBefore: new RegExp(`${UNAMBIGUOUS_GRADED_PROVIDER_TITLE_PATTERN.source}[\\s-]+${buildProviderPattern(term)}`, 'i'),
}));
const AMBIGUOUS_PROVIDER_TITLE_PATTERN = new RegExp(
  Array.from(AMBIGUOUS_GRADED_PROVIDER_TERMS)
    .map(buildProviderPattern)
    .join('|'),
  'i',
);

export function isGradedListingTitle(title: string): boolean {
  return (
    UNAMBIGUOUS_GRADED_PROVIDER_TITLE_PATTERN.test(title) ||
    GRADE_SCORE_TITLE_PATTERN.test(title) ||
    (GRADED_LANGUAGE_PATTERN.test(title) && !AMBIGUOUS_PROVIDER_TITLE_PATTERN.test(title)) ||
    hasCorroboratedAmbiguousProvider(title)
  );
}

function hasCorroboratedAmbiguousProvider(title: string): boolean {
  for (const { after, before, gradedAfter, gradedBefore, providerAfter, providerBefore } of AMBIGUOUS_PROVIDER_CORROBORATION_PATTERNS) {
    if (
      after.test(title) ||
      before.test(title) ||
      gradedAfter.test(title) ||
      gradedBefore.test(title) ||
      providerAfter.test(title) ||
      providerBefore.test(title)
    ) {
      return true;
    }
  }

  return false;
}

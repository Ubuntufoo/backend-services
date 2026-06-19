function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildProviderPattern(term: string): string {
  return `\\b${escapeRegex(term).replace(/\\ /g, '[\\\\s-]+')}\\b`;
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

export const GRADED_NEGATIVE_MODIFIERS = CORE_GRADED_PROVIDER_NEGATIVES;

const GRADED_PROVIDER_TITLE_PATTERN = new RegExp(
  Array.from(GRADED_PROVIDER_TERMS)
    .sort((left: string, right: string) => right.length - left.length)
    .map(buildProviderPattern)
    .join('|'),
  'i',
);

const GRADED_TITLE_PATTERN = new RegExp(
  `${GRADED_PROVIDER_TITLE_PATTERN.source}|\\bgraded\\b|\\bslab(?:bed)?\\b`,
  'i',
);

export function isGradedListingTitle(title: string): boolean {
  return GRADED_TITLE_PATTERN.test(title);
}

import type { GenerateListingDraftInput } from './contracts.js';

const OUTPUT_SCHEMA_DESCRIPTION = `{
  "title": "string",
  "description": "string",
  "categorySuggestion": "string or null",
  "cardConditionToken": "NEAR_MINT_OR_BETTER | EXCELLENT | VERY_GOOD | POOR | null",
  "cardConditionNote": "string or null",
  "conditionSuggestion": "string or null",
  "skuCategoryCode": "BSKBL | BSBL | OTHER",
  "aspects": {
    "Player": "string",
    "Manufacturer": "string",
    "Set": "string",
    "Card Number": "string",
    "Parallel/Variety": "string",
    "Insert Set": "string",
    "Franchise": "string",
    "Sport": "string"
  },
  "yearEvidence": null,
  "confidence": {
    "title": 0.0,
    "category": 0.0,
    "aspects": 0.0
  },
  "warnings": ["string"]
}

If qualifying visible year evidence exists, replace "yearEvidence": null with:
{
  "yearEvidence": {
    "year": "1954",
    "sourceType": "copyright_line",
    "visibleText": "© 1954 THE TOPPS COMPANY, INC.",
    "imageIndex": 1
  }
}`;

function omitPriceFromUserHints(
  hints: GenerateListingDraftInput['userHints']
): Omit<NonNullable<GenerateListingDraftInput['userHints']>, 'price'> | null {
  if (!hints) {
    return null;
  }

  const { price: _price, ...safeHints } = hints;
  return safeHints;
}

export function buildGenerateListingDraftPrompt(input: GenerateListingDraftInput): string {
  return [
    'Generate an eBay listing draft for a trading card or card lot.',
    'Use visible image evidence first.',
    'If provided, user hints are supplemental context, not canonical proof.',
    'Listing title must be < 80 characters and use only: player name, exact year only when visible qualifying text supports it, manufacturer, # card number, and explicit market-relevant characteristics visible on the card (e.g., Rookie Card, Refractor, parallel, insert type e.g. "Grand Slammers" or "Legends", serial numbered).',
    'Do NOT include inferred filler in titles: sport, league, team, franchise, position, role e.g. "coach", "3rd base", or similar — unless those words are genuinely part of an official set name, insert type, or parallel name printed on the card.',
    'Do not invent grades, certification status, serial numbers, autographs, relics, or rare variants unless they are visible in the images or explicitly provided in the user hints.',
    'Year handling is strict.',
    'Never infer or guess the card year.',
    'Return yearEvidence only when visible card text explicitly states the production or release year in a copyright line, manufacture line, production line, or explicit release-year line.',
    'Statistics, biography dates, career dates, card numbers, design recognition, set knowledge, player history, existing listing text, existing item specifics, user hints, and general model knowledge are not year evidence.',
    'If the images do not show qualifying text, return yearEvidence: null and omit exact years from the title and generated item specifics.',
    'When qualifying text exists, copy the exact supporting text into yearEvidence.visibleText, copy the exact four-digit year into yearEvidence.year, and return the zero-based image index containing that text in yearEvidence.imageIndex.',
    'Use only these yearEvidence.sourceType values: "copyright_line", "manufacture_line", "production_line", "explicit_release_year".',
    'If you are unsure whether visible text directly identifies the card production or release year, return yearEvidence: null.',
    'Inspect visible card condition and choose the closest supported raw card condition token when the item appears ungraded.',
    'Supported raw card condition tokens: NEAR_MINT_OR_BETTER, EXCELLENT, VERY_GOOD, POOR.',
    'Do not return PSA/BGS/SGC-style numeric grades.',
    'Do not return collector shorthand such as NM-MT, EX-MT, VG-EX, MT, NM, EX, VG, FR, or PR.',
    'For raw ungraded cards, choose the closest supported eBay card condition descriptor.',
    'When uncertain, choose the lower and more conservative supported condition.',
    'Keep any human-readable condition notes in cardConditionNote only; do not let notes become the condition token.',
    'Be conservative when visible wear exists or image quality is limited.',
    'Set cardConditionNote to a short explanation of the visible condition evidence or uncertainty.',
    'Return skuCategoryCode using only one controlled value: BSKBL, BSBL, or OTHER.',
    'Do not generate, infer, or return a full SKU anywhere in the response.',
    'Basketball cards -> BSKBL.',
    'Baseball cards -> BSBL.',
    'Hockey, football, soccer, racing, Pokemon, MTG, other TCG, non-sports, unknown, or uncertain -> OTHER.',
    'If unsure, choose OTHER.',
    'Do not infer skuCategoryCode from player name alone when sport or card type is unclear.',
    'Do not return free-form category labels for skuCategoryCode such as Basketball, Baseball, MLB, NBA, TCG, or Pokemon.',
    'Emit non-year canonical trading-card pricing aspects when visible or strongly inferable: Player, Manufacturer, Set, Card Number, Parallel/Variety, Insert Set.',
    'Do not generate Year or Season item specifics. The backend derives canonical Year from validated yearEvidence.',
    'Use Manufacturer as the canonical manufacturer field. Do not emit duplicate manufacturer aliases unless strictly necessary.',
    'If title includes a card number marker such as "#98", "Card #98", "Card No. 98", or "Card Number 98", also return aspects["Card Number"] with value "98" and no leading "#".',
    'Include a Franchise aspect when the team, franchise, or IP is identifiable from the card or user hints.',
    'Examples: Utah Jazz card -> "Franchise": "Utah Jazz"; Pokemon card -> "Franchise": "Pokémon"; Marvel card -> "Franchise": "Marvel".',
    'Prefer cautious language when uncertain.',
    'Return strict JSON only with no markdown fences or explanatory prose.',
    'Include warnings for uncertain or missing information.',
    '',
    'Expected JSON shape:',
    OUTPUT_SCHEMA_DESCRIPTION,
    '',
    'Listing context:',
    JSON.stringify(
      {
        listingId: input.listingId,
        imageUrls: input.imageUrls,
        userHints: omitPriceFromUserHints(input.userHints),
      },
      null,
      2
    ),
  ].join('\n');
}

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
    "Year": "string",
    "Manufacturer": "string",
    "Set": "string",
    "Card Number": "string",
    "Parallel/Variety": "string",
    "Insert Set": "string",
    "Franchise": "string",
    "Sport": "string",
    "Card Manufacturer": "string",
    "Season": "string"
  },
  "yearEvidence": {
    "isVerified": "boolean",
    "likelyYear": "string or null",
    "likelyYearRange": "string or null",
    "warningCode": "year_unverified or omitted"
  },
  "confidence": {
    "title": 0.0,
    "category": 0.0,
    "aspects": 0.0
  },
  "warnings": ["string"]
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
    'Use user hints only as supplemental context.',
    'Listing title must be < 80 characters and use only: player name, verified year when visible, manufacturer, card number, and explicit market-relevant characteristics visible on the card (e.g., Rookie Card, Refractor, parallel, insert, autograph, memorabilia, numbered).',
    'Do NOT include inferred filler in titles: sport, league, team, franchise, position, role, "coach", "3rd base", or similar—unless those words are genuinely part of an official set name, insert name, or parallel name printed on the card.',
    'Do not invent grades, certification status, serial numbers, autographs, relics, or rare variants unless they are visible in the images or explicitly provided in the user hints.',
    'Year handling is strict.',
    'A card year is verified only when the exact year is visibly printed on the card image or explicitly provided in user hints.',
    'Do not treat checklist memory, player career dates, team uniforms, copyright style, set design, card number, manufacturer, or general trading-card knowledge as verified year evidence.',
    'For vintage or older cards, most card years are not printed on the card; if the year is not visibly printed or user-provided, do not guess the year.',
    'When the year is not visible or user-provided, do not infer it from player/team/card-number knowledge, do not put it in the title, do not return aspects["Year"], and do not return aspects["Season"].',
    'When the year is not visible or user-provided, set yearEvidence.isVerified to false, set yearEvidence.warningCode to "year_unverified", and if useful put only a non-canonical advisory guess in yearEvidence.likelyYear or yearEvidence.likelyYearRange.',
    'When the year is visible on the card or explicitly provided by user hints, return aspects["Year"], include the year in the title when useful, and set yearEvidence.isVerified to true.',
    'If you are unsure whether the year is printed or user-provided, treat the year as unverified.',
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
    'Emit canonical trading-card pricing aspects whenever visible or strongly inferable: Player, verified Year, Manufacturer, Set, Card Number, Parallel/Variety, Insert Set.',
    'Keep eBay-friendly aliases such as Season and Card Manufacturer when useful, but do not omit canonical Year or Manufacturer when those alias values are verifiably known.',
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

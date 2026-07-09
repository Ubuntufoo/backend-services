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
    'If a vintage or older card does not visibly print the year and the year is not otherwise verifiable from the images or explicit user hints, do not guess a canonical Year and do not insert a guessed year into the title.',
    'When the year is visible or otherwise verifiable, return aspects["Year"] normally.',
    'When the year is not verifiable, omit canonical Year and Season aspects, set yearEvidence.isVerified to false, and if useful include only non-canonical advisory likelyYear or likelyYearRange.',
    'If the year is verified, set yearEvidence.isVerified to true or omit yearEvidence entirely.',
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

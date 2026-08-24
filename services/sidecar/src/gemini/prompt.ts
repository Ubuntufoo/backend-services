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
    "Sport": "string",
    "League": "string",
    "Franchise": "string",
    "Character": "string",
    "Card Name": "string",
    "Game": "string",
    "Rarity": "string",
    "Language": "string",
    "Card Type": "string",
    "Finish": "string",
    "Manufacturer": "string",
    "Set": "string",
    "Card Number": "string",
    "Parallel/Variety": "string",
    "Insert Set": "string",
    "Features": ["string"]
  },
  "yearEvidence": null,
  "serialEvidence": null,
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
    'If provided, user hints are canonical proof.',
    'Listing title must be <= 80 characters. When the data exists, use this canonical order: [validated year] [set] [recognized characteristic] [player] [#card number] [team if evidenced]. Recognized characteristics are positively identified insert, parallel/variety, Rookie Card, Refractor, or serial-numbered identifiers. Use the exact set or manufacturer name, preserve the # marker (for example, #138), and omit any missing component.',
    'Count the complete final title including every word, number, and space, and keep it at most 80 characters total.',
    'Include the Card Number exactly once in the title, always in # form (for example, #138). Never repeat the Card Number as a bare number elsewhere in the title.',
    'Render the validated year in full four-digit form (for example, 1974) or a supported season range such as 1997-98. Never use two-digit year shorthand.',
    'Do not include card-condition or grading language in titles, including NM+, NM, Near Mint, Mint, EX, Excellent, VG, Very Good, Good, Fair, Poor, Low Grade, numeric grades, or similar shorthand. Condition assessment remains in cardConditionToken, cardConditionNote, and conditionSuggestion only.',
    'Do NOT include inferred filler in titles: sport, league, franchise, position, role e.g. "coach", "3rd base", or similar — unless those words are genuinely part of an official set name, insert type, or parallel name printed on the card. A team may appear last only when positively evidenced by a visible team name, logo, or wordmark, or by an explicit operator hint; never infer a team from player identity, roster history, or general knowledge.',
    'Do not remove or omit positively identified Rookie Card, Refractor, parallel/variety, insert names/types (e.g. "Grand Slammers" or "Legends"), or serial-numbered identifiers from the title.',
    'Extract visible card-number forms such as "#98" or "Card #98" into the Card Number aspect and preserve the # form in the title.',
    'Do not invent grades, certification status, serial numbers, autographs, relics, or rare variants unless they are visible in the images or explicitly provided in the user hints.',
    'Year handling is strict.',
    'Never infer or guess the card year.',
    'When userHints.explicitYear is present, it is canonical operator-provided proof: use that exact year once in the title even when no qualifying year text is visible in the images.',
    'A structured explicitYear takes precedence over any conflicting model-produced year claim.',
    'Do not create yearEvidence for explicitYear; yearEvidence remains reserved for qualifying visible image text.',
    'Return yearEvidence only when visible card text explicitly states the production or release year in a copyright line, manufacture line, production line, or explicit release-year line.',
    'Statistics, biography dates, career dates, card numbers, design recognition, set knowledge, player history, existing listing text, existing item specifics, unstructured user hints, and general model knowledge are not year evidence.',
    'If explicitYear is absent and the images do not show qualifying text, return yearEvidence: null and omit exact years from the title and generated item specifics.',
    'When qualifying text exists, copy the exact supporting text into yearEvidence.visibleText, copy the exact four-digit year into yearEvidence.year, and return the zero-based image index containing that text in yearEvidence.imageIndex.',
    'When returning valid yearEvidence, include that exact canonical year in the title exactly once; never return valid yearEvidence while omitting its year from the title.',
    'Place the canonical validated title year at the very start of the title, exactly once.',
    'Use only these yearEvidence.sourceType values: "copyright_line", "manufacture_line", "production_line", "explicit_release_year".',
    'If you are unsure whether visible text directly identifies the card production or release year, return yearEvidence: null.',
    'Inspect visible card condition and choose the closest supported raw card condition token when the item appears ungraded.',
    'Supported raw card condition tokens: NEAR_MINT_OR_BETTER, EXCELLENT, VERY_GOOD, POOR.',
    'Do not return PSA/BGS/SGC-style numeric grades.',
    'Do not return collector shorthand such as NM-MT, EX-MT, VG-EX, MT, NM, EX, VG, FR, or PR.',
    'For raw ungraded cards, choose the closest supported eBay card condition descriptor.',
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
    'Generate item-specific candidates only for a single card, and omit any candidate that is not positively identified from visible evidence or canonical user hints.',
    'For sports singles, candidate fields are: Player, Sport, League, Language, Card Name, Manufacturer, Set, Card Number, Parallel/Variety, Insert Set, Franchise, Features.',
    'For non-sport singles, candidate fields are: Franchise, Character, Card Name, Manufacturer, Set, Card Number, Parallel/Variety, Insert Set, Features.',
    'For CCG singles, candidate fields are: Game, Card Name, Character, Rarity, Language, Card Type, Finish, Manufacturer, Set, Card Number, Features.',
    'Features may contain only positively identified characteristics such as Insert, Parallel/Variety, Rookie, or Serial Numbered. Never invent Base Set or absence-based feature values.',
    'Do not generate Season, Autographed, Original/Licensed Reprint, Vintage, Illustrator, Featured Person/Artist, Movie, TV Show, Genre, HP, Stage, Attribute, MTG Color, Card Size, Material, Country of Origin, Age Level, Card Thickness, MPN, UPC, or generic Graded item specifics.',
    'Never generate Autographed, Signed By, Autograph Format, Autograph Authentication, or Autograph Authentication Number item specifics, including for printed or facsimile signatures.',
    'Do not generate Year or Season item specifics. The backend derives canonical Year from structured explicitYear or validated yearEvidence.',
    'Use Manufacturer as the canonical manufacturer field. Do not emit duplicate manufacturer aliases unless strictly necessary.',
    'For sports singles, include the internal Franchise aspect whenever the team or franchise is positively identifiable from visible card evidence or canonical user hints.',
    'A visible team name, team logo, or team wordmark is positive team evidence.',
    'Do not infer Franchise from player identity, career or roster history, or general model knowledge alone; omit it when no visible or canonical team evidence exists.',
    'Keep this generated field named Franchise; do not emit the eBay Team field.',
    'For sports singles, League may be returned only when a league name is positively visible on the card or explicitly supplied as a canonical operator hint. Never infer League from player identity, team history, roster history, or general model knowledge.',
    'For sports singles, Card Name may be returned only when a distinct card name is positively visible or explicitly supplied as a canonical operator hint; never synthesize it from the player name.',
    'For sports singles, Language may be returned only when confidently supported by visible text or an explicit canonical operator hint; omit it when uncertain.',
    'Never return Print Run as a free-form aspect. When a clearly printed serial fraction is visible, return structured serialEvidence with the exact visibleText, zero-based imageIndex, positive numerator, and positive denominator. The backend derives Print Run from the denominator only.',
    'serialEvidence must identify an unambiguous printed fraction such as 037/199. Reject card numbers (#25), Card #10 of 25, title-only claims, ambiguous fractions, and set/model-knowledge claims by returning serialEvidence: null.',
    'Examples: Utah Jazz sports card -> "Franchise": "Utah Jazz"; Marvel non-sport card -> "Franchise": "Marvel"; Pokémon CCG card -> "Game": "Pokémon TCG".',
    'Prefer cautious language when uncertain.',
    'Description should be a concise, factual summary of the card, with no marketing or sales language.',
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

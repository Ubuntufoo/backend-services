import type { GenerateVariationListingIdentityInput } from './variation-listing-identity-contracts.js';

const OUTPUT_SHAPE = `{
  "facts": {
    "sport": {"value":"string","imageIndex":0 | 1,"visibleEvidence":"string"} | null,
    "league": {"value":"string","imageIndex":0 | 1,"visibleEvidence":"string"} | null,
    "playerAthlete": {"value":"string","imageIndex":0 | 1,"visibleEvidence":"string"} | null,
    "team": {"value":"string","imageIndex":0 | 1,"visibleEvidence":"string"} | null,
    "manufacturer": {"value":"string","imageIndex":0 | 1,"visibleEvidence":"string"} | null,
    "set": {"value":"string","imageIndex":0 | 1,"visibleEvidence":"string"} | null,
    "cardNumber": {"value":"string","imageIndex":0 | 1,"visibleEvidence":"string"} | null,
    "parallelVariety": {"value":"string","imageIndex":0 | 1,"visibleEvidence":"string"} | null,
    "insertSet": {"value":"string","imageIndex":0 | 1,"visibleEvidence":"string"} | null,
    "cardName": {"value":"string","imageIndex":0 | 1,"visibleEvidence":"string"} | null,
    "language": {"value":"string","imageIndex":0 | 1,"visibleEvidence":"string"} | null,
    "features": [
      {"value":"Insert | Parallel/Variety | Refractor | Rookie Card | Serial Numbered","imageIndex":0 | 1,"visibleEvidence":"string"}
    ]
  },
  "yearEvidence": {"year":"YYYY","sourceType":"copyright_line | manufacture_line | production_line | explicit_release_year","visibleText":"string","imageIndex":0 | 1} | null,
  "seasonEvidence": {"season":"YYYY-YY","visibleText":"string","imageIndex":0 | 1} | null,
  "serialEvidence": {"visibleText":"string","imageIndex":0 | 1,"numerator":0,"denominator":0} | null,
  "reviewNotes": ["string"],
  "warnings": ["string"]
}`;

export function buildVariationListingIdentityPrompt(
  input: GenerateVariationListingIdentityInput
): string {
  return [
    'Identify one physical trading card for a variation-listing review draft.',
    'Image index 0 is the FRONT. Image index 1 is the BACK.',
    'Use only evidence visible in the supplied images plus the explicit operator year hint when present.',
    'Do not use player history, roster history, release knowledge, memorized checklists, web knowledge, or likely-set guesses as proof.',
    'Every returned fact must include the image index and a concise visibleEvidence description explaining exactly what in that image supports the value.',
    'Omit uncertain facts by returning null. Do not fill defaults.',
    'Do not generate a listing title, listing description, eBay category, condition grade, price, SKU, or buyer selector. Backend code constructs the selector deterministically.',
    'Do not return priceSuggestion or any pricing recommendation. Pricing is manual outside Gemini.',
    'Never return Autographed, Signed By, Autograph Format, Autograph Authentication, Autograph Authentication Number, or any equivalent autograph claim. Printed or facsimile signatures are not proof of a genuine autograph.',
    'cardNumber must come from a visibly printed card-number identifier. Return the number/token itself; leading # is optional because backend normalization owns the final # form. Never infer a checklist number.',
    'team may be returned only from a visible team name, logo, or wordmark. Do not infer team from player identity or roster knowledge.',
    'league may be returned only from a visible league name/logo/wordmark. Do not infer it from team or sport knowledge.',
    'manufacturer, set, insertSet, parallelVariety, cardName, and playerAthlete must be grounded in visible card evidence. Keep Set to the base set/product identity; put insert names in insertSet and parallels in parallelVariety.',
    'features may use only: Insert, Parallel/Variety, Refractor, Rookie Card, Serial Numbered. Return a feature only when positively evidenced.',
    'Year handling is strict. Never guess a year.',
    'If an explicitYear operator hint is present, it is canonical. Do not create yearEvidence for it and do not return a conflicting year claim.',
    'Without explicitYear, return yearEvidence only when visible card text explicitly states the production/release year in a copyright, manufacture, production, or explicit release-year line. Copy the exact supporting visibleText and imageIndex.',
    'Statistics, biography dates, career dates, card numbers, set knowledge, and design recognition are not year evidence.',
    'seasonEvidence is independent from Year. Return it only for one exact visibly printed adjacent sports season range such as 2024-25, 2024/25, or 2024-2025. Copy the exact supporting text and image index.',
    'serialEvidence is only for one unambiguous visibly printed serial fraction such as 037/199. Return exact visibleText, numerator, denominator, and imageIndex. Do not treat Card #10 of 25 or a card number as serial numbering.',
    'reviewNotes should be short factual observations useful to a human reviewing card identity. warnings should describe missing or uncertain identity evidence.',
    'Return strict JSON only. Do not add markdown fences, prose, or keys outside the expected shape.',
    '',
    'Expected JSON shape:',
    OUTPUT_SHAPE,
    '',
    'Generation context:',
    JSON.stringify(
      {
        variationId: input.variationId,
        imageOrder: ['front', 'back'],
        explicitYear: input.userHints?.explicitYear ?? null,
      },
      null,
      2
    ),
  ].join('\n');
}

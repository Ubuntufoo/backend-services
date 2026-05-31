import type { GenerateListingDraftInput } from './contracts.js';

const OUTPUT_SCHEMA_DESCRIPTION = `{
  "title": "string",
  "description": "string",
  "categorySuggestion": "string or null",
  "cardConditionToken": "MT | MINT | NM-MT | NM | EX-MT | EX | VG-EX | VG | GOOD | FR | PR | null",
  "cardConditionNote": "string or null",
  "conditionSuggestion": "string or null",
  "aspects": {
    "Player": "string",
    "Franchise": "string",
    "Sport": "string",
    "Card Manufacturer": "string",
    "Season": "string"
  },
  "priceSuggestion": 0,
  "confidence": {
    "title": 0.0,
    "category": 0.0,
    "price": 0.0,
    "aspects": 0.0
  },
  "warnings": ["string"]
}`;

export function buildGenerateListingDraftPrompt(input: GenerateListingDraftInput): string {
  return [
    'Generate an eBay listing draft for a trading card or card lot.',
    'Use visible image evidence first.',
    'Use user hints only as supplemental context.',
    'Listing title must be < 80 characters and be in this format: "[Player Name] [Year] [Card Manufacturer] [Card Number] [Important Details: Rookie Card, Parallel, etc.]".',
    'Do not invent grades, certification status, serial numbers, autographs, relics, or rare variants unless they are visible in the images or explicitly provided in the user hints.',
    'Inspect visible card condition and choose the closest supported raw card condition token when the item appears ungraded.',
    'Be conservative when visible wear exists or image quality is limited.',
    'Do not choose NM-MT, NM, MINT, or MT if creases, heavy corner wear, edge wear, whitening, or surface damage are visible.',
    'Set cardConditionNote to a short explanation of the visible condition evidence or uncertainty.',
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
        userHints: input.userHints ?? null,
      },
      null,
      2
    ),
  ].join('\n');
}

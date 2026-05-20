import type { GenerateListingDraftInput } from './contracts.js';

const OUTPUT_SCHEMA_DESCRIPTION = `{
  "title": string,
  "description": string,
  "categorySuggestion": string | null,
  "conditionSuggestion": string | null,
  "aspects": Record<string, string | string[]>,
  "priceSuggestion": number | null,
  "confidence": {
    "title"?: number,
    "category"?: number,
    "price"?: number,
    "aspects"?: number
  },
  "warnings": string[]
}`;

export function buildGenerateListingDraftPrompt(input: GenerateListingDraftInput): string {
  return [
    'Generate an eBay listing draft for a trading card or card lot.',
    'Use visible image evidence first.',
    'Use user hints only as supplemental context.',
    'Do not invent grades, certification status, serial numbers, autographs, relics, or rare variants unless they are visible in the images or explicitly provided in the user hints.',
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

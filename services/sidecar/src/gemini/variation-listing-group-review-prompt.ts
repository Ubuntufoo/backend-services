import type { GenerateVariationListingGroupReviewInput } from './variation-listing-group-review-contracts.js';

const OUTPUT_SHAPE = `{
  "title": "string, 1-80 characters",
  "description": "string",
  "warnings": ["string"]
}`;

function publicVariationMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).filter(([key, value]) => !key.startsWith('_') && value !== undefined)
  );
}

export function buildVariationListingGroupReviewPrompt(
  input: GenerateVariationListingGroupReviewInput,
  derivedCommonEbayAspects: Record<string, string | string[]>
): string {
  return [
    'Generate buyer-facing GROUP content for one fixed-price eBay trading-card variation listing.',
    'The application has already reviewed each child card identity. Treat the supplied selector values and variation metadata as canonical application facts; do not invent or correct card identities using model knowledge.',
    'Generate only one group title and one group description. Do not generate per-card titles or descriptions.',
    'The group title must be factual, concise, and at most 80 characters.',
    'The title should describe the common merchandising theme of the complete group rather than pretending every heterogeneous child has the same optional facts.',
    'The description should explain that the buyer selects one card using the Card variation selector and that the corresponding images identify that selected card.',
    'Do not include condition/grading claims in the title. Do not invent condition details in the description.',
    'Do not generate or recommend prices, discounts, shipping promotions, quantities, SKUs, category ids, business policies, or eBay publish state.',
    'Do not generate item specifics or common aspects. Backend code has already derived truthful common eBay aspects deterministically from all reviewed variations; those values are context only.',
    'Do not add an aspect merely because it is plausible. Heterogeneous optional facts are intentionally omitted from the common projection.',
    'Do not make autograph, certification, grading, rarity, serial-number, rookie, parallel, or insert claims unless they are explicitly present in the supplied reviewed facts and are relevant to the group theme.',
    'Use no external market knowledge, player history, roster history, checklist knowledge, or web knowledge.',
    'No SoldComps, Browse, market-price, or repricing analysis is part of this task.',
    'Return strict JSON only with exactly title, description, and warnings.',
    '',
    'Expected JSON shape:',
    OUTPUT_SHAPE,
    '',
    'Reviewed group context:',
    JSON.stringify(
      {
        groupId: input.groupId,
        groupTheme: input.userHints?.groupTheme ?? null,
        derivedCommonEbayAspects,
        variations: input.variations.map((variation) => ({
          selectorValue: variation.selectorValue,
          variationMetadata: publicVariationMetadata(variation.variationMetadata),
        })),
      },
      null,
      2
    ),
  ].join('\n');
}

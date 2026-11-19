import type { GenerateVariationListingGroupReviewInput } from './variation-listing-group-review-contracts.js';
import { MAX_VARIATION_GROUP_TITLE_LENGTH } from '@/ebay/variation-listing-limits.js';

const OUTPUT_SHAPE = `{
  "title": "string, 1-${MAX_VARIATION_GROUP_TITLE_LENGTH} characters",
  "description": "one factual plain-text Item Info summary, 1-600 characters",
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
    `The group title must be factual, concise, and at most ${MAX_VARIATION_GROUP_TITLE_LENGTH} characters.`,
    'The title should describe the common merchandising theme of the complete group rather than pretending every heterogeneous child has the same optional facts.',
    'For description, write only one concise, factual Item Info summary (maximum 600 characters) using reviewed group-shared attributes such as sport, manufacturer, set, player or team. If little is shared, keep it short. Do not write the full seller listing description.',
    'The application supplies the exact seller-approved promotion, seller link, condition and photography disclosure, Card selector instructions, and shipping terms separately. Do not repeat or rewrite those fixed sections.',
    'Only describe a detail as shared when it is supported by derivedCommonEbayAspects for every variation. A group theme or an individual selector is not proof that a detail applies to all cards.',
    'Do not mention the cards\' language or use terms such as English, English-language, or written in English in Item Info. Language remains an item-specific field, not buyer-facing group description copy.',
    'Do not invent wear, centering, surface quality, grades, shipping, discounts, policies, availability, or per-copy condition guarantees. Do not assert the representative images show the exact physical copy shipped.',
    'The description field must contain only a short plain-text sentence or paragraph: no HTML, markdown, headings, bullet lists, URLs or placeholders.',
    'Do not include condition/grading claims in the title. Do not invent condition details in the description.',
    'Do not generate or recommend prices, discounts, shipping promotions, quantities, SKUs, category ids, business policies, or eBay publish state. Seller-approved copy is appended by the application, not authored by Gemini.',
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

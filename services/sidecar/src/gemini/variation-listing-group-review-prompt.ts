import type { GenerateVariationListingGroupReviewInput } from './variation-listing-group-review-contracts.js';
import { MAX_VARIATION_GROUP_TITLE_LENGTH } from '@/ebay/variation-listing-limits.js';

const OUTPUT_SHAPE = `{
  "title": "string, 1-${MAX_VARIATION_GROUP_TITLE_LENGTH} characters",
  "description": "plain-text seller description, 1-4000 characters",
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
    'Write a concise, factual, buyer-ready group description in plain text, following the clear seller-description style used for Standard listings. Do not return only a selector instruction or sales/marketing copy.',
    'Use two or three short paragraphs: first summarize the shared group theme and only genuinely common, reviewed facts (such as sport, manufacturer, set, player or team); then explain how to choose a card and interpret its photos; optionally add a brief condition reminder.',
    'Only describe a detail as shared when it is supported by derivedCommonEbayAspects for the entire group. A group theme or one child selector does not establish a fact for every variation. If few shared details exist, be brief rather than inventing filler.',
    'State clearly that each purchase is for one card chosen with the Card variation selector, not the entire group. The front/back images change to show the selected variation. Images may represent a variation rather than the exact physical copy when multiple copies exist; do not promise an exact photographed copy.',
    'Refer buyers to the listing condition and selected-card photos without inventing wear, centering, surface quality, grades or per-copy condition guarantees. The shared group condition token is not a license to describe individual copies as identical.',
    'Use readable plain-text paragraphs separated by a blank line; no HTML, markdown, headings, bullet lists, or placeholders. Keep the description concise and within 4000 characters.',
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

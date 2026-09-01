import { isVariationListingManualPriceAmount } from '@ebay-inventory/data';
import type { Json, VariationListingAggregateSnapshot } from '@ebay-inventory/data';
import { z } from 'zod';

import { mapListingConditionIdToInventoryCondition } from '@/ebay/publish-mappers.js';

const CATEGORY_ID = '261328' as const;
const MARKETPLACE_ID = 'EBAY_US' as const;
const SELECTOR_NAME = 'Card' as const;
const LISTING_FORMAT = 'FIXED_PRICE' as const;
const CURRENCY = 'USD' as const;
const MAX_INVENTORY_KEY_LENGTH = 50;

const CONDITION_RANK: Record<string, number> = {
  POOR: 0,
  VERY_GOOD: 1,
  EXCELLENT: 2,
  NEAR_MINT_OR_BETTER: 3,
};
const isConditionToken = (value: string): value is keyof typeof CONDITION_RANK =>
  Object.prototype.hasOwnProperty.call(CONDITION_RANK, value);

const trimmedText = (max?: number) => {
  const schema = max === undefined ? z.string().min(1) : z.string().min(1).max(max);
  return schema.refine((value) => value === value.trim(), 'Value must be outer-trimmed.');
};
const inventoryKeySchema = trimmedText(MAX_INVENTORY_KEY_LENGTH);
const numericIdSchema = z.string().regex(/^\d+$/);
const aspectNameSchema = trimmedText();
const aspectValueSchema = trimmedText();
const conditionDescriptorSchema = z
  .object({
    additionalInfo: trimmedText(30).optional(),
    name: numericIdSchema,
    values: z.array(numericIdSchema).min(1).refine((values) => new Set(values).size === values.length, 'Condition descriptor values must be unique.'),
  })
  .strict();
const commonAspectValueSchema = z.union([
  aspectValueSchema,
  z.array(aspectValueSchema).min(1).refine((values) => new Set(values).size === values.length, 'Aspect values must be unique.'),
]);
const commonAspectsInputSchema = z
  .record(aspectNameSchema, commonAspectValueSchema)
  .refine((value) => !Object.prototype.hasOwnProperty.call(value, SELECTOR_NAME), 'Common group aspects must not contain the Card selector.')
  .refine((value) => Object.prototype.hasOwnProperty.call(value, 'Sport'), 'Category 261328 requires a truthful common Sport aspect.');

export const variationListingEpsImageUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'i.ebayimg.com' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.pathname.length > 1
    );
  }, 'Representative image must be a trusted HTTPS i.ebayimg.com EPS URL.');

export const variationListingChildInventoryItemPayloadSchema = z
  .object({
    availability: z.object({ shipToLocationAvailability: z.object({ quantity: z.number().int().nonnegative() }).strict() }).strict(),
    condition: trimmedText(),
    conditionDescription: trimmedText(1000).optional(),
    conditionDescriptors: z.array(conditionDescriptorSchema),
    product: z
      .object({
        aspects: z.record(aspectNameSchema, z.array(aspectValueSchema).min(1)),
        imageUrls: z.tuple([variationListingEpsImageUrlSchema, variationListingEpsImageUrlSchema]),
      })
      .strict()
      .superRefine((product, context) => {
        const keys = Object.keys(product.aspects);
        if (keys.length !== 1 || keys[0] !== SELECTOR_NAME || product.aspects[SELECTOR_NAME]?.length !== 1) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['aspects'],
            message: 'Child product aspects must contain exactly one Card selector value.',
          });
        }
        if (product.imageUrls[0] === product.imageUrls[1]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['imageUrls'],
            message: 'Front and back EPS URLs must be distinct.',
          });
        }
      }),
  })
  .strict();

export const variationListingOfferPayloadSchema = z
  .object({
    availableQuantity: z.number().int().nonnegative(),
    categoryId: z.literal(CATEGORY_ID),
    format: z.literal(LISTING_FORMAT),
    listingPolicies: z
      .object({
        fulfillmentPolicyId: trimmedText(),
        paymentPolicyId: trimmedText(),
        returnPolicyId: trimmedText(),
      })
      .strict(),
    marketplaceId: z.literal(MARKETPLACE_ID),
    merchantLocationKey: trimmedText(),
    pricingSummary: z
      .object({ price: z.object({ currency: z.literal(CURRENCY), value: z.string().regex(/^\d+\.\d{2}$/) }).strict() })
      .strict(),
    sku: inventoryKeySchema,
  })
  .strict();

export const variationListingInventoryItemGroupPayloadSchema = z
  .object({
    aspects: z.record(aspectNameSchema, z.array(aspectValueSchema).min(1)),
    description: trimmedText(4000),
    inventoryItemGroupKey: inventoryKeySchema,
    title: trimmedText(80),
    variantSKUs: z.array(inventoryKeySchema).min(2),
    variesBy: z
      .object({
        aspectsImageVariesBy: z.tuple([z.literal(SELECTOR_NAME)]),
        specifications: z.tuple([
          z.object({ name: z.literal(SELECTOR_NAME), values: z.array(aspectValueSchema).min(2) }).strict(),
        ]),
      })
      .strict(),
  })
  .strict()
  .superRefine((group, context) => {
    const selectorValues = group.variesBy.specifications[0].values;
    if (group.variantSKUs.length !== selectorValues.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'variantSKUs and ordered Card selector values must have the same length.',
      });
    }
    if (new Set(group.variantSKUs).size !== group.variantSKUs.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['variantSKUs'], message: 'Variant SKUs must be unique.' });
    }
    if (new Set(selectorValues).size !== selectorValues.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['variesBy', 'specifications', 0, 'values'], message: 'Card selector values must be unique.' });
    }
  });

export const variationListingPublishGroupRequestSchema = z
  .object({
    inventoryItemGroupKey: inventoryKeySchema,
    marketplaceId: z.literal(MARKETPLACE_ID),
  })
  .strict();

export const variationListingRepresentativeImageSchema = z
  .object({
    backEpsUrl: variationListingEpsImageUrlSchema,
    copyId: trimmedText(),
    frontEpsUrl: variationListingEpsImageUrlSchema,
  })
  .strict()
  .refine((value) => value.frontEpsUrl !== value.backEpsUrl, 'Representative front/back EPS URLs must be distinct.');

export type VariationListingChildInventoryItemPayload = z.infer<typeof variationListingChildInventoryItemPayloadSchema>;
export type VariationListingOfferPayload = z.infer<typeof variationListingOfferPayloadSchema>;
export type VariationListingInventoryItemGroupPayload = z.infer<typeof variationListingInventoryItemGroupPayloadSchema>;
export type VariationListingPublishGroupRequest = z.infer<typeof variationListingPublishGroupRequestSchema>;
export type VariationListingRepresentativeImage = z.infer<typeof variationListingRepresentativeImageSchema>;

export interface VariationListingChildPayloadBundle {
  inventoryItem: VariationListingChildInventoryItemPayload;
  offer: VariationListingOfferPayload;
  quantity: number;
  representativeCopyId: string;
  selectorValue: string;
  sku: string;
  variationId: string;
}

export interface VariationListingInventoryPayloadBundle {
  children: VariationListingChildPayloadBundle[];
  group: VariationListingInventoryItemGroupPayload;
  groupId: string;
  groupKey: string;
  publishRequest: VariationListingPublishGroupRequest;
}

function jsonObject(value: Json, label: string): Record<string, Json> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Variation listing ${label} must be a JSON object.`);
  }
  return value as Record<string, Json>;
}

function parseConditionDescriptors(value: Json): Array<{ name: string; values: string[] }> {
  if (!Array.isArray(value)) throw new Error('Variation listing condition_descriptors must be an array.');
  const parsed = z.array(conditionDescriptorSchema).parse(value);
  if (new Set(parsed.map((descriptor) => descriptor.name)).size !== parsed.length) {
    throw new Error('Variation listing condition descriptor names must be unique.');
  }
  return parsed;
}

function normalizeCommonAspects(value: Json): Record<string, string[]> {
  const parsed = commonAspectsInputSchema.parse(jsonObject(value, 'derived_common_ebay_aspects'));
  return Object.fromEntries(
    Object.entries(parsed).map(([key, rawValue]) => [key, Array.isArray(rawValue) ? rawValue : [rawValue]])
  );
}

function validateAggregateIdentity(aggregate: VariationListingAggregateSnapshot): void {
  const { group, variations, copies } = aggregate;
  if (group.category_id !== CATEGORY_ID) throw new Error(`Variation listing payload builder supports category ${CATEGORY_ID} only.`);
  if (group.marketplace_id !== MARKETPLACE_ID) throw new Error(`Variation listing payload builder supports ${MARKETPLACE_ID} only.`);
  if (group.condition_id !== '4000') throw new Error('Category 261328 variation listings require raw-card condition_id 4000.');
  if (group.selector_name !== SELECTOR_NAME) throw new Error('Variation listing selector_name must be Card.');
  if (group.listing_format !== LISTING_FORMAT) throw new Error('Variation listing listing_format must be FIXED_PRICE.');
  if (!group.title || group.title !== group.title.trim() || group.title.length > 80) throw new Error('Variation listing group title must be present, outer-trimmed, and at most 80 characters.');
  if (!group.description || group.description !== group.description.trim() || group.description.length > 4000) throw new Error('Variation listing group description must be present, outer-trimmed, and at most 4000 characters.');
  if (variations.length < 2) throw new Error('Variation listing payload builder requires at least two variations.');

  const ordered = [...variations].sort((left, right) => left.position - right.position);
  ordered.forEach((variation, index) => {
    if (variation.group_id !== group.group_id) throw new Error('Every variation must belong to the payload group.');
    if (variation.position !== index) throw new Error('Variation positions must be contiguous from zero.');
    if (variation.price_currency !== CURRENCY || !isVariationListingManualPriceAmount(variation.price_amount)) {
      throw new Error('Variation prices must be persisted USD manual tiers.');
    }
  });
  if (new Set(ordered.map((variation) => variation.variation_id)).size !== ordered.length) {
    throw new Error('Variation ids must be unique.');
  }
  if (new Set(ordered.map((variation) => variation.sku)).size !== ordered.length) throw new Error('Variation SKUs must be unique.');
  if (new Set(ordered.map((variation) => variation.selector_value)).size !== ordered.length) throw new Error('Variation selector values must be unique.');

  const variationIds = new Set(ordered.map((variation) => variation.variation_id));
  const copyIds = new Set<string>();
  for (const copy of copies) {
    if (!variationIds.has(copy.variation_id)) throw new Error('Every copy must belong to a variation in the payload group.');
    if (copyIds.has(copy.copy_id)) throw new Error('Physical copy ids must be unique.');
    copyIds.add(copy.copy_id);
    if (copy.availability_state !== 'available' && copy.availability_state !== 'unavailable') {
      throw new Error(`Unsupported physical copy availability state ${copy.availability_state}.`);
    }
    if (!isConditionToken(copy.condition_token)) throw new Error(`Unsupported physical copy condition token ${copy.condition_token}.`);
  }
  if (!isConditionToken(group.condition_token)) throw new Error(`Unsupported group condition token ${group.condition_token}.`);
  const groupRank = CONDITION_RANK[group.condition_token]!;
  const incompatible = copies.filter(
    (copy) => copy.availability_state === 'available' && CONDITION_RANK[copy.condition_token]! < groupRank
  );
  if (incompatible.length > 0) throw new Error('Available physical copies must satisfy the shared group condition tier.');
}

export function buildVariationListingInventoryPayloadBundle(input: {
  aggregate: VariationListingAggregateSnapshot;
  representativeImages: readonly VariationListingRepresentativeImage[];
}): VariationListingInventoryPayloadBundle {
  const aggregate = input.aggregate;
  validateAggregateIdentity(aggregate);
  const group = aggregate.group;
  const orderedVariations = [...aggregate.variations].sort((left, right) => left.position - right.position);
  const conditionDescriptors = parseConditionDescriptors(group.condition_descriptors);
  const condition = mapListingConditionIdToInventoryCondition(group.condition_id);
  const commonAspects = normalizeCommonAspects(group.derived_common_ebay_aspects);

  const images = input.representativeImages.map((entry) => variationListingRepresentativeImageSchema.parse(entry));
  if (new Set(images.map((entry) => entry.copyId)).size !== images.length) throw new Error('Representative image copy ids must be unique.');
  const expectedRepresentativeIds = orderedVariations.map((variation) => {
    if (!variation.representative_copy_id) throw new Error(`Variation ${variation.variation_id} is missing representative_copy_id.`);
    return variation.representative_copy_id;
  });
  if (
    images.length !== expectedRepresentativeIds.length ||
    images.some((entry) => !expectedRepresentativeIds.includes(entry.copyId)) ||
    expectedRepresentativeIds.some((copyId) => !images.some((entry) => entry.copyId === copyId))
  ) {
    throw new Error('Representative EPS image inputs must exactly match the group representative copies.');
  }
  const allImageUrls = images.flatMap((entry) => [entry.frontEpsUrl, entry.backEpsUrl]);
  if (new Set(allImageUrls).size !== allImageUrls.length) throw new Error('Representative EPS URLs must be unique across the complete group.');
  const imagesByCopyId = new Map(images.map((entry) => [entry.copyId, entry]));
  const copiesByVariationId = new Map<string, typeof aggregate.copies>();
  for (const variation of orderedVariations) copiesByVariationId.set(variation.variation_id, []);
  for (const copy of aggregate.copies) copiesByVariationId.get(copy.variation_id)!.push(copy);

  const children: VariationListingChildPayloadBundle[] = orderedVariations.map((variation) => {
    const copies = copiesByVariationId.get(variation.variation_id)!;
    const representativeCopyId = variation.representative_copy_id!;
    if (!copies.some((copy) => copy.copy_id === representativeCopyId)) {
      throw new Error(`Variation ${variation.variation_id} representative copy does not belong to that variation.`);
    }
    const representativeImages = imagesByCopyId.get(representativeCopyId)!;
    const quantity = copies.filter((copy) => copy.availability_state === 'available').length;
    const inventoryItem = variationListingChildInventoryItemPayloadSchema.parse({
      availability: { shipToLocationAvailability: { quantity } },
      condition,
      ...(conditionDescriptors.length === 0 && group.condition_description
        ? { conditionDescription: group.condition_description }
        : {}),
      conditionDescriptors,
      product: {
        aspects: { [SELECTOR_NAME]: [variation.selector_value] },
        imageUrls: [representativeImages.frontEpsUrl, representativeImages.backEpsUrl],
      },
    });
    const offer = variationListingOfferPayloadSchema.parse({
      availableQuantity: quantity,
      categoryId: group.category_id,
      format: group.listing_format,
      listingPolicies: {
        fulfillmentPolicyId: group.fulfillment_policy_id,
        paymentPolicyId: group.payment_policy_id,
        returnPolicyId: group.return_policy_id,
      },
      marketplaceId: group.marketplace_id,
      merchantLocationKey: group.merchant_location_key,
      pricingSummary: { price: { currency: variation.price_currency, value: Number(variation.price_amount).toFixed(2) } },
      sku: variation.sku,
    });
    return {
      inventoryItem,
      offer,
      quantity,
      representativeCopyId,
      selectorValue: variation.selector_value,
      sku: variation.sku,
      variationId: variation.variation_id,
    };
  });

  const groupPayload = variationListingInventoryItemGroupPayloadSchema.parse({
    aspects: commonAspects,
    description: group.description,
    inventoryItemGroupKey: group.group_key,
    title: group.title,
    variantSKUs: children.map((child) => child.sku),
    variesBy: {
      aspectsImageVariesBy: [SELECTOR_NAME],
      specifications: [{ name: SELECTOR_NAME, values: children.map((child) => child.selectorValue) }],
    },
  });
  const publishRequest = variationListingPublishGroupRequestSchema.parse({
    inventoryItemGroupKey: group.group_key,
    marketplaceId: group.marketplace_id,
  });

  return {
    children,
    group: groupPayload,
    groupId: group.group_id,
    groupKey: group.group_key,
    publishRequest,
  };
}

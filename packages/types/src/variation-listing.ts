export interface VariationListingConditionDescriptor {
  additionalInfo?: string;
  name: string;
  values: readonly string[];
}

export interface VariationListingSharedCondition {
  conditionDescription?: string;
  conditionDescriptors: readonly VariationListingConditionDescriptor[];
  conditionId: string;
}

export interface VariationListingPolicies {
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
}

export interface VariationListingMoney {
  currency: string;
  value: string;
}

export interface VariationListingCardImages {
  back: string;
  front: string;
}

export interface VariationListingVariationDraft {
  availableQuantity: number;
  images: VariationListingCardImages;
  price: VariationListingMoney;
  selectorValue: string;
  sku: string;
  variantAspects: Readonly<Record<string, readonly string[]>>;
}

export interface VariationListingGroupDraft {
  categoryId: string;
  condition: VariationListingSharedCondition;
  description: string;
  groupKey: string;
  marketplaceId: string;
  merchantLocationKey: string;
  policies: VariationListingPolicies;
  selectorName: string;
  sharedAspects: Readonly<Record<string, readonly string[]>>;
  title: string;
  variants: readonly VariationListingVariationDraft[];
}

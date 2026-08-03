export interface YouPickConditionDescriptor {
  additionalInfo?: string;
  name: string;
  values: readonly string[];
}

export interface YouPickSharedCondition {
  conditionDescription?: string;
  conditionDescriptors: readonly YouPickConditionDescriptor[];
  conditionId: string;
}

export interface YouPickListingPolicies {
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
}

export interface YouPickMoney {
  currency: string;
  value: string;
}

export interface YouPickCardImages {
  back: string;
  front: string;
}

export interface YouPickVariantDraft {
  availableQuantity: number;
  images: YouPickCardImages;
  price: YouPickMoney;
  selectorValue: string;
  sku: string;
  variantAspects: Readonly<Record<string, readonly string[]>>;
}

export interface YouPickGroupDraft {
  categoryId: string;
  condition: YouPickSharedCondition;
  description: string;
  groupKey: string;
  marketplaceId: string;
  merchantLocationKey: string;
  policies: YouPickListingPolicies;
  selectorName: string;
  sharedAspects: Readonly<Record<string, readonly string[]>>;
  title: string;
  variants: readonly YouPickVariantDraft[];
}

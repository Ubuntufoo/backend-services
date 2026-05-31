import type { MetadataApi } from '@/api/listing-metadata/metadata.js';
import type { components as MetadataComponents } from '@/types/sell-apps/listing-metadata/sellMetadataV1Oas3.js';

type MetadataResponse = MetadataComponents['schemas']['ItemConditionPolicyResponse'];
type MetadataItemConditionPolicy = MetadataComponents['schemas']['ItemConditionPolicy'];
type MetadataItemCondition = MetadataComponents['schemas']['ItemCondition'];
type MetadataItemConditionDescriptor = MetadataComponents['schemas']['ItemConditionDescriptor'];

export const TRADING_CARD_CONDITION_DESCRIPTOR_NAME_ALIASES = ['card condition'] as const;

export interface ConditionPolicyDiagnosticResult {
  marketplaceId: string;
  categories: Array<{
    categoryId: string;
    itemConditionPolicies: MetadataItemConditionPolicy[];
  }>;
}

function normalizeLookupText(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
}

export function getMetadataPolicies(response: unknown): MetadataItemConditionPolicy[] {
  if (!response || typeof response !== 'object') {
    return [];
  }

  const itemConditionPolicies = (response as MetadataResponse).itemConditionPolicies;
  return Array.isArray(itemConditionPolicies) ? itemConditionPolicies : [];
}

export function isTradingCardConditionDescriptorName(
  descriptorName: string | null | undefined
): boolean {
  const normalizedName = normalizeLookupText(descriptorName);

  return TRADING_CARD_CONDITION_DESCRIPTOR_NAME_ALIASES.some(
    (alias) => normalizeLookupText(alias) === normalizedName
  );
}

export function getTradingCardConditionDescriptor(
  condition: MetadataItemCondition | undefined
): MetadataItemConditionDescriptor | undefined {
  return condition?.conditionDescriptors?.find((descriptor) =>
    isTradingCardConditionDescriptorName(descriptor.conditionDescriptorName)
  );
}

export async function getConditionPolicyDiagnostic(
  metadataApi: Pick<MetadataApi, 'getItemConditionPolicies'>,
  marketplaceId: string,
  categoryIds: string[]
): Promise<ConditionPolicyDiagnosticResult> {
  const categories = await Promise.all(
    categoryIds.map(async (categoryId) => {
      const response = await metadataApi.getItemConditionPolicies(
        marketplaceId,
        `categoryIds:{${categoryId}}`
      );

      return {
        categoryId,
        itemConditionPolicies: getMetadataPolicies(response),
      };
    })
  );

  return {
    marketplaceId,
    categories,
  };
}

export function formatConditionPolicyDiagnostic(
  diagnostic: ConditionPolicyDiagnosticResult
): string {
  const lines: string[] = [`marketplace_id: ${diagnostic.marketplaceId}`];

  for (const category of diagnostic.categories) {
    lines.push(`category_id: ${category.categoryId}`);

    if (category.itemConditionPolicies.length === 0) {
      lines.push('  itemConditionPolicies: []');
      continue;
    }

    for (const policy of category.itemConditionPolicies) {
      lines.push(`  policy.categoryId: ${policy.categoryId ?? '[missing]'}`);

      const itemConditions = Array.isArray(policy.itemConditions) ? policy.itemConditions : [];
      if (itemConditions.length === 0) {
        lines.push('  itemConditions: []');
        continue;
      }

      for (const condition of itemConditions) {
        lines.push(`  conditionId: ${condition.conditionId ?? '[missing]'}`);
        lines.push(`  conditionDescription: ${condition.conditionDescription ?? '[missing]'}`);

        const descriptors = Array.isArray(condition.conditionDescriptors)
          ? condition.conditionDescriptors
          : [];
        if (descriptors.length === 0) {
          lines.push('    conditionDescriptors: []');
          continue;
        }

        for (const descriptor of descriptors) {
          lines.push(
            `    descriptor: ${descriptor.conditionDescriptorId ?? '[missing id]'} | ${descriptor.conditionDescriptorName ?? '[missing name]'}`
          );

          const values = Array.isArray(descriptor.conditionDescriptorValues)
            ? descriptor.conditionDescriptorValues
            : [];
          if (values.length === 0) {
            lines.push('      values: []');
            continue;
          }

          for (const value of values) {
            lines.push(
              `      value: ${value.conditionDescriptorValueId ?? '[missing id]'} | ${value.conditionDescriptorValueName ?? '[missing name]'}`
            );
          }
        }
      }
    }
  }

  return lines.join('\n');
}

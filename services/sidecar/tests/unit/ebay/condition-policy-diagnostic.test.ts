import { describe, expect, it } from 'vitest';
import {
  formatConditionPolicyDiagnostic,
  isTradingCardConditionDescriptorName,
} from '@/ebay/condition-policy-diagnostic.js';

describe('condition policy diagnostic', () => {
  it('formats item conditions, descriptors, and values for diagnostics', () => {
    const formatted = formatConditionPolicyDiagnostic({
      marketplaceId: 'EBAY_US',
      categories: [
        {
          categoryId: '261328',
          itemConditionPolicies: [
            {
              categoryId: '261328',
              itemConditions: [
                {
                  conditionId: '4000',
                  conditionDescription: 'Ungraded',
                  conditionDescriptors: [
                    {
                      conditionDescriptorId: '40001',
                      conditionDescriptorName: 'Card Condition',
                      conditionDescriptorValues: [
                        {
                          conditionDescriptorValueId: '400012',
                          conditionDescriptorValueName: 'Near Mint or Better',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(formatted).toContain('marketplace_id: EBAY_US');
    expect(formatted).toContain('category_id: 261328');
    expect(formatted).toContain('conditionId: 4000');
    expect(formatted).toContain('conditionDescription: Ungraded');
    expect(formatted).toContain('descriptor: 40001 | Card Condition');
    expect(formatted).toContain('value: 400012 | Near Mint or Better');
  });

  it('matches only explicit trading-card descriptor aliases', () => {
    expect(isTradingCardConditionDescriptorName('Card Condition')).toBe(true);
    expect(isTradingCardConditionDescriptorName('card-condition')).toBe(true);
    expect(isTradingCardConditionDescriptorName('Condition')).toBe(false);
    expect(isTradingCardConditionDescriptorName('Ungraded Grade')).toBe(false);
  });
});

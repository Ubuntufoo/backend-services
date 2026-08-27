import { describe, expect, it } from 'vitest';

import {
  buildActiveMarketTitleTarget,
  getActiveMarketTitleMismatchReason,
} from '@/pricing/active-market-title.js';

function buildTarget(overrides: Record<string, string> = {}) {
  return buildActiveMarketTitleTarget({
    itemSpecifics: {
      'Card Number': '123',
      Manufacturer: 'Topps',
      Player: 'Johnny Bench',
      Set: 'Topps Chrome',
      Year: '1973',
      ...overrides,
    },
    title: '1973 Topps Chrome Johnny Bench #123',
  });
}

describe('active-market-title', () => {
  it.each([
    ['1973 Topps Johnny Bench #123', 'active_set_mismatch'],
    ['1973 Topps Chrome Johnny Bench #123 Reprint', 'active_reprint_mismatch'],
    ['1973 Topps Chrome Johnny Bench #123 Signed', 'active_autograph_mismatch'],
    ['1973 Topps Chrome Johnny Bench #123 Lot of 2', 'active_multi_card_mismatch'],
    ['1973 Topps Chrome Johnny Bench 123', 'active_card_number_evidence_mismatch'],
  ])('rejects active-market false positive %s', (title, reason) => {
    expect(getActiveMarketTitleMismatchReason(title, buildTarget())).toBe(reason);
  });

  it.each([
    '1973 Topps Chrome Johnny Bench #123',
    '1973 Topps Chrome Johnny Bench Card No. 123 Hall of Fame Class of 1988',
    '1973 Topps Chrome Johnny Bench',
  ])('accepts legitimate active title %s', (title) => {
    expect(getActiveMarketTitleMismatchReason(title, buildTarget())).toBeNull();
  });

  it('still rejects a genuine later-year identity conflict', () => {
    expect(getActiveMarketTitleMismatchReason('1988 Topps Chrome Johnny Bench #123', buildTarget()))
      .toBe('exact_year_mismatch');
  });

  it('accepts autograph and reprint signals when target metadata authorizes them', () => {
    const target = buildTarget({ Features: 'Autograph Reprint' });
    expect(
      getActiveMarketTitleMismatchReason(
        '1973 Topps Chrome Johnny Bench Signed Reprint #123',
        target
      )
    ).toBeNull();
  });
});

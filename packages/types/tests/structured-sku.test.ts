import { describe, expect, it } from 'vitest';
import {
  SKU_CATEGORY_CODES,
  SKU_LISTING_TYPES,
  formatStructuredSku,
  normalizeSkuCategoryCode,
  parseBaseSku,
  parseStructuredSku,
} from '../src/index.js';

describe('structured SKU helpers', () => {
  it('exports allowed category codes and listing types', () => {
    expect(SKU_CATEGORY_CODES).toEqual(['BSKBL', 'BSBL', 'OTHER']);
    expect(SKU_LISTING_TYPES).toEqual(['Single', 'Lot']);
  });

  it('parses valid base SKUs', () => {
    expect(parseBaseSku('Single-000001')).toEqual({
      listingType: 'Single',
      sequence: '000001',
    });
    expect(parseBaseSku('Lot-000002')).toEqual({
      listingType: 'Lot',
      sequence: '000002',
    });
  });

  it('parses valid structured SKUs', () => {
    expect(parseStructuredSku('BSKBL-Single-000001')).toEqual({
      categoryCode: 'BSKBL',
      listingType: 'Single',
      sequence: '000001',
      baseSku: 'Single-000001',
      structuredSku: 'BSKBL-Single-000001',
    });
    expect(parseStructuredSku('BSBL-Lot-000002')).toEqual({
      categoryCode: 'BSBL',
      listingType: 'Lot',
      sequence: '000002',
      baseSku: 'Lot-000002',
      structuredSku: 'BSBL-Lot-000002',
    });
    expect(parseStructuredSku('OTHER-Single-999999')).toEqual({
      categoryCode: 'OTHER',
      listingType: 'Single',
      sequence: '999999',
      baseSku: 'Single-999999',
      structuredSku: 'OTHER-Single-999999',
    });
  });

  it('formats structured SKUs for all allowed prefixes', () => {
    expect(formatStructuredSku({ categoryCode: 'BSKBL', baseSku: 'Single-000001' })).toBe(
      'BSKBL-Single-000001'
    );
    expect(formatStructuredSku({ categoryCode: 'BSBL', baseSku: 'Lot-000002' })).toBe(
      'BSBL-Lot-000002'
    );
    expect(formatStructuredSku({ categoryCode: 'OTHER', baseSku: 'Single-000003' })).toBe(
      'OTHER-Single-000003'
    );
  });

  it('normalizes category codes from whitespace and lowercase input', () => {
    expect(normalizeSkuCategoryCode(' bskbl ')).toBe('BSKBL');
    expect(normalizeSkuCategoryCode(' bsbl')).toBe('BSBL');
    expect(normalizeSkuCategoryCode('other ')).toBe('OTHER');
  });

  it.each([
    '',
    'Single',
    'Single-1',
    'Single-00001',
    'Single-000001-extra',
  ])('rejects invalid base SKU %s', (value) => {
    expect(() => parseBaseSku(value)).toThrow();
  });

  it.each([
    '',
    'BSKBL-Single',
    'BSKBL-Single-1',
    'BSKBL-single-000001',
    'BASKETBALL-Single-000001',
    'TCG-Single-000001',
    'OTHER-Bundle-000001',
    'OTHER-Lot-ABCDEF',
    'OTHER-Lot-000001-extra',
  ])('rejects invalid structured SKU %s', (value) => {
    expect(() => parseStructuredSku(value)).toThrow();
  });

  it('returns null for unknown normalized category codes', () => {
    expect(normalizeSkuCategoryCode('')).toBeNull();
    expect(normalizeSkuCategoryCode('mlb')).toBeNull();
    expect(normalizeSkuCategoryCode('basketball')).toBeNull();
    expect(normalizeSkuCategoryCode(null)).toBeNull();
  });
});

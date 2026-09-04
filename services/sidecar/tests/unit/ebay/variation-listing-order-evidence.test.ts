import { describe, expect, it } from 'vitest';
import {
  getVariationOrderLineIdempotencyKey,
  matchVariationOrderEvidence,
  parseVariationOrderEvidence,
} from '@/ebay/variation-listing-order-evidence.js';
import {
  parseInspectVariationListingOrderArgs,
  runInspectVariationListingOrderCli,
} from '@/scripts/inspect-variation-listing-order.js';

function order(
  lineItems: { lineItemId?: unknown; sku?: unknown; quantity?: unknown }[],
  orderId: unknown = 'ORDER-1'
): unknown {
  return { orderId, lineItems };
}

function line(
  lineItemId: unknown,
  sku: unknown,
  quantity: unknown = 1
): {
  lineItemId: unknown;
  sku: unknown;
  quantity: unknown;
} {
  return { lineItemId, sku, quantity };
}

describe('variation order evidence', () => {
  it('matches one exact SKU to one local variation', () => {
    const evidence = parseVariationOrderEvidence(order([line('LINE-1', 'CARD-C01')]));
    const result = matchVariationOrderEvidence(evidence, ['CARD-C01']);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      status: 'matched',
      localVariationSku: 'CARD-C01',
      sku: 'CARD-C01',
    });
  });

  it('fails closed when SKU is missing', () => {
    expect(() => parseVariationOrderEvidence(order([line('LINE-1', undefined)]))).toThrow(/sku/i);
  });

  it('surfaces duplicate local SKU ownership as ambiguous', () => {
    const evidence = parseVariationOrderEvidence(order([line('LINE-1', 'CARD-C01')]));
    const result = matchVariationOrderEvidence(evidence, ['CARD-C01', 'CARD-C01']);

    expect(result.lines[0]).toMatchObject({ status: 'ambiguous', reason: 'duplicate_local_sku' });
    expect(result.lines[0].localVariationSku).toBeUndefined();
  });

  it('matches each line independently when an order contains different variation SKUs', () => {
    const evidence = parseVariationOrderEvidence(
      order([line('LINE-2', 'CARD-C02'), line('LINE-1', 'CARD-C01')])
    );
    const result = matchVariationOrderEvidence(evidence, ['CARD-C01', 'CARD-C02']);

    expect(result.lines.map((item) => [item.lineItemId, item.status])).toEqual([
      ['LINE-1', 'matched'],
      ['LINE-2', 'matched'],
    ]);
  });

  it('preserves quantity greater than one on one line identity', () => {
    const evidence = parseVariationOrderEvidence(order([line('LINE-1', 'CARD-C01', 3)]));

    expect(evidence.lines[0]).toMatchObject({ quantity: 3, lineItemId: 'LINE-1' });
    expect(evidence.lines).toHaveLength(1);
  });

  it('returns the same idempotency key on replay', () => {
    const first = parseVariationOrderEvidence(order([line('LINE-1', 'CARD-C01')])).lines[0];
    const replay = parseVariationOrderEvidence(order([line('LINE-1', 'CARD-C01')])).lines[0];

    expect(first.idempotencyKey).toBe(replay.idempotencyKey);
    expect(first.idempotencyKey).toBe(getVariationOrderLineIdempotencyKey('ORDER-1', 'LINE-1'));
  });

  it('leaves a non-variation SKU unresolved without contaminating matched lines', () => {
    const evidence = parseVariationOrderEvidence(
      order([line('LINE-2', 'OTHER-LISTING'), line('LINE-1', 'CARD-C01')])
    );
    const result = matchVariationOrderEvidence(evidence, ['CARD-C01']);

    expect(result.lines.map((item) => item.status)).toEqual(['matched', 'unresolved']);
    expect(result.lines[1].reason).toBe('sku_not_in_local_variations');
  });

  it('is independent of Fulfillment response line order', () => {
    const first = parseVariationOrderEvidence(
      order([line('LINE-B', 'CARD-C02'), line('LINE-A', 'CARD-C01')])
    );
    const second = parseVariationOrderEvidence(
      order([line('LINE-A', 'CARD-C01'), line('LINE-B', 'CARD-C02')])
    );

    expect(first).toEqual(second);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    'rejects malformed quantity %s',
    (quantity) => {
      expect(() =>
        parseVariationOrderEvidence(order([line('LINE-1', 'CARD-C01', quantity)]))
      ).toThrow(/quantity/i);
    }
  );

  it('rejects duplicate lineItemId values within one order', () => {
    expect(() =>
      parseVariationOrderEvidence(order([line('LINE-1', 'CARD-C01'), line('LINE-1', 'CARD-C02')]))
    ).toThrow(/duplicate lineItemId/i);
  });

  it('uses exact SKU text without trimming or fuzzy matching', () => {
    const evidence = parseVariationOrderEvidence(order([line('LINE-1', ' CARD-C01 ')]));
    const result = matchVariationOrderEvidence(evidence, ['CARD-C01']);

    expect(result.lines[0].status).toBe('unresolved');
    expect(result.lines[0].sku).toBe(' CARD-C01 ');
  });

  it('diagnostic emits parser-only evidence and omits private order fields', async () => {
    const output: string[] = [];
    await runInspectVariationListingOrderCli(['--order-id', 'ORDER-1'], {
      apiFactory: async () => ({
        fulfillment: {
          getOrder: async () => ({
            orderId: 'ORDER-1',
            buyer: { username: 'private-buyer' },
            lineItems: [{ lineItemId: 'LINE-1', sku: 'CARD-C01', quantity: 1 }],
          }),
          getOrders: async () => ({ orders: [] }),
        },
      }),
      print: (value) => output.push(value),
    });

    expect(output).toHaveLength(1);
    expect(output[0]).not.toContain('private-buyer');
    expect(JSON.parse(output[0])).toEqual({
      orders: [
        {
          orderId: 'ORDER-1',
          lines: [
            {
              orderId: 'ORDER-1',
              lineItemId: 'LINE-1',
              sku: 'CARD-C01',
              quantity: 1,
              idempotencyKey: '["ORDER-1","LINE-1"]',
            },
          ],
        },
      ],
    });
  });

  it('accepts only bounded, ordered ISO-Z date filters', () => {
    expect(
      parseInspectVariationListingOrderArgs([
        '--filter',
        'creationdate:[2026-08-01T00:00:00.000Z..2026-08-12T23:59:59.999Z]',
      ])
    ).toEqual({
      filter: 'creationdate:[2026-08-01T00:00:00.000Z..2026-08-12T23:59:59.999Z]',
    });
    for (const filter of [
      'creationdate:[2026-08-01T00:00:00.000Z..]',
      'creationdate:[2026-08-12T00:00:00.000Z..2026-08-01T00:00:00.000Z]',
      'creationdate:[2026-02-29T00:00:00.000Z..2026-03-01T00:00:00.000Z]',
      'lastmodifieddate:[2026-08-01T00:00:00.000Z..2026-08-02T00:00:00.000Z],junk',
    ]) {
      expect(() => parseInspectVariationListingOrderArgs(['--filter', filter])).toThrow(/filter/i);
    }
  });

  it('accepts only documented fulfillment-status sets', () => {
    expect(
      parseInspectVariationListingOrderArgs([
        '--filter',
        'orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}',
      ])
    ).toEqual({ filter: 'orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}' });
    expect(
      parseInspectVariationListingOrderArgs([
        '--filter',
        'orderfulfillmentstatus:{FULFILLED|IN_PROGRESS}',
      ])
    ).toEqual({ filter: 'orderfulfillmentstatus:{FULFILLED|IN_PROGRESS}' });
    for (const filter of [
      'orderfulfillmentstatus:{NOT_STARTED}',
      'orderfulfillmentstatus:{IN_PROGRESS|NOT_STARTED}',
      'orderfulfillmentstatus:{NOT_STARTED|FULFILLED}',
      'orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS},creationdate:[junk]',
    ]) {
      expect(() => parseInspectVariationListingOrderArgs(['--filter', filter])).toThrow(/filter/i);
    }
  });
});

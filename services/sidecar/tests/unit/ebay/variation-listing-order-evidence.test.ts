import { describe, expect, it } from 'vitest';
import {
  getVariationOrderLineIdempotencyKey,
  matchVariationOrderEvidence,
  parseVariationOrderEvidence,
  readRemovedSkuOrderSafety,
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
describe('removed-SKU outstanding-order safety', () => {
  const created = '2026-10-01T00:00:00Z';
  const now = new Date('2026-11-06T00:00:00Z');
  const empty = {limit: 200, offset: 0, total: 0, orders: []};
  const check = (reader: (filter: string, limit: number, offset: number) => Promise<unknown>) =>
    readRemovedSkuOrderSafety(reader, 'SKU-B', created, 'LISTING-1', now);

  it('searches only outstanding orders from group creation onward', async () => {
    const filters: string[] = [];
    const result = await check(async (filter) => { filters.push(filter); return empty; });
    expect(result).toEqual({complete: true, openTargetLines: 0});
    expect(filters).toEqual([
      'creationdate:[2026-10-01T00:00:00.000Z..2026-11-06T00:00:00.000Z],orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}',
    ]);
  });

  it.each(['NOT_STARTED', 'IN_PROGRESS'])('blocks an outstanding %s order for the target SKU', async (status) => {
    const reader = async () => ({
      ...empty, total: 1, orders: [{
        orderId: 'ORDER-1', orderFulfillmentStatus: status,
        lineItems: [{lineItemId: 'L1', sku: 'SKU-B', quantity: 1}],
      }],
    });
    await expect(check(reader)).resolves.toEqual({complete: true, openTargetLines: 1});
  });

  it('allows missing SKU on an unrelated listing and rejects ambiguous target identity', async () => {
    const reader = (legacyItemId: unknown) => async () => ({
      ...empty, total: 1, orders: [{
        orderId: 'OTHER-ORDER', orderFulfillmentStatus: 'NOT_STARTED',
        lineItems: [{lineItemId: 'OTHER-LINE', legacyItemId, quantity: 1}],
      }],
    });
    await expect(check(reader('OTHER-LISTING'))).resolves.toEqual({complete: true, openTargetLines: 0});
    await expect(check(reader('LISTING-1'))).rejects.toThrow(/cannot be ruled out/);
    await expect(check(reader(undefined))).rejects.toThrow(/cannot be ruled out/);
  });

  it('rejects malformed non-string and blank SKUs even with a foreign listing identity', async () => {
    const reader = (sku: unknown) => async () => ({
      ...empty, total: 1, orders: [{
        orderId: 'OTHER-ORDER', orderFulfillmentStatus: 'NOT_STARTED',
        lineItems: [{lineItemId: 'OTHER-LINE', sku, legacyItemId: 'OTHER-LISTING', quantity: 1}],
      }],
    });
    await expect(check(reader(42))).rejects.toThrow(/SKU/);
    await expect(check(reader(null))).rejects.toThrow(/SKU/);
    await expect(check(reader('   '))).rejects.toThrow(/SKU/);
  });

  it('rejects malformed target quantity and duplicate line IDs', async () => {
    const read = (lines: unknown[]) => async () => ({
      ...empty, total: 1, orders: [{
        orderId: 'ORDER-1', orderFulfillmentStatus: 'NOT_STARTED', lineItems: lines,
      }],
    });
    await expect(check(read([{lineItemId: 'L1', sku: 'SKU-B', quantity: -1}]))).rejects.toThrow(/quantity/);
    await expect(check(read([
      {lineItemId: 'L1', sku: 'SKU-B', quantity: 1},
      {lineItemId: 'L1', sku: 'OTHER', quantity: 1},
    ]))).rejects.toThrow(/duplicate/);
  });

  it.each([
    {total: 1, offset: 0, limit: 200, orders: []},
    {total: 0, offset: 2, limit: 200, orders: []},
    {total: 0, offset: 0, limit: 200, orders: [], next: 'unexpected'},
  ])('rejects incomplete or contradictory pagination', async (page) => {
    await expect(check(async () => page)).rejects.toThrow(/pagination|coverage|incomplete/);
  });

  it('rejects duplicate order identities across pages', async () => {
    const firstPage = Array.from({length: 200}, (_, i) => ({
      orderId: `ORDER-${i}`, orderFulfillmentStatus: 'NOT_STARTED',
      lineItems: [{lineItemId: `L-${i}`, sku: 'OTHER', quantity: 1}],
    }));
    const read = async (_filter: string, _limit: number, offset: number) =>
      offset === 0
        ? {...empty, total: 201, orders: firstPage, next: 'more'}
        : {...empty, offset: 200, total: 201, orders: [firstPage[199]]};
    await expect(check(read)).rejects.toThrow(/duplicate order identities/);
  });

  it('accepts complete multipage coverage when the optional next cursor is omitted', async () => {
    const read = async (_filter: string, _limit: number, offset: number) => ({
      total: 201,
      offset,
      limit: 200,
      orders: Array.from({length: offset === 0 ? 200 : 1}, (_, index) => ({
        orderId: `ORDER-${offset + index}`,
        orderFulfillmentStatus: 'IN_PROGRESS',
        lineItems: [{lineItemId: `LINE-${offset + index}`, sku: 'OTHER', legacyItemId: 'OTHER-LISTING', quantity: 1}],
      })),
    });
    await expect(check(read)).resolves.toEqual({complete: true, openTargetLines: 0});
  });

  it('rejects malformed pagination cursors and a cursor on a terminal page', async () => {
    await expect(check(async () => ({...empty, next: ''}))).rejects.toThrow(/cursor/);
    await expect(check(async () => ({...empty, next: 'unexpected'}))).rejects.toThrow(/pagination|inconsistent/);
    await expect(check(async () => ({...empty, next: 1}))).rejects.toThrow(/cursor/);
  });

  it('fails closed when order coverage exceeds the bounded inspection capacity', async () => {
    const read = async (_filter: string, _limit: number, offset: number) => ({
      total: 2001,
      offset,
      limit: 200,
      orders: Array.from({length: 200}, (_, index) => ({
        orderId: `ORDER-${offset + index}`,
        orderFulfillmentStatus: 'NOT_STARTED',
        lineItems: [{lineItemId: `LINE-${offset + index}`, sku: 'OTHER', legacyItemId: 'OTHER-LISTING', quantity: 1}],
      })),
    });
    await expect(check(read)).rejects.toThrow(/bounded inspection capacity/);
  });

  it('rejects blank target identities before reading orders', async () => {
    const read = async () => empty;
    await expect(readRemovedSkuOrderSafety(read, '   ', created, 'LISTING-1', now)).rejects.toThrow(/two-year/);
    await expect(readRemovedSkuOrderSafety(read, 'SKU-B', created, '   ', now)).rejects.toThrow(/two-year/);
  });

  it('rejects history beyond the supported two-year window', async () => {
    await expect(readRemovedSkuOrderSafety(async () => empty, 'SKU-B', '2020-01-01T00:00:00Z', 'LISTING-1', now))
      .rejects.toThrow(/two-year/);
  });
});

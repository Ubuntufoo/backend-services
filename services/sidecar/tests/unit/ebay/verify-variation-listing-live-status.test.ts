import { describe, expect, it } from 'vitest';

import {
  addUnknown,
  baseReport,
  collectDurableIdentity,
  countUniqueLiveListingIds,
  durableIdentityFor,
  isNotFound,
  isOfferLive,
  normalizeOffers,
  parseOffer,
  recordDurableOfferOwner,
} from '@/scripts/verify-variation-listing-live-status.js';

const identity = (): {
  offerIdsBySku: Map<string, Set<string>>;
  unscopedOfferIds: Set<string>;
  listingIds: Set<string>;
  hasPublishedHistory: boolean;
  malformed: boolean;
} => ({
  offerIdsBySku: new Map<string, Set<string>>(),
  unscopedOfferIds: new Set<string>(),
  listingIds: new Set<string>(),
  hasPublishedHistory: false,
  malformed: false,
});

describe('unknown diagnostics', () => {
  it('derives unknownCount from sanitized reasons', () => {
    const report = baseReport({
      environment: 'production',
      apiBaseUrl: 'https://api.ebay.com',
      marketplaceId: 'EBAY_US',
      productionPublishEnabled: false,
      readiness: 'pass',
    });
    addUnknown(report, 'group_read_unknown:GROUP-1');
    addUnknown(report, 'offers_payload_invalid:SKU-1');
    expect(report.unknownReasons).toEqual([
      'group_read_unknown:GROUP-1',
      'offers_payload_invalid:SKU-1',
    ]);
    expect(report.unknownCount).toBe(report.unknownReasons.length);
  });
});

describe('isNotFound', () => {
  it('accepts only an exact numeric HTTP 404 status', () => {
    expect(isNotFound({ statusCode: 404 })).toBe(true);
    expect(isNotFound({ response: { status: 404 } })).toBe(true);
    expect(isNotFound({ statusCode: '404' })).toBe(false);
    expect(isNotFound(new Error('404 offer not found'))).toBe(false);
    expect(isNotFound({ statusCode: 500, message: 'could not be found' })).toBe(false);

    const wrapped = new Error('request failed');
    Object.defineProperty(wrapped, 'cause', { value: { response: { status: 404 } } });
    expect(isNotFound(wrapped)).toBe(true);

    const nonNotFoundCause = new Error('request failed');
    Object.defineProperty(nonNotFoundCause, 'cause', { value: { statusCode: 500 } });
    expect(isNotFound(nonNotFoundCause)).toBe(false);
  });
});

describe('offer normalization', () => {
  const published = {
    offerId: 'offer-1',
    sku: 'SKU-1',
    marketplaceId: 'EBAY_US',
    status: 'PUBLISHED',
  };

  it('requires a coherent published listing identity and lifecycle', () => {
    const active = parseOffer({
      ...published,
      listing: { listingId: 'listing-1', listingStatus: 'ACTIVE' },
    });
    expect(active?.live).toBe(true);
    expect(isOfferLive(active!)).toBe(true);
    expect(parseOffer({ ...published, listing: { listingStatus: 'ACTIVE' } })).toBeNull();
    expect(
      parseOffer({ ...published, listing: { listingId: 'listing-1', listingStatus: 'ENDED' } })
    ).toBeNull();
    expect(
      parseOffer({
        ...published,
        listing: { listingId: '', listingStatus: 'ACTIVE' },
      })
    ).toBeNull();
    expect(
      parseOffer({
        ...published,
        listingId: 123,
        listing: { listingId: 'listing-1', listingStatus: 'ACTIVE' },
      })
    ).toBeNull();
  });

  it('rejects contradictory unpublished identity', () => {
    expect(
      parseOffer({
        ...published,
        status: 'UNPUBLISHED',
        listing: { listingId: 'listing-1', listingStatus: 'ACTIVE' },
      })
    ).toBeNull();
    expect(
      parseOffer({
        ...published,
        status: 'UNPUBLISHED',
        listing: {},
      })?.live
    ).toBe(false);
    expect(parseOffer({ ...published, status: 'UNPUBLISHED', listing: 'invalid' })).toBeNull();
  });

  it('requires an explicit SKU for durable getOffer reads', () => {
    expect(parseOffer({ ...published, sku: undefined })).toBeNull();
    expect(parseOffer({ offers: [published, published] })).toBeNull();
  });
});

describe('durable identity', () => {
  it('rejects cross-group offer ID reuse for another SKU', () => {
    const owners = new Map<string, string>();
    expect(recordDurableOfferOwner(owners, 'offer-1', 'SKU-1')).toBe(true);
    expect(recordDurableOfferOwner(owners, 'offer-1', 'SKU-1')).toBe(true);
    expect(recordDurableOfferOwner(owners, 'offer-1', 'SKU-2')).toBe(false);
  });

  it('treats nullable identity absence as valid and malformed values fail closed', () => {
    const absent = identity();
    collectDurableIdentity(absent, {
      sku: null,
      offerId: null,
      listingId: undefined,
      offerIdsBySku: {},
    });
    expect(absent.malformed).toBe(false);

    const missingSku = identity();
    collectDurableIdentity(missingSku, { offerId: 'offer-1' });
    expect(missingSku.malformed).toBe(false);
    expect(missingSku.unscopedOfferIds).toEqual(new Set(['offer-1']));

    const malformedMap = identity();
    collectDurableIdentity(malformedMap, { offerIdsBySku: [] });
    expect(malformedMap.malformed).toBe(true);

    const nullMap = identity();
    collectDurableIdentity(nullMap, { offerIdsBySku: null });
    expect(nullMap.malformed).toBe(true);

    const publishedHistory = identity();
    collectDurableIdentity(publishedHistory, {
      publicationHistoryExists: true,
      listingId: 'listing-1',
      offerIdsBySku: { 'SKU-1': 'offer-1' },
    });
    expect(publishedHistory.malformed).toBe(false);

    const abandonedHistory = identity();
    collectDurableIdentity(abandonedHistory, {
      publicationHistoryExists: false,
      listingId: null,
      offerIdsBySku: { 'SKU-1': 'offer-1' },
    });
    expect(abandonedHistory.malformed).toBe(false);

    const missingAbandonedListing = identity();
    collectDurableIdentity(missingAbandonedListing, {
      publicationHistoryExists: false,
      offerIdsBySku: {},
    });
    expect(missingAbandonedListing.malformed).toBe(true);

    const undefinedAbandonedListing = identity();
    collectDurableIdentity(undefinedAbandonedListing, {
      publicationHistoryExists: false,
      listingId: undefined,
      offerIdsBySku: {},
    });
    expect(undefinedAbandonedListing.malformed).toBe(true);

    const invalidHistory = identity();
    collectDurableIdentity(invalidHistory, {
      publicationHistoryExists: true,
      listingId: null,
      offerIdsBySku: {},
    });
    expect(invalidHistory.malformed).toBe(true);

    const malformedId = identity();
    collectDurableIdentity(malformedId, { sku: 'SKU-1', offerId: 123 });
    expect(malformedId.malformed).toBe(true);
  });

  it('marks mismatched and conflicting per-SKU IDs as malformed', () => {
    const mismatched = durableIdentityFor(
      [
        {
          group_id: 'group-1',
          operation_plan: null,
          revision_id: 'revision-1',
          snapshot: { offerIdsBySku: { OTHER: 'offer-1' } },
        },
      ],
      new Map(),
      new Set(['SKU-1'])
    );
    expect(mismatched.malformed).toBe(true);

    const crossSkuConflict = durableIdentityFor(
      [
        {
          group_id: 'group-1',
          operation_plan: null,
          revision_id: 'revision-1',
          snapshot: {
            offerIdsBySku: { 'SKU-1': 'offer-shared', 'SKU-2': 'offer-shared' },
          },
        },
      ],
      new Map(),
      new Set(['SKU-1', 'SKU-2'])
    );
    expect(crossSkuConflict.malformed).toBe(true);

    const conflicting = durableIdentityFor(
      [
        {
          group_id: 'group-1',
          operation_plan: null,
          revision_id: 'revision-1',
          snapshot: {
            publicationHistoryExists: true,
            listingId: 'listing-1',
            offerIdsBySku: { 'SKU-1': 'offer-1' },
          },
        },
        {
          group_id: 'group-1',
          operation_plan: null,
          revision_id: 'revision-2',
          snapshot: {
            publicationHistoryExists: true,
            listingId: 'listing-2',
            offerIdsBySku: { 'SKU-1': 'offer-2' },
          },
        },
      ],
      new Map(),
      new Set(['SKU-1'])
    );
    expect(conflicting.malformed).toBe(false);

    const crossGenerationConflict = durableIdentityFor(
      [
        {
          group_id: 'group-1',
          operation_plan: null,
          revision_id: 'revision-1',
          snapshot: {
            publicationHistoryExists: true,
            listingId: 'listing-1',
            offerIdsBySku: { 'SKU-1': 'offer-shared' },
          },
        },
        {
          group_id: 'group-1',
          operation_plan: null,
          revision_id: 'revision-2',
          snapshot: {
            publicationHistoryExists: true,
            listingId: 'listing-2',
            offerIdsBySku: { 'SKU-2': 'offer-shared' },
          },
        },
      ],
      new Map(),
      new Set(['SKU-1', 'SKU-2'])
    );
    expect(crossGenerationConflict.malformed).toBe(true);

    const incompletePublished = durableIdentityFor(
      [
        {
          group_id: 'group-1',
          operation_plan: null,
          revision_id: 'revision-1',
          snapshot: {
            publicationHistoryExists: true,
            listingId: 'listing-1',
            offerIdsBySku: { 'SKU-1': 'offer-1' },
          },
        },
      ],
      new Map(),
      new Set(['SKU-1', 'SKU-2'])
    );
    expect(incompletePublished.malformed).toBe(true);
  });

  it('resolves unscoped cleanup evidence against authoritative durable ownership', () => {
    const resolved = durableIdentityFor(
      [
        {
          group_id: 'group-1',
          operation_plan: null,
          revision_id: 'revision-1',
          snapshot: {
            ownedRemote: {
              listingId: null,
              offerIdsBySku: { 'SKU-1': 'offer-1' },
              publicationHistoryExists: false,
            },
          },
        },
      ],
      new Map([
        [
          'revision-1',
          [
            {
              evidence: { state: 'proven_absent', offerId: 'offer-1' },
              revision_id: 'revision-1',
            },
          ],
        ],
      ]),
      new Set(['SKU-1'])
    );
    expect(resolved.malformed).toBe(false);

    const orphan = durableIdentityFor(
      [
        {
          group_id: 'group-1',
          operation_plan: null,
          revision_id: 'revision-1',
          snapshot: { ownedRemote: { listingId: null, offerIdsBySku: {} } },
        },
      ],
      new Map([
        [
          'revision-1',
          [
            {
              evidence: { state: 'proven_absent', offerId: 'offer-orphan' },
              revision_id: 'revision-1',
            },
          ],
        ],
      ]),
      new Set(['SKU-1'])
    );
    expect(orphan.malformed).toBe(true);
  });

  it('validates the confirmed remote identity path and full SKU coverage', () => {
    const valid = durableIdentityFor(
      [
        {
          group_id: 'group-1',
          operation_plan: null,
          revision_id: 'revision-1',
          snapshot: {
            confirmed: {
              remote: {
                listingId: 'listing-1',
                offerIdsBySku: { 'SKU-1': 'offer-1', 'SKU-2': 'offer-2' },
              },
            },
          },
        },
      ],
      new Map(),
      new Set(['SKU-1', 'SKU-2'])
    );
    expect(valid.malformed).toBe(false);
    expect(valid.hasPublishedHistory).toBe(true);

    const missingSku = durableIdentityFor(
      [
        {
          group_id: 'group-1',
          operation_plan: null,
          revision_id: 'revision-1',
          snapshot: {
            confirmed: {
              remote: { listingId: 'listing-1', offerIdsBySku: { 'SKU-1': 'offer-1' } },
            },
          },
        },
      ],
      new Map(),
      new Set(['SKU-1', 'SKU-2'])
    );
    expect(missingSku.malformed).toBe(true);

    const malformedRemote = durableIdentityFor(
      [
        {
          group_id: 'group-1',
          operation_plan: null,
          revision_id: 'revision-1',
          snapshot: { confirmed: { remote: 'invalid' } },
        },
      ],
      new Map(),
      new Set(['SKU-1'])
    );
    expect(malformedRemote.malformed).toBe(true);

    const missingConfirmedValue = durableIdentityFor(
      [
        {
          group_id: 'group-1',
          operation_plan: null,
          revision_id: 'revision-1',
          snapshot: { confirmed: null },
        },
      ],
      new Map(),
      new Set(['SKU-1'])
    );
    expect(missingConfirmedValue.malformed).toBe(true);
  });
});

describe('live listing count', () => {
  it('counts unique listing IDs only', () => {
    const first = parseOffer({
      offerId: 'offer-1',
      sku: 'SKU-1',
      marketplaceId: 'EBAY_US',
      status: 'PUBLISHED',
      listing: { listingId: 'listing-1', listingStatus: 'ACTIVE' },
    });
    const second = parseOffer({
      offerId: 'offer-2',
      sku: 'SKU-2',
      marketplaceId: 'EBAY_US',
      status: 'PUBLISHED',
      listing: { listingId: 'listing-1', listingStatus: 'OUT_OF_STOCK' },
    });
    const unpublished = parseOffer({
      offerId: 'offer-3',
      sku: 'SKU-3',
      marketplaceId: 'EBAY_US',
      status: 'UNPUBLISHED',
    });
    expect(countUniqueLiveListingIds([first!, second!, unpublished!])).toBe(1);
  });
});

describe('offer pagination metadata', () => {
  const offer = {
    offerId: 'offer-1',
    sku: 'SKU-1',
    marketplaceId: 'EBAY_US',
    status: 'UNPUBLISHED',
  };

  it('rejects pagination links and inconsistent or malformed counts', () => {
    expect(normalizeOffers({ offers: [offer], next: '/offer?offset=1' }, 'SKU-1')).toBeNull();
    expect(normalizeOffers({ offers: [offer], prev: '/offer?offset=1' }, 'SKU-1')).toBeNull();
    expect(normalizeOffers({ offers: [offer], next: '' }, 'SKU-1')).toBeNull();
    expect(normalizeOffers({ offers: [offer], prev: '' }, 'SKU-1')).toBeNull();
    expect(normalizeOffers({ offers: [offer], total: 2 }, 'SKU-1')).toBeNull();
    expect(normalizeOffers({ offers: [offer], size: 2 }, 'SKU-1')).toBeNull();
    expect(normalizeOffers({ offers: [offer], total: '1' }, 'SKU-1')).toBeNull();
    expect(normalizeOffers({ offers: [offer], total: 1, size: 1 }, 'SKU-1')).toHaveLength(1);
  });
});

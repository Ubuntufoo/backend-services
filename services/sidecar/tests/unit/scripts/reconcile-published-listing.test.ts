import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reconcilePublishedListingMock = vi.fn();
const loadRootEnvironmentMock = vi.fn();

vi.mock('@/config/env-paths.js', () => ({
  loadRootEnvironment: loadRootEnvironmentMock,
}));

vi.mock('@/ebay/reconcile-published-listing.js', () => ({
  reconcilePublishedListing: reconcilePublishedListingMock,
}));

describe('reconcile published listing script', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reconcilePublishedListingMock.mockResolvedValue({
      ebayListingId: null,
      exportedAt: null,
      listing: {
        listing_id: 'LIST-001',
      },
      offer: {
        offerId: '11109473010',
        status: 'PUBLISHED',
      },
      offerId: '11109473010',
      reason: 'Offer did not expose listingId.',
      reconciled: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses identifier args and prints reconcile result', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runReconcilePublishedListingCli } = await import(
      '@/scripts/reconcile-published-listing.js'
    );
    await runReconcilePublishedListingCli(['--', '--offer-id', '11109473010']);

    expect(reconcilePublishedListingMock).toHaveBeenCalledWith({
      listingId: undefined,
      offerId: '11109473010',
    });
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          ebayListingId: null,
          exportedAt: null,
          listingId: 'LIST-001',
          offer: {
            offerId: '11109473010',
            status: 'PUBLISHED',
          },
          offerId: '11109473010',
          reason: 'Offer did not expose listingId.',
          reconciled: false,
        },
        null,
        2
      )
    );
  });

  it('fails on unknown args', async () => {
    const { runReconcilePublishedListingCli } = await import(
      '@/scripts/reconcile-published-listing.js'
    );

    await expect(runReconcilePublishedListingCli(['--unknown'])).rejects.toThrow(
      'Unknown argument: --unknown'
    );
  });

  it('fails on missing identifier values', async () => {
    const { runReconcilePublishedListingCli } = await import(
      '@/scripts/reconcile-published-listing.js'
    );

    await expect(runReconcilePublishedListingCli(['--listing-id'])).rejects.toThrow(
      '--listing-id requires a non-empty value.'
    );
    await expect(runReconcilePublishedListingCli(['--offer-id'])).rejects.toThrow(
      '--offer-id requires a non-empty value.'
    );
  });

  it('fails non-zero through cli when duplicate local rows are detected', async () => {
    reconcilePublishedListingMock.mockRejectedValueOnce(
      new Error('Multiple local listings found for ebay_offer_id "11109473010".')
    );

    const { runReconcilePublishedListingCli } = await import(
      '@/scripts/reconcile-published-listing.js'
    );

    await expect(
      runReconcilePublishedListingCli(['--', '--offer-id', '11109473010'])
    ).rejects.toThrow('Multiple local listings found for ebay_offer_id "11109473010".');
  });
});

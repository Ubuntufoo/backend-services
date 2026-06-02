import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadRootEnvironmentMock = vi.fn();
const runSandboxCleanupMock = vi.fn();

vi.mock('@/config/env-paths.js', () => ({
  loadRootEnvironment: loadRootEnvironmentMock,
}));

vi.mock('@/ebay/sandbox-cleanup.js', () => ({
  runSandboxCleanup: runSandboxCleanupMock,
}));

describe('cleanup ebay sandbox script', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runSandboxCleanupMock.mockResolvedValue({
      candidateCount: 1,
      candidateSkus: ['Single-000001'],
      foundSkus: ['Single-000001'],
      from: 1,
      mode: 'dry-run',
      missingSkus: [],
      outcomes: [],
      offersBySku: {
        'Single-000001': [
          {
            offerId: 'OFFER-1',
            sku: 'Single-000001',
            status: 'PUBLISHED',
          },
        ],
      },
      prefixes: ['Single-'],
      skus: ['Single-000001'],
      sourceMode: 'sku',
      success: true,
      to: 1,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses explicit sku mode and prints preview output', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { runCleanupEbaySandboxCli } = await import('@/scripts/cleanup-ebay-sandbox.js');

    await runCleanupEbaySandboxCli(['--sku', 'Single-000001']);

    expect(runSandboxCleanupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        skus: ['Single-000001'],
      })
    );
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          candidateCount: 1,
          candidateSkus: ['Single-000001'],
          foundSkus: ['Single-000001'],
          from: 1,
          missingSkus: [],
          offersBySku: {
            'Single-000001': [
              {
                offerId: 'OFFER-1',
                sku: 'Single-000001',
                status: 'PUBLISHED',
              },
            ],
          },
          prefixes: ['Single-'],
          skus: ['Single-000001'],
          sourceMode: 'sku',
          to: 1,
        },
        null,
        2
      )
    );
  });

  it('parses generated range mode and prints delete summary after confirmation', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    runSandboxCleanupMock.mockResolvedValueOnce({
      candidateCount: 2,
      candidateSkus: ['Single-000001', 'Single-000002'],
      foundSkus: ['Single-000001', 'Single-000002'],
      from: 1,
      mode: 'delete',
      missingSkus: [],
      outcomes: [
        {
          deletedInventoryItem: true,
          deletedOffers: ['OFFER-1'],
          errors: [],
          sku: 'Single-000001',
          skippedMissing: [],
          status: 'deleted',
        },
        {
          deletedInventoryItem: true,
          deletedOffers: [],
          errors: [],
          sku: 'Single-000002',
          skippedMissing: [],
          status: 'deleted',
        },
      ],
      offersBySku: {
        'Single-000001': [
          {
            offerId: 'OFFER-1',
            sku: 'Single-000001',
            status: 'PUBLISHED',
          },
        ],
        'Single-000002': [],
      },
      prefixes: ['Single-'],
      skus: [],
      sourceMode: 'range',
      success: true,
      to: 2,
    });
    const { runCleanupEbaySandboxCli } = await import('@/scripts/cleanup-ebay-sandbox.js');

    await runCleanupEbaySandboxCli([
      '--prefix',
      'Single-',
      '--from',
      '1',
      '--to',
      '2',
      '--delete',
      '--confirm-sandbox-cleanup',
    ]);

    expect(runSandboxCleanupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowLargeRange: false,
        confirmSandboxCleanup: true,
        delete: true,
        from: 1,
        prefixes: ['Single-'],
        skus: [],
        to: 2,
      })
    );
    expect(logSpy).toHaveBeenNthCalledWith(
      1,
      JSON.stringify(
        {
          candidateCount: 2,
          candidateSkus: ['Single-000001', 'Single-000002'],
          foundSkus: ['Single-000001', 'Single-000002'],
          from: 1,
          missingSkus: [],
          offersBySku: {
            'Single-000001': [
              {
                offerId: 'OFFER-1',
                sku: 'Single-000001',
                status: 'PUBLISHED',
              },
            ],
            'Single-000002': [],
          },
          prefixes: ['Single-'],
          skus: [],
          sourceMode: 'range',
          to: 2,
        },
        null,
        2
      )
    );
    expect(logSpy).toHaveBeenNthCalledWith(
      2,
      JSON.stringify(
        {
          candidateCount: 2,
          mode: 'delete',
          outcomes: [
            {
              deletedInventoryItem: true,
              deletedOffers: ['OFFER-1'],
              errors: [],
              sku: 'Single-000001',
              skippedMissing: [],
              status: 'deleted',
            },
            {
              deletedInventoryItem: true,
              deletedOffers: [],
              errors: [],
              sku: 'Single-000002',
              skippedMissing: [],
              status: 'deleted',
            },
          ],
          success: true,
        },
        null,
        2
      )
    );
  });

  it('rejects unknown args', async () => {
    const { runCleanupEbaySandboxCli } = await import('@/scripts/cleanup-ebay-sandbox.js');

    await expect(runCleanupEbaySandboxCli(['--bad'])).rejects.toThrow('Unknown argument: --bad');
  });

  it('rejects missing values', async () => {
    const { runCleanupEbaySandboxCli } = await import('@/scripts/cleanup-ebay-sandbox.js');

    await expect(runCleanupEbaySandboxCli(['--sku'])).rejects.toThrow('--sku requires a non-empty value.');
    await expect(runCleanupEbaySandboxCli(['--prefix'])).rejects.toThrow(
      '--prefix requires a non-empty value.'
    );
    await expect(runCleanupEbaySandboxCli(['--from'])).rejects.toThrow('--from requires a non-empty value.');
    await expect(runCleanupEbaySandboxCli(['--to'])).rejects.toThrow('--to requires a non-empty value.');
  });

  it('requires confirmation before destructive cleanup', async () => {
    const { runCleanupEbaySandboxCli } = await import('@/scripts/cleanup-ebay-sandbox.js');

    await expect(runCleanupEbaySandboxCli(['--delete'])).rejects.toThrow(
      'Destructive sandbox cleanup requires --confirm-sandbox-cleanup.'
    );
  });
});

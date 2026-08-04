import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  YOU_PICK_EXECUTION_ERROR,
  type PilotReport,
  type YouPickPilotReadApi,
} from '@/ebay/you-pick-sandbox-pilot.js';
import {
  parseYouPickPilotArgs,
  normalizeYouPickMetadata,
  normalizeYouPickPolicies,
  runYouPickSandboxPilotCli,
} from '@/scripts/you-pick-sandbox-pilot.js';

const tempRoots: string[] = [];
const fixturePath = fileURLToPath(
  new URL('../../fixtures/you-pick-sandbox/two-card.json', import.meta.url)
);

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const report: PilotReport = {
  mode: 'dry-run',
  run: {
    runId: '20260803T151700Z-a1b2c3',
    prefix: 'YPSBX-20260803T151700Z-a1b2c3',
    groupKey: 'YPSBX-20260803T151700Z-a1b2c3-G',
    childSkus: ['YPSBX-20260803T151700Z-a1b2c3-C01', 'YPSBX-20260803T151700Z-a1b2c3-C02'],
  },
  manifestPath: '/repo/.local/you-pick-sandbox/20260803T151700Z-a1b2c3/manifest.json',
  seller: { userId: 'sandbox-seller-123' },
  sellerConfirmation: 'not-supplied',
  contentLanguage: 'en-US',
  gates: [{ name: 'environment', status: 'pass', detail: 'sandbox' }],
  selected: {
    policies: {
      fulfillmentPolicyId: 'FULFILLMENT-PILOT',
      paymentPolicyId: 'PAYMENT-PILOT',
      returnPolicyId: 'RETURN-PILOT',
    },
    merchantLocationKey: 'you-pick-pilot-location',
  },
  metadata: {
    categoryId: '261328',
    variationsSupported: true,
    selectorCandidates: ['Card'],
    conditions: [
      {
        conditionId: '4000',
        conditionDescription: 'Very Good',
        inventoryCondition: 'USED_VERY_GOOD',
        conditionDescriptors: [
          {
            id: '40001',
            name: 'Card Condition',
            values: [{ id: '400012', name: 'Very Good' }],
          },
        ],
      },
    ],
  },
  metadataSummary: {
    selectorStatus: 'taxonomy-listed',
    selectorName: 'Card',
    selectorCandidatesDigest: 'b'.repeat(64),
    conditionId: '4000',
    condition: 'USED_VERY_GOOD',
    conditionDescriptorsDigest: 'c'.repeat(64),
  },
  cleanupRemoteSummary: null,
  collisions: [],
  arrangementId: 'arrangement-v1-1234567890abcdef',
  operationPlan: [
    {
      id: 'item-C01',
      kind: 'create-or-replace-child-item',
      digest: 'a'.repeat(64),
    },
  ],
  requestDigests: ['a'.repeat(64)],
  nextAuthorizedCommand:
    'pnpm --filter sidecar ebay:pilot-you-pick-sandbox -- --manifest /repo/manifest.json --execute --confirm-sandbox-seller sandbox-seller-123',
};

describe('You Pick sandbox pilot CLI', () => {
  it('parses only the dedicated explicit dry-run arguments', () => {
    expect(
      parseYouPickPilotArgs(['--fixture', 'fixture.json', '--confirm-sandbox-seller', 'seller-1'])
    ).toEqual({
      fixturePath: 'fixture.json',
      cleanup: false,
      execute: false,
      confirmSandboxSeller: 'seller-1',
    });
    expect(parseYouPickPilotArgs(['--manifest', 'manifest.json', '--cleanup'])).toEqual({
      manifestPath: 'manifest.json',
      cleanup: true,
      execute: false,
    });
    expect(() => parseYouPickPilotArgs(['--fixture', 'a', '--manifest', 'b'])).toThrow(
      /exactly one/
    );
    expect(() => parseYouPickPilotArgs(['--fixture', 'a', '--force'])).toThrow(
      'Unknown argument: --force'
    );
    expect(() => parseYouPickPilotArgs(['--fixture', 'a', '--cleanup'])).toThrow(
      /requires --manifest/
    );
    expect(() => parseYouPickPilotArgs(['--manifest', 'a', '--manifest', 'b'])).toThrow(
      /only once/
    );
    expect(() => parseYouPickPilotArgs(['--manifest', 'a', '--execute'])).toThrow(
      YOU_PICK_EXECUTION_ERROR
    );
    expect(
      parseYouPickPilotArgs([
        '--manifest',
        'manifest.json',
        '--execute',
        '--confirm-sandbox-seller',
        'seller-1',
        '--attestation',
        'attestation.json',
      ])
    ).toEqual({
      manifestPath: 'manifest.json',
      cleanup: false,
      execute: true,
      confirmSandboxSeller: 'seller-1',
      attestationPath: 'attestation.json',
    });
  });

  it.each([
    ['--execute'],
    ['--fixture', 'fixture.json', '--execute'],
    ['--manifest', 'manifest.json', '--cleanup', '--execute'],
  ])('rejects every execute shape before resolving dependencies: %s', async (...argv) => {
    const apiFactory = vi.fn<() => Promise<YouPickPilotReadApi>>();

    await expect(runYouPickSandboxPilotCli(argv, { apiFactory })).rejects.toThrow(
      YOU_PICK_EXECUTION_ERROR
    );
    expect(apiFactory).not.toHaveBeenCalled();
  });

  it('prints sanitized structured JSON for dry-run output', async () => {
    const api = {} as YouPickPilotReadApi;
    const apiFactory = vi.fn(async () => api);
    const runner = vi.fn(async () => report);
    const print = vi.fn();

    await expect(
      runYouPickSandboxPilotCli(['--fixture', 'fixture.json'], {
        apiFactory,
        runner,
        print,
        repoRoot: '/repo',
      })
    ).resolves.toEqual(report);
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        apiFactory,
        fixturePath: 'fixture.json',
        execute: false,
        repoRoot: '/repo',
      })
    );
    expect(apiFactory).not.toHaveBeenCalled();
    const output = print.mock.calls[0]?.[0] as string;
    expect(JSON.parse(output)).toEqual(report);
    expect(output).not.toContain('Authorization');
    expect(output).not.toContain('imageUrls');
  });

  it('runs the CLI dry-run through raw-response normalization without loading credentials', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'you-pick-cli-'));
    tempRoots.push(repoRoot);
    const apiFactory = vi.fn(
      async (): Promise<YouPickPilotReadApi> => ({
        getRuntimeSnapshot: async () => ({
          environment: 'sandbox',
          restOrigin: 'https://api.sandbox.ebay.com',
          oauthOrigin: 'https://api.sandbox.ebay.com',
          tradingOrigin: 'https://api.sandbox.ebay.com',
          marketplaceId: 'EBAY_US',
          contentLanguage: 'en-US',
          hasUserRefreshToken: true,
          productionCredentialMaterialPresent: false,
          background: {
            jobRunner: false,
            apify: false,
            soldComps: false,
            publishing: false,
            watcher: false,
          },
          forbiddenDependencies: {
            supabase: false,
            r2: false,
            jobs: false,
            watcher: false,
            ai: false,
            pricing: false,
          },
        }),
        getCurrentUserIdentity: async () => ({ userId: 'sandbox-seller-123' }),
        getPolicyLocationSnapshot: async () =>
          normalizeYouPickPolicies(
            {
              fulfillmentPolicies: [
                { fulfillmentPolicyId: 'FULFILLMENT-PILOT', marketplaceId: 'EBAY_US' },
              ],
            },
            { paymentPolicies: [{ paymentPolicyId: 'PAYMENT-PILOT', marketplaceId: 'EBAY_US' }] },
            { returnPolicies: [{ returnPolicyId: 'RETURN-PILOT', marketplaceId: 'EBAY_US' }] },
            {
              locations: [
                {
                  merchantLocationKey: 'you-pick-pilot-location',
                  merchantLocationStatus: 'ENABLED',
                },
              ],
            },
            'sandbox-seller-123'
          ),
        getMetadataSnapshot: async () =>
          normalizeYouPickMetadata(
            '261328',
            { listingStructurePolicies: [{ categoryId: '261328', variationsSupported: true }] },
            {
              itemConditionPolicies: [
                {
                  categoryId: '261328',
                  itemConditions: [
                    {
                      conditionId: '4000',
                      conditionDescription: 'Very Good',
                      conditionDescriptors: [
                        {
                          conditionDescriptorId: '40001',
                          conditionDescriptorName: 'Card Condition',
                          conditionDescriptorValues: [
                            {
                              conditionDescriptorValueId: '400012',
                              conditionDescriptorValueName: 'Very Good',
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            { aspects: [] }
          ),
        getInventoryItemGroup: async () => ({ status: 'missing' }),
        getInventoryItem: async () => ({ status: 'missing' }),
        getOffers: async () => ({ status: 'found', value: { offers: [] } }),
      })
    );
    const print = vi.fn();

    const result = await runYouPickSandboxPilotCli(['--fixture', fixturePath], {
      apiFactory,
      print,
      repoRoot,
    });

    expect(apiFactory).toHaveBeenCalledOnce();
    expect(result.metadataSummary.selectorStatus).toBe('custom-unlisted');
    expect(JSON.parse(print.mock.calls[0]?.[0] as string)).toEqual(result);
  });
});

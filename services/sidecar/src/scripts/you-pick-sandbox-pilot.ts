#!/usr/bin/env node

import { relative, resolve, sep } from 'path';
import { readFile, realpath } from 'fs/promises';
import { fileURLToPath } from 'url';
import { mapListingConditionIdToInventoryCondition } from '@/ebay/publish-mappers.js';
import {
  YOU_PICK_EXECUTION_ERROR,
  YOU_PICK_LISTING_STATUSES,
  YOU_PICK_SANDBOX_ORIGIN,
  classifyYouPickListingStatus,
  digest,
  runYouPickSandboxPilot,
  sanitizeError,
  sanitizeReport,
  type ExactRead,
  type MetadataSnapshot,
  type PilotReport,
  type PolicyLocationSnapshot,
  type RemoteInventoryItem,
  type RemoteInventoryItemGroup,
  type RemoteOffer,
  type RuntimeSnapshot,
  type YouPickListingStatus,
  type YouPickPilotReadApi,
} from '@/ebay/you-pick-sandbox-pilot.js';
import type {
  MutationExecutionReport,
  YouPickPilotMutationApi,
} from '@/ebay/you-pick-sandbox-pilot-mutation.js';
import type { InventoryApi } from '@/api/listing-management/inventory.js';

export interface YouPickPilotCliArgs {
  fixturePath?: string;
  manifestPath?: string;
  cleanup: boolean;
  execute: boolean;
  confirmSandboxSeller?: string;
  attestationPath?: string;
}

interface CliOptions {
  repoRoot?: string;
  apiFactory?: () => Promise<YouPickPilotReadApi>;
  mutationApiFactory?: () => Promise<YouPickPilotMutationApi>;
  runner?: typeof runYouPickSandboxPilot;
  print?: (output: string) => void;
}

function resolveRepositoryFile(path: string, repoRoot: string, label: string): string {
  const root = resolve(repoRoot);
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`${label} path must be contained in the repository root.`);
  }
  return absolute;
}

async function readRepositoryJson(path: string, repoRoot: string, label: string): Promise<unknown> {
  const [rootReal, fileReal] = await Promise.all([realpath(repoRoot), realpath(path)]);
  const rel = relative(rootReal, fileReal);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`${label} path must resolve within the repository root.`);
  }
  return JSON.parse(await readFile(fileReal, 'utf8')) as unknown;
}

function requireValue(value: string | undefined, flag: string): string {
  if (!value || value === '--' || value.startsWith('--') || value.trim().length === 0) {
    throw new Error(`${flag} requires a non-empty value.`);
  }
  return value.trim();
}

export function parseYouPickPilotArgs(argv: string[]): YouPickPilotCliArgs {
  const parsed: YouPickPilotCliArgs = { cleanup: false, execute: false };
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (seen.has(argument)) throw new Error(`${argument} may be supplied only once.`);
    seen.add(argument);
    if (argument === '--fixture') {
      if (parsed.fixturePath) throw new Error('--fixture may be supplied only once.');
      parsed.fixturePath = requireValue(argv[index + 1], '--fixture');
      index += 1;
      continue;
    }
    if (argument === '--manifest') {
      if (parsed.manifestPath) throw new Error('--manifest may be supplied only once.');
      parsed.manifestPath = requireValue(argv[index + 1], '--manifest');
      index += 1;
      continue;
    }
    if (argument === '--confirm-sandbox-seller') {
      if (parsed.confirmSandboxSeller)
        throw new Error('--confirm-sandbox-seller may be supplied only once.');
      parsed.confirmSandboxSeller = requireValue(argv[index + 1], '--confirm-sandbox-seller');
      index += 1;
      continue;
    }
    if (argument === '--attestation') {
      parsed.attestationPath = requireValue(argv[index + 1], '--attestation');
      index += 1;
      continue;
    }
    if (argument === '--cleanup') {
      parsed.cleanup = true;
      continue;
    }
    if (argument === '--execute') {
      parsed.execute = true;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (parsed.execute && (!parsed.manifestPath || !parsed.confirmSandboxSeller))
    throw new Error(YOU_PICK_EXECUTION_ERROR);
  if (parsed.execute && parsed.fixturePath) throw new Error(YOU_PICK_EXECUTION_ERROR);
  if (Boolean(parsed.fixturePath) === Boolean(parsed.manifestPath))
    throw new Error('Supply exactly one of --fixture or --manifest.');
  if (parsed.cleanup && !parsed.manifestPath) throw new Error('--cleanup requires --manifest.');
  if (parsed.attestationPath && !parsed.execute)
    throw new Error('--attestation requires --execute.');
  return parsed;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function stringField(record: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    const value = record[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function booleanField(record: Record<string, unknown>, name: string): boolean {
  return record[name] === true || record[name] === 'true';
}

function arrayField(value: unknown, name: string): Record<string, unknown>[] {
  return records(asRecord(value)?.[name]);
}

function errorStatus(error: unknown): number | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    const record = asRecord(current);
    const status = record?.statusCode ?? asRecord(record?.response)?.status;
    if (typeof status === 'number') return status;
    current = record?.cause;
  }
  return undefined;
}

export async function classifyYouPickExactRead<T>(
  operation: () => Promise<T>
): Promise<ExactRead<T>> {
  try {
    return { status: 'found', value: await operation() };
  } catch (error) {
    if (errorStatus(error) === 404) return { status: 'missing' };
    return { status: 'unknown', reason: sanitizeError(error) };
  }
}

export function normalizeYouPickPolicies(
  fulfillmentRaw: unknown,
  paymentRaw: unknown,
  returnRaw: unknown,
  locationsRaw: unknown,
  ownerUserId: string
): PolicyLocationSnapshot {
  const normalize = (raw: unknown, key: string, idName: string) =>
    arrayField(raw, key)
      .map((item) => ({
        id: stringField(item, idName),
        marketplaceId: stringField(item, 'marketplaceId'),
        ownerUserId,
      }))
      .filter((item) => item.id && item.marketplaceId);
  const locations = arrayField(locationsRaw, 'locations')
    .map((item) => ({
      merchantLocationKey: stringField(item, 'merchantLocationKey'),
      ownerUserId,
      enabled:
        ['ENABLED', 'ACTIVE'].includes(
          stringField(item, 'merchantLocationStatus', 'status').toUpperCase()
        ) || booleanField(item, 'enabled'),
    }))
    .filter((item) => item.merchantLocationKey);
  return {
    fulfillment: normalize(fulfillmentRaw, 'fulfillmentPolicies', 'fulfillmentPolicyId'),
    payment: normalize(paymentRaw, 'paymentPolicies', 'paymentPolicyId'),
    returns: normalize(returnRaw, 'returnPolicies', 'returnPolicyId'),
    locations,
  };
}

function uniqueRecords(
  recordsInput: Record<string, unknown>[],
  label: string,
  key: (record: Record<string, unknown>) => string
): Record<string, unknown>[] {
  const keys = recordsInput.map(key);
  if (keys.some((value) => !value) || new Set(keys).size !== keys.length)
    throw new Error(`${label} response contains missing or duplicate identifiers.`);
  return recordsInput;
}

function requiredArray(value: unknown, name: string): Record<string, unknown>[] {
  const record = asRecord(value);
  if (!record || !Array.isArray(record[name])) throw new Error(`${name} must be an array.`);
  const parsed = records(record[name]);
  if (parsed.length !== record[name].length) throw new Error(`${name} contains a malformed row.`);
  return parsed;
}

export function normalizeYouPickMetadata(
  categoryId: string,
  listingStructureRaw: unknown,
  conditionRaw: unknown,
  taxonomyRaw: unknown
): MetadataSnapshot {
  const listingPolicies = requiredArray(listingStructureRaw, 'listingStructurePolicies');
  const categoryPolicies = listingPolicies.filter(
    (item) => stringField(item, 'categoryId') === categoryId
  );
  if (categoryPolicies.length !== 1 || typeof categoryPolicies[0].variationsSupported !== 'boolean')
    throw new Error('Listing structure metadata is missing or ambiguous for the category.');
  const categoryPolicy = categoryPolicies[0];
  const aspects = requiredArray(taxonomyRaw, 'aspects');
  const selectorCandidates = aspects
    .filter((aspect) => {
      const constraint = asRecord(aspect.aspectConstraint);
      return constraint?.aspectEnabledForVariations === true;
    })
    .map((aspect) => stringField(aspect, 'localizedAspectName'))
    .filter(Boolean);
  if (new Set(selectorCandidates).size !== selectorCandidates.length)
    throw new Error('Taxonomy metadata contains duplicate variation aspect names.');
  const policies = requiredArray(conditionRaw, 'itemConditionPolicies');
  const matchingPolicies = policies.filter(
    (item) => stringField(item, 'categoryId') === categoryId
  );
  if (matchingPolicies.length !== 1)
    throw new Error('Condition metadata is missing or ambiguous for the category.');
  const conditionRows = uniqueRecords(
    requiredArray(matchingPolicies[0], 'itemConditions'),
    'Condition metadata',
    (condition) => stringField(condition, 'conditionId')
  );
  const conditions = conditionRows
    .map((condition) => {
      const conditionId = stringField(condition, 'conditionId');
      let inventoryCondition: string | null = null;
      try {
        inventoryCondition = mapListingConditionIdToInventoryCondition(conditionId);
      } catch {
        /* Only mappings established by the existing publish contract are authoritative. */
      }
      const rawDescriptors = condition.conditionDescriptors;
      if (rawDescriptors !== undefined && !Array.isArray(rawDescriptors))
        throw new Error('conditionDescriptors must be an array when present.');
      const descriptorRows = rawDescriptors === undefined ? [] : records(rawDescriptors);
      if (rawDescriptors !== undefined && descriptorRows.length !== rawDescriptors.length)
        throw new Error('conditionDescriptors contains a malformed row.');
      return {
        conditionId,
        conditionDescription: stringField(condition, 'conditionDescription'),
        inventoryCondition,
        conditionDescriptors: uniqueRecords(
          descriptorRows,
          'Condition descriptor metadata',
          (descriptor) => {
            const id = stringField(descriptor, 'conditionDescriptorId');
            return /^\d+$/.test(id) ? id : '';
          }
        ).map((descriptor) => {
          const rawValues = descriptor.conditionDescriptorValues;
          if (rawValues !== undefined && !Array.isArray(rawValues))
            throw new Error('conditionDescriptorValues must be an array when present.');
          const valueRows = rawValues === undefined ? [] : records(rawValues);
          if (rawValues !== undefined && valueRows.length !== rawValues.length)
            throw new Error('conditionDescriptorValues contains a malformed row.');
          return {
            id: stringField(descriptor, 'conditionDescriptorId'),
            name: stringField(descriptor, 'conditionDescriptorName'),
            values: uniqueRecords(valueRows, 'Condition descriptor value metadata', (value) => {
              const id = stringField(value, 'conditionDescriptorValueId');
              return /^\d+$/.test(id) ? id : '';
            }).map((value) => ({
              id: stringField(value, 'conditionDescriptorValueId'),
              name: stringField(value, 'conditionDescriptorValueName'),
            })),
          };
        }),
      };
    })
    .filter((condition) => condition.conditionId && /^\d+$/.test(condition.conditionId));
  return {
    categoryId,
    variationsSupported: categoryPolicy.variationsSupported as boolean,
    selectorCandidates,
    conditions,
  };
}

export function normalizeYouPickGroup(
  raw: unknown,
  inventoryItemGroupKey?: string
): RemoteInventoryItemGroup {
  const record = asRecord(raw);
  if (!record || !Array.isArray(record.variantSKUs))
    throw new Error('Inventory item group response requires variantSKUs.');
  const variantSKUs = record.variantSKUs.map((value) =>
    typeof value === 'string' ? value.trim() : ''
  );
  if (variantSKUs.some((value) => !value) || new Set(variantSKUs).size !== variantSKUs.length)
    throw new Error('Inventory item group response has malformed or duplicate variantSKUs.');
  const planned = {
    inventoryItemGroupKey: inventoryItemGroupKey ?? stringField(record, 'inventoryItemGroupKey'),
    title: stringField(record, 'title'),
    description: stringField(record, 'description'),
    aspects: record.aspects,
    imageUrls: record.imageUrls,
    variantSKUs,
    variesBy: record.variesBy,
  };
  const snapshotDigest = Object.values(planned).every(
    (value) => value !== undefined && value !== ''
  )
    ? digest(planned)
    : undefined;
  return snapshotDigest ? { variantSKUs, snapshotDigest } : { variantSKUs };
}

export function normalizeYouPickItem(raw: unknown): RemoteInventoryItem {
  const record = asRecord(raw);
  if (!record) throw new Error('Inventory item response must be an object.');
  const sku = stringField(record, 'sku');
  if (!sku) throw new Error('Inventory item response requires sku.');
  const sources = ['groupIds', 'inventoryItemGroupKeys'].filter((key) => key in record);
  if (sources.length > 1)
    throw new Error('Inventory item response contains ambiguous group association fields.');
  const availability = asRecord(record.availability);
  const shipTo = availability ? asRecord(availability.shipToLocationAvailability) : undefined;
  const quantity = shipTo?.quantity;
  const itemPayload = {
    sku,
    availability: record.availability,
    condition: record.condition,
    conditionDescriptors: record.conditionDescriptors,
    product: record.product,
  };
  const snapshotDigest =
    itemPayload.availability && itemPayload.condition && itemPayload.product
      ? digest(itemPayload)
      : undefined;
  const base = {
    sku,
    quantity: typeof quantity === 'number' && Number.isInteger(quantity) ? quantity : undefined,
    snapshotDigest,
  };
  if (sources.length === 0) return { ...base, groupKeys: null };
  const rawKeys = record[sources[0]];
  if (!Array.isArray(rawKeys))
    throw new Error('Inventory item group association must be an array.');
  const groupKeys = rawKeys.map((value) => (typeof value === 'string' ? value.trim() : ''));
  if (groupKeys.some((value) => !value) || new Set(groupKeys).size !== groupKeys.length)
    throw new Error('Inventory item response has malformed or duplicate group associations.');
  return { ...base, groupKeys };
}

export function normalizeYouPickOffers(raw: unknown): { offers: RemoteOffer[] } {
  const offerRows = requiredArray(raw, 'offers');
  const offers = uniqueRecords(offerRows, 'Offer', (offer) => stringField(offer, 'offerId')).map(
    (offer): RemoteOffer => {
      const listing = offer.listing === undefined ? undefined : asRecord(offer.listing);
      if (offer.listing !== undefined && !listing)
        throw new Error('Offer listing must be an object.');
      const status = stringField(offer, 'status').toUpperCase();
      const rawListingStatus = listing
        ? stringField(listing, 'listingStatus').toUpperCase() || null
        : null;
      if (!['PUBLISHED', 'UNPUBLISHED'].includes(status))
        throw new Error('Offer response has an unsupported publication status.');
      if (
        rawListingStatus !== null &&
        !(YOU_PICK_LISTING_STATUSES as readonly string[]).includes(rawListingStatus)
      ) {
        throw new Error('Offer response has an unsupported listing status.');
      }
      const listingStatus = rawListingStatus as YouPickListingStatus | null;
      const lifecycle = classifyYouPickListingStatus(listingStatus);
      const normalized: RemoteOffer = {
        offerId: stringField(offer, 'offerId'),
        sku: stringField(offer, 'sku'),
        marketplaceId: stringField(offer, 'marketplaceId'),
        status: status as RemoteOffer['status'],
        listingId: listing ? stringField(listing, 'listingId') || null : null,
        listingStatus,
        lifecycleClass: lifecycle.lifecycleClass,
        publicationObserved: status === 'PUBLISHED' || lifecycle.publicationObserved,
        listingCurrentlyActive: lifecycle.listingCurrentlyActive,
        withdrawRequired: lifecycle.withdrawRequired,
        availableQuantity:
          typeof offer.availableQuantity === 'number' && Number.isInteger(offer.availableQuantity)
            ? offer.availableQuantity
            : undefined,
      };
      const offerPayload = {
        sku: normalized.sku,
        marketplaceId: normalized.marketplaceId,
        format: offer.format,
        categoryId: offer.categoryId,
        merchantLocationKey: offer.merchantLocationKey,
        availableQuantity: offer.availableQuantity,
        pricingSummary: offer.pricingSummary,
        listingPolicies: offer.listingPolicies,
      };
      if (Object.values(offerPayload).every((value) => value !== undefined && value !== ''))
        normalized.snapshotDigest = digest(offerPayload);
      if (!normalized.sku || !normalized.marketplaceId || !normalized.status)
        throw new Error('Offer response requires sku, marketplaceId, and status.');
      if (
        (normalized.status === 'PUBLISHED' &&
          (!normalized.listingId || !normalized.listingStatus)) ||
        (normalized.status === 'UNPUBLISHED' && (normalized.listingId || normalized.listingStatus))
      ) {
        throw new Error('Offer response has ambiguous publication and listing identity.');
      }
      return normalized;
    }
  );
  return { offers };
}

export async function createYouPickPilotReadApi(): Promise<YouPickPilotReadApi> {
  const [{ EbaySellerApi }, environmentModule] = await Promise.all([
    import('@/api/index.js'),
    import('@/config/environment.js'),
  ]);
  const config = environmentModule.getEbayConfig();
  const api = new EbaySellerApi(config);
  let currentUserId: string | undefined;
  let initialized = false;

  return {
    getRuntimeSnapshot(): Promise<RuntimeSnapshot> {
      const isEnabled = (name: string) => process.env[name] !== 'false';
      const productionCredentialMaterialPresent = Object.entries(process.env).some(
        ([name, value]) =>
          name.includes('PRODUCTION') && name.includes('EBAY') && Boolean(value?.trim())
      );
      return Promise.resolve({
        environment: process.env.EBAY_ENVIRONMENT?.trim() ?? '',
        restOrigin: environmentModule.getBaseUrl(config.environment),
        oauthOrigin: new URL(environmentModule.getAuthUrl(config.environment)).origin,
        tradingOrigin:
          config.environment === 'sandbox' ? YOU_PICK_SANDBOX_ORIGIN : 'https://api.ebay.com',
        marketplaceId: process.env.EBAY_MARKETPLACE_ID?.trim() ?? '',
        contentLanguage: process.env.EBAY_CONTENT_LANGUAGE?.trim(),
        hasUserRefreshToken: Boolean(config.refreshToken?.trim()),
        productionCredentialMaterialPresent,
        background: {
          jobRunner: isEnabled('SIDECAR_JOB_RUNNER_ENABLED'),
          apify: isEnabled('APIFY_ENABLED'),
          soldComps: isEnabled('SOLDCOMPS_ENABLED'),
          publishing: isEnabled('EBAY_PUBLISH_ENABLED'),
          watcher: isEnabled('WATCHER_ENABLED'),
        },
        forbiddenDependencies: {
          supabase: false,
          r2: false,
          jobs: false,
          watcher: false,
          ai: false,
          pricing: false,
        },
      });
    },
    async getCurrentUserIdentity() {
      if (!initialized) {
        await api.initialize();
        initialized = true;
      }
      const identity = await api.trading.getCurrentUserIdentity();
      currentUserId = identity.userId;
      return identity;
    },
    async getPolicyLocationSnapshot() {
      if (!currentUserId)
        throw new Error('Trading identity must be resolved before seller resources.');
      const marketplace = config.marketplaceId ?? '';
      const [fulfillment, payment, returns, locations] = await Promise.all([
        api.account.getFulfillmentPolicies(marketplace),
        api.account.getPaymentPolicies(marketplace),
        api.account.getReturnPolicies(marketplace),
        api.inventory.getInventoryLocations(),
      ]);
      return normalizeYouPickPolicies(fulfillment, payment, returns, locations, currentUserId);
    },
    async getMetadataSnapshot(categoryId) {
      const marketplace = config.marketplaceId ?? '';
      const tree = asRecord(await api.taxonomy.getDefaultCategoryTreeId(marketplace));
      const treeId = tree ? stringField(tree, 'categoryTreeId') : '';
      if (!treeId) throw new Error('Taxonomy did not return a category tree ID.');
      const filter = `categoryIds:{${categoryId}}`;
      const [listingStructure, conditions, taxonomy] = await Promise.all([
        api.metadata.getListingStructurePolicies(marketplace, filter),
        api.metadata.getItemConditionPolicies(marketplace, filter),
        api.taxonomy.getItemAspectsForCategory(treeId, categoryId),
      ]);
      return normalizeYouPickMetadata(categoryId, listingStructure, conditions, taxonomy);
    },
    async getInventoryItemGroup(groupKey) {
      const read = await classifyYouPickExactRead(() =>
        api.inventory.getInventoryItemGroup(groupKey)
      );
      return read.status === 'found'
        ? { status: 'found', value: normalizeYouPickGroup(read.value, groupKey) }
        : read;
    },
    async getInventoryItem(sku) {
      const read = await classifyYouPickExactRead(() => api.inventory.getInventoryItem(sku));
      return read.status === 'found'
        ? { status: 'found', value: normalizeYouPickItem(read.value) }
        : read;
    },
    async getOffers(sku, marketplaceId) {
      const read = await classifyYouPickExactRead(() =>
        api.inventory.getOffers(sku, marketplaceId)
      );
      if (read.status !== 'found') return read;
      return { status: 'found', value: normalizeYouPickOffers(read.value) };
    },
  };
}

export async function createYouPickPilotMutationApi(): Promise<YouPickPilotMutationApi> {
  const [{ EbaySellerApi }, environmentModule] = await Promise.all([
    import('@/api/index.js'),
    import('@/config/environment.js'),
  ]);
  const api = new EbaySellerApi(environmentModule.getEbayConfig());
  await api.initialize();
  return adaptYouPickPilotMutationApi(api.inventory);
}

type PilotInventoryAdapter = InventoryApi;

export function adaptYouPickPilotMutationApi(
  inventory: PilotInventoryAdapter
): YouPickPilotMutationApi {
  const config = (headers: { 'Content-Language': 'en-US' }) => ({ headers });
  return {
    createOrReplaceInventoryItem: (sku, payload, headers) =>
      inventory.createOrReplaceInventoryItem(sku, payload, config(headers)),
    createOffer: (payload, headers) => inventory.createOffer(payload, config(headers)),
    createOrReplaceInventoryItemGroup: (groupKey, payload, headers) =>
      inventory.createOrReplaceInventoryItemGroup(
        groupKey,
        payload as Parameters<typeof inventory.createOrReplaceInventoryItemGroup>[1],
        config(headers)
      ),
    publishInventoryItemGroup: (payload, headers) =>
      inventory.publishOfferByInventoryItemGroup(
        payload as Parameters<typeof inventory.publishOfferByInventoryItemGroup>[0],
        config(headers)
      ),
    bulkUpdatePriceQuantity: (payload, headers) =>
      inventory.bulkUpdatePriceQuantity(payload, config(headers)),
    withdrawInventoryItemGroup: (payload, headers) =>
      inventory.withdrawOfferByInventoryItemGroup(payload, config(headers)),
    deleteOffer: (offerId, headers) => inventory.deleteOffer(offerId, config(headers)),
    deleteInventoryItemGroup: (groupKey, headers) =>
      inventory.deleteInventoryItemGroup(groupKey, config(headers)),
    deleteInventoryItem: (sku, headers) => inventory.deleteInventoryItem(sku, config(headers)),
  };
}

export async function runYouPickSandboxPilotCli(
  argv: string[] = process.argv.slice(2),
  options: CliOptions = {}
): Promise<PilotReport | MutationExecutionReport> {
  const args = parseYouPickPilotArgs(argv);
  const repoRoot =
    options.repoRoot ?? resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
  const fixturePath = args.fixturePath
    ? resolveRepositoryFile(args.fixturePath, repoRoot, 'Fixture')
    : undefined;
  const manifestPath = args.manifestPath
    ? resolveRepositoryFile(args.manifestPath, repoRoot, 'Manifest')
    : undefined;
  const attestationPath = args.attestationPath
    ? resolveRepositoryFile(args.attestationPath, repoRoot, 'Attestation')
    : undefined;
  const runner = options.runner ?? runYouPickSandboxPilot;
  const attestation = attestationPath
    ? await readRepositoryJson(attestationPath, repoRoot, 'Attestation')
    : undefined;
  const report = await runner({
    apiFactory: options.apiFactory ?? createYouPickPilotReadApi,
    fixturePath,
    manifestPath,
    cleanup: args.cleanup,
    mutationApiFactory: options.mutationApiFactory ?? createYouPickPilotMutationApi,
    execute: args.execute,
    confirmSandboxSeller: args.confirmSandboxSeller,
    attestation,
    repoRoot,
  });
  (options.print ?? console.log)(JSON.stringify(sanitizeReport(report), null, 2));
  return report;
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));
if (entryPath && entryPath === modulePath) {
  runYouPickSandboxPilotCli().catch((error) => {
    console.error(JSON.stringify({ error: sanitizeError(error), status: 'failed' }));
    /* eslint-disable-next-line n/no-process-exit -- CLI entry must fail non-zero on validation/gate failure. */
    process.exit(1);
  });
}

import { createHash, randomBytes } from 'crypto';
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'path';
import { z } from 'zod';
import type {
  GuardedMutationHeaders,
  MutationExecutionReport,
  YouPickPilotMutationApi,
} from './you-pick-sandbox-pilot-mutation.js';

export const YOU_PICK_MANIFEST_VERSION = 5 as const;
export const YOU_PICK_LEGACY_MANIFEST_VERSION = 4 as const;
export const YOU_PICK_EXECUTION_ERROR =
  'Guarded execution requires --manifest, --execute, and an exact --confirm-sandbox-seller; fixture execution, legacy manifests, and incomplete checkpoints are not executable.';
export const YOU_PICK_MARKETPLACE = 'EBAY_US' as const;
export const YOU_PICK_CATEGORY = '261328' as const;
export const YOU_PICK_CONTENT_LANGUAGE = 'en-US' as const;
export const YOU_PICK_SANDBOX_ORIGIN = 'https://api.sandbox.ebay.com' as const;
export const YOU_PICK_MAX_SKU_LENGTH = 50;

const RUN_ID_PATTERN = /^\d{8}T\d{6}Z-[a-f0-9]{6}$/;
const CHILD_SLOT_PATTERN = /^C0[1-3]$/;
const NON_SECRET_FINGERPRINT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const REMOTE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]{1,127}$/;
const PLACEHOLDER_IDENTITY_PATTERN =
  /^(?:mock|placeholder|example|sample|unknown)(?:[-_ ].*)?$|^(?:test|sandbox|user)(?:[-_ ]?\d*)?$/i;

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
const nonEmpty = z.string().trim().min(1);
const numericId = z.string().regex(/^\d+$/);
const selectorNameSchema = z.enum(['Card', 'Card Selection']);
export const YOU_PICK_LISTING_STATUSES = [
  'ACTIVE',
  'OUT_OF_STOCK',
  'INACTIVE',
  'ENDED',
  'EBAY_ENDED',
  'NOT_LISTED',
] as const;
export type YouPickListingStatus = (typeof YOU_PICK_LISTING_STATUSES)[number];
export type YouPickLifecycleClass = 'active' | 'ended' | 'not-listed' | 'ambiguous';

const imageSchema = strictObject({
  role: z.enum(['front', 'back']),
  url: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      );
    }, 'Image URL must be public HTTPS without credentials, query, or fragment.'),
  fingerprint: z
    .string()
    .regex(NON_SECRET_FINGERPRINT_PATTERN)
    .refine(
      (value) => !/(?:token|secret|signature|password|cookie)/i.test(value),
      'Image fingerprint must be non-secret.'
    ),
});

const conditionDescriptorSchema = strictObject({
  name: numericId,
  values: z.array(numericId).min(1),
});

const sharedConditionSchema = strictObject({
  condition: z.literal('USED_VERY_GOOD'),
  conditionId: z.literal('4000'),
  conditionDescriptors: z.array(conditionDescriptorSchema),
});

const childFixtureSchema = strictObject({
  slot: z.string().regex(CHILD_SLOT_PATTERN),
  selector: strictObject({ name: nonEmpty, value: nonEmpty }),
  productAspects: z.record(nonEmpty, z.array(nonEmpty).min(1)),
  itemQuantity: z.number().int().positive(),
  offerQuantity: z.number().int().positive(),
  price: strictObject({ currency: z.literal('USD'), value: z.string().regex(/^\d+\.\d{2}$/) }),
  images: z.tuple([imageSchema, imageSchema]),
  condition: sharedConditionSchema,
});

const youPickFixtureCommonShape = {
  marketplaceId: z.literal(YOU_PICK_MARKETPLACE),
  categoryId: z.literal(YOU_PICK_CATEGORY),
  format: z.literal('FIXED_PRICE'),
  contentLanguage: z.literal(YOU_PICK_CONTENT_LANGUAGE),
  policies: strictObject({
    fulfillmentPolicyId: nonEmpty,
    paymentPolicyId: nonEmpty,
    returnPolicyId: nonEmpty,
  }),
  merchantLocationKey: nonEmpty,
  selector: strictObject({
    name: selectorNameSchema,
    values: z.array(nonEmpty).min(2).max(3),
  }),
  group: strictObject({
    title: nonEmpty,
    description: nonEmpty,
    sharedAspects: z.record(nonEmpty, z.array(nonEmpty).min(1)),
    variantSkuSnapshot: z.array(z.string().regex(CHILD_SLOT_PATTERN)).min(2).max(3),
    variesBy: strictObject({
      specifications: z.tuple([
        strictObject({ name: nonEmpty, values: z.array(nonEmpty).min(2).max(3) }),
      ]),
      aspectsImageVariesBy: nonEmpty,
    }),
  }),
  sharedCondition: sharedConditionSchema,
  children: z.array(childFixtureSchema).min(2).max(3),
  predecessorRunId: z.string().regex(RUN_ID_PATTERN).optional(),
  predecessorFullyCleaned: z.boolean().optional(),
} satisfies z.ZodRawShape;

const youPickFixtureVersion1BaseSchema = strictObject({
  version: z.literal(1),
  ...youPickFixtureCommonShape,
});
const youPickFixtureVersion2BaseSchema = strictObject({
  version: z.literal(2),
  ...youPickFixtureCommonShape,
});
type YouPickFixtureRefinementInput =
  | z.infer<typeof youPickFixtureVersion1BaseSchema>
  | z.infer<typeof youPickFixtureVersion2BaseSchema>;

function refineYouPickFixture(fixture: YouPickFixtureRefinementInput, ctx: z.RefinementCtx): void {
  const childCount = fixture.children.length;
  const slots = fixture.children.map((child) => child.slot);
  const expectedSlots = Array.from({ length: childCount }, (_, index) => `C0${index + 1}`);
  const values = fixture.children.map((child) => child.selector.value);
  const prices = fixture.children.map((child) => child.price.value);
  const imageUrls = fixture.children.flatMap((child) => child.images.map((image) => image.url));
  const fingerprints = fixture.children.flatMap((child) =>
    child.images.map((image) => image.fingerprint)
  );
  const conditionSnapshot = JSON.stringify(fixture.sharedCondition);

  const issue = (message: string, path: (string | number)[] = []) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

  if (JSON.stringify(slots) !== JSON.stringify(expectedSlots))
    issue('Children must be ordered C01, C02, then optional C03.', ['children']);
  if (JSON.stringify(fixture.group.variantSkuSnapshot) !== JSON.stringify(slots))
    issue('variantSkuSnapshot must exactly match ordered child slots.', [
      'group',
      'variantSkuSnapshot',
    ]);
  if (JSON.stringify(fixture.selector.values) !== JSON.stringify(values))
    issue('Selector values must exactly match ordered child selector values.', [
      'selector',
      'values',
    ]);
  if (new Set(values).size !== values.length)
    issue('Selector values must be unique.', ['selector', 'values']);
  if (new Set(prices).size !== prices.length || prices.some((value) => Number(value) <= 0))
    issue('Prices must be distinct and positive.', ['children']);
  if (new Set(fingerprints).size !== fingerprints.length)
    issue('Image fingerprints must be distinct.', ['children']);
  if (fixture.version === 2 && new Set(imageUrls).size !== imageUrls.length)
    issue('Version-2 image source URLs must be distinct across children.', ['children']);
  if (fixture.group.variesBy.aspectsImageVariesBy !== fixture.selector.name)
    issue('aspectsImageVariesBy must equal selector name.', ['group', 'variesBy']);
  const specification = fixture.group.variesBy.specifications[0];
  if (
    specification.name !== fixture.selector.name ||
    JSON.stringify(specification.values) !== JSON.stringify(values)
  )
    issue('variesBy specification must exactly match selector name and ordered values.', [
      'group',
      'variesBy',
      'specifications',
    ]);

  fixture.children.forEach((child, index) => {
    if (child.selector.name !== fixture.selector.name)
      issue('Child selector name must exactly match group selector.', [
        'children',
        index,
        'selector',
      ]);
    if (
      JSON.stringify(child.productAspects[fixture.selector.name]) !==
      JSON.stringify([child.selector.value])
    )
      issue('Child product selector aspect must contain exactly its selector value.', [
        'children',
        index,
        'productAspects',
      ]);
    if (child.images[0].role !== 'front' || child.images[1].role !== 'back')
      issue('Images must be exactly front then back.', ['children', index, 'images']);
    child.images.forEach((image, imageIndex) => {
      if (/[?&](?:signature|sig|token|key|auth|x-amz-[^=]*)=/i.test(image.url))
        issue('Signed or secret-bearing image URLs are forbidden.', [
          'children',
          index,
          'images',
          imageIndex,
          'url',
        ]);
    });
    if (JSON.stringify(child.condition) !== conditionSnapshot)
      issue('Every child must use the complete shared condition contract.', [
        'children',
        index,
        'condition',
      ]);
  });

  if (fixture.predecessorRunId && fixture.predecessorFullyCleaned !== true)
    issue('A predecessor fallback may reference only a fully cleaned run.', [
      'predecessorFullyCleaned',
    ]);
  if (!fixture.predecessorRunId && fixture.predecessorFullyCleaned !== undefined)
    issue('predecessorFullyCleaned requires predecessorRunId.', ['predecessorFullyCleaned']);
}

export const youPickFixtureVersion1Schema =
  youPickFixtureVersion1BaseSchema.superRefine(refineYouPickFixture);
export const youPickFixtureVersion2Schema =
  youPickFixtureVersion2BaseSchema.superRefine(refineYouPickFixture);
export const youPickFixtureSchema = z.union([
  youPickFixtureVersion1Schema,
  youPickFixtureVersion2Schema,
]);

export type YouPickFixture = z.infer<typeof youPickFixtureSchema>;

const runIdentitySchema = strictObject({
  runId: z.string().regex(RUN_ID_PATTERN),
  prefix: nonEmpty,
  groupKey: nonEmpty.max(YOU_PICK_MAX_SKU_LENGTH),
  childSkus: z.array(nonEmpty.max(YOU_PICK_MAX_SKU_LENGTH)).min(2).max(3),
});

const gateSchema = strictObject({
  name: nonEmpty,
  status: z.enum(['pass', 'fail']),
  detail: nonEmpty,
});
const operationDigestSchema = strictObject({
  id: nonEmpty,
  kind: nonEmpty,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
const resourceSchema = strictObject({
  sku: nonEmpty,
  offerId: z.string().regex(REMOTE_ID_PATTERN).nullable(),
  offerStatus: nonEmpty.nullable(),
});
const collisionSchema = strictObject({
  identifier: nonEmpty,
  resource: z.enum(['group', 'item', 'offers']),
  status: z.enum(['missing', 'found', 'unknown']),
});
const metadataSummarySchema = strictObject({
  selectorStatus: z.enum(['taxonomy-listed', 'custom-unlisted', 'unresolved']),
  selectorName: selectorNameSchema,
  selectorCandidatesDigest: z.string().regex(/^[a-f0-9]{64}$/),
  conditionId: z.literal('4000'),
  condition: z.literal('USED_VERY_GOOD'),
  conditionDescriptorsDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
const cleanupRemoteSummarySchema = strictObject({
  stateDigest: z.string().regex(/^[a-f0-9]{64}$/),
  manifestPublished: z.boolean(),
  publicationObserved: z.boolean(),
  listingCurrentlyActive: z.boolean(),
  withdrawRequired: z.boolean(),
  listingId: z.string().regex(REMOTE_ID_PATTERN).nullable(),
  lifecycleClass: z.enum(['active', 'ended', 'not-listed']).nullable(),
  listingStatuses: z
    .array(z.enum(YOU_PICK_LISTING_STATUSES))
    .max(2)
    .refine(
      (values) => JSON.stringify(values) === JSON.stringify([...new Set(values)].sort()),
      'Cleanup listing statuses must be sorted and unique.'
    ),
  warnings: z.array(nonEmpty),
});

const manifestCommonShape = {
  run: runIdentitySchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  mode: z.literal('dry-run'),
  checkpoint: z.enum([
    'created',
    'preflight-complete',
    'creating-items',
    'creating-offers',
    'replacing-group',
    'verifying-unpublished',
    'publishing',
    'awaiting-published-view-verification',
    'setting-quantity-zero',
    'awaiting-quantity-zero-verification',
    'withdrawal-ready',
    'cleanup-plan-ready',
    'cleanup-in-progress',
    'cleanup-complete',
  ]),
  seller: strictObject({ userId: nonEmpty, username: nonEmpty.optional() }).nullable(),
  expected: strictObject({
    environment: z.literal('sandbox'),
    restOrigin: z.literal(YOU_PICK_SANDBOX_ORIGIN),
    oauthOrigin: z.literal(YOU_PICK_SANDBOX_ORIGIN),
    tradingOrigin: z.literal(YOU_PICK_SANDBOX_ORIGIN),
    marketplaceId: z.literal(YOU_PICK_MARKETPLACE),
    categoryId: z.literal(YOU_PICK_CATEGORY),
    contentLanguage: z.literal(YOU_PICK_CONTENT_LANGUAGE),
  }),
  ownership: strictObject({
    selectorName: selectorNameSchema,
    selectorValues: z.array(nonEmpty).min(2).max(3),
    imageFingerprints: z.array(nonEmpty).min(4).max(6),
    itemQuantities: z.array(z.number().int().positive()).min(2).max(3),
    offerQuantities: z.array(z.number().int().positive()).min(2).max(3),
    prices: z
      .array(z.string().regex(/^\d+\.\d{2}$/))
      .min(2)
      .max(3),
    condition: z.literal('USED_VERY_GOOD'),
    conditionId: z.literal('4000'),
    conditionDescriptors: z.array(conditionDescriptorSchema),
    conditionDigest: z.string().regex(/^[a-f0-9]{64}$/),
    fulfillmentPolicyId: nonEmpty,
    paymentPolicyId: nonEmpty,
    returnPolicyId: nonEmpty,
    merchantLocationKey: nonEmpty,
  }),
  arrangementId: nonEmpty,
  predecessorRunId: z.string().regex(RUN_ID_PATTERN).nullable(),
  predecessorFullyCleaned: z.boolean(),
  published: z.boolean(),
  groupListingId: z.string().regex(REMOTE_ID_PATTERN).nullable(),
  resources: z.array(resourceSchema).min(2).max(3),
  gates: z.array(gateSchema),
  collisions: z.array(collisionSchema),
  metadataSummary: metadataSummarySchema.nullable(),
  cleanupRemoteSummary: cleanupRemoteSummarySchema.nullable(),
  operations: z.array(operationDigestSchema).min(1),
  cleanup: strictObject({
    attempts: z.number().int().nonnegative(),
    finalAbsenceVerified: z.boolean(),
  }),
  lastError: nonEmpty.nullable(),
} satisfies z.ZodRawShape;

const operationLedgerEntrySchema = strictObject({
  id: nonEmpty,
  kind: nonEmpty,
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['planned', 'started', 'completed', 'unknown']),
  attemptCount: z.number().int().nonnegative(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  result: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).nullable(),
  error: nonEmpty.nullable(),
  readBackDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
}).superRefine((entry, ctx) => {
  if (entry.state === 'planned' && (entry.startedAt !== null || entry.completedAt !== null))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Planned operation has timestamps.' });
  if (entry.state !== 'planned' && entry.startedAt === null)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Attempted operation lacks startedAt.' });
  if (entry.state === 'completed' && entry.completedAt === null)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Completed operation lacks completedAt.',
    });
  if (entry.state !== 'completed' && entry.completedAt !== null)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Incomplete operation has completedAt.' });
});

const executableStateSchema = strictObject({
  eligible: z.literal(true),
  fixture: youPickFixtureSchema,
  ledger: z.array(operationLedgerEntrySchema).min(1),
  publishedAttestationDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  quantityZeroAttestationDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});

function refineManifest(
  manifest: z.infer<z.ZodObject<typeof manifestCommonShape>>,
  ctx: z.RefinementCtx
): void {
  try {
    validateRunIdentity(manifest.run);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : 'Invalid run identity.',
      path: ['run'],
    });
  }
  const resourceSkus = manifest.resources.map((resource) => resource.sku);
  if (JSON.stringify(resourceSkus) !== JSON.stringify(manifest.run.childSkus))
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Manifest resources must exactly match run child SKUs.',
      path: ['resources'],
    });
  if (manifest.predecessorRunId === manifest.run.runId)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A run cannot be its own predecessor.',
      path: ['predecessorRunId'],
    });
  if (manifest.predecessorRunId && !manifest.predecessorFullyCleaned)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Predecessor run must be fully cleaned.',
      path: ['predecessorFullyCleaned'],
    });
}

export const legacyYouPickManifestSchema = strictObject({
  version: z.literal(YOU_PICK_LEGACY_MANIFEST_VERSION),
  ...manifestCommonShape,
}).superRefine(refineManifest);

export const executableYouPickManifestSchema = strictObject({
  version: z.literal(YOU_PICK_MANIFEST_VERSION),
  ...manifestCommonShape,
  execution: executableStateSchema,
}).superRefine((manifest, ctx) => {
  refineManifest(manifest, ctx);
  try {
    assertExecutableManifestIntegrity(manifest);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : 'Executable manifest integrity failed.',
      path: ['execution'],
    });
  }
});

export const youPickManifestSchema = z.union([
  legacyYouPickManifestSchema,
  executableYouPickManifestSchema,
]);

export type YouPickManifest = z.infer<typeof youPickManifestSchema>;
export type ExecutableYouPickManifest = z.infer<typeof executableYouPickManifestSchema>;

export interface CurrentUserIdentity {
  userId: string;
  username?: string;
}
export interface RuntimeSnapshot {
  environment: string;
  restOrigin: string;
  oauthOrigin: string;
  tradingOrigin: string;
  marketplaceId: string;
  contentLanguage?: string;
  hasUserRefreshToken: boolean;
  productionCredentialMaterialPresent: boolean;
  background: {
    jobRunner: boolean;
    apify: boolean;
    soldComps: boolean;
    publishing: boolean;
    watcher: boolean;
  };
  forbiddenDependencies: {
    supabase: boolean;
    r2: boolean;
    jobs: boolean;
    watcher: boolean;
    ai: boolean;
    pricing: boolean;
  };
}
export interface OwnedPolicy {
  id: string;
  marketplaceId: string;
  ownerUserId: string;
}
export interface OwnedLocation {
  merchantLocationKey: string;
  ownerUserId: string;
  enabled: boolean;
}
export interface PolicyLocationSnapshot {
  fulfillment: OwnedPolicy[];
  payment: OwnedPolicy[];
  returns: OwnedPolicy[];
  locations: OwnedLocation[];
}
export interface MetadataSnapshot {
  categoryId: string;
  variationsSupported: boolean;
  selectorCandidates: string[];
  conditions: {
    conditionId: string;
    conditionDescription: string;
    inventoryCondition: string | null;
    conditionDescriptors: {
      id: string;
      name: string;
      values: { id: string; name: string }[];
    }[];
  }[];
}
export interface RemoteInventoryItemGroup {
  variantSKUs: string[];
  snapshotDigest?: string;
}
export const inventoryItemSemanticSnapshotSchema = strictObject({
  sku: nonEmpty.max(YOU_PICK_MAX_SKU_LENGTH),
  availability: strictObject({
    shipToLocationAvailability: strictObject({ quantity: z.number().int().nonnegative() }),
  }),
  condition: nonEmpty,
  conditionDescriptors: z.array(
    strictObject({
      name: nonEmpty,
      values: z.array(nonEmpty).min(1),
    })
  ),
  product: strictObject({
    aspects: z.record(nonEmpty, z.array(nonEmpty).min(1)),
    imageUrls: z.unknown().optional(),
  }),
});
export type InventoryItemSemanticSnapshot = z.infer<typeof inventoryItemSemanticSnapshotSchema>;
export const offerSemanticSnapshotSchema = strictObject({
  sku: nonEmpty.max(YOU_PICK_MAX_SKU_LENGTH),
  marketplaceId: nonEmpty,
  format: nonEmpty,
  categoryId: nonEmpty,
  merchantLocationKey: nonEmpty,
  availableQuantity: z.number().int().nonnegative(),
  pricingSummary: strictObject({
    price: strictObject({ currency: nonEmpty, value: z.string().regex(/^\d+\.\d{2}$/) }),
  }),
  listingPolicies: strictObject({
    fulfillmentPolicyId: nonEmpty,
    paymentPolicyId: nonEmpty,
    returnPolicyId: nonEmpty,
  }),
});
export type OfferSemanticSnapshot = z.infer<typeof offerSemanticSnapshotSchema>;
export interface RemoteInventoryItem {
  sku: string;
  groupKeys: string[] | null;
  quantity?: number;
  semanticSnapshot?: InventoryItemSemanticSnapshot;
}
export interface RemoteOffer {
  offerId: string;
  sku: string;
  marketplaceId: string;
  status: 'PUBLISHED' | 'UNPUBLISHED';
  listingId: string | null;
  listingStatus: YouPickListingStatus | null;
  lifecycleClass: YouPickLifecycleClass | null;
  publicationObserved: boolean;
  listingCurrentlyActive: boolean | null;
  withdrawRequired: boolean | null;
  availableQuantity?: number;
  semanticSnapshot?: OfferSemanticSnapshot;
}

export function classifyYouPickListingStatus(status: YouPickListingStatus | null): {
  lifecycleClass: YouPickLifecycleClass | null;
  publicationObserved: boolean;
  listingCurrentlyActive: boolean | null;
  withdrawRequired: boolean | null;
} {
  if (status === null || status === 'NOT_LISTED')
    return {
      lifecycleClass: status === 'NOT_LISTED' ? 'not-listed' : null,
      publicationObserved: false,
      listingCurrentlyActive: false,
      withdrawRequired: false,
    };
  if (status === 'ACTIVE' || status === 'OUT_OF_STOCK')
    return {
      lifecycleClass: 'active',
      publicationObserved: true,
      listingCurrentlyActive: true,
      withdrawRequired: true,
    };
  if (status === 'ENDED' || status === 'EBAY_ENDED')
    return {
      lifecycleClass: 'ended',
      publicationObserved: true,
      listingCurrentlyActive: false,
      withdrawRequired: false,
    };
  return {
    lifecycleClass: 'ambiguous',
    publicationObserved: true,
    listingCurrentlyActive: null,
    withdrawRequired: null,
  };
}
export type ExactRead<T = unknown> =
  | { status: 'missing' }
  | { status: 'found'; value: T }
  | { status: 'unknown'; reason: string };

export interface YouPickPilotReadApi {
  getRuntimeSnapshot(): Promise<RuntimeSnapshot>;
  getCurrentUserIdentity(): Promise<CurrentUserIdentity>;
  getPolicyLocationSnapshot(): Promise<PolicyLocationSnapshot>;
  getMetadataSnapshot(categoryId: string): Promise<MetadataSnapshot>;
  getInventoryItemGroup(groupKey: string): Promise<ExactRead<RemoteInventoryItemGroup>>;
  getInventoryItem(sku: string): Promise<ExactRead<RemoteInventoryItem>>;
  getOffers(sku: string, marketplaceId: string): Promise<ExactRead<{ offers: RemoteOffer[] }>>;
}

export interface PlannedOperation {
  id: string;
  kind: string;
  payload: unknown;
  digest: string;
}
export interface FuturePlan {
  arrangementId: string;
  operations: PlannedOperation[];
}

const plannedConditionDescriptorSchema = strictObject({
  name: numericId,
  values: z.array(numericId).min(1),
});
const plannedItemCommonShape = {
  sku: nonEmpty.max(YOU_PICK_MAX_SKU_LENGTH),
  availability: strictObject({
    shipToLocationAvailability: strictObject({ quantity: z.number().int().positive() }),
  }),
  condition: z.literal('USED_VERY_GOOD'),
  conditionDescriptors: z.array(plannedConditionDescriptorSchema),
} satisfies z.ZodRawShape;
const plannedItemVersion1Schema = strictObject({
  ...plannedItemCommonShape,
  product: strictObject({ aspects: z.record(nonEmpty, z.array(nonEmpty).min(1)) }),
});
const plannedItemVersion2Schema = strictObject({
  ...plannedItemCommonShape,
  product: strictObject({
    aspects: z.record(nonEmpty, z.array(nonEmpty).min(1)),
    imageUrls: z.tuple([imageSchema.shape.url, imageSchema.shape.url]),
  }),
});
const plannedOfferSchema = strictObject({
  sku: nonEmpty.max(YOU_PICK_MAX_SKU_LENGTH),
  marketplaceId: z.literal(YOU_PICK_MARKETPLACE),
  format: z.literal('FIXED_PRICE'),
  categoryId: z.literal(YOU_PICK_CATEGORY),
  merchantLocationKey: nonEmpty,
  availableQuantity: z.number().int().positive(),
  pricingSummary: strictObject({
    price: strictObject({ currency: z.literal('USD'), value: z.string().regex(/^\d+\.\d{2}$/) }),
  }),
  listingPolicies: strictObject({
    fulfillmentPolicyId: nonEmpty,
    paymentPolicyId: nonEmpty,
    returnPolicyId: nonEmpty,
  }),
});
const plannedGroupCommonShape = {
  inventoryItemGroupKey: nonEmpty.max(YOU_PICK_MAX_SKU_LENGTH),
  title: nonEmpty,
  description: nonEmpty,
  aspects: z.record(nonEmpty, z.array(nonEmpty).min(1)),
  variantSKUs: z.array(nonEmpty.max(YOU_PICK_MAX_SKU_LENGTH)).min(2).max(3),
  variesBy: strictObject({
    specifications: z.tuple([
      strictObject({ name: nonEmpty, values: z.array(nonEmpty).min(2).max(3) }),
    ]),
    aspectsImageVariesBy: z.tuple([nonEmpty]),
  }),
} satisfies z.ZodRawShape;
const plannedGroupVersion1Schema = strictObject({
  ...plannedGroupCommonShape,
  imageUrls: z.array(imageSchema.shape.url).min(4).max(6),
});
const plannedGroupVersion2Schema = strictObject({
  ...plannedGroupCommonShape,
  imageUrls: z.array(imageSchema.shape.url).min(2).max(3),
});
const plannedGroupRequestSchema = strictObject({
  inventoryItemGroupKey: nonEmpty.max(YOU_PICK_MAX_SKU_LENGTH),
  marketplaceId: z.literal(YOU_PICK_MARKETPLACE),
});
const plannedBulkQuantitySchema = strictObject({
  requests: z.tuple([
    strictObject({
      sku: nonEmpty.max(YOU_PICK_MAX_SKU_LENGTH),
      shipToLocationAvailability: strictObject({ quantity: z.number().int().nonnegative() }),
      offers: z.tuple([
        strictObject({ offerId: nonEmpty, availableQuantity: z.number().int().nonnegative() }),
      ]),
    }),
  ]),
});
const plannedGroupKeySchema = strictObject({
  inventoryItemGroupKey: nonEmpty.max(YOU_PICK_MAX_SKU_LENGTH),
});
const plannedSkuSchema = strictObject({ sku: nonEmpty.max(YOU_PICK_MAX_SKU_LENGTH) });
const plannedOfferIdSchema = strictObject({ offerId: nonEmpty });
const plannedAbsenceSchema = strictObject({
  inventoryItemGroupKey: nonEmpty.max(YOU_PICK_MAX_SKU_LENGTH),
  skus: z.array(nonEmpty.max(YOU_PICK_MAX_SKU_LENGTH)).min(2).max(3),
  marketplaceId: z.literal(YOU_PICK_MARKETPLACE),
});
const cleanupWithdrawSchema = strictObject({
  groupKey: nonEmpty.max(YOU_PICK_MAX_SKU_LENGTH),
  listingId: z.string().regex(REMOTE_ID_PATTERN).nullable(),
});
const cleanupOfferSchema = strictObject({
  offerId: z.string().regex(REMOTE_ID_PATTERN),
  sku: nonEmpty.max(YOU_PICK_MAX_SKU_LENGTH),
});
const cleanupGroupSchema = strictObject({ groupKey: nonEmpty.max(YOU_PICK_MAX_SKU_LENGTH) });
const cleanupAbsenceSchema = strictObject({
  groupKey: nonEmpty.max(YOU_PICK_MAX_SKU_LENGTH),
  skus: z.array(nonEmpty.max(YOU_PICK_MAX_SKU_LENGTH)).min(2).max(3),
});

export interface PilotRunOptions {
  api?: YouPickPilotReadApi;
  apiFactory?: () => Promise<YouPickPilotReadApi>;
  mutationApiFactory?: () => Promise<YouPickPilotMutationApi>;
  fixturePath?: string;
  manifestPath?: string;
  cleanup?: boolean;
  execute?: boolean;
  confirmSandboxSeller?: string;
  attestation?: unknown;
  repoRoot: string;
  localRoot?: string;
  now?: () => Date;
  randomBytesImpl?: (size: number) => Buffer;
}

export interface PilotReport {
  mode: 'dry-run' | 'cleanup-plan' | 'execute' | 'cleanup-execute';
  run: YouPickManifest['run'];
  manifestPath: string;
  seller: CurrentUserIdentity;
  sellerConfirmation: 'not-supplied' | 'matched';
  contentLanguage: typeof YOU_PICK_CONTENT_LANGUAGE;
  gates: YouPickManifest['gates'];
  selected: { policies: YouPickFixture['policies']; merchantLocationKey: string };
  metadata: MetadataSnapshot;
  metadataSummary: NonNullable<YouPickManifest['metadataSummary']>;
  cleanupRemoteSummary: YouPickManifest['cleanupRemoteSummary'];
  collisions: YouPickManifest['collisions'];
  arrangementId: string;
  operationPlan: Omit<PlannedOperation, 'payload'>[];
  requestDigests: string[];
  nextAuthorizedCommand: string;
  checkpoint?: YouPickManifest['checkpoint'];
  listingId?: string | null;
  completedOperationIds?: string[];
  safeResumeCommand?: string;
}

export function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function semanticRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Inventory item semantic ${field} is missing or invalid.`);
  return value as Record<string, unknown>;
}

function semanticString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`Inventory item semantic ${field} is missing or invalid.`);
  return value.trim();
}

function canonicalSemanticValues(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`Inventory item semantic ${field} is missing or invalid.`);
  const values = value.map((entry) => semanticString(entry, field));
  if (new Set(values).size !== values.length)
    throw new Error(`Inventory item semantic ${field} contains duplicate values.`);
  return values.sort((left, right) => left.localeCompare(right));
}

/**
 * Projects both planned PUT bodies and GET responses into the same owned semantic contract.
 * eBay treats descriptor rows, descriptor values, aspect keys, and aspect values as unordered;
 * canonical sorting therefore ignores only collection order, never missing or duplicate content.
 */
export function projectInventoryItemSemanticSnapshot(
  value: unknown
): InventoryItemSemanticSnapshot {
  const item = semanticRecord(value, 'item');
  const availability = semanticRecord(item.availability, 'availability');
  const shipTo = semanticRecord(
    availability.shipToLocationAvailability,
    'ship-to-location availability'
  );
  if (!Number.isInteger(shipTo.quantity) || (shipTo.quantity as number) < 0)
    throw new Error('Inventory item semantic quantity is missing or invalid.');
  if (!Array.isArray(item.conditionDescriptors))
    throw new Error('Inventory item semantic condition descriptors are missing or invalid.');
  const conditionDescriptors = item.conditionDescriptors
    .map((entry) => {
      const descriptor = semanticRecord(entry, 'condition descriptor');
      const name = semanticString(descriptor.name, 'condition descriptor name');
      return {
        name,
        values: canonicalSemanticValues(descriptor.values, `condition descriptor ${name} values`),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(conditionDescriptors.map(({ name }) => name)).size !== conditionDescriptors.length)
    throw new Error('Inventory item semantic condition descriptors contain duplicate names.');
  const product = semanticRecord(item.product, 'product');
  const rawAspects = semanticRecord(product.aspects, 'product aspects');
  const aspects = Object.fromEntries(
    Object.entries(rawAspects)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, rawValues]) => [
        semanticString(name, 'product aspect name'),
        canonicalSemanticValues(rawValues, `product aspect ${name} values`),
      ])
  );
  const semanticProduct =
    'imageUrls' in product ? { aspects, imageUrls: product.imageUrls } : { aspects };
  return inventoryItemSemanticSnapshotSchema.parse({
    sku: semanticString(item.sku, 'SKU'),
    availability: {
      shipToLocationAvailability: { quantity: shipTo.quantity },
    },
    condition: semanticString(item.condition, 'condition'),
    conditionDescriptors,
    product: semanticProduct,
  });
}

const semanticImageUrlsSchema = z
  .tuple([imageSchema.shape.url, imageSchema.shape.url])
  .refine(([front, back]) => front !== back, 'Inventory item semantic image URLs are duplicated.');

export type InventoryItemSemanticField =
  | 'snapshot'
  | 'SKU'
  | 'quantity'
  | 'condition'
  | 'condition descriptors'
  | 'product aspects'
  | 'product images';

export function inventoryItemSemanticMismatch(
  actual: InventoryItemSemanticSnapshot | undefined,
  expectedInput: unknown
): InventoryItemSemanticField | null {
  if (!actual) return 'snapshot';
  const expected = projectInventoryItemSemanticSnapshot(expectedInput);
  if (actual.sku !== expected.sku) return 'SKU';
  if (
    actual.availability.shipToLocationAvailability.quantity !==
    expected.availability.shipToLocationAvailability.quantity
  )
    return 'quantity';
  if (actual.condition !== expected.condition) return 'condition';
  if (canonicalJson(actual.conditionDescriptors) !== canonicalJson(expected.conditionDescriptors))
    return 'condition descriptors';
  if (canonicalJson(actual.product.aspects) !== canonicalJson(expected.product.aspects))
    return 'product aspects';
  if (expected.product.imageUrls !== undefined) {
    const expectedImages = semanticImageUrlsSchema.parse(expected.product.imageUrls);
    const actualImages = semanticImageUrlsSchema.safeParse(actual.product.imageUrls);
    if (!actualImages.success || canonicalJson(actualImages.data) !== canonicalJson(expectedImages))
      return 'product images';
  }
  return null;
}

export function assertInventoryItemSemanticMatch(
  actual: InventoryItemSemanticSnapshot | undefined,
  expectedInput: unknown,
  label: string
): void {
  const mismatch = inventoryItemSemanticMismatch(actual, expectedInput);
  if (mismatch)
    throw new Error(`${label} semantic ${mismatch} does not match the immutable planned item.`);
}

export function projectOfferSemanticSnapshot(value: unknown): OfferSemanticSnapshot {
  const offer = semanticRecord(value, 'offer');
  if (!Number.isInteger(offer.availableQuantity) || (offer.availableQuantity as number) < 0)
    throw new Error('Offer semantic available quantity is missing or invalid.');
  const pricingSummary = semanticRecord(offer.pricingSummary, 'offer pricing summary');
  const price = semanticRecord(pricingSummary.price, 'offer price');
  const listingPolicies = semanticRecord(offer.listingPolicies, 'offer listing policies');
  return offerSemanticSnapshotSchema.parse({
    sku: semanticString(offer.sku, 'offer SKU'),
    marketplaceId: semanticString(offer.marketplaceId, 'offer marketplace ID'),
    format: semanticString(offer.format, 'offer format'),
    categoryId: semanticString(offer.categoryId, 'offer category ID'),
    merchantLocationKey: semanticString(
      offer.merchantLocationKey,
      'offer merchant location key'
    ),
    availableQuantity: offer.availableQuantity,
    pricingSummary: {
      price: {
        currency: semanticString(price.currency, 'offer price currency'),
        value: semanticString(price.value, 'offer price value'),
      },
    },
    listingPolicies: {
      fulfillmentPolicyId: semanticString(
        listingPolicies.fulfillmentPolicyId,
        'offer fulfillment policy ID'
      ),
      paymentPolicyId: semanticString(
        listingPolicies.paymentPolicyId,
        'offer payment policy ID'
      ),
      returnPolicyId: semanticString(
        listingPolicies.returnPolicyId,
        'offer return policy ID'
      ),
    },
  });
}

export type OfferSemanticField =
  | 'snapshot'
  | 'SKU'
  | 'marketplace ID'
  | 'format'
  | 'category ID'
  | 'merchant location key'
  | 'available quantity'
  | 'price currency'
  | 'price value'
  | 'fulfillment policy ID'
  | 'payment policy ID'
  | 'return policy ID';

export function offerSemanticMismatch(
  actual: OfferSemanticSnapshot | undefined,
  expectedInput: unknown
): OfferSemanticField | null {
  if (!actual) return 'snapshot';
  const expected = projectOfferSemanticSnapshot(expectedInput);
  if (actual.sku !== expected.sku) return 'SKU';
  if (actual.marketplaceId !== expected.marketplaceId) return 'marketplace ID';
  if (actual.format !== expected.format) return 'format';
  if (actual.categoryId !== expected.categoryId) return 'category ID';
  if (actual.merchantLocationKey !== expected.merchantLocationKey)
    return 'merchant location key';
  if (actual.availableQuantity !== expected.availableQuantity) return 'available quantity';
  if (actual.pricingSummary.price.currency !== expected.pricingSummary.price.currency)
    return 'price currency';
  if (actual.pricingSummary.price.value !== expected.pricingSummary.price.value)
    return 'price value';
  if (
    actual.listingPolicies.fulfillmentPolicyId !==
    expected.listingPolicies.fulfillmentPolicyId
  )
    return 'fulfillment policy ID';
  if (actual.listingPolicies.paymentPolicyId !== expected.listingPolicies.paymentPolicyId)
    return 'payment policy ID';
  if (actual.listingPolicies.returnPolicyId !== expected.listingPolicies.returnPolicyId)
    return 'return policy ID';
  return null;
}

export function assertOfferSemanticMatch(
  actual: OfferSemanticSnapshot | undefined,
  expectedInput: unknown,
  label: string
): void {
  const mismatch = offerSemanticMismatch(actual, expectedInput);
  if (mismatch)
    throw new Error(`${label} semantic ${mismatch} does not match the immutable planned offer.`);
}

export function generateRunIdentity(
  childCount: number,
  now = new Date(),
  random: Buffer = randomBytes(3)
): YouPickManifest['run'] {
  if (childCount !== 2 && childCount !== 3)
    throw new Error('Run identity requires exactly 2 or 3 children.');
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const runId = `${timestamp}-${random.toString('hex')}`;
  const prefix = `YPSBX-${runId}`;
  const run = {
    runId,
    prefix,
    groupKey: `${prefix}-G`,
    childSkus: Array.from({ length: childCount }, (_, index) => `${prefix}-C0${index + 1}`),
  };
  validateRunIdentity(run);
  return run;
}

export function validateRunIdentity(run: YouPickManifest['run']): void {
  if (!RUN_ID_PATTERN.test(run.runId)) throw new Error('Invalid You Pick run ID.');
  const expectedPrefix = `YPSBX-${run.runId}`;
  if (run.prefix !== expectedPrefix || run.groupKey !== `${expectedPrefix}-G`)
    throw new Error('Run prefix or group key is not owned by this run.');
  const expectedSkus = Array.from(
    { length: run.childSkus.length },
    (_, index) => `${expectedPrefix}-C0${index + 1}`
  );
  if (JSON.stringify(run.childSkus) !== JSON.stringify(expectedSkus))
    throw new Error('Child SKUs are not exact ordered run-owned identifiers.');
  if ([run.groupKey, ...run.childSkus].some((value) => value.length > YOU_PICK_MAX_SKU_LENGTH))
    throw new Error('Run-owned identifier exceeds eBay SKU length.');
  if ([run.groupKey, ...run.childSkus].some((value) => /(?:Single|Lot)-\d{6}/.test(value)))
    throw new Error('You Pick identifiers must not match Single/Lot SKU grammar.');
}

export function parseCurrentUserIdentity(value: unknown): CurrentUserIdentity {
  const response = z.object({ User: z.unknown() }).passthrough().safeParse(value);
  if (
    !response.success ||
    !response.data.User ||
    typeof response.data.User !== 'object' ||
    Array.isArray(response.data.User)
  )
    throw new Error('Trading GetUser response must contain one User object.');
  const user = response.data.User as Record<string, unknown>;
  const userId = typeof user.UserID === 'string' ? user.UserID.trim() : '';
  const username = typeof user.UserName === 'string' ? user.UserName.trim() : undefined;
  if (!USER_ID_PATTERN.test(userId) || PLACEHOLDER_IDENTITY_PATTERN.test(userId))
    throw new Error('Trading GetUser returned a missing, malformed, or placeholder UserID.');
  if (
    Array.isArray(user.UserID) ||
    Object.keys(user).filter((key) => key.toLowerCase() === 'userid').length !== 1
  )
    throw new Error('Trading GetUser returned an ambiguous UserID.');
  return username ? { userId, username } : { userId };
}

export function buildGuardedMutationHeaders(input: {
  environment: string;
  sellerUserId: string;
  expectedSellerUserId: string;
  marketplaceId: string;
  contentLanguage?: string;
}): GuardedMutationHeaders {
  if (input.environment !== 'sandbox')
    throw new Error('Guarded mutation contract requires sandbox.');
  if (!input.sellerUserId || input.sellerUserId !== input.expectedSellerUserId)
    throw new Error('Guarded mutation contract requires exact seller identity.');
  if (input.marketplaceId !== YOU_PICK_MARKETPLACE)
    throw new Error('Guarded mutation contract requires EBAY_US.');
  if (input.contentLanguage !== YOU_PICK_CONTENT_LANGUAGE)
    throw new Error('Guarded mutation contract requires Content-Language: en-US.');
  return { 'Content-Language': YOU_PICK_CONTENT_LANGUAGE };
}

function operation(
  id: string,
  kind: string,
  schema: z.ZodType,
  payloadInput: unknown
): PlannedOperation {
  const payload = schema.parse(payloadInput);
  return { id, kind, payload, digest: digest(payload) };
}

export function buildFuturePlan(fixtureInput: unknown, run: YouPickManifest['run']): FuturePlan {
  const fixture = youPickFixtureSchema.parse(fixtureInput);
  validateRunIdentity(run);
  if (fixture.children.length !== run.childSkus.length)
    throw new Error('Fixture child count does not match run identity.');
  const selectorName = fixture.selector.name;
  const groupImages =
    fixture.version === 1
      ? fixture.children.flatMap((child) => child.images.map((image) => image.url))
      : fixture.children.map((child) => child.images[0].url);
  const operations: PlannedOperation[] = [];

  fixture.children.forEach((child, index) => {
    const sku = run.childSkus[index];
    operations.push(
      operation(
        `item-${child.slot}`,
        'create-or-replace-child-item',
        fixture.version === 1 ? plannedItemVersion1Schema : plannedItemVersion2Schema,
        {
          sku,
          availability: { shipToLocationAvailability: { quantity: child.itemQuantity } },
          condition: child.condition.condition,
          conditionDescriptors: child.condition.conditionDescriptors,
          product:
            fixture.version === 1
              ? { aspects: child.productAspects }
              : {
                  aspects: child.productAspects,
                  imageUrls: child.images.map((image) => image.url),
                },
        }
      )
    );
  });
  fixture.children.forEach((child, index) => {
    operations.push(
      operation(`offer-${child.slot}`, 'create-child-offer', plannedOfferSchema, {
        sku: run.childSkus[index],
        marketplaceId: fixture.marketplaceId,
        format: fixture.format,
        categoryId: fixture.categoryId,
        merchantLocationKey: fixture.merchantLocationKey,
        availableQuantity: child.offerQuantity,
        pricingSummary: { price: child.price },
        listingPolicies: fixture.policies,
      })
    );
  });
  operations.push(
    operation(
      'group-complete',
      'replace-complete-inventory-item-group',
      fixture.version === 1 ? plannedGroupVersion1Schema : plannedGroupVersion2Schema,
      {
        inventoryItemGroupKey: run.groupKey,
        title: fixture.group.title,
        description: fixture.group.description,
        aspects: fixture.group.sharedAspects,
        imageUrls: groupImages,
        variantSKUs: run.childSkus,
        variesBy: {
          specifications: [{ name: selectorName, values: fixture.selector.values }],
          aspectsImageVariesBy: [selectorName],
        },
      }
    )
  );
  operations.push(
    operation('publish-group', 'publish-inventory-item-group', plannedGroupRequestSchema, {
      inventoryItemGroupKey: run.groupKey,
      marketplaceId: fixture.marketplaceId,
    })
  );
  const target = fixture.children[0];
  operations.push(
    operation('quantity-zero', 'bulk-update-one-child-quantity-zero', plannedBulkQuantitySchema, {
      requests: [
        {
          sku: run.childSkus[0],
          shipToLocationAvailability: { quantity: 0 },
          offers: [{ offerId: `$manifest.offerId.${target.slot}`, availableQuantity: 0 }],
        },
      ],
    })
  );
  operations.push(
    operation(
      'quantity-restore-optional',
      'optional-restore-one-child-quantity',
      plannedBulkQuantitySchema,
      {
        requests: [
          {
            sku: run.childSkus[0],
            shipToLocationAvailability: { quantity: target.itemQuantity },
            offers: [
              {
                offerId: `$manifest.offerId.${target.slot}`,
                availableQuantity: target.offerQuantity,
              },
            ],
          },
        ],
      }
    )
  );
  operations.push(
    operation('withdraw-group', 'withdraw-inventory-item-group', plannedGroupRequestSchema, {
      inventoryItemGroupKey: run.groupKey,
      marketplaceId: fixture.marketplaceId,
    })
  );
  [...fixture.children].reverse().forEach((child) =>
    operations.push(
      operation(`cleanup-offer-${child.slot}`, 'delete-recorded-offer', plannedOfferIdSchema, {
        offerId: `$manifest.offerId.${child.slot}`,
      })
    )
  );
  operations.push(
    operation('cleanup-group', 'delete-inventory-item-group', plannedGroupKeySchema, {
      inventoryItemGroupKey: run.groupKey,
    })
  );
  [...run.childSkus].reverse().forEach((sku, index) =>
    operations.push(
      operation(
        `cleanup-child-${run.childSkus.length - index}`,
        'delete-child-inventory-item',
        plannedSkuSchema,
        {
          sku,
        }
      )
    )
  );
  operations.push(
    operation('verify-absence', 'verify-exact-run-resource-absence', plannedAbsenceSchema, {
      inventoryItemGroupKey: run.groupKey,
      skus: run.childSkus,
      marketplaceId: fixture.marketplaceId,
    })
  );
  return {
    arrangementId: `arrangement-v${fixture.version}-${digest(operations.map(({ id, digest: value }) => ({ id, digest: value }))).slice(0, 16)}`,
    operations,
  };
}

function requireExactIntegrity(label: string, actual: unknown, expected: unknown): void {
  if (canonicalJson(actual) !== canonicalJson(expected))
    throw new Error(`Executable manifest integrity mismatch: ${label}.`);
}

export function assertExecutableManifestIntegrity(manifest: ExecutableYouPickManifest): void {
  const fixture = youPickFixtureSchema.parse(manifest.execution.fixture);
  const plan = buildFuturePlan(fixture, manifest.run);
  const expectedOperations = plan.operations.map(({ id, kind, digest: operationDigest }) => ({
    id,
    kind,
    digest: operationDigest,
  }));
  const expectedLedgerIdentity = expectedOperations.map(({ id, kind, digest: requestDigest }) => ({
    id,
    kind,
    requestDigest,
  }));
  const actualLedgerIdentity = manifest.execution.ledger.map(({ id, kind, requestDigest }) => ({
    id,
    kind,
    requestDigest,
  }));
  const expectedOwnership: ExecutableYouPickManifest['ownership'] = {
    selectorName: fixture.selector.name,
    selectorValues: fixture.selector.values,
    imageFingerprints: fixture.children.flatMap((child) =>
      child.images.map((image) => image.fingerprint)
    ),
    itemQuantities: fixture.children.map((child) => child.itemQuantity),
    offerQuantities: fixture.children.map((child) => child.offerQuantity),
    prices: fixture.children.map((child) => child.price.value),
    condition: fixture.sharedCondition.condition,
    conditionId: fixture.sharedCondition.conditionId,
    conditionDescriptors: fixture.sharedCondition.conditionDescriptors,
    conditionDigest: digest(fixture.sharedCondition),
    ...fixture.policies,
    merchantLocationKey: fixture.merchantLocationKey,
  };
  requireExactIntegrity('arrangementId', manifest.arrangementId, plan.arrangementId);
  requireExactIntegrity('ordered operations', manifest.operations, expectedOperations);
  requireExactIntegrity('ordered execution ledger', actualLedgerIdentity, expectedLedgerIdentity);
  requireExactIntegrity('fixture-derived ownership', manifest.ownership, expectedOwnership);
  requireExactIntegrity(
    'ordered resource SKUs',
    manifest.resources.map((resource) => resource.sku),
    manifest.run.childSkus
  );
  requireExactIntegrity(
    'fixture child count',
    fixture.children.length,
    manifest.run.childSkus.length
  );
}

function manifestLocalRoot(repoRoot: string, override?: string): string {
  const expected = resolve(repoRoot, '.local', 'you-pick-sandbox');
  if (override !== undefined && resolve(override) !== expected) {
    throw new Error('You Pick manifest root must be <repo>/.local/you-pick-sandbox.');
  }
  return expected;
}

export function assertSafeManifestPath(
  path: string,
  localRoot: string,
  expectedRunId?: string
): string {
  const absolute = resolve(path);
  const root = resolve(localRoot);
  const rel = relative(root, absolute);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || resolve(root, rel) !== absolute)
    throw new Error('Manifest path must be contained in the You Pick local root.');
  if (
    absolute !== join(root, expectedRunId ?? dirname(rel).split(sep).at(-1) ?? '', 'manifest.json')
  )
    throw new Error('Manifest path must be the exact run directory manifest.json.');
  return absolute;
}

async function assertRealManifestContainment(path: string, localRoot: string): Promise<void> {
  const [rootReal, directoryReal] = await Promise.all([
    realpath(localRoot),
    realpath(dirname(path)),
  ]);
  const parentReal = await realpath(dirname(localRoot));
  if (rootReal !== join(parentReal, basename(localRoot))) {
    throw new Error('You Pick local root must not be a symbolic link.');
  }
  const rel = relative(rootReal, directoryReal);
  if (rel.startsWith(`..${sep}`) || rel === '..') {
    throw new Error('Manifest directory resolves outside the You Pick local root.');
  }
  if (directoryReal !== join(rootReal, basename(dirname(path)))) {
    throw new Error('Manifest run directory must not be a symbolic link.');
  }
}

async function assertNotSymlinkIfExists(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new Error(`Unsafe symbolic link in manifest path: ${path}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function writeManifestAtomic(
  path: string,
  manifestInput: unknown,
  localRoot: string
): Promise<void> {
  const manifest = youPickManifestSchema.parse(sanitizeReport(manifestInput));
  const absolute = assertSafeManifestPath(path, localRoot, manifest.run.runId);
  const directory = dirname(absolute);
  await assertRealManifestContainment(absolute, localRoot);
  const tempPath = join(
    directory,
    `.manifest.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  );
  const directoryHandle = await open(directory, 'r');
  let fileHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    fileHandle = await open(tempPath, 'wx', 0o600);
    await fileHandle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = undefined;
    await rename(tempPath, absolute);
    try {
      await directoryHandle.sync();
    } catch {
      /* Directory sync is not supported on every platform. */
    }
  } finally {
    if (fileHandle) await fileHandle.close();
    try {
      await unlink(tempPath);
    } catch {
      /* A successful rename already removed the temp path. */
    }
    await directoryHandle.close();
  }
}

export async function readManifest(path: string, localRoot: string): Promise<YouPickManifest> {
  const absolute = assertSafeManifestPath(path, localRoot);
  await assertRealManifestContainment(absolute, localRoot);
  const [fileReal, directoryReal] = await Promise.all([
    realpath(absolute),
    realpath(dirname(absolute)),
  ]);
  if (fileReal !== join(directoryReal, 'manifest.json')) {
    throw new Error('Manifest file must not be a symbolic link.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(absolute, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`Manifest is missing or corrupt: ${sanitizeError(error)}`);
  }
  const manifest = youPickManifestSchema.parse(parsed);
  assertSafeManifestPath(absolute, localRoot, manifest.run.runId);
  return manifest;
}

function initialManifest(
  fixture: YouPickFixture,
  run: YouPickManifest['run'],
  plan: FuturePlan,
  now: Date
): YouPickManifest {
  const timestamp = now.toISOString();
  return youPickManifestSchema.parse({
    version: YOU_PICK_MANIFEST_VERSION,
    run,
    createdAt: timestamp,
    updatedAt: timestamp,
    mode: 'dry-run',
    checkpoint: 'created',
    seller: null,
    expected: {
      environment: 'sandbox',
      restOrigin: YOU_PICK_SANDBOX_ORIGIN,
      oauthOrigin: YOU_PICK_SANDBOX_ORIGIN,
      tradingOrigin: YOU_PICK_SANDBOX_ORIGIN,
      marketplaceId: YOU_PICK_MARKETPLACE,
      categoryId: YOU_PICK_CATEGORY,
      contentLanguage: YOU_PICK_CONTENT_LANGUAGE,
    },
    ownership: {
      selectorName: fixture.selector.name,
      selectorValues: fixture.selector.values,
      imageFingerprints: fixture.children.flatMap((child) =>
        child.images.map((image) => image.fingerprint)
      ),
      itemQuantities: fixture.children.map((child) => child.itemQuantity),
      offerQuantities: fixture.children.map((child) => child.offerQuantity),
      prices: fixture.children.map((child) => child.price.value),
      condition: fixture.sharedCondition.condition,
      conditionId: fixture.sharedCondition.conditionId,
      conditionDescriptors: fixture.sharedCondition.conditionDescriptors,
      conditionDigest: digest(fixture.sharedCondition),
      ...fixture.policies,
      merchantLocationKey: fixture.merchantLocationKey,
    },
    arrangementId: plan.arrangementId,
    predecessorRunId: fixture.predecessorRunId ?? null,
    predecessorFullyCleaned: fixture.predecessorFullyCleaned ?? false,
    published: false,
    groupListingId: null,
    resources: run.childSkus.map((sku) => ({ sku, offerId: null, offerStatus: null })),
    gates: [],
    collisions: [],
    metadataSummary: null,
    cleanupRemoteSummary: null,
    operations: plan.operations.map(({ id, kind, digest: value }) => ({ id, kind, digest: value })),
    execution: {
      eligible: true,
      fixture,
      ledger: plan.operations.map(({ id, kind, digest: requestDigest }) => ({
        id,
        kind,
        requestDigest,
        state: 'planned',
        attemptCount: 0,
        startedAt: null,
        completedAt: null,
        result: null,
        error: null,
        readBackDigest: null,
      })),
      publishedAttestationDigest: null,
      quantityZeroAttestationDigest: null,
    },
    cleanup: { attempts: 0, finalAbsenceVerified: false },
    lastError: null,
  });
}

function pass(name: string, detail: string): YouPickManifest['gates'][number] {
  return { name, status: 'pass', detail };
}
function assertGate(
  condition: unknown,
  name: string,
  detail: string
): YouPickManifest['gates'][number] {
  if (!condition) throw new Error(`${name} gate failed: ${detail}`);
  return pass(name, detail);
}

function validateRuntime(runtime: RuntimeSnapshot): YouPickManifest['gates'] {
  return [
    assertGate(runtime.environment === 'sandbox', 'environment', 'sandbox environment required'),
    assertGate(
      runtime.restOrigin === YOU_PICK_SANDBOX_ORIGIN &&
        runtime.oauthOrigin === YOU_PICK_SANDBOX_ORIGIN &&
        runtime.tradingOrigin === YOU_PICK_SANDBOX_ORIGIN,
      'hosts',
      'exact sandbox REST, OAuth, and Trading origins required'
    ),
    assertGate(runtime.marketplaceId === YOU_PICK_MARKETPLACE, 'marketplace', 'EBAY_US required'),
    assertGate(
      runtime.contentLanguage === YOU_PICK_CONTENT_LANGUAGE,
      'content-language',
      'exact en-US required'
    ),
    assertGate(
      runtime.hasUserRefreshToken && !runtime.productionCredentialMaterialPresent,
      'auth-readiness',
      'sandbox user refresh token readiness without production material required'
    ),
    assertGate(
      Object.values(runtime.background).every((value) => value === false),
      'background-work',
      'all external background work must be disabled'
    ),
    assertGate(
      Object.values(runtime.forbiddenDependencies).every((value) => value === false),
      'dependency-isolation',
      'Supabase, R2, jobs, watcher, AI, and pricing must be unused'
    ),
  ];
}

function validateIdentity(
  identityInput: CurrentUserIdentity,
  confirmation?: string,
  manifestUserId?: string
): CurrentUserIdentity {
  const identity = parseCurrentUserIdentity({
    User: {
      UserID: identityInput.userId,
      ...(identityInput.username ? { UserName: identityInput.username } : {}),
    },
  });
  if (confirmation !== undefined && confirmation !== identity.userId)
    throw new Error('Sandbox seller confirmation does not exactly match Trading UserID.');
  if (manifestUserId !== undefined && manifestUserId !== identity.userId)
    throw new Error('Trading UserID changed from the manifest seller identity.');
  return identity;
}

function selectOwnedResources(
  snapshot: PolicyLocationSnapshot,
  ownership: YouPickManifest['ownership'],
  userId: string
): void {
  const exact = (items: OwnedPolicy[], id: string, label: string) =>
    items.filter(
      (item) =>
        item.id === id && item.marketplaceId === YOU_PICK_MARKETPLACE && item.ownerUserId === userId
    ).length === 1 ||
    (() => {
      throw new Error(
        `${label} policy selection is missing, ambiguous, or not owned by confirmed seller.`
      );
    })();
  exact(snapshot.fulfillment, ownership.fulfillmentPolicyId, 'Fulfillment');
  exact(snapshot.payment, ownership.paymentPolicyId, 'Payment');
  exact(snapshot.returns, ownership.returnPolicyId, 'Return');
  const locations = snapshot.locations.filter(
    (location) =>
      location.merchantLocationKey === ownership.merchantLocationKey &&
      location.ownerUserId === userId &&
      location.enabled
  );
  if (locations.length !== 1)
    throw new Error(
      'Merchant location selection is missing, ambiguous, disabled, or not owned by confirmed seller.'
    );
}

function validateMetadata(
  metadata: MetadataSnapshot,
  manifest: YouPickManifest
): NonNullable<YouPickManifest['metadataSummary']> {
  if (metadata.categoryId !== YOU_PICK_CATEGORY || !metadata.variationsSupported)
    throw new Error('Current metadata does not confirm category 261328 variation support.');
  if (new Set(metadata.selectorCandidates).size !== metadata.selectorCandidates.length)
    throw new Error('Current taxonomy returned duplicate variation aspect candidates.');
  const conditionMatches = metadata.conditions.filter(
    (condition) => condition.conditionId === manifest.ownership.conditionId
  );
  if (conditionMatches.length !== 1) {
    throw new Error('Current condition metadata does not confirm the fixture condition contract.');
  }
  const condition = conditionMatches[0];
  if (condition.inventoryCondition !== manifest.ownership.condition)
    throw new Error('Current condition metadata maps condition 4000 to an unexpected enum.');
  for (const expected of manifest.ownership.conditionDescriptors) {
    const descriptors = condition.conditionDescriptors.filter(
      (descriptor) => descriptor.id === expected.name
    );
    if (descriptors.length !== 1) {
      throw new Error('Current condition metadata has a missing or ambiguous descriptor ID.');
    }
    const actualValues = descriptors[0].values.map((value) => value.id);
    if (expected.values.some((value) => !actualValues.includes(value))) {
      throw new Error('Current condition metadata does not confirm the fixture descriptor values.');
    }
  }
  const selectorStatus = metadata.selectorCandidates.includes(manifest.ownership.selectorName)
    ? 'taxonomy-listed'
    : selectorNameSchema.safeParse(manifest.ownership.selectorName).success
      ? 'custom-unlisted'
      : 'unresolved';
  return {
    selectorStatus,
    selectorName: manifest.ownership.selectorName,
    selectorCandidatesDigest: digest([...metadata.selectorCandidates].sort()),
    conditionId: '4000',
    condition: 'USED_VERY_GOOD',
    conditionDescriptorsDigest: digest(condition.conditionDescriptors),
  };
}

async function collisions(
  api: YouPickPilotReadApi,
  run: YouPickManifest['run']
): Promise<YouPickManifest['collisions']> {
  const results: YouPickManifest['collisions'] = [];
  const group = await api.getInventoryItemGroup(run.groupKey);
  results.push({ identifier: run.groupKey, resource: 'group', status: group.status });
  for (const sku of run.childSkus) {
    const item = await api.getInventoryItem(sku);
    results.push({ identifier: sku, resource: 'item', status: item.status });
    const offers = await api.getOffers(sku, YOU_PICK_MARKETPLACE);
    const offerStatus =
      offers.status === 'found' && offers.value.offers.length === 0 ? 'missing' : offers.status;
    results.push({ identifier: sku, resource: 'offers', status: offerStatus });
  }
  if (results.some((result) => result.status !== 'missing'))
    throw new Error(
      'Exact collision reads did not confirm absence for every run-owned identifier.'
    );
  return results;
}

export interface CleanupRemoteState {
  group: 'found' | 'missing';
  items: { sku: string; status: 'found' | 'missing'; groupKeys: string[] | null }[];
  offers: { sku: string; status: 'found' | 'missing'; offer: RemoteOffer | null }[];
  publicationObserved: boolean;
  listingCurrentlyActive: boolean;
  withdrawRequired: boolean;
  listingId: string | null;
  lifecycleClass: Exclude<YouPickLifecycleClass, 'ambiguous'> | null;
  listingStatuses: YouPickListingStatus[];
  warnings: string[];
}

async function cleanupReads(
  api: YouPickPilotReadApi,
  manifest: YouPickManifest
): Promise<{ collisions: YouPickManifest['collisions']; state: CleanupRemoteState }> {
  const results: YouPickManifest['collisions'] = [];
  const group = await api.getInventoryItemGroup(manifest.run.groupKey);
  if (group.status === 'unknown') throw new Error('Cleanup group state is unknown.');
  if (
    group.status === 'found' &&
    JSON.stringify(group.value.variantSKUs) !== JSON.stringify(manifest.run.childSkus)
  ) {
    throw new Error('Cleanup group children do not exactly match ordered run-owned SKUs.');
  }
  results.push({ identifier: manifest.run.groupKey, resource: 'group', status: group.status });
  const items: CleanupRemoteState['items'] = [];
  const normalizedOffers: CleanupRemoteState['offers'] = [];
  const listingIds = new Set<string>();
  for (const resource of manifest.resources) {
    const item = await api.getInventoryItem(resource.sku);
    if (item.status === 'unknown')
      throw new Error(`Cleanup item state is unknown for ${resource.sku}.`);
    if (item.status === 'found') {
      if (item.value.sku !== resource.sku)
        throw new Error(`Cleanup item identity mismatch for ${resource.sku}.`);
      if (
        item.value.groupKeys !== null &&
        (item.value.groupKeys.length !== 1 || item.value.groupKeys[0] !== manifest.run.groupKey)
      ) {
        throw new Error(`Cleanup item has a conflicting group association for ${resource.sku}.`);
      }
    }
    items.push({
      sku: resource.sku,
      status: item.status,
      groupKeys: item.status === 'found' ? item.value.groupKeys : null,
    });
    results.push({ identifier: resource.sku, resource: 'item', status: item.status });
    const offers = await api.getOffers(resource.sku, YOU_PICK_MARKETPLACE);
    if (offers.status === 'unknown')
      throw new Error(`Cleanup offer state is unknown for ${resource.sku}.`);
    if (offers.status === 'found' && offers.value.offers.length > 1)
      throw new Error(`Cleanup found ambiguous offers for ${resource.sku}.`);
    const offer = offers.status === 'found' ? (offers.value.offers[0] ?? null) : null;
    if (offer) {
      if (
        !resource.offerId ||
        offer.offerId !== resource.offerId ||
        offer.sku !== resource.sku ||
        offer.marketplaceId !== YOU_PICK_MARKETPLACE
      ) {
        throw new Error(`Cleanup found an unrecorded or ambiguous offer for ${resource.sku}.`);
      }
      if (
        !['PUBLISHED', 'UNPUBLISHED'].includes(offer.status) ||
        (offer.listingStatus !== null &&
          !(YOU_PICK_LISTING_STATUSES as readonly string[]).includes(offer.listingStatus)) ||
        (offer.status === 'PUBLISHED' && (!offer.listingId || !offer.listingStatus)) ||
        (offer.status === 'UNPUBLISHED' && (offer.listingId || offer.listingStatus))
      ) {
        throw new Error(`Cleanup found an invalid publication/listing state for ${resource.sku}.`);
      }
      const lifecycle = classifyYouPickListingStatus(offer.listingStatus);
      const expectedPublicationObserved =
        offer.status === 'PUBLISHED' || lifecycle.publicationObserved;
      if (
        offer.publicationObserved !== expectedPublicationObserved ||
        offer.lifecycleClass !== lifecycle.lifecycleClass ||
        offer.listingCurrentlyActive !== lifecycle.listingCurrentlyActive ||
        offer.withdrawRequired !== lifecycle.withdrawRequired
      ) {
        throw new Error(
          `Cleanup found inconsistent normalized lifecycle state for ${resource.sku}.`
        );
      }
      if (offer.listingId) listingIds.add(offer.listingId);
    }
    normalizedOffers.push({
      sku: resource.sku,
      status: offer ? 'found' : 'missing',
      offer,
    });
    const offerStatus =
      offers.status === 'found' && offers.value.offers.length === 0 ? 'missing' : offers.status;
    results.push({ identifier: resource.sku, resource: 'offers', status: offerStatus });
  }
  if (listingIds.size > 1) throw new Error('Cleanup found conflicting group listing identities.');
  const foundOffers = normalizedOffers.flatMap((entry) => (entry.offer ? [entry.offer] : []));
  const offerStatuses = new Set(foundOffers.map((offer) => offer.status));
  if (offerStatuses.size > 1)
    throw new Error('Cleanup found conflicting offer publication states across group children.');
  const listingStatuses = [
    ...new Set(foundOffers.flatMap((offer) => (offer.listingStatus ? [offer.listingStatus] : []))),
  ].sort();
  const lifecycleClasses = new Set(
    foundOffers.map((offer) => offer.lifecycleClass ?? 'unpublished')
  );
  if (lifecycleClasses.has('ambiguous')) {
    throw new Error(
      'Cleanup listing status INACTIVE is ambiguous; refusing destructive cleanup planning.'
    );
  }
  if (lifecycleClasses.size > 1)
    throw new Error('Cleanup found conflicting listing lifecycle classes across group children.');
  const remoteListingId = [...listingIds][0] ?? null;
  if (manifest.groupListingId && remoteListingId && manifest.groupListingId !== remoteListingId) {
    throw new Error('Cleanup remote listing identity conflicts with the manifest.');
  }
  const lifecycleClassValue = [...lifecycleClasses][0] ?? null;
  const lifecycleClass =
    lifecycleClassValue === 'unpublished'
      ? null
      : (lifecycleClassValue as Exclude<YouPickLifecycleClass, 'ambiguous'>);
  const publicationObserved =
    lifecycleClass === 'active' ||
    lifecycleClass === 'ended' ||
    (lifecycleClass === 'not-listed' && foundOffers.some((offer) => offer.publicationObserved));
  const listingCurrentlyActive = lifecycleClass === 'active';
  const withdrawRequired = lifecycleClass === 'active';
  const warnings: string[] = [];
  if (!manifest.published && publicationObserved)
    warnings.push('Remote evidence shows publication not recorded by the manifest.');
  if (manifest.published && !publicationObserved)
    warnings.push(
      'Manifest records publication but current offers do not expose publication evidence.'
    );
  if (manifest.published && publicationObserved && !withdrawRequired)
    warnings.push(
      'Manifest publication history reconciles with a remote listing that no longer requires withdrawal.'
    );
  return {
    collisions: results,
    state: {
      group: group.status,
      items,
      offers: normalizedOffers,
      publicationObserved,
      listingCurrentlyActive,
      withdrawRequired,
      listingId: remoteListingId ?? manifest.groupListingId,
      lifecycleClass,
      listingStatuses,
      warnings,
    },
  };
}

export function buildCleanupPlan(
  manifest: YouPickManifest,
  remote: CleanupRemoteState
): Omit<PlannedOperation, 'payload'>[] {
  const planned: PlannedOperation[] = [];
  if (remote.withdrawRequired)
    planned.push(
      operation(
        'cleanup-withdraw-group',
        'withdraw-active-group-if-needed',
        cleanupWithdrawSchema,
        {
          groupKey: manifest.run.groupKey,
          listingId: remote.listingId,
        }
      )
    );
  [...manifest.resources].reverse().forEach((resource, index) => {
    if (resource.offerId)
      planned.push(
        operation(
          `cleanup-recorded-offer-${index + 1}`,
          'delete-recorded-offer',
          cleanupOfferSchema,
          {
            offerId: resource.offerId,
            sku: resource.sku,
          }
        )
      );
  });
  planned.push(
    operation('cleanup-delete-group', 'delete-group', cleanupGroupSchema, {
      groupKey: manifest.run.groupKey,
    })
  );
  [...manifest.run.childSkus]
    .reverse()
    .forEach((sku, index) =>
      planned.push(
        operation(`cleanup-delete-child-${index + 1}`, 'delete-child', plannedSkuSchema, { sku })
      )
    );
  planned.push(
    operation('cleanup-verify-absence', 'verify-exact-absence', cleanupAbsenceSchema, {
      groupKey: manifest.run.groupKey,
      skus: manifest.run.childSkus,
    })
  );
  return planned.map(({ id, kind, digest: value }) => ({ id, kind, digest: value }));
}

export async function runYouPickSandboxPilot(
  options: PilotRunOptions
): Promise<PilotReport | MutationExecutionReport> {
  if (Boolean(options.fixturePath) === Boolean(options.manifestPath))
    throw new Error('Supply exactly one of --fixture or --manifest.');
  if (options.cleanup && !options.manifestPath) throw new Error('--cleanup requires --manifest.');
  if (options.execute && (!options.manifestPath || !options.confirmSandboxSeller?.trim()))
    throw new Error(YOU_PICK_EXECUTION_ERROR);
  if (options.execute && options.fixturePath) throw new Error(YOU_PICK_EXECUTION_ERROR);
  const now = options.now ?? (() => new Date());
  const localRoot = manifestLocalRoot(options.repoRoot, options.localRoot);
  let manifest: YouPickManifest;
  let path: string;
  let planOperations: Omit<PlannedOperation, 'payload'>[] | undefined;

  if (options.fixturePath) {
    const fixture = youPickFixtureVersion2Schema.parse(
      JSON.parse(await readFile(resolve(options.fixturePath), 'utf8')) as unknown
    );
    const run = generateRunIdentity(
      fixture.children.length,
      now(),
      (options.randomBytesImpl ?? randomBytes)(3)
    );
    if (fixture.predecessorRunId === run.runId)
      throw new Error('Fallback predecessor must be a different run.');
    const plan = buildFuturePlan(fixture, run);
    path = join(localRoot, run.runId, 'manifest.json');
    const directory = dirname(path);
    await assertNotSymlinkIfExists(dirname(localRoot));
    await assertNotSymlinkIfExists(localRoot);
    await mkdir(localRoot, { recursive: true, mode: 0o700 });
    await assertNotSymlinkIfExists(localRoot);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    manifest = initialManifest(fixture, run, plan, now());
    await writeManifestAtomic(path, manifest, localRoot);
    planOperations = plan.operations.map(({ id, kind, digest: value }) => ({
      id,
      kind,
      digest: value,
    }));
  } else {
    path = assertSafeManifestPath(resolve(options.manifestPath!), localRoot);
    manifest = await readManifest(path, localRoot);
    planOperations = options.cleanup ? undefined : manifest.operations;
  }

  if (options.execute) {
    if (manifest.version !== YOU_PICK_MANIFEST_VERSION) throw new Error(YOU_PICK_EXECUTION_ERROR);
    assertExecutableManifestIntegrity(manifest);
    const allowed = options.cleanup
      ? [
          'preflight-complete',
          'creating-items',
          'creating-offers',
          'replacing-group',
          'verifying-unpublished',
          'publishing',
          'awaiting-published-view-verification',
          'setting-quantity-zero',
          'awaiting-quantity-zero-verification',
          'withdrawal-ready',
          'cleanup-in-progress',
        ]
      : [
          'preflight-complete',
          'creating-items',
          'creating-offers',
          'replacing-group',
          'verifying-unpublished',
          'publishing',
          'awaiting-published-view-verification',
          'setting-quantity-zero',
          'awaiting-quantity-zero-verification',
        ];
    if (!allowed.includes(manifest.checkpoint)) throw new Error(YOU_PICK_EXECUTION_ERROR);
    if (!options.mutationApiFactory) throw new Error(YOU_PICK_EXECUTION_ERROR);
  }

  if (Boolean(options.api) === Boolean(options.apiFactory)) {
    throw new Error('Supply exactly one pilot read API or API factory.');
  }
  const api = options.api ?? (await (options.apiFactory as () => Promise<YouPickPilotReadApi>)());

  const gates: YouPickManifest['gates'] = [];
  let activeGate = 'runtime';
  let identity: CurrentUserIdentity | undefined;
  let metadata: MetadataSnapshot | undefined;
  let metadataSummary: NonNullable<YouPickManifest['metadataSummary']> | undefined;
  let collisionResults: YouPickManifest['collisions'] | undefined;
  let cleanupState: CleanupRemoteState | undefined;
  let mutationHeaders: GuardedMutationHeaders | undefined;
  try {
    const runtime = await api.getRuntimeSnapshot();
    gates.push(...validateRuntime(runtime));
    activeGate = 'seller-identity';
    identity = validateIdentity(
      await api.getCurrentUserIdentity(),
      options.confirmSandboxSeller,
      manifest.seller?.userId
    );
    gates.push(pass('seller-identity', 'immutable Trading UserID confirmed'));
    activeGate = 'future-mutation-header-contract';
    mutationHeaders = buildGuardedMutationHeaders({
      environment: runtime.environment,
      sellerUserId: identity.userId,
      expectedSellerUserId: identity.userId,
      marketplaceId: runtime.marketplaceId,
      contentLanguage: runtime.contentLanguage,
    });
    gates.push(
      pass(
        'future-mutation-header-contract',
        'Content-Language: en-US guard validated without mutation'
      )
    );
    activeGate = 'policies-location';
    const policies = await api.getPolicyLocationSnapshot();
    selectOwnedResources(policies, manifest.ownership, identity.userId);
    gates.push(pass('policies-location', 'exact fixture-owned seller resources selected'));
    activeGate = 'metadata';
    metadata = await api.getMetadataSnapshot(YOU_PICK_CATEGORY);
    metadataSummary = validateMetadata(metadata, manifest);
    gates.push(
      pass(
        'metadata',
        `current category and condition metadata confirmed; selector=${metadataSummary.selectorStatus}; sandbox group validation remains authoritative`
      )
    );
    activeGate = options.execute
      ? 'execution-remote-state'
      : options.cleanup
        ? 'cleanup-state'
        : 'collisions';
    if (options.execute) {
      collisionResults = manifest.collisions;
      if (
        manifest.checkpoint === 'preflight-complete' &&
        (collisionResults.length !== manifest.run.childSkus.length * 2 + 1 ||
          collisionResults.some((collision) => collision.status !== 'missing'))
      )
        throw new Error(
          'execution-remote-state gate failed: preflight collision proof is incomplete.'
        );
      gates.push(pass(activeGate, 'manifest checkpoint and exact prior collision proof accepted'));
    } else if (options.cleanup) {
      const cleanup = await cleanupReads(api, manifest);
      collisionResults = cleanup.collisions;
      cleanupState = cleanup.state;
      planOperations = buildCleanupPlan(manifest, cleanup.state);
    } else {
      collisionResults = await collisions(api, manifest.run);
    }
    if (!options.execute)
      gates.push(
        pass(
          activeGate,
          options.cleanup
            ? 'manifest-owned resource state reconstructed with exact reads'
            : 'exact group, item, and offer absence confirmed'
        )
      );
  } catch (error) {
    const detail = sanitizeError(error);
    const namedGate = /^([a-z-]+) gate failed:/i.exec(detail)?.[1] ?? activeGate;
    const failedGates = [
      ...gates.filter((gate) => gate.name !== namedGate),
      { name: namedGate, status: 'fail' as const, detail },
    ];
    manifest = youPickManifestSchema.parse({
      ...manifest,
      seller: identity ?? manifest.seller,
      gates: failedGates,
      lastError: detail,
      updatedAt: now().toISOString(),
    });
    await writeManifestAtomic(path, manifest, localRoot);
    throw new Error(detail);
  }
  if (
    !identity ||
    !metadata ||
    !metadataSummary ||
    !collisionResults ||
    (!options.execute && !planOperations)
  ) {
    throw new Error('Pilot preflight ended without complete read-only evidence.');
  }

  manifest = youPickManifestSchema.parse({
    ...manifest,
    seller: identity,
    gates,
    collisions: collisionResults,
    metadataSummary,
    cleanupRemoteSummary: cleanupState
      ? {
          stateDigest: digest(cleanupState),
          manifestPublished: manifest.published,
          publicationObserved: cleanupState.publicationObserved,
          listingCurrentlyActive: cleanupState.listingCurrentlyActive,
          withdrawRequired: cleanupState.withdrawRequired,
          listingId: cleanupState.listingId,
          lifecycleClass: cleanupState.lifecycleClass,
          listingStatuses: cleanupState.listingStatuses,
          warnings: cleanupState.warnings,
        }
      : manifest.cleanupRemoteSummary,
    checkpoint: options.execute
      ? manifest.checkpoint
      : options.cleanup
        ? 'cleanup-plan-ready'
        : 'preflight-complete',
    updatedAt: now().toISOString(),
  });
  await writeManifestAtomic(path, manifest, localRoot);

  if (options.execute) {
    try {
      if (manifest.version !== YOU_PICK_MANIFEST_VERSION || !mutationHeaders)
        throw new Error(YOU_PICK_EXECUTION_ERROR);
      const {
        executeYouPickManifest,
        validatePublishedViewAttestation,
        validateQuantityZeroAttestation,
      } = await import('./you-pick-sandbox-pilot-mutation.js');
      if (!options.cleanup && manifest.checkpoint === 'awaiting-published-view-verification')
        validatePublishedViewAttestation(options.attestation, manifest, now());
      if (!options.cleanup && manifest.checkpoint === 'awaiting-quantity-zero-verification')
        validateQuantityZeroAttestation(options.attestation, manifest, now());
      assertExecutableManifestIntegrity(manifest);
      const mutationApi = await options.mutationApiFactory!();
      return await executeYouPickManifest({
        manifest,
        manifestPath: path,
        readApi: api,
        mutationApi,
        headers: mutationHeaders,
        attestation: options.attestation,
        cleanup: Boolean(options.cleanup),
        now,
        persist: async (next) => {
          manifest = next;
          await writeManifestAtomic(path, next, localRoot);
        },
      });
    } catch (error) {
      const detail = sanitizeError(error);
      manifest = executableYouPickManifestSchema.parse({
        ...manifest,
        lastError: detail,
        updatedAt: now().toISOString(),
      });
      await writeManifestAtomic(path, manifest, localRoot);
      const resume = `pnpm --filter sidecar ebay:pilot-you-pick-sandbox -- --manifest ${path} ${options.cleanup ? '--cleanup ' : ''}--execute --confirm-sandbox-seller ${identity.userId}`;
      throw new Error(`${detail} Safe resume command: ${resume}`);
    }
  }

  const selected = {
    policies: {
      fulfillmentPolicyId: manifest.ownership.fulfillmentPolicyId,
      paymentPolicyId: manifest.ownership.paymentPolicyId,
      returnPolicyId: manifest.ownership.returnPolicyId,
    },
    merchantLocationKey: manifest.ownership.merchantLocationKey,
  };
  return sanitizeReport({
    mode: options.cleanup ? 'cleanup-plan' : 'dry-run',
    run: manifest.run,
    manifestPath: path,
    seller: identity,
    sellerConfirmation: options.confirmSandboxSeller ? 'matched' : 'not-supplied',
    contentLanguage: YOU_PICK_CONTENT_LANGUAGE,
    gates,
    selected,
    metadata,
    metadataSummary,
    cleanupRemoteSummary: manifest.cleanupRemoteSummary,
    collisions: collisionResults,
    arrangementId: manifest.arrangementId,
    operationPlan: planOperations!,
    requestDigests: planOperations!.map((item) => item.digest),
    nextAuthorizedCommand: `pnpm --filter sidecar ebay:pilot-you-pick-sandbox -- --manifest ${path} ${options.cleanup ? '--cleanup ' : ''}--execute --confirm-sandbox-seller ${identity.userId}`,
  });
}

const sensitiveKeyPattern =
  /(?:authorization|cookie|token|secret|password|address|imageurl|signedurl)/i;

export function sanitizeReport<T>(value: T, sensitiveValues: string[] = []): T {
  const cleanString = (input: string): string => {
    let output = input
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
      .replace(/([?&](?:signature|sig|token|key|expires|x-amz-[^=]+)=)[^&#\s]+/gi, '$1[REDACTED]')
      .replace(/https:\/\/[^\s"']+\?[^\s"']+/gi, (url) => `${url.split('?')[0]}?[REDACTED]`);
    for (const secret of sensitiveValues.filter(Boolean))
      output = output.split(secret).join('[REDACTED]');
    return output;
  };
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string') return cleanString(item);
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).map(([key, child]) => [
          key,
          sensitiveKeyPattern.test(key) ? '[REDACTED]' : visit(child),
        ])
      );
    return item;
  };
  return visit(value) as T;
}

export function sanitizeError(error: unknown, sensitiveValues: string[] = []): string {
  return sanitizeReport(error instanceof Error ? error.message : String(error), sensitiveValues);
}

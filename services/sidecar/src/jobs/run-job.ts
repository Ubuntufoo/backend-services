import {
  AiModelRouteNotFoundError,
  getPricingProviderMode,
  isPricingEnabled,
  type AiModelAttemptMetadata,
  type AiModelAttemptRow,
  type GeminiJobAttemptAuditUpdate,
  type GeminiModelAttempt,
  type JobRow,
  type ListingRow,
  type ListingUpdate,
  type ResolvedAiModelRoute,
} from '@ebay-inventory/data';
import {
  aspectValueSchema,
  generateListingDraft,
  generateListingDraftWithFallback,
  GeminiDraftServiceError,
  GeminiDraftValidationError,
  GeminiFallbackExecutionError,
  prepareGenerateListingDraft,
  resolveTradingCardListingIds,
  type GenerateAiAttemptDiagnostics,
  type GenerateAiLatencyDiagnostics,
  type GenerateAiPayloadDiagnostics,
  type GenerateListingDraftInput,
  type PreparedGenerateListingDraft,
  type PreparedGenerateListingDraftExecutionResult,
} from '@/gemini/index.js';
import {
  deriveAuthorizedSportsSeasonFromSet,
  sanitizeSetAspectValue,
  sanitizeTitleYearClaims,
} from '@/gemini/year-normalization.js';
import { parseAuthorizedSellerYears } from '@/gemini/seller-year-hints.js';
import { TRADING_CARD_CONDITION_ASPECT_KEY } from '@/listings/trading-card-conditions.js';
import { getSidecarDataAccess, type SidecarDataAccess } from '@/data/sidecar-data.js';
import {
  buildGeneratedDraftMetadata,
  GENERATED_DRAFT_METADATA_KEY,
} from '@/pricing/generated-draft-metadata.js';
import {
  publishListing as publishApprovedListing,
  type PublishListingDependencies,
  type PublishListingResult,
} from '@/ebay/publish-listing.js';
import { isStructurallyEseEligibleListing } from '@/listings/trading-card-conditions.js';
import { createProductionPricingAnalyst } from '@/pricing/production-llm-pricing-analyst.js';
import {
  classifyJobError,
  createRetryExhaustedError,
  JOB_ERROR_CODES,
  SidecarJobError,
  toJobErrorUpdateInput,
  toListingErrorContext,
} from './job-errors.js';
import {
  hasActionableRecordCreatedListings,
  prepareRecordCreatedListings,
  type PrepareRecordCreatedListingsResult,
} from './prepare-record-created-listings.js';
import {
  isResearchPriceListingEligible,
  isSoldCompsRuntimeEnabled,
  runResearchPriceJob,
  type ResearchPriceJobDependencies,
} from './research-price-job.js';
import { getNextRetryAt, hasAttemptsRemaining } from './retry-policy.js';
import { createLogger } from '@/utils/logger.js';

const GENERATE_AI_JOB_TYPE = 'generate_ai';
const PUBLISH_JOB_TYPE = 'publish';
const PROCESS_IMAGES_JOB_TYPE = 'process_images';
const RESEARCH_PRICE_JOB_TYPE = 'research_price';
const JOB_STATUS_RUNNING = 'running';
const CATEGORY_SUGGESTION_ASPECT_KEY = 'CategorySuggestion';
const CONDITION_SUGGESTION_ASPECT_KEY = 'ConditionSuggestion';
const SKU_CATEGORY_CODE_ASPECT_KEY = 'skuCategoryCode';
const AI_PROVIDER_GOOGLE = 'google';
const AI_ROUTING_SOURCE_DIRECT_GEMINI = 'direct_gemini';
const LISTING_DRAFT_ROUTE_TASK_TYPE = 'listing_draft_generation';
const GENERATED_DESCRIPTION_NOTICE =
  "Condition & Photography: Card was photographed outside its sleeve to minimize glare and show its actual condition clearly. It will be shipped securely in a new sleeve, protected against movement, bending, and moisture. Please review all high-res photos closely to assess centering, corners, and surface details.\n\nShipping: Eligible low-value items under $20 ship via eBay Standard Envelope for $0.99. One or two eligible items cost $0.99 total; three or more eligible items receive free shipping automatically. FedEx Ground Economy is also available as a $6.49 alternate. Items priced at $20 or more, or items not eligible for eBay Standard Envelope, ship free via FedEx Ground Economy.\n\nCombined Shipping: eBay automatically applies combined shipping in your cart; no message is needed before payment.\n\nFeedback: If you have feedback about the shipping process, please message me. I'm always open to practical, cost-effective shipping improvements.";
const PREVIOUS_GENERATED_DESCRIPTION_NOTICE =
  "Condition & Photography: Card was photographed outside its sleeve to minimize glare and show its actual condition clearly. It will be shipped securely in a new sleeve, protected against movement, bending, and moisture. Please review all high-res photos closely to assess centering, corners, and surface details.\n\nShipping: For cards under $20, I ship securely and free via eBay Standard Envelope, which includes integrated tracking. USPS Ground Advantage is also available at the buyer's expense for an additional $6.49. You can select your preferred shipping option at checkout.\n\nCombined Shipping: Combined shipping is often available for multiple items from my store. Please add items to your eBay cart and message me before payment to request a combined-shipping total.\n\nFeedback: If you have feedback about the shipping process, please message me. I'm always open to practical, cost-effective shipping improvements.";
const LEGACY_GENERATED_DESCRIPTION_NOTICE =
  'Condition & Photography:\nCard was photographed outside its sleeve to minimize glare and show its actual condition clearly. It will be shipped securely in a new sleeve, protected against movement and moisture. Please review all high-resolution photos closely to assess centering, corners, and surface details.\nCombined Shipping: Combined shipping is available for multiple items. Please add items to your eBay cart and then message to request a total.';
const jobLogger = createLogger('Job');
const nowMs = () => performance.now();
const elapsedMs = (startedAt: number) => Math.max(0, Math.round(performance.now() - startedAt));

type GenerateListingDraftFn = (
  input: GenerateListingDraftInput,
  options: { model: string }
) => ReturnType<typeof generateListingDraft>;
type PrepareListingDraftFn = (
  input: GenerateListingDraftInput
) => Promise<PreparedGenerateListingDraft>;
type PublishListingFn = (
  listingId: string,
  dependencies?: Partial<PublishListingDependencies>
) => Promise<PublishListingResult>;
type PrepareRecordCreatedListingsFn = (
  options?: Parameters<typeof prepareRecordCreatedListings>[0]
) => Promise<PrepareRecordCreatedListingsResult>;

export interface RunSidecarJobOptions {
  dataAccess?: SidecarDataAccess;
  generateListingDraft?: GenerateListingDraftFn;
  now?: () => Date;
  prepareListingDraft?: PrepareListingDraftFn;
  publishListing?: PublishListingFn;
  prepareRecordCreatedListings?: PrepareRecordCreatedListingsFn;
  researchPrice?: Partial<Omit<ResearchPriceJobDependencies, 'dataAccess' | 'now'>>;
}

export interface AssetPrepSummary {
  exhaustedCandidates: boolean;
  failedCount: number;
  processedCount: number;
  skippedCount: number;
}

export interface RunSidecarJobResult {
  assetPrepSummary?: AssetPrepSummary;
  job: JobRow;
  listing: ListingRow | null;
  processedListings?: ListingRow[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asIsoTimestamp(now: () => Date): string {
  return now().toISOString();
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getListingImageUrls(listing: ListingRow): string[] {
  return listing.image_urls
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function getListingAspectHints(
  listing: ListingRow
): NonNullable<GenerateListingDraftInput['userHints']>['aspects'] | undefined {
  if (!isRecord(listing.item_specifics)) {
    return undefined;
  }

  const aspects = Object.fromEntries(
    Object.entries(listing.item_specifics).flatMap(([key, value]) => {
      const parsed = aspectValueSchema.safeParse(value);
      return parsed.success ? [[key, parsed.data]] : [];
    })
  );

  const sanitizedAspects = Object.fromEntries(
    Object.entries(aspects).flatMap(([key, value]) => {
      if (key === 'Year' || key === 'Season') {
        return [];
      }

      if (key === 'Set') {
        const normalizedSet = sanitizeSetAspectValue(value);
        return normalizedSet !== undefined ? [[key, normalizedSet]] : [];
      }

      return [[key, value]];
    })
  );

  return Object.keys(sanitizedAspects).length > 0 ? sanitizedAspects : undefined;
}

function getListingNotesHint(listing: ListingRow): string | undefined {
  const sections = [
    asNonEmptyString(listing.seller_hints),
    asNonEmptyString(listing.condition_notes),
  ].filter((value): value is string => value !== undefined);

  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

function buildUserHints(listing: ListingRow): GenerateListingDraftInput['userHints'] | undefined {
  const explicitYears = parseAuthorizedSellerYears(listing.seller_hints);
  if (explicitYears.length > 1) {
    throw new GeminiDraftValidationError([
      {
        code: 'custom',
        message: `Conflicting seller year directives: ${explicitYears.join(', ')}.`,
        path: ['seller_hints'],
      },
    ]);
  }

  const explicitYear = explicitYears[0];
  const title = (() => {
    const value = asNonEmptyString(listing.title);
    if (!value) {
      return undefined;
    }

    const sanitized = sanitizeTitleYearClaims(value);
    return sanitized.length > 0 ? sanitized : undefined;
  })();
  const notes = getListingNotesHint(listing);
  const aspects = getListingAspectHints(listing);

  if (!explicitYear && !title && !notes && !aspects) {
    return undefined;
  }

  return {
    aspects,
    ...(explicitYear ? { explicitYear } : {}),
    notes,
    title,
  };
}

function buildGeneratedListingAspects(
  draft: Awaited<ReturnType<typeof generateListingDraft>>,
  authorizedYear?: string,
  categoryId?: string
): NonNullable<ListingUpdate['item_specifics']> {
  const draftMetadata = buildGeneratedDraftMetadata(draft.yearEvidence, authorizedYear);
  const canonicalYear = authorizedYear ?? draft.yearEvidence?.year;
  const draftAspects = { ...draft.aspects };
  delete (draftAspects as Record<string, unknown>).Season;
  const safeDraftSeason = draft.seasonEvidence?.season ?? (() => {
    if (categoryId !== '261328' || !canonicalYear) {
      return null;
    }

    const value = draftAspects.Set;
    const raw = typeof value === 'string' ? value.trim() : null;
    if (!raw) {
      return null;
    }

    return deriveAuthorizedSportsSeasonFromSet(raw, canonicalYear);
  })();

  const itemSpecifics: Record<string, unknown> = {
    ...draftAspects,
    ...(categoryId === '261328' && (safeDraftSeason || canonicalYear)
      ? { Season: safeDraftSeason ?? canonicalYear }
      : {}),
    ...(draftMetadata ? { [GENERATED_DRAFT_METADATA_KEY]: draftMetadata } : {}),
    ...(draft.cardConditionToken
      ? { [TRADING_CARD_CONDITION_ASPECT_KEY]: draft.cardConditionToken }
      : {}),
    ...(draft.categorySuggestion
      ? { [CATEGORY_SUGGESTION_ASPECT_KEY]: draft.categorySuggestion }
      : {}),
    ...(draft.conditionSuggestion
      ? { [CONDITION_SUGGESTION_ASPECT_KEY]: draft.conditionSuggestion }
      : {}),
    ...(draft.skuCategoryCode ? { [SKU_CATEGORY_CODE_ASPECT_KEY]: draft.skuCategoryCode } : {}),
  };

  return itemSpecifics as NonNullable<ListingUpdate['item_specifics']>;
}

const GENERATED_ITEM_INFO_LABEL = 'Item Info: ';

// Prepends the label for the Gemini-generated card segment so published
// descriptions read "Item Info: <generated content>". No-op when the segment
// is empty or already labeled.
function prefixGeneratedItemInfo(description: string): string {
  if (description.length === 0 || description.startsWith(GENERATED_ITEM_INFO_LABEL)) {
    return description;
  }

  return `${GENERATED_ITEM_INFO_LABEL}${description}`;
}

function appendGeneratedDescriptionNotice(description: string): string {
  const generatedDescription = description.trimEnd();

  if (generatedDescription.endsWith(GENERATED_DESCRIPTION_NOTICE)) {
    const cardSegment = generatedDescription
      .slice(0, -GENERATED_DESCRIPTION_NOTICE.length)
      .trimEnd();
    return cardSegment
      ? `${prefixGeneratedItemInfo(cardSegment)}\n\n${GENERATED_DESCRIPTION_NOTICE}`
      : GENERATED_DESCRIPTION_NOTICE;
  }

  for (const staleNotice of [
    PREVIOUS_GENERATED_DESCRIPTION_NOTICE,
    LEGACY_GENERATED_DESCRIPTION_NOTICE,
  ]) {
    if (generatedDescription.endsWith(staleNotice)) {
      const withoutStaleNotice = generatedDescription.slice(0, -staleNotice.length).trimEnd();
      return withoutStaleNotice
        ? `${prefixGeneratedItemInfo(withoutStaleNotice)}\n\n${GENERATED_DESCRIPTION_NOTICE}`
        : GENERATED_DESCRIPTION_NOTICE;
    }
  }

  return generatedDescription
    ? `${prefixGeneratedItemInfo(generatedDescription)}\n\n${GENERATED_DESCRIPTION_NOTICE}`
    : GENERATED_DESCRIPTION_NOTICE;
}

function buildGeneratedListingReviewUpdate(
  listing: ListingRow,
  draft: Awaited<ReturnType<typeof generateListingDraft>>,
  authorizedYear?: string
): ListingUpdate {
  const resolvedIds = resolveTradingCardListingIds(listing, draft);
  const eseEligible = isStructurallyEseEligibleListing({
    category_id: resolvedIds.category_id,
    condition_id: resolvedIds.condition_id,
    listing_type: listing.listing_type,
  });

  return {
    category_id: resolvedIds.category_id,
    condition_id: resolvedIds.condition_id,
    condition_notes: draft.cardConditionNote ?? null,
    description: appendGeneratedDescriptionNotice(draft.description),
    ese_eligible: eseEligible,
    item_specifics: buildGeneratedListingAspects(
      draft,
      authorizedYear,
      resolvedIds.category_id ?? undefined,
    ),
    last_error_at: null,
    last_error_code: null,
    last_error_context: {},
    last_error_message: null,
    price: listing.auto_pricing_enabled === false ? listing.price : (draft.priceSuggestion ?? null),
    status: 'needs_review',
    sub_status: 'review_pending',
    title: draft.title,
  };
}

function buildGenerateAiFailureUpdate(error: SidecarJobError, errorAt: string): ListingUpdate {
  return {
    last_error_at: errorAt,
    last_error_code: error.code,
    last_error_context: toListingErrorContext(error),
    last_error_message: error.message,
    status: 'assets_ready',
    sub_status: 'ready_to_generate',
  };
}

function buildPublishFailureUpdate(
  error: SidecarJobError,
  errorAt: string,
  subStatus: 'idle' | 'publish_queued'
): ListingUpdate {
  const validationScope = error.context.validation_scope;
  const shouldReturnToReview =
    validationScope === 'listing' ||
    error.context.validation_code === 'PUBLISH_REQUIRED_FIELD_MISSING';

  return {
    last_error_at: errorAt,
    last_error_code: error.code,
    last_error_context: toListingErrorContext(error),
    last_error_message: error.message,
    status: shouldReturnToReview ? 'needs_review' : 'approved_for_export',
    sub_status: shouldReturnToReview ? 'review_pending' : subStatus,
  };
}

function appendCleanupFailure(message: string, cleanupError: unknown): string {
  const cleanupMessage =
    cleanupError instanceof Error ? cleanupError.message : 'Unknown cleanup error';

  return `${message} Cleanup also failed: ${cleanupMessage}`;
}

function summarizeGeminiAttemptFailureMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();

  if (normalized.length <= 240) {
    return normalized;
  }

  return `${normalized.slice(0, 237)}...`;
}

function buildListingDraftRouteResolutionInput(): {
  freeTierOnly: true;
  provider: typeof AI_PROVIDER_GOOGLE;
  requireImages: true;
  requireJsonOutput: true;
  requireStructuredOutput: true;
  taskType: typeof LISTING_DRAFT_ROUTE_TASK_TYPE;
} {
  return {
    freeTierOnly: true,
    provider: AI_PROVIDER_GOOGLE,
    requireImages: true,
    requireJsonOutput: true,
    requireStructuredOutput: true,
    taskType: LISTING_DRAFT_ROUTE_TASK_TYPE,
  };
}

function createListingDraftRouteNotFoundError(): AiModelRouteNotFoundError {
  return new AiModelRouteNotFoundError(buildListingDraftRouteResolutionInput());
}

function enrichGeminiJobError(
  error: SidecarJobError,
  routerError: GeminiFallbackExecutionError<ResolvedAiModelRoute>
): SidecarJobError {
  return new SidecarJobError(
    error.code,
    error.category,
    error.message,
    {
      ...error.context,
      attempt_count: routerError.attempts.length,
      attempted_models: routerError.attemptedModels,
      fallback_exhausted: routerError.fallbackExhausted,
      final_failure_code: error.code,
      final_fallback_kind: routerError.finalFallbackKind,
      final_failure_message: error.message,
    },
    { cause: error }
  );
}

async function persistGeminiAttemptAudit(
  dataAccess: SidecarDataAccess,
  jobId: string,
  audit: GeminiJobAttemptAuditUpdate,
  bestEffort = false
): Promise<boolean> {
  try {
    await dataAccess.jobs.updateGeminiAttemptAudit(jobId, audit);
    return true;
  } catch (error) {
    if (!bestEffort) {
      throw error;
    }

    return false;
  }
}

async function createAiModelAttemptRecord(
  dataAccess: SidecarDataAccess,
  input: Parameters<SidecarDataAccess['aiModelAttempts']['create']>[0],
  context: {
    jobId: string;
    listingId: string;
    modelName: string;
  },
  bestEffort = false
): Promise<AiModelAttemptRow | null> {
  try {
    return await dataAccess.aiModelAttempts.create(input);
  } catch (error) {
    if (!bestEffort) {
      throw error;
    }

    jobLogger.warn('Failed to create ai_model_attempts audit row.', {
      error: error instanceof Error ? error.message : String(error),
      jobId: context.jobId,
      listingId: context.listingId,
      modelName: context.modelName,
      phase: 'start',
    });

    return null;
  }
}

async function markAiModelAttemptRecordSucceeded(
  dataAccess: SidecarDataAccess,
  input: Parameters<SidecarDataAccess['aiModelAttempts']['markSucceeded']>[0],
  context: {
    jobId: string;
    listingId: string;
    modelName: string;
  },
  bestEffort = false
): Promise<void> {
  try {
    await dataAccess.aiModelAttempts.markSucceeded(input);
  } catch (error) {
    if (!bestEffort) {
      throw error;
    }

    jobLogger.warn('Failed to mark ai_model_attempts audit row succeeded.', {
      attemptId: input.id,
      error: error instanceof Error ? error.message : String(error),
      jobId: context.jobId,
      listingId: context.listingId,
      modelName: context.modelName,
      phase: 'succeeded',
    });
  }
}

async function markAiModelAttemptRecordFailed(
  dataAccess: SidecarDataAccess,
  input: Parameters<SidecarDataAccess['aiModelAttempts']['markFailed']>[0],
  context: {
    jobId: string;
    listingId: string;
    modelName: string;
  },
  bestEffort = false
): Promise<void> {
  try {
    await dataAccess.aiModelAttempts.markFailed(input);
  } catch (error) {
    if (!bestEffort) {
      throw error;
    }

    jobLogger.warn('Failed to mark ai_model_attempts audit row failed.', {
      attemptId: input.id,
      error: error instanceof Error ? error.message : String(error),
      jobId: context.jobId,
      listingId: context.listingId,
      modelName: context.modelName,
      phase: 'failed',
    });
  }
}

function createPreparedListingDraftFromGenerateFn(
  generateDraft: GenerateListingDraftFn
): PrepareListingDraftFn {
  return (input) =>
    Promise.resolve({
      diagnostics: {
        latency: {
          prepareDraftMs: 0,
        },
        payload: {
          imageCount: input.imageUrls.length,
        },
      },
      input,
      execute: async (options) => ({
        diagnostics: {
          payload: {
            imageCount: input.imageUrls.length,
          },
        },
        draft: await generateDraft(input, options),
      }),
    });
}

function buildAiModelAttemptMetadata(
  diagnostics: GenerateAiAttemptDiagnostics | undefined
): AiModelAttemptMetadata | undefined {
  if (!diagnostics) {
    return undefined;
  }

  const payload: AiModelAttemptMetadata = {
    imageCount: diagnostics.payload.imageCount,
    ...(diagnostics.payload.inlineImageBytesApprox !== undefined
      ? { inlineImageBytesApprox: diagnostics.payload.inlineImageBytesApprox }
      : {}),
    ...(diagnostics.payload.preparedImagePartCount !== undefined
      ? { preparedImagePartCount: diagnostics.payload.preparedImagePartCount }
      : {}),
    ...(diagnostics.payload.promptBytes !== undefined
      ? { promptBytes: diagnostics.payload.promptBytes }
      : {}),
  };

  return {
    ...(diagnostics.latency
      ? {
          latency: {
            ...(diagnostics.latency.modelMs !== undefined
              ? { modelMs: diagnostics.latency.modelMs }
              : {}),
            ...(diagnostics.latency.parseMs !== undefined
              ? { parseMs: diagnostics.latency.parseMs }
              : {}),
          },
        }
      : {}),
    payload,
  };
}

function getGenerateAiAttemptDiagnostics(error: unknown): GenerateAiAttemptDiagnostics | undefined {
  if (error instanceof GeminiDraftServiceError) {
    return error.diagnostics;
  }

  return undefined;
}

async function ensureJobRunning(
  dataAccess: SidecarDataAccess,
  job: JobRow,
  now: () => Date
): Promise<JobRow> {
  if (job.status === JOB_STATUS_RUNNING) {
    return job;
  }

  if (job.status === 'queued') {
    const claimedJob = await dataAccess.jobs.claimDueQueued(job.id, asIsoTimestamp(now));

    if (claimedJob) {
      return claimedJob;
    }

    throw new SidecarJobError(
      JOB_ERROR_CODES.JOB_NOT_CLAIMABLE,
      'terminal',
      `Job "${job.id}" is queued but could not be claimed for execution. It may not be due yet or another worker already claimed it.`
    );
  }

  throw new SidecarJobError(
    JOB_ERROR_CODES.JOB_NOT_RUNNABLE,
    'terminal',
    `Job "${job.id}" has status "${job.status}" and cannot be run.`
  );
}

async function getListingSafely(
  dataAccess: SidecarDataAccess,
  listingId: string
): Promise<ListingRow | null> {
  try {
    return await dataAccess.listings.getByListingId(listingId);
  } catch {
    return null;
  }
}

async function hasOtherPublishJobsForListing(
  dataAccess: SidecarDataAccess,
  listingId: string,
  currentJobId: string
): Promise<boolean> {
  const jobs = await dataAccess.jobs.listByListingId(listingId);

  return jobs.some(
    (candidateJob) => candidateJob.job_type === PUBLISH_JOB_TYPE && candidateJob.id !== currentJobId
  );
}

async function enqueueResearchPriceAfterGenerate(
  dataAccess: SidecarDataAccess,
  listing: ListingRow,
  pricingProviderEnv: ResearchPriceJobDependencies['pricingProviderEnv']
): Promise<void> {
  if (!isResearchPriceListingEligible(listing)) {
    return;
  }

  if (listing.auto_pricing_enabled === false) {
    jobLogger.info(
      'Skipped research_price enqueue after generate_ai because auto pricing is disabled.',
      {
        event: 'research_price_enqueue_skipped',
        listingId: listing.listing_id,
        reason: 'listing_auto_pricing_disabled',
      }
    );
    return;
  }

  if (!isSoldCompsRuntimeEnabled(pricingProviderEnv)) {
    jobLogger.info(
      'Skipped research_price enqueue after generate_ai because SoldComps runtime is disabled.',
      {
        event: 'research_price_enqueue_skipped',
        listingId: listing.listing_id,
        soldCompsEnabled: false,
      }
    );
    return;
  }

  let pricingProviderMode: ReturnType<typeof getPricingProviderMode> = 'soldcomps';

  try {
    const appSettings = await dataAccess.appSettings.get();
    pricingProviderMode = getPricingProviderMode(appSettings);
    if (pricingProviderMode !== 'soldcomps' || !isPricingEnabled(appSettings)) {
      jobLogger.info(
        'Skipped research_price enqueue after generate_ai because pricing provider mode is not soldcomps.',
        {
          event: 'research_price_enqueue_skipped',
          listingId: listing.listing_id,
          pricingProviderMode,
          settingsSource: appSettings ? 'app_settings' : 'default',
        }
      );
      return;
    }

    await dataAccess.jobs.enqueueResearchPrice(listing.listing_id);
  } catch (error) {
    jobLogger.warn('Failed to enqueue research_price after generate_ai success.', {
      error: error instanceof Error ? error.message : String(error),
      listingId: listing.listing_id,
      phase: 'post_generate_ai_enqueue',
      pricingProviderMode,
    });
  }
}

async function runGenerateAiJob(
  job: JobRow,
  options: Required<
    Pick<
      RunSidecarJobOptions,
      'dataAccess' | 'generateListingDraft' | 'now' | 'prepareListingDraft'
    >
  > & { pricingProviderEnv?: ResearchPriceJobDependencies['pricingProviderEnv'] }
): Promise<RunSidecarJobResult> {
  const listingId = asNonEmptyString(job.listing_id);
  const errorAt = asIsoTimestamp(options.now);

  if (!listingId) {
    const error = new SidecarJobError(
      JOB_ERROR_CODES.GENERATE_AI_MISSING_LISTING_ID,
      'terminal',
      `Job "${job.id}" is missing listing_id and cannot run generate_ai.`
    );
    const failedJob = await options.dataAccess.jobs.fail(
      job.id,
      toJobErrorUpdateInput(error, errorAt)
    );

    return {
      job: failedJob,
      listing: null,
    };
  }

  const listing = await options.dataAccess.listings.getByListingId(listingId);

  if (!listing) {
    const error = new SidecarJobError(
      JOB_ERROR_CODES.GENERATE_AI_LISTING_NOT_FOUND,
      'terminal',
      `Listing "${listingId}" was not found for generate_ai.`
    );
    const failedJob = await options.dataAccess.jobs.fail(
      job.id,
      toJobErrorUpdateInput(error, errorAt)
    );

    return {
      job: failedJob,
      listing: null,
    };
  }

  if (listing.status !== 'assets_ready') {
    const error = new SidecarJobError(
      JOB_ERROR_CODES.GENERATE_AI_LISTING_NOT_ELIGIBLE,
      'user_fixable',
      `Listing "${listingId}" is not eligible for generate_ai from status "${listing.status}".`
    );
    const failedJob = await options.dataAccess.jobs.fail(
      job.id,
      toJobErrorUpdateInput(error, errorAt)
    );

    return {
      job: failedJob,
      listing,
    };
  }

  const imageUrls = getListingImageUrls(listing);

  if (imageUrls.length === 0) {
    let listingError = new SidecarJobError(
      JOB_ERROR_CODES.GENERATE_AI_MISSING_IMAGE_URLS,
      'user_fixable',
      `Listing "${listingId}" does not have any image URLs for generate_ai.`
    );

    try {
      await options.dataAccess.listings.update(
        listingId,
        buildGenerateAiFailureUpdate(listingError, errorAt)
      );
    } catch (error) {
      listingError = new SidecarJobError(
        listingError.code,
        listingError.category,
        appendCleanupFailure(listingError.message, error),
        listingError.context,
        { cause: listingError }
      );
    }

    const failedJob = await options.dataAccess.jobs.fail(
      job.id,
      toJobErrorUpdateInput(listingError, errorAt)
    );

    return {
      job: failedJob,
      listing: await getListingSafely(options.dataAccess, listingId),
    };
  }

  const legacyAttempts: GeminiModelAttempt[] = [];
  const aiModelAttemptRows = new Map<number, AiModelAttemptRow>();
  const totalStartedAt = nowMs();

  try {
    const resolvedRoutes = await options.dataAccess.aiModelRoutes.resolveForTask(
      buildListingDraftRouteResolutionInput()
    );

    if (resolvedRoutes.length === 0) {
      throw createListingDraftRouteNotFoundError();
    }

    const userHints = buildUserHints(listing);
    const prepareDraftStartedAt = nowMs();
    const preparedDraft = await options.prepareListingDraft({
      imageUrls,
      listingId,
      userHints,
    });
    const prepareDraftMs =
      preparedDraft.diagnostics.latency.prepareDraftMs || elapsedMs(prepareDraftStartedAt);
    const payloadDiagnostics = preparedDraft.diagnostics.payload;

    jobLogger.info('Completed generate_ai draft preparation.', {
      event: 'generate_ai_prepare_completed',
      generateAiLatency: {
        prepareDraftMs,
      },
      generateAiPayload: payloadDiagnostics,
      jobId: job.id,
      listingId,
    });

    const routerResult =
      await generateListingDraftWithFallback<PreparedGenerateListingDraftExecutionResult>({
        executeRoute: async (route) => await preparedDraft.execute({ model: route.modelName }),
        incrementDailyUsage: async () => {
          await options.dataAccess.dailyUsage.incrementGeminiCallsUsed();
        },
        now: options.now,
        onAttemptFailed: async (attempt) => {
          const attemptError = classifyJobError(job.job_type, attempt.error);
          const aiAttemptContext = {
            jobId: job.id,
            listingId,
            modelName: attempt.route.modelName,
          };
          const failedAttempt: GeminiModelAttempt = {
            attempt_order: attempt.attemptOrder,
            completed_at: attempt.completedAt,
            duration_ms: attempt.durationMs,
            failure_code: attemptError.code,
            failure_message: summarizeGeminiAttemptFailureMessage(attemptError.message),
            model_name: attempt.route.modelName,
            started_at: attempt.startedAt,
            status: 'failed',
          };

          legacyAttempts[attempt.attemptOrder - 1] = failedAttempt;
          const attemptDiagnostics = getGenerateAiAttemptDiagnostics(attempt.error) ?? {
            payload: payloadDiagnostics,
          };

          const aiModelAttempt = aiModelAttemptRows.get(attempt.attemptOrder);
          if (aiModelAttempt) {
            await markAiModelAttemptRecordFailed(
              options.dataAccess,
              {
                duration_ms: attempt.durationMs,
                failure_code: attemptError.code,
                failure_message: summarizeGeminiAttemptFailureMessage(attemptError.message),
                finished_at: attempt.completedAt,
                id: aiModelAttempt.id,
                metadata: buildAiModelAttemptMetadata(attemptDiagnostics),
              },
              aiAttemptContext,
              true
            );
          }

          await persistGeminiAttemptAudit(
            options.dataAccess,
            job.id,
            {
              gemini_attempt_count: legacyAttempts.length,
              gemini_attempts: [...legacyAttempts],
              gemini_selected_model: null,
            },
            true
          );

          jobLogger.info('Completed generate_ai model attempt.', {
            event: 'generate_ai_model_attempt_completed',
            failureCode: attemptError.code,
            generateAiLatency: attemptDiagnostics.latency,
            generateAiPayload: attemptDiagnostics.payload,
            jobId: job.id,
            listingId,
            modelName: attempt.route.modelName,
            status: 'failed',
            willFallback: attempt.willFallback,
          });
        },
        onAttemptStarted: async (attempt) => {
          const startedAttempt: GeminiModelAttempt = {
            attempt_order: attempt.attemptOrder,
            completed_at: null,
            duration_ms: null,
            failure_code: null,
            failure_message: null,
            model_name: attempt.route.modelName,
            started_at: attempt.startedAt,
            status: 'started',
          };
          const aiAttemptContext = {
            jobId: job.id,
            listingId,
            modelName: attempt.route.modelName,
          };

          if (attempt.attemptOrder === 1) {
            await options.dataAccess.listings.updateWorkflowState({
              listingId,
              status: 'generating',
              subStatus: 'ai_call_in_progress',
            });
          }

          legacyAttempts.push(startedAttempt);
          await persistGeminiAttemptAudit(
            options.dataAccess,
            job.id,
            {
              gemini_attempt_count: legacyAttempts.length,
              gemini_attempts: [...legacyAttempts],
              gemini_selected_model: null,
            },
            true
          );

          const aiModelAttempt = await createAiModelAttemptRecord(
            options.dataAccess,
            {
              attempt_order: attempt.attemptOrder,
              job_id: job.id,
              listing_id: listingId,
              model_name: attempt.route.modelName,
              metadata: buildAiModelAttemptMetadata({
                payload: payloadDiagnostics,
              }),
              provider: AI_PROVIDER_GOOGLE,
              provider_model_id: attempt.route.modelName,
              routing_source: AI_ROUTING_SOURCE_DIRECT_GEMINI,
              started_at: attempt.startedAt,
              status: 'started',
            },
            aiAttemptContext,
            true
          );

          if (aiModelAttempt) {
            aiModelAttemptRows.set(attempt.attemptOrder, aiModelAttempt);
          }
        },
        onAttemptSucceeded: async (attempt) => {
          const aiAttemptContext = {
            jobId: job.id,
            listingId,
            modelName: attempt.route.modelName,
          };
          const succeededAttempt: GeminiModelAttempt = {
            attempt_order: attempt.attemptOrder,
            completed_at: attempt.completedAt,
            duration_ms: attempt.durationMs,
            failure_code: null,
            failure_message: null,
            model_name: attempt.route.modelName,
            started_at: attempt.startedAt,
            status: 'succeeded',
          };

          legacyAttempts[attempt.attemptOrder - 1] = succeededAttempt;
          const attemptDiagnostics = attempt.draft.diagnostics;

          const aiModelAttempt = aiModelAttemptRows.get(attempt.attemptOrder);
          if (aiModelAttempt) {
            await markAiModelAttemptRecordSucceeded(
              options.dataAccess,
              {
                duration_ms: attempt.durationMs,
                finished_at: attempt.completedAt,
                id: aiModelAttempt.id,
                metadata: buildAiModelAttemptMetadata(attemptDiagnostics),
              },
              aiAttemptContext,
              true
            );
          }

          await persistGeminiAttemptAudit(
            options.dataAccess,
            job.id,
            {
              gemini_attempt_count: legacyAttempts.length,
              gemini_attempts: [...legacyAttempts],
              gemini_selected_model: attempt.route.modelName,
            },
            true
          );

          jobLogger.info('Completed generate_ai model attempt.', {
            event: 'generate_ai_model_attempt_completed',
            generateAiLatency: attemptDiagnostics.latency,
            generateAiPayload: attemptDiagnostics.payload,
            jobId: job.id,
            listingId,
            modelName: attempt.route.modelName,
            status: 'succeeded',
            willFallback: false,
          });
        },
        routes: resolvedRoutes,
      });

    const listingUpdateStartedAt = nowMs();
    const reviewListing = await options.dataAccess.listings.update(
      listingId,
      buildGeneratedListingReviewUpdate(listing, routerResult.draft.draft, userHints?.explicitYear)
    );
    const listingUpdateMs = elapsedMs(listingUpdateStartedAt);
    const enqueueResearchPriceStartedAt = nowMs();
    await enqueueResearchPriceAfterGenerate(
      options.dataAccess,
      reviewListing,
      options.pricingProviderEnv
    );
    const enqueueResearchPriceMs = elapsedMs(enqueueResearchPriceStartedAt);
    const completedJob = await options.dataAccess.jobs.complete(job.id);

    const generateAiLatency: GenerateAiLatencyDiagnostics = {
      enqueueResearchPriceMs,
      listingUpdateMs,
      modelMs: routerResult.draft.diagnostics.latency?.modelMs,
      parseMs: routerResult.draft.diagnostics.latency?.parseMs,
      prepareDraftMs,
      totalMs: elapsedMs(totalStartedAt),
    };

    jobLogger.info('Completed generate_ai successfully.', {
      event: 'generate_ai_succeeded',
      generateAiLatency,
      generateAiPayload: routerResult.draft.diagnostics.payload,
      jobId: job.id,
      listingId,
      selectedModel: routerResult.selectedRoute.modelName,
    });

    return {
      job: completedJob,
      listing: reviewListing,
    };
  } catch (error) {
    let jobError =
      error instanceof GeminiFallbackExecutionError
        ? enrichGeminiJobError(
            classifyJobError(job.job_type, error.finalError),
            error as GeminiFallbackExecutionError<ResolvedAiModelRoute>
          )
        : classifyJobError(job.job_type, error);

    try {
      await options.dataAccess.listings.update(
        listingId,
        buildGenerateAiFailureUpdate(jobError, errorAt)
      );
    } catch (cleanupError) {
      jobError = new SidecarJobError(
        jobError.code,
        jobError.category,
        appendCleanupFailure(jobError.message, cleanupError),
        jobError.context,
        { cause: jobError }
      );
    }

    if (jobError.category === 'recoverable' && hasAttemptsRemaining(job)) {
      const requeuedJob = await options.dataAccess.jobs.requeue(
        job.id,
        toJobErrorUpdateInput(jobError, errorAt),
        getNextRetryAt(job.attempts, options.now())
      );

      return {
        job: requeuedJob,
        listing: await getListingSafely(options.dataAccess, listingId),
      };
    }

    const finalError =
      jobError.category === 'recoverable' ? createRetryExhaustedError(job, jobError) : jobError;
    const failedJob = await options.dataAccess.jobs.fail(
      job.id,
      toJobErrorUpdateInput(finalError, errorAt)
    );

    return {
      job: failedJob,
      listing: await getListingSafely(options.dataAccess, listingId),
    };
  }
}

function buildAssetPrepSummary(result: PrepareRecordCreatedListingsResult): AssetPrepSummary {
  return {
    exhaustedCandidates: result.exhaustedCandidates,
    failedCount: result.failed.length,
    processedCount: result.processed.length,
    skippedCount: result.skipped.length,
  };
}

async function runProcessImagesJob(
  job: JobRow,
  options: Required<
    Pick<RunSidecarJobOptions, 'dataAccess' | 'now' | 'prepareRecordCreatedListings'>
  >
): Promise<RunSidecarJobResult> {
  const errorAt = asIsoTimestamp(options.now);

  try {
    const result = await options.prepareRecordCreatedListings({
      dataAccess: options.dataAccess,
      now: options.now,
    });
    const completedJob = await options.dataAccess.jobs.complete(job.id);

    try {
      const attemptedListingIds = [
        ...result.processed.map((listing) => listing.listing_id),
        ...result.failed.map((failure) => failure.listingId),
      ];
      const shouldEnqueueFollowUp = await hasActionableRecordCreatedListings({
        dataAccess: options.dataAccess,
        excludeListingIds: attemptedListingIds,
      });

      if (shouldEnqueueFollowUp) {
        await options.dataAccess.jobs.enqueueProcessImages();
      }
    } catch (error) {
      jobLogger.warn('Failed to enqueue follow-up process_images job after completion.', {
        compactErrorMessage: error instanceof Error ? error.message : String(error),
        event: 'process_images_followup_enqueue_failed',
        jobId: job.id,
      });
    }

    return {
      assetPrepSummary: buildAssetPrepSummary(result),
      job: completedJob,
      listing: null,
      processedListings: result.processed,
    };
  } catch (error) {
    const jobError = classifyJobError(job.job_type, error);

    if (jobError.category === 'recoverable' && hasAttemptsRemaining(job)) {
      const requeuedJob = await options.dataAccess.jobs.requeue(
        job.id,
        toJobErrorUpdateInput(jobError, errorAt),
        getNextRetryAt(job.attempts, options.now())
      );

      return {
        job: requeuedJob,
        listing: null,
      };
    }

    const finalError =
      jobError.category === 'recoverable' ? createRetryExhaustedError(job, jobError) : jobError;
    const failedJob = await options.dataAccess.jobs.fail(
      job.id,
      toJobErrorUpdateInput(finalError, errorAt)
    );

    return {
      job: failedJob,
      listing: null,
    };
  }
}

async function runPublishJob(
  job: JobRow,
  options: Required<Pick<RunSidecarJobOptions, 'dataAccess' | 'now' | 'publishListing'>>
): Promise<RunSidecarJobResult> {
  const listingId = asNonEmptyString(job.listing_id);
  const errorAt = asIsoTimestamp(options.now);

  if (!listingId) {
    const error = new SidecarJobError(
      JOB_ERROR_CODES.PUBLISH_MISSING_LISTING_ID,
      'terminal',
      `Job "${job.id}" is missing listing_id and cannot run publish.`
    );
    const failedJob = await options.dataAccess.jobs.fail(
      job.id,
      toJobErrorUpdateInput(error, errorAt)
    );

    return {
      job: failedJob,
      listing: null,
    };
  }

  const listing = await options.dataAccess.listings.getByListingId(listingId);

  if (!listing) {
    const error = new SidecarJobError(
      JOB_ERROR_CODES.PUBLISH_LISTING_NOT_FOUND,
      'terminal',
      `Listing "${listingId}" was not found for publish.`
    );
    const failedJob = await options.dataAccess.jobs.fail(
      job.id,
      toJobErrorUpdateInput(error, errorAt)
    );

    return {
      job: failedJob,
      listing: null,
    };
  }

  if (listing.status !== 'approved_for_export') {
    const error = new SidecarJobError(
      JOB_ERROR_CODES.PUBLISH_LISTING_NOT_ELIGIBLE,
      'user_fixable',
      `Listing "${listingId}" is not eligible for publish from status "${listing.status}".`
    );

    await options.dataAccess.listings.update(
      listingId,
      buildPublishFailureUpdate(error, errorAt, 'idle')
    );

    const failedJob = await options.dataAccess.jobs.fail(
      job.id,
      toJobErrorUpdateInput(error, errorAt)
    );

    return {
      job: failedJob,
      listing: await getListingSafely(options.dataAccess, listingId),
    };
  }

  if (listing.sub_status === 'idle') {
    const hasOtherPublishJobs = await hasOtherPublishJobsForListing(
      options.dataAccess,
      listingId,
      job.id
    );

    if (hasOtherPublishJobs) {
      const error = new SidecarJobError(
        JOB_ERROR_CODES.JOB_NOT_RUNNABLE,
        'terminal',
        `Publish job "${job.id}" is stale for listing "${listingId}" because another publish job already resolved the listing to approved_for_export/idle.`
      );
      const failedJob = await options.dataAccess.jobs.fail(
        job.id,
        toJobErrorUpdateInput(error, errorAt)
      );

      return {
        job: failedJob,
        listing,
      };
    }
  }

  if (listing.sub_status !== 'publish_queued' && listing.sub_status !== 'publishing_to_ebay') {
    const error = new SidecarJobError(
      JOB_ERROR_CODES.PUBLISH_LISTING_NOT_ELIGIBLE,
      'user_fixable',
      `Listing "${listingId}" is not eligible for publish from sub_status "${listing.sub_status}".`
    );

    await options.dataAccess.listings.update(
      listingId,
      buildPublishFailureUpdate(error, errorAt, 'idle')
    );

    const failedJob = await options.dataAccess.jobs.fail(
      job.id,
      toJobErrorUpdateInput(error, errorAt)
    );

    return {
      job: failedJob,
      listing: await getListingSafely(options.dataAccess, listingId),
    };
  }

  if (listing.sub_status === 'publish_queued') {
    const claimedListing = await options.dataAccess.listings.claimApprovedForPublish(listingId);

    if (!claimedListing) {
      const error = new SidecarJobError(
        JOB_ERROR_CODES.PUBLISH_LISTING_NOT_ELIGIBLE,
        'user_fixable',
        `Listing "${listingId}" could not be claimed for publish.`
      );
      const failedJob = await options.dataAccess.jobs.fail(
        job.id,
        toJobErrorUpdateInput(error, errorAt)
      );

      return {
        job: failedJob,
        listing: await getListingSafely(options.dataAccess, listingId),
      };
    }
  }

  try {
    await options.publishListing(listingId, {
      dataAccess: options.dataAccess,
      now: options.now,
    });
    const completedJob = await options.dataAccess.jobs.complete(job.id);

    return {
      job: completedJob,
      listing: await getListingSafely(options.dataAccess, listingId),
    };
  } catch (error) {
    const classifiedError = classifyJobError(job.job_type, error);
    const shouldRetry = classifiedError.category === 'recoverable' && hasAttemptsRemaining(job);
    let finalError = shouldRetry
      ? classifiedError
      : classifiedError.category === 'recoverable'
        ? createRetryExhaustedError(job, classifiedError)
        : classifiedError;

    try {
      await options.dataAccess.listings.update(
        listingId,
        buildPublishFailureUpdate(finalError, errorAt, shouldRetry ? 'publish_queued' : 'idle')
      );
    } catch (cleanupError) {
      finalError = new SidecarJobError(
        finalError.code,
        finalError.category,
        appendCleanupFailure(finalError.message, cleanupError),
        finalError.context,
        { cause: finalError }
      );
    }

    if (shouldRetry) {
      const requeuedJob = await options.dataAccess.jobs.requeue(
        job.id,
        toJobErrorUpdateInput(finalError, errorAt),
        getNextRetryAt(job.attempts, options.now())
      );

      return {
        job: requeuedJob,
        listing: await getListingSafely(options.dataAccess, listingId),
      };
    }

    const failedJob = await options.dataAccess.jobs.fail(
      job.id,
      toJobErrorUpdateInput(finalError, errorAt)
    );

    return {
      job: failedJob,
      listing: await getListingSafely(options.dataAccess, listingId),
    };
  }
}

export async function runSidecarJob(
  jobId: string,
  options: RunSidecarJobOptions = {}
): Promise<RunSidecarJobResult> {
  const dataAccess = options.dataAccess ?? getSidecarDataAccess();
  const runGenerateDraft = options.generateListingDraft ?? generateListingDraft;
  const prepareListingDraft =
    options.prepareListingDraft ??
    (options.generateListingDraft
      ? createPreparedListingDraftFromGenerateFn(runGenerateDraft)
      : prepareGenerateListingDraft);
  const runPublishListing = options.publishListing ?? publishApprovedListing;
  const runPrepareRecordCreatedListings =
    options.prepareRecordCreatedListings ?? prepareRecordCreatedListings;
  const now = options.now ?? (() => new Date());
  const job = await dataAccess.jobs.getById(jobId);

  if (!job) {
    throw new SidecarJobError(
      JOB_ERROR_CODES.JOB_NOT_FOUND,
      'terminal',
      `Job "${jobId}" was not found.`
    );
  }

  const runnableJob = await ensureJobRunning(dataAccess, job, now);

  switch (runnableJob.job_type) {
    case GENERATE_AI_JOB_TYPE:
      return await runGenerateAiJob(runnableJob, {
        dataAccess,
        generateListingDraft: runGenerateDraft,
        now,
        prepareListingDraft,
        pricingProviderEnv: options.researchPrice?.pricingProviderEnv,
      });
    case PUBLISH_JOB_TYPE:
      return await runPublishJob(runnableJob, {
        dataAccess,
        now,
        publishListing: runPublishListing,
      });
    case PROCESS_IMAGES_JOB_TYPE:
      return await runProcessImagesJob(runnableJob, {
        dataAccess,
        now,
        prepareRecordCreatedListings: runPrepareRecordCreatedListings,
      });
    case RESEARCH_PRICE_JOB_TYPE: {
      const runtimePricingAnalyst =
        options.researchPrice?.pricingAnalyst ??
        createProductionPricingAnalyst({
          dataAccess,
          now,
        });

      return await runResearchPriceJob(runnableJob, {
        ...options.researchPrice,
        dataAccess,
        now,
        pricingAnalyst: runtimePricingAnalyst,
      });
    }
    default: {
      const errorAt = asIsoTimestamp(now);
      const error = new SidecarJobError(
        JOB_ERROR_CODES.UNSUPPORTED_JOB_TYPE,
        'terminal',
        `Job "${runnableJob.id}" has unsupported type "${runnableJob.job_type}".`
      );
      const failedJob = await dataAccess.jobs.fail(
        runnableJob.id,
        toJobErrorUpdateInput(error, errorAt)
      );

      return {
        job: failedJob,
        listing: null,
      };
    }
  }
}

import {
  approveListingForExport,
  createAiModelAttempt,
  resolveAiModelRoutesForTask,
  resolvePrimaryAiModelRouteForTask,
  getLatestGeminiUsageAttempt,
  listAiModelAttemptsForListing,
  listAiModelAttemptsForListings,
  markAiModelAttemptFailed,
  markAiModelAttemptSucceeded,
  claimApprovedListingForPublish,
  claimDueQueuedJob,
  completeJob,
  DEFAULT_APP_SETTINGS_ID,
  createAppSettings,
  createJob,
  createListingPriceResearch,
  createListing,
  createOrder,
  enqueueGenerateAiJob,
  enqueueProcessImagesJob,
  enqueuePublishJob,
  enqueueResearchPriceJob,
  failJob,
  getEffectiveGeminiDailyLimit,
  getEffectiveOrderSyncDailyLimit,
  getGeminiDailyUsageSummary,
  createSupabaseServiceClient,
  getAppSettings,
  getActiveGenerateAiJobByListingId,
  getJobById,
  getOrCreateDailyUsage,
  getListingByOfferId,
  getListingByListingId,
  getOrderByOrderId,
  incrementGeminiCallsUsed,
  incrementOrderSyncCount,
  listApprovedForExportListings,
  listDueQueuedJobs,
  listJobsByListingId,
  listJobsByListingIds,
  listStaleRunningJobs,
  listListings,
  listListingsByStatus,
  markListingPriceResearchFailed,
  markListingPriceResearchSucceeded,
  prepareListingForGenerateAi,
  markListingPublishFailed,
  resetJobForManualRetry,
  requeueJob,
  saveListingImageMetadata,
  setGeminiJobAttemptAudit,
  updateAppSettings,
  updateJob,
  updateListing,
  updateListingWorkflowState,
  updateOrder,
  type AppSettingsInsert,
  type AppSettingsRow,
  type AppSettingsUpdate,
  type AiModelAttemptRow,
  type GeminiUsageLastAttempt,
  type ResolveAiModelRoutesInput,
  type ResolvedAiModelRoute,
  type CreateAiModelAttemptInput,
  type DailyUsageIncrementResult,
  type DailyUsageLimitResolution,
  type GeminiDailyUsageSummary,
  type EnqueueGenerateAiJobResult,
  type EnqueueProcessImagesJobResult,
  type EnqueuePublishJobResult,
  type EnqueueResearchPriceJobResult,
  type GeminiJobAttemptAuditUpdate,
  type JobInsert,
  type JobErrorUpdateInput,
  type JobRow,
  type JobUpdate,
  type ListApprovedForExportListingsOptions,
  type ListDueQueuedJobsOptions,
  type ListListingsByStatusOptions,
  type ListingPriceResearchInsert,
  type ListingPriceResearchRow,
  type ListingInsert,
  type ListingImageMetadataUpdate,
  type ListingRow,
  type ListingUpdate,
  type ListingWorkflowTransitionInput,
  type MarkAiModelAttemptFailedInput,
  type MarkAiModelAttemptSucceededInput,
  type OrderInsert,
  type OrderRow,
  type OrderUpdate,
} from '@ebay-inventory/data';

export interface SidecarDataAccess {
  aiModelRoutes: {
    resolveForTask(input: ResolveAiModelRoutesInput): Promise<ResolvedAiModelRoute[]>;
    resolvePrimaryForTask(input: ResolveAiModelRoutesInput): Promise<ResolvedAiModelRoute>;
  };
  aiModelAttempts: {
    create(input: CreateAiModelAttemptInput): Promise<AiModelAttemptRow>;
    getLatestGeminiUsageAttempt(): Promise<GeminiUsageLastAttempt | null>;
    listByListingId(listingId: string): Promise<AiModelAttemptRow[]>;
    listByListingIds(listingIds: string[]): Promise<AiModelAttemptRow[]>;
    markFailed(input: MarkAiModelAttemptFailedInput): Promise<AiModelAttemptRow>;
    markSucceeded(input: MarkAiModelAttemptSucceededInput): Promise<AiModelAttemptRow>;
  };
  appSettings: {
    create(input: AppSettingsInsert): Promise<AppSettingsRow>;
    get(id?: string): Promise<AppSettingsRow | null>;
    update(changes: AppSettingsUpdate, id?: string): Promise<AppSettingsRow>;
  };
  dailyUsage: {
    getEffectiveGeminiLimit(usageDate?: string): Promise<DailyUsageLimitResolution>;
    getEffectiveOrderSyncLimit(usageDate?: string): Promise<DailyUsageLimitResolution>;
    getGeminiSummary(now?: Date): Promise<GeminiDailyUsageSummary>;
    getOrCreate(usageDate?: string): Promise<DailyUsageLimitResolution['usage']>;
    incrementGeminiCallsUsed(usageDate?: string): Promise<DailyUsageIncrementResult>;
    incrementOrderSyncCount(usageDate?: string): Promise<DailyUsageIncrementResult>;
  };
  jobs: {
    claimDueQueued(jobId: string, now: string): Promise<JobRow | null>;
    complete(jobId: string): Promise<JobRow>;
    create(input: JobInsert): Promise<JobRow>;
    enqueueGenerateAi(listingId: string): Promise<EnqueueGenerateAiJobResult>;
    enqueueProcessImages(): Promise<EnqueueProcessImagesJobResult>;
    enqueuePublish(listingId: string): Promise<EnqueuePublishJobResult>;
    enqueueResearchPrice(listingId: string): Promise<EnqueueResearchPriceJobResult>;
    fail(jobId: string, error: JobErrorUpdateInput): Promise<JobRow>;
    getActiveGenerateAiByListingId(listingId: string): Promise<JobRow | null>;
    getById(jobId: string): Promise<JobRow | null>;
    listDueQueued(now: string, options?: ListDueQueuedJobsOptions): Promise<JobRow[]>;
    listByListingId(listingId: string): Promise<JobRow[]>;
    listByListingIds?(listingIds: string[]): Promise<JobRow[]>;
    listStaleRunning(cutoff: string): Promise<JobRow[]>;
    resetForManualRetry(jobId: string, now: string): Promise<JobRow | null>;
    requeue(jobId: string, error: JobErrorUpdateInput, nextRunAt: string): Promise<JobRow>;
    updateGeminiAttemptAudit(
      jobId: string,
      audit: GeminiJobAttemptAuditUpdate
    ): Promise<JobRow>;
    update(jobId: string, changes: JobUpdate): Promise<JobRow>;
  };
  listings: {
    approveForExport(listingId: string): Promise<ListingRow>;
    claimApprovedForPublish(listingId: string): Promise<ListingRow | null>;
    create(input: ListingInsert): Promise<ListingRow>;
    getByOfferId(offerId: string): Promise<ListingRow | null>;
    getByListingId(listingId: string): Promise<ListingRow | null>;
    listApprovedForExport(options: ListApprovedForExportListingsOptions): Promise<ListingRow[]>;
    list(): Promise<ListingRow[]>;
    listByStatus(
      status: ListingRow['status'],
      options: ListListingsByStatusOptions
    ): Promise<ListingRow[]>;
    markPublishFailed(listingId: string, errorAt: string, error: unknown): Promise<ListingRow>;
    prepareForGenerateAi(input: {
      expectedUpdatedAt?: string;
      listingId: string;
      sellerHints?: ListingUpdate['seller_hints'];
    }): Promise<ListingRow | null>;
    saveImageMetadata(input: ListingImageMetadataUpdate): Promise<ListingRow | null>;
    update(listingId: string, changes: ListingUpdate): Promise<ListingRow>;
    updateWorkflowState(input: ListingWorkflowTransitionInput): Promise<ListingRow>;
  };
  listingPriceResearch: {
    create(input: ListingPriceResearchInsert): Promise<ListingPriceResearchRow>;
    markFailed(
      input: Parameters<typeof markListingPriceResearchFailed>[1]
    ): Promise<ListingPriceResearchRow>;
    markSucceeded(
      input: Parameters<typeof markListingPriceResearchSucceeded>[1]
    ): Promise<ListingPriceResearchRow>;
  };
  orders: {
    create(input: OrderInsert): Promise<OrderRow>;
    getByOrderId(orderId: string): Promise<OrderRow | null>;
    update(orderId: string, changes: OrderUpdate): Promise<OrderRow>;
  };
}

let cachedSidecarDataAccess: SidecarDataAccess | undefined;

export function createSidecarDataAccess(env: NodeJS.ProcessEnv = process.env): SidecarDataAccess {
  const client = createSupabaseServiceClient(env);

  return {
    aiModelRoutes: {
      resolveForTask: async (input) => await resolveAiModelRoutesForTask(client, input),
      resolvePrimaryForTask: async (input) =>
        await resolvePrimaryAiModelRouteForTask(client, input),
    },
    dailyUsage: {
      getEffectiveGeminiLimit: async (usageDate) =>
        await getEffectiveGeminiDailyLimit(client, usageDate),
      getEffectiveOrderSyncLimit: async (usageDate) =>
        await getEffectiveOrderSyncDailyLimit(client, usageDate),
      getGeminiSummary: async (now) => await getGeminiDailyUsageSummary(client, now),
      getOrCreate: async (usageDate) => await getOrCreateDailyUsage(client, usageDate),
      incrementGeminiCallsUsed: async (usageDate) =>
        await incrementGeminiCallsUsed(client, usageDate),
      incrementOrderSyncCount: async (usageDate) =>
        await incrementOrderSyncCount(client, usageDate),
    },
    aiModelAttempts: {
      create: async (input) => await createAiModelAttempt(client, input),
      getLatestGeminiUsageAttempt: async () => await getLatestGeminiUsageAttempt(client),
      listByListingId: async (listingId) => await listAiModelAttemptsForListing(client, listingId),
      listByListingIds: async (listingIds) =>
        await listAiModelAttemptsForListings(client, listingIds),
      markFailed: async (input) => await markAiModelAttemptFailed(client, input),
      markSucceeded: async (input) => await markAiModelAttemptSucceeded(client, input),
    },
    listings: {
      approveForExport: async (listingId) => await approveListingForExport(client, listingId),
      claimApprovedForPublish: async (listingId) =>
        await claimApprovedListingForPublish(client, listingId),
      create: async (input) => await createListing(client, input),
      getByOfferId: async (offerId) => await getListingByOfferId(client, offerId),
      getByListingId: async (listingId) => await getListingByListingId(client, listingId),
      listApprovedForExport: async (options) =>
        await listApprovedForExportListings(client, options),
      list: async () => await listListings(client),
      listByStatus: async (status, options) => await listListingsByStatus(client, status, options),
      markPublishFailed: async (listingId, errorAt, error) =>
        await markListingPublishFailed(client, listingId, errorAt, error),
      prepareForGenerateAi: async (input) => await prepareListingForGenerateAi(client, input),
      saveImageMetadata: async (input) => await saveListingImageMetadata(client, input),
      update: async (listingId, changes) => await updateListing(client, listingId, changes),
      updateWorkflowState: async (input) => await updateListingWorkflowState(client, input),
    },
    listingPriceResearch: {
      create: async (input) => await createListingPriceResearch(client, input),
      markFailed: async (input) => await markListingPriceResearchFailed(client, input),
      markSucceeded: async (input) => await markListingPriceResearchSucceeded(client, input),
    },
    jobs: {
      claimDueQueued: async (jobId, now) => await claimDueQueuedJob(client, jobId, now),
      complete: async (jobId) => await completeJob(client, jobId),
      create: async (input) => await createJob(client, input),
      enqueueGenerateAi: async (listingId) => await enqueueGenerateAiJob(client, listingId),
      enqueueProcessImages: async () => await enqueueProcessImagesJob(client),
      enqueuePublish: async (listingId) => await enqueuePublishJob(client, listingId),
      enqueueResearchPrice: async (listingId) => await enqueueResearchPriceJob(client, listingId),
      fail: async (jobId, error) => await failJob(client, jobId, error),
      getActiveGenerateAiByListingId: async (listingId) =>
        await getActiveGenerateAiJobByListingId(client, listingId),
      getById: async (jobId) => await getJobById(client, jobId),
      listDueQueued: async (now, options) => await listDueQueuedJobs(client, now, options),
      listByListingId: async (listingId) => await listJobsByListingId(client, listingId),
      listByListingIds: async (listingIds) => await listJobsByListingIds(client, listingIds),
      listStaleRunning: async (cutoff) => await listStaleRunningJobs(client, cutoff),
      resetForManualRetry: async (jobId, now) => await resetJobForManualRetry(client, jobId, now),
      requeue: async (jobId, error, nextRunAt) => await requeueJob(client, jobId, error, nextRunAt),
      updateGeminiAttemptAudit: async (jobId, audit) =>
        await setGeminiJobAttemptAudit(client, jobId, audit),
      update: async (jobId, changes) => await updateJob(client, jobId, changes),
    },
    orders: {
      create: async (input) => await createOrder(client, input),
      getByOrderId: async (orderId) => await getOrderByOrderId(client, orderId),
      update: async (orderId, changes) => await updateOrder(client, orderId, changes),
    },
    appSettings: {
      create: async (input) => await createAppSettings(client, input),
      get: async (id = DEFAULT_APP_SETTINGS_ID) => await getAppSettings(client, id),
      update: async (changes, id) => await updateAppSettings(client, changes, id),
    },
  };
}

export function getSidecarDataAccess(): SidecarDataAccess {
  cachedSidecarDataAccess ??= createSidecarDataAccess();
  return cachedSidecarDataAccess;
}

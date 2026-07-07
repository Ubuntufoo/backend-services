import {
  approveListingForExport,
  createAiModelAttempt,
  resolveAiModelRoutesForTask,
  getLatestGeminiUsageAttempt,
  markAiModelAttemptFailed,
  markAiModelAttemptSucceeded,
  claimApprovedListingForPublish,
  claimDueQueuedJob,
  completeJob,
  DEFAULT_APP_SETTINGS_ID,
  createAppSettings,
  createListingPriceResearch,
  dismissListingPriceResearchPricingWarnings,
  createListing,
  enqueueGenerateAiJob,
  enqueuePublishJob,
  enqueueResearchPriceJob,
  failJob,
  getGeminiDailyUsageSummary,
  createSupabaseServiceClient,
  getAppSettings,
  getActiveResearchPriceJobByListingId,
  getJobById,
  getLatestListingPriceResearchByListingId,
  listLatestListingPriceResearchByListingIds,
  getListingByOfferId,
  getListingByListingId,
  incrementGeminiCallsUsed,
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
  resetJobForManualRetry,
  requeueJob,
  saveListingImageMetadata,
  setGeminiJobAttemptAudit,
  updateAppSettings,
  updateJob,
  updateListing,
  updateListingWorkflowState,
  type AppSettingsInsert,
  type AppSettingsRow,
  type AppSettingsUpdate,
  type AiModelAttemptRow,
  type GeminiUsageLastAttempt,
  type ResolveAiModelRoutesInput,
  type ResolvedAiModelRoute,
  type CreateAiModelAttemptInput,
  type DailyUsageIncrementResult,
  type GeminiDailyUsageSummary,
  type EnqueueGenerateAiJobResult,
  type EnqueuePublishJobResult,
  type EnqueueResearchPriceJobResult,
  type GeminiJobAttemptAuditUpdate,
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
} from '@ebay-inventory/data';

export interface SidecarDataAccess {
  aiModelRoutes: {
    resolveForTask(input: ResolveAiModelRoutesInput): Promise<ResolvedAiModelRoute[]>;
  };
  aiModelAttempts: {
    create(input: CreateAiModelAttemptInput): Promise<AiModelAttemptRow>;
    getLatestGeminiUsageAttempt(): Promise<GeminiUsageLastAttempt | null>;
    markFailed(input: MarkAiModelAttemptFailedInput): Promise<AiModelAttemptRow>;
    markSucceeded(input: MarkAiModelAttemptSucceededInput): Promise<AiModelAttemptRow>;
  };
  appSettings: {
    create(input: AppSettingsInsert): Promise<AppSettingsRow>;
    get(id?: string): Promise<AppSettingsRow | null>;
    update(changes: AppSettingsUpdate, id?: string): Promise<AppSettingsRow>;
  };
  dailyUsage: {
    getGeminiSummary(now?: Date): Promise<GeminiDailyUsageSummary>;
    incrementGeminiCallsUsed(usageDate?: string): Promise<DailyUsageIncrementResult>;
  };
  jobs: {
    claimDueQueued(jobId: string, now: string): Promise<JobRow | null>;
    complete(jobId: string): Promise<JobRow>;
    enqueueGenerateAi(listingId: string): Promise<EnqueueGenerateAiJobResult>;
    enqueuePublish(listingId: string): Promise<EnqueuePublishJobResult>;
    enqueueResearchPrice(listingId: string): Promise<EnqueueResearchPriceJobResult>;
    fail(jobId: string, error: JobErrorUpdateInput): Promise<JobRow>;
    getActiveResearchPriceByListingId(listingId: string): Promise<JobRow | null>;
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
    dismissPricingWarnings(
      input: Parameters<typeof dismissListingPriceResearchPricingWarnings>[1]
    ): Promise<ListingPriceResearchRow>;
    getLatestByListingId(listingId: string): Promise<ListingPriceResearchRow | null>;
    listLatestByListingIds(listingIds: string[]): Promise<ListingPriceResearchRow[]>;
    markFailed(
      input: Parameters<typeof markListingPriceResearchFailed>[1]
    ): Promise<ListingPriceResearchRow>;
    markSucceeded(
      input: Parameters<typeof markListingPriceResearchSucceeded>[1]
    ): Promise<ListingPriceResearchRow>;
  };
}

let cachedSidecarDataAccess: SidecarDataAccess | undefined;

export function createSidecarDataAccess(env: NodeJS.ProcessEnv = process.env): SidecarDataAccess {
  const client = createSupabaseServiceClient(env);

  return {
    aiModelRoutes: {
      resolveForTask: async (input) => await resolveAiModelRoutesForTask(client, input),
    },
    dailyUsage: {
      getGeminiSummary: async (now) => await getGeminiDailyUsageSummary(client, now),
      incrementGeminiCallsUsed: async (usageDate) =>
        await incrementGeminiCallsUsed(client, usageDate),
    },
    aiModelAttempts: {
      create: async (input) => await createAiModelAttempt(client, input),
      getLatestGeminiUsageAttempt: async () => await getLatestGeminiUsageAttempt(client),
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
      prepareForGenerateAi: async (input) => await prepareListingForGenerateAi(client, input),
      saveImageMetadata: async (input) => await saveListingImageMetadata(client, input),
      update: async (listingId, changes) => await updateListing(client, listingId, changes),
      updateWorkflowState: async (input) => await updateListingWorkflowState(client, input),
    },
    listingPriceResearch: {
      create: async (input) => await createListingPriceResearch(client, input),
      dismissPricingWarnings: async (input) =>
        await dismissListingPriceResearchPricingWarnings(client, input),
      getLatestByListingId: async (listingId) =>
        await getLatestListingPriceResearchByListingId(client, listingId),
      listLatestByListingIds: async (listingIds) =>
        await listLatestListingPriceResearchByListingIds(client, listingIds),
      markFailed: async (input) => await markListingPriceResearchFailed(client, input),
      markSucceeded: async (input) => await markListingPriceResearchSucceeded(client, input),
    },
    jobs: {
      claimDueQueued: async (jobId, now) => await claimDueQueuedJob(client, jobId, now),
      complete: async (jobId) => await completeJob(client, jobId),
      enqueueGenerateAi: async (listingId) => await enqueueGenerateAiJob(client, listingId),
      enqueuePublish: async (listingId) => await enqueuePublishJob(client, listingId),
      enqueueResearchPrice: async (listingId) => await enqueueResearchPriceJob(client, listingId),
      fail: async (jobId, error) => await failJob(client, jobId, error),
      getActiveResearchPriceByListingId: async (listingId) =>
        await getActiveResearchPriceJobByListingId(client, listingId),
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

import {
  claimApprovedListingForPublish,
  claimQueuedJob,
  DEFAULT_APP_SETTINGS_ID,
  createAppSettings,
  createJob,
  createListing,
  createOrder,
  enqueueGenerateAiJob,
  enqueueProcessImagesJob,
  createSupabaseServiceClient,
  getAppSettings,
  getActiveGenerateAiJobByListingId,
  getJobById,
  getListingByListingId,
  getOrderByOrderId,
  listApprovedForExportListings,
  listQueuedJobs,
  listJobsByListingId,
  listListings,
  listListingsByStatus,
  prepareListingForGenerateAi,
  markListingPublishFailed,
  saveListingImageMetadata,
  updateAppSettings,
  updateJob,
  updateListing,
  updateListingWorkflowState,
  updateOrder,
  type AppSettingsInsert,
  type AppSettingsRow,
  type AppSettingsUpdate,
  type EnqueueGenerateAiJobResult,
  type EnqueueProcessImagesJobResult,
  type JobInsert,
  type JobRow,
  type JobUpdate,
  type ListApprovedForExportListingsOptions,
  type ListQueuedJobsOptions,
  type ListListingsByStatusOptions,
  type ListingInsert,
  type ListingImageMetadataUpdate,
  type ListingRow,
  type ListingUpdate,
  type ListingWorkflowTransitionInput,
  type OrderInsert,
  type OrderRow,
  type OrderUpdate,
} from '@ebay-inventory/data';

export interface SidecarDataAccess {
  appSettings: {
    create(input: AppSettingsInsert): Promise<AppSettingsRow>;
    get(id?: string): Promise<AppSettingsRow | null>;
    update(changes: AppSettingsUpdate, id?: string): Promise<AppSettingsRow>;
  };
  jobs: {
    claimQueued(jobId: string): Promise<JobRow | null>;
    create(input: JobInsert): Promise<JobRow>;
    enqueueGenerateAi(listingId: string): Promise<EnqueueGenerateAiJobResult>;
    enqueueProcessImages(): Promise<EnqueueProcessImagesJobResult>;
    getActiveGenerateAiByListingId(listingId: string): Promise<JobRow | null>;
    getById(jobId: string): Promise<JobRow | null>;
    listQueued(options?: ListQueuedJobsOptions): Promise<JobRow[]>;
    listByListingId(listingId: string): Promise<JobRow[]>;
    update(jobId: string, changes: JobUpdate): Promise<JobRow>;
  };
  listings: {
    claimApprovedForPublish(listingId: string): Promise<ListingRow | null>;
    create(input: ListingInsert): Promise<ListingRow>;
    getByListingId(listingId: string): Promise<ListingRow | null>;
    listApprovedForExport(options: ListApprovedForExportListingsOptions): Promise<ListingRow[]>;
    list(): Promise<ListingRow[]>;
    listByStatus(
      status: ListingRow['status'],
      options: ListListingsByStatusOptions
    ): Promise<ListingRow[]>;
    markPublishFailed(listingId: string, errorAt: string, error: unknown): Promise<ListingRow>;
    prepareForGenerateAi(
      input: {
        expectedUpdatedAt?: string;
        listingId: string;
        sellerHints?: ListingUpdate['seller_hints'];
      }
    ): Promise<ListingRow | null>;
    saveImageMetadata(input: ListingImageMetadataUpdate): Promise<ListingRow | null>;
    update(listingId: string, changes: ListingUpdate): Promise<ListingRow>;
    updateWorkflowState(input: ListingWorkflowTransitionInput): Promise<ListingRow>;
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
    listings: {
      claimApprovedForPublish: async (listingId) =>
        await claimApprovedListingForPublish(client, listingId),
      create: async (input) => await createListing(client, input),
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
    jobs: {
      claimQueued: async (jobId) => await claimQueuedJob(client, jobId),
      create: async (input) => await createJob(client, input),
      enqueueGenerateAi: async (listingId) => await enqueueGenerateAiJob(client, listingId),
      enqueueProcessImages: async () => await enqueueProcessImagesJob(client),
      getActiveGenerateAiByListingId: async (listingId) =>
        await getActiveGenerateAiJobByListingId(client, listingId),
      getById: async (jobId) => await getJobById(client, jobId),
      listQueued: async (options) => await listQueuedJobs(client, options),
      listByListingId: async (listingId) => await listJobsByListingId(client, listingId),
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

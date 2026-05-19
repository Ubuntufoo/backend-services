import {
  DEFAULT_APP_SETTINGS_ID,
  createAppSettings,
  createJob,
  createListing,
  createOrder,
  createSupabaseServiceClient,
  getAppSettings,
  getJobById,
  getListingByListingId,
  getOrderByOrderId,
  listJobsByListingId,
  listListings,
  saveListingImageMetadata,
  updateAppSettings,
  updateJob,
  updateListing,
  updateListingWorkflowState,
  updateOrder,
  type AppSettingsInsert,
  type AppSettingsRow,
  type AppSettingsUpdate,
  type JobInsert,
  type JobRow,
  type JobUpdate,
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
    create(input: JobInsert): Promise<JobRow>;
    getById(jobId: string): Promise<JobRow | null>;
    listByListingId(listingId: string): Promise<JobRow[]>;
    update(jobId: string, changes: JobUpdate): Promise<JobRow>;
  };
  listings: {
    create(input: ListingInsert): Promise<ListingRow>;
    getByListingId(listingId: string): Promise<ListingRow | null>;
    list(): Promise<ListingRow[]>;
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
      create: async (input) => await createListing(client, input),
      getByListingId: async (listingId) => await getListingByListingId(client, listingId),
      list: async () => await listListings(client),
      saveImageMetadata: async (input) => await saveListingImageMetadata(client, input),
      update: async (listingId, changes) => await updateListing(client, listingId, changes),
      updateWorkflowState: async (input) => await updateListingWorkflowState(client, input),
    },
    jobs: {
      create: async (input) => await createJob(client, input),
      getById: async (jobId) => await getJobById(client, jobId),
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

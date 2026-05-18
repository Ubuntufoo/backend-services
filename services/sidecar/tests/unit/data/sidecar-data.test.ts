import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListingInsert, ListingUpdate, ListingWorkflowTransitionInput } from '@ebay-inventory/data';

const createSupabaseServiceClientMock = vi.fn(() => ({ from: vi.fn() }));
const listListingsMock = vi.fn();
const getListingByListingIdMock = vi.fn();
const createListingMock = vi.fn();
const updateListingMock = vi.fn();
const updateListingWorkflowStateMock = vi.fn();
const getAppSettingsMock = vi.fn();
const createJobMock = vi.fn();
const getJobByIdMock = vi.fn();
const listJobsByListingIdMock = vi.fn();
const updateJobMock = vi.fn();
const createOrderMock = vi.fn();
const getOrderByOrderIdMock = vi.fn();
const updateOrderMock = vi.fn();
const createAppSettingsMock = vi.fn();
const updateAppSettingsMock = vi.fn();

vi.mock('@ebay-inventory/data', () => ({
  createAppSettings: createAppSettingsMock,
  createJob: createJobMock,
  createListing: createListingMock,
  createOrder: createOrderMock,
  createSupabaseServiceClient: createSupabaseServiceClientMock,
  getAppSettings: getAppSettingsMock,
  getJobById: getJobByIdMock,
  getListingByListingId: getListingByListingIdMock,
  getOrderByOrderId: getOrderByOrderIdMock,
  listJobsByListingId: listJobsByListingIdMock,
  listListings: listListingsMock,
  updateAppSettings: updateAppSettingsMock,
  updateJob: updateJobMock,
  updateListing: updateListingMock,
  updateListingWorkflowState: updateListingWorkflowStateMock,
  updateOrder: updateOrderMock,
}));

describe('sidecar data access', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates one shared client and delegates listing queries through @ebay-inventory/data', async () => {
    const { createSidecarDataAccess } = await import('@/data/sidecar-data.js');
    const env = {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://fmiliwxthjonjwywuqta.supabase.co',
      SUPABASE_PROJECT_REF: 'fmiliwxthjonjwywuqta',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    } as NodeJS.ProcessEnv;

    const dataAccess = createSidecarDataAccess(env);

    await dataAccess.listings.list();
    await dataAccess.listings.getByListingId('LIST-001');

    expect(createSupabaseServiceClientMock).toHaveBeenCalledWith(env);
    const client = createSupabaseServiceClientMock.mock.results[0]?.value;
    expect(listListingsMock).toHaveBeenCalledWith(client);
    expect(getListingByListingIdMock).toHaveBeenCalledWith(client, 'LIST-001');
  });

  it('delegates create, update, workflow, and app-settings calls to shared repository helpers', async () => {
    const { createSidecarDataAccess } = await import('@/data/sidecar-data.js');
    const dataAccess = createSidecarDataAccess();
    const client = createSupabaseServiceClientMock.mock.results[0]?.value;
    const listingInsert = {
      listing_id: 'LIST-001',
      status: 'record_created',
      sub_status: 'idle',
    } as ListingInsert;
    const listingUpdate = {
      title: 'Updated title',
    } as ListingUpdate;
    const workflowUpdate = {
      listingId: 'LIST-001',
      status: 'approved_for_export',
      subStatus: 'publish_queued',
    } as ListingWorkflowTransitionInput;

    await dataAccess.listings.create(listingInsert);
    await dataAccess.listings.update('LIST-001', listingUpdate);
    await dataAccess.listings.updateWorkflowState(workflowUpdate);
    await dataAccess.appSettings.get();

    expect(createListingMock).toHaveBeenCalledWith(client, listingInsert);
    expect(updateListingMock).toHaveBeenCalledWith(client, 'LIST-001', listingUpdate);
    expect(updateListingWorkflowStateMock).toHaveBeenCalledWith(client, workflowUpdate);
    expect(getAppSettingsMock).toHaveBeenCalledWith(client, undefined);
  });
});

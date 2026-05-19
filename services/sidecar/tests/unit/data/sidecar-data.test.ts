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
  DEFAULT_APP_SETTINGS_ID: 'default',
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
    expect(getAppSettingsMock).toHaveBeenCalledWith(client, 'default');
  });

  it('delegates jobs and orders calls to the matching shared repository helpers', async () => {
    const { createSidecarDataAccess } = await import('@/data/sidecar-data.js');
    const dataAccess = createSidecarDataAccess();
    const client = createSupabaseServiceClientMock.mock.results[0]?.value;

    await dataAccess.jobs.create({
      job_type: 'process_images',
      listing_id: 'LIST-001',
      status: 'queued',
    });
    await dataAccess.jobs.getById('job-row-id');
    await dataAccess.jobs.listByListingId('LIST-001');
    await dataAccess.jobs.update('job-row-id', { status: 'running' });

    await dataAccess.orders.create({
      listing_id: 'LIST-001',
      order_id: 'ORDER-001',
    });
    await dataAccess.orders.getByOrderId('ORDER-001');
    await dataAccess.orders.update('ORDER-001', { fulfillment_status: 'shipped' });

    expect(createJobMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        job_type: 'process_images',
        listing_id: 'LIST-001',
        status: 'queued',
      })
    );
    expect(getJobByIdMock).toHaveBeenCalledWith(client, 'job-row-id');
    expect(listJobsByListingIdMock).toHaveBeenCalledWith(client, 'LIST-001');
    expect(updateJobMock).toHaveBeenCalledWith(client, 'job-row-id', { status: 'running' });

    expect(createOrderMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        listing_id: 'LIST-001',
        order_id: 'ORDER-001',
      })
    );
    expect(getOrderByOrderIdMock).toHaveBeenCalledWith(client, 'ORDER-001');
    expect(updateOrderMock).toHaveBeenCalledWith(client, 'ORDER-001', {
      fulfillment_status: 'shipped',
    });
  });
});

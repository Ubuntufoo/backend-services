import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ListingImageMetadataUpdate,
  ListingInsert,
  ListingUpdate,
  ListingWorkflowTransitionInput,
} from '@ebay-inventory/data';

const createSupabaseServiceClientMock = vi.fn(() => ({ from: vi.fn() }));
const listListingsMock = vi.fn();
const listListingsByStatusMock = vi.fn();
const listApprovedForExportListingsMock = vi.fn();
const getListingByListingIdMock = vi.fn();
const createListingMock = vi.fn();
const updateListingMock = vi.fn();
const claimApprovedListingForPublishMock = vi.fn();
const markListingPublishFailedMock = vi.fn();
const updateListingWorkflowStateMock = vi.fn();
const saveListingImageMetadataMock = vi.fn();
const getAppSettingsMock = vi.fn();
const createJobMock = vi.fn();
const enqueueGenerateAiJobMock = vi.fn();
const enqueueProcessImagesJobMock = vi.fn();
const enqueuePublishJobMock = vi.fn();
const failJobMock = vi.fn();
const completeJobMock = vi.fn();
const getActiveGenerateAiJobByListingIdMock = vi.fn();
const getJobByIdMock = vi.fn();
const listDueQueuedJobsMock = vi.fn();
const listJobsByListingIdMock = vi.fn();
const listStaleRunningJobsMock = vi.fn();
const claimDueQueuedJobMock = vi.fn();
const resetJobForManualRetryMock = vi.fn();
const requeueJobMock = vi.fn();
const setGeminiJobAttemptAuditMock = vi.fn();
const updateJobMock = vi.fn();
const createOrderMock = vi.fn();
const getOrderByOrderIdMock = vi.fn();
const updateOrderMock = vi.fn();
const createAppSettingsMock = vi.fn();
const updateAppSettingsMock = vi.fn();

vi.mock('@ebay-inventory/data', () => ({
  DEFAULT_APP_SETTINGS_ID: 'default',
  claimApprovedListingForPublish: claimApprovedListingForPublishMock,
  claimDueQueuedJob: claimDueQueuedJobMock,
  completeJob: completeJobMock,
  createAppSettings: createAppSettingsMock,
  createJob: createJobMock,
  createListing: createListingMock,
  createOrder: createOrderMock,
  createSupabaseServiceClient: createSupabaseServiceClientMock,
  enqueueGenerateAiJob: enqueueGenerateAiJobMock,
  enqueueProcessImagesJob: enqueueProcessImagesJobMock,
  enqueuePublishJob: enqueuePublishJobMock,
  failJob: failJobMock,
  getAppSettings: getAppSettingsMock,
  getActiveGenerateAiJobByListingId: getActiveGenerateAiJobByListingIdMock,
  getJobById: getJobByIdMock,
  getListingByListingId: getListingByListingIdMock,
  getOrderByOrderId: getOrderByOrderIdMock,
  listApprovedForExportListings: listApprovedForExportListingsMock,
  listDueQueuedJobs: listDueQueuedJobsMock,
  listJobsByListingId: listJobsByListingIdMock,
  listStaleRunningJobs: listStaleRunningJobsMock,
  listListings: listListingsMock,
  listListingsByStatus: listListingsByStatusMock,
  markListingPublishFailed: markListingPublishFailedMock,
  resetJobForManualRetry: resetJobForManualRetryMock,
  requeueJob: requeueJobMock,
  saveListingImageMetadata: saveListingImageMetadataMock,
  setGeminiJobAttemptAudit: setGeminiJobAttemptAuditMock,
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
    await dataAccess.listings.listByStatus('record_created', {
      limit: 25,
      offset: 0,
      orderByCreatedAt: 'asc',
    });
    await dataAccess.listings.listApprovedForExport({
      limit: 5,
      queuedOnly: true,
    });
    await dataAccess.listings.getByListingId('LIST-001');

    expect(createSupabaseServiceClientMock).toHaveBeenCalledWith(env);
    const client = createSupabaseServiceClientMock.mock.results[0]?.value;
    expect(listListingsMock).toHaveBeenCalledWith(client);
    expect(listListingsByStatusMock).toHaveBeenCalledWith(client, 'record_created', {
      limit: 25,
      offset: 0,
      orderByCreatedAt: 'asc',
    });
    expect(listApprovedForExportListingsMock).toHaveBeenCalledWith(client, {
      limit: 5,
      queuedOnly: true,
    });
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
    const imageMetadataUpdate = {
      imageUrls: ['https://cdn.example.com/1.jpg'],
      listingId: 'LIST-001',
      r2ObjectKeys: ['listings/LIST-001/1.jpg'],
    } as ListingImageMetadataUpdate;
    const workflowUpdate = {
      listingId: 'LIST-001',
      status: 'approved_for_export',
      subStatus: 'publish_queued',
    } as ListingWorkflowTransitionInput;

    await dataAccess.listings.create(listingInsert);
    await dataAccess.listings.claimApprovedForPublish('LIST-001');
    await dataAccess.listings.update('LIST-001', listingUpdate);
    await dataAccess.listings.markPublishFailed('LIST-001', '2026-05-25T12:00:00.000Z', new Error('boom'));
    await dataAccess.listings.saveImageMetadata(imageMetadataUpdate);
    await dataAccess.listings.updateWorkflowState(workflowUpdate);
    await dataAccess.appSettings.get();

    expect(createListingMock).toHaveBeenCalledWith(client, listingInsert);
    expect(claimApprovedListingForPublishMock).toHaveBeenCalledWith(client, 'LIST-001');
    expect(updateListingMock).toHaveBeenCalledWith(client, 'LIST-001', listingUpdate);
    expect(markListingPublishFailedMock).toHaveBeenCalledWith(
      client,
      'LIST-001',
      '2026-05-25T12:00:00.000Z',
      expect.any(Error)
    );
    expect(saveListingImageMetadataMock).toHaveBeenCalledWith(client, imageMetadataUpdate);
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
    await dataAccess.jobs.claimDueQueued('job-row-id', '2026-05-25T13:00:00.000Z');
    await dataAccess.jobs.complete('job-row-id');
    await dataAccess.jobs.enqueueGenerateAi('LIST-001');
    await dataAccess.jobs.enqueueProcessImages();
    await dataAccess.jobs.enqueuePublish('LIST-001');
    await dataAccess.jobs.fail('job-row-id', {
      errorAt: '2026-05-25T13:00:00.000Z',
      errorCode: 'stale_worker',
      errorMessage: 'boom',
    });
    await dataAccess.jobs.getActiveGenerateAiByListingId('LIST-001');
    await dataAccess.jobs.getById('job-row-id');
    await dataAccess.jobs.listDueQueued('2026-05-25T13:00:00.000Z', { limit: 1 });
    await dataAccess.jobs.listByListingId('LIST-001');
    await dataAccess.jobs.listStaleRunning('2026-05-25T12:00:00.000Z');
    await dataAccess.jobs.resetForManualRetry('job-row-id', '2026-05-25T13:00:00.000Z');
    await dataAccess.jobs.requeue('job-row-id', {
      errorAt: '2026-05-25T13:00:00.000Z',
      errorCode: 'retry_exhausted',
      errorMessage: 'boom',
    }, '2026-05-25T13:01:00.000Z');
    await dataAccess.jobs.updateGeminiAttemptAudit('job-row-id', {
      gemini_attempt_count: 1,
      gemini_attempts: [
        {
          attempt_order: 1,
          completed_at: '2026-05-25T13:00:02.000Z',
          duration_ms: 2000,
          failure_code: null,
          failure_message: null,
          model_name: 'gemini-3.1-flash-lite',
          started_at: '2026-05-25T13:00:00.000Z',
          status: 'succeeded',
        },
      ],
      gemini_selected_model: 'gemini-3.1-flash-lite',
    });
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
    expect(claimDueQueuedJobMock).toHaveBeenCalledWith(
      client,
      'job-row-id',
      '2026-05-25T13:00:00.000Z'
    );
    expect(completeJobMock).toHaveBeenCalledWith(client, 'job-row-id');
    expect(enqueueGenerateAiJobMock).toHaveBeenCalledWith(client, 'LIST-001');
    expect(enqueueProcessImagesJobMock).toHaveBeenCalledWith(client);
    expect(enqueuePublishJobMock).toHaveBeenCalledWith(client, 'LIST-001');
    expect(failJobMock).toHaveBeenCalledWith(client, 'job-row-id', {
      errorAt: '2026-05-25T13:00:00.000Z',
      errorCode: 'stale_worker',
      errorMessage: 'boom',
    });
    expect(getActiveGenerateAiJobByListingIdMock).toHaveBeenCalledWith(client, 'LIST-001');
    expect(getJobByIdMock).toHaveBeenCalledWith(client, 'job-row-id');
    expect(listDueQueuedJobsMock).toHaveBeenCalledWith(
      client,
      '2026-05-25T13:00:00.000Z',
      { limit: 1 }
    );
    expect(listJobsByListingIdMock).toHaveBeenCalledWith(client, 'LIST-001');
    expect(listStaleRunningJobsMock).toHaveBeenCalledWith(client, '2026-05-25T12:00:00.000Z');
    expect(resetJobForManualRetryMock).toHaveBeenCalledWith(
      client,
      'job-row-id',
      '2026-05-25T13:00:00.000Z'
    );
    expect(requeueJobMock).toHaveBeenCalledWith(
      client,
      'job-row-id',
      {
        errorAt: '2026-05-25T13:00:00.000Z',
        errorCode: 'retry_exhausted',
        errorMessage: 'boom',
      },
      '2026-05-25T13:01:00.000Z'
    );
    expect(setGeminiJobAttemptAuditMock).toHaveBeenCalledWith(client, 'job-row-id', {
      gemini_attempt_count: 1,
      gemini_attempts: [
        {
          attempt_order: 1,
          completed_at: '2026-05-25T13:00:02.000Z',
          duration_ms: 2000,
          failure_code: null,
          failure_message: null,
          model_name: 'gemini-3.1-flash-lite',
          started_at: '2026-05-25T13:00:00.000Z',
          status: 'succeeded',
        },
      ],
      gemini_selected_model: 'gemini-3.1-flash-lite',
    });
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

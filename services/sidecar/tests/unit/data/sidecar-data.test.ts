import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ListingImageMetadataUpdate,
  ListingInsert,
  ListingUpdate,
  ListingWorkflowTransitionInput,
} from '@ebay-inventory/data';

const createSupabaseServiceClientMock = vi.fn(() => ({ from: vi.fn() }));
const createAiModelAttemptMock = vi.fn();
const resolveAiModelRoutesForTaskMock = vi.fn();
const listListingsMock = vi.fn();
const listListingsByStatusMock = vi.fn();
const listApprovedForExportListingsMock = vi.fn();
const getLatestGeminiUsageAttemptMock = vi.fn();
const getListingByOfferIdMock = vi.fn();
const getListingByListingIdMock = vi.fn();
const getListingBySkuMock = vi.fn();
const hasOrderForListingMock = vi.fn();
const markAiModelAttemptFailedMock = vi.fn();
const markAiModelAttemptSucceededMock = vi.fn();
const prepareListingForGenerateAiMock = vi.fn();
const createListingMock = vi.fn();
const deleteSandboxCleanedListingMock = vi.fn();
const deleteNeedsReviewListingMock = vi.fn();
const approveListingForExportMock = vi.fn();
const updateListingMock = vi.fn();
const claimApprovedListingForPublishMock = vi.fn();
const updateListingWorkflowStateMock = vi.fn();
const saveListingImageMetadataMock = vi.fn();
const getAppSettingsMock = vi.fn();
const enqueueGenerateAiJobMock = vi.fn();
const enqueuePublishJobMock = vi.fn();
const failJobMock = vi.fn();
const getGeminiDailyUsageSummaryMock = vi.fn();
const completeJobMock = vi.fn();
const getJobByIdMock = vi.fn();
const getLatestListingPriceResearchByListingIdMock = vi.fn();
const listLatestListingPriceResearchByListingIdsMock = vi.fn();
const listDueQueuedJobsMock = vi.fn();
const listJobsByListingIdMock = vi.fn();
const listStaleRunningJobsMock = vi.fn();
const incrementGeminiCallsUsedMock = vi.fn();
const claimDueQueuedJobMock = vi.fn();
const resetJobForManualRetryMock = vi.fn();
const requeueJobMock = vi.fn();
const setGeminiJobAttemptAuditMock = vi.fn();
const updateJobMock = vi.fn();
const createAppSettingsMock = vi.fn();
const updateAppSettingsMock = vi.fn();
const createListingPriceResearchMock = vi.fn();
const markListingPriceResearchFailedMock = vi.fn();
const markListingPriceResearchSucceededMock = vi.fn();
const createSupabaseVariationListingTransactionGatewayMock = vi.fn();
const listVariationListingGroupsMock = vi.fn();
const listVariationListingRevisionsByGroupIdMock = vi.fn();
const listVariationListingPublishingCheckpointsByRevisionIdMock = vi.fn();
const variationLoadAggregateMock = vi.fn();
const variationCreateGroupMock = vi.fn();
const variationApplyGroupReviewDraftMock = vi.fn();
const variationMarkPublishReadyMock = vi.fn();
const variationReserveActionRevisionMock = vi.fn();
const variationCaptureRevisionMock = vi.fn();
const variationAppendJournalCheckpointMock = vi.fn();
const variationConfirmRevisionMock = vi.fn();
const variationAdvanceCleanupLifecycleMock = vi.fn();
const variationAbandonUntouchedGroupMock = vi.fn();
const variationUpdatePriceMock = vi.fn();
const variationUpdateCopyAvailabilityMock = vi.fn();
const variationUpdateRepresentativeCopyMock = vi.fn();

vi.mock('@ebay-inventory/data', () => ({
  DEFAULT_APP_SETTINGS_ID: 'default',
  createAiModelAttempt: createAiModelAttemptMock,
  resolveAiModelRoutesForTask: resolveAiModelRoutesForTaskMock,
  getLatestGeminiUsageAttempt: getLatestGeminiUsageAttemptMock,
  claimApprovedListingForPublish: claimApprovedListingForPublishMock,
  claimDueQueuedJob: claimDueQueuedJobMock,
  completeJob: completeJobMock,
  createAppSettings: createAppSettingsMock,
  createListing: createListingMock,
  createListingPriceResearch: createListingPriceResearchMock,
  createSupabaseVariationListingTransactionGateway: createSupabaseVariationListingTransactionGatewayMock,
  deleteSandboxCleanedListing: deleteSandboxCleanedListingMock,
  deleteNeedsReviewListing: deleteNeedsReviewListingMock,
  approveListingForExport: approveListingForExportMock,
  createSupabaseServiceClient: createSupabaseServiceClientMock,
  enqueueGenerateAiJob: enqueueGenerateAiJobMock,
  enqueuePublishJob: enqueuePublishJobMock,
  failJob: failJobMock,
  getGeminiDailyUsageSummary: getGeminiDailyUsageSummaryMock,
  getAppSettings: getAppSettingsMock,
  getJobById: getJobByIdMock,
  getLatestListingPriceResearchByListingId: getLatestListingPriceResearchByListingIdMock,
  getListingByOfferId: getListingByOfferIdMock,
  getListingByListingId: getListingByListingIdMock,
  getListingBySku: getListingBySkuMock,
  hasOrderForListing: hasOrderForListingMock,
  incrementGeminiCallsUsed: incrementGeminiCallsUsedMock,
  listApprovedForExportListings: listApprovedForExportListingsMock,
  listDueQueuedJobs: listDueQueuedJobsMock,
  listJobsByListingId: listJobsByListingIdMock,
  listLatestListingPriceResearchByListingIds: listLatestListingPriceResearchByListingIdsMock,
  listStaleRunningJobs: listStaleRunningJobsMock,
  listListings: listListingsMock,
  listListingsByStatus: listListingsByStatusMock,
  listVariationListingGroups: listVariationListingGroupsMock,
  listVariationListingRevisionsByGroupId: listVariationListingRevisionsByGroupIdMock,
  listVariationListingPublishingCheckpointsByRevisionId: listVariationListingPublishingCheckpointsByRevisionIdMock,
  markListingPriceResearchFailed: markListingPriceResearchFailedMock,
  markListingPriceResearchSucceeded: markListingPriceResearchSucceededMock,
  markAiModelAttemptFailed: markAiModelAttemptFailedMock,
  markAiModelAttemptSucceeded: markAiModelAttemptSucceededMock,
  prepareListingForGenerateAi: prepareListingForGenerateAiMock,
  resetJobForManualRetry: resetJobForManualRetryMock,
  requeueJob: requeueJobMock,
  saveListingImageMetadata: saveListingImageMetadataMock,
  setGeminiJobAttemptAudit: setGeminiJobAttemptAuditMock,
  updateAppSettings: updateAppSettingsMock,
  updateJob: updateJobMock,
  updateListing: updateListingMock,
  updateListingWorkflowState: updateListingWorkflowStateMock,
}));

describe('sidecar data access', () => {
  beforeEach(() => {
    createSupabaseVariationListingTransactionGatewayMock.mockReturnValue({
      loadAggregate: variationLoadAggregateMock,
      createGroup: variationCreateGroupMock,
      applyGroupReviewDraft: variationApplyGroupReviewDraftMock,
      markPublishReady: variationMarkPublishReadyMock,
      reserveActionRevision: variationReserveActionRevisionMock,
      captureRevision: variationCaptureRevisionMock,
      appendJournalCheckpoint: variationAppendJournalCheckpointMock,
      confirmRevision: variationConfirmRevisionMock,
      advanceCleanupLifecycle: variationAdvanceCleanupLifecycleMock,
      abandonUntouchedGroup: variationAbandonUntouchedGroupMock,
      updateVariationPrice: variationUpdatePriceMock,
      updateCopyAvailability: variationUpdateCopyAvailabilityMock,
      updateRepresentativeCopy: variationUpdateRepresentativeCopyMock,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('delegates every variation-listing read and mutation through the existing helpers', async () => {
    const { createSidecarDataAccess } = await import('@/data/sidecar-data.js');
    const env = {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://fmiliwxthjonjwywuqta.supabase.co',
      SUPABASE_PROJECT_REF: 'fmiliwxthjonjwywuqta',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    } as NodeJS.ProcessEnv;
    const dataAccess = createSidecarDataAccess(env);
    const client = createSupabaseServiceClientMock.mock.results[0]?.value;
    const groupId = '11111111-1111-4111-8111-111111111111';
    const variationId = '22222222-2222-4222-8222-222222222222';
    const copyId = '33333333-3333-4333-8333-333333333333';
    const revisionId = '44444444-4444-4444-8444-444444444444';

    await dataAccess.variationListings.listGroups();
    await dataAccess.variationListings.loadAggregate(groupId);
    await dataAccess.variationListings.listRevisionsByGroupId(groupId);
    await dataAccess.variationListings.listCheckpointsByRevisionId(revisionId);
    await dataAccess.variationListings.createGroup({
      groupId,
      groupKey: 'VL-G-11111111111141118111111111111111',
      skuCategoryCode: 'BSKBL',
      skuBucketToken: 'McGrady',
      categoryId: '261328',
      marketplaceId: 'EBAY_US',
      merchantLocationKey: 'main',
      fulfillmentPolicyId: 'fulfillment',
      paymentPolicyId: 'payment',
      returnPolicyId: 'returns',
      conditionId: '4000',
      conditionToken: 'VERY_GOOD',
    });
    await dataAccess.variationListings.applyGroupReviewDraft({
      groupId,
      expectedDesiredRevision: 1,
      title: 'Cards',
      description: 'Description',
      derivedCommonEbayAspects: { Sport: ['Basketball'] },
    });
    await dataAccess.variationListings.markPublishReady({ groupId, expectedDesiredRevision: 2 });
    await dataAccess.variationListings.reserveActionRevision({ groupId, expectedDesiredRevision: 2 });
    await dataAccess.variationListings.captureRevision({ groupId, revisionId, capturedDesiredRevision: 2, snapshotVersion: 1, snapshotDigest: 'a'.repeat(64), snapshot: {}, operationPlan: [] });
    await dataAccess.variationListings.appendJournalCheckpoint({ revisionId, operationKey: 'op', checkpointId: copyId, attemptNumber: 1, checkpointNumber: 1, state: 'started', evidence: {} });
    await dataAccess.variationListings.confirmRevision({ groupId, expectedPreviousConfirmedRevision: null, confirmedRevision: 2 });
    await dataAccess.variationListings.advanceCleanupLifecycle({ groupId, revisionId, expectedDesiredRevision: 2, expectedPreviousConfirmedRevision: null, targetLifecycle: 'abandoned' });
    await dataAccess.variationListings.abandonUntouchedGroup({ groupId, expectedDesiredRevision: 0 });
    await dataAccess.variationListings.updateVariationPrice({
      groupId,
      variationId,
      expectedDesiredRevision: 1,
      priceAmount: 1.99,
    });
    await dataAccess.variationListings.updateCopyAvailability({
      groupId,
      variationId,
      copyId,
      expectedDesiredRevision: 1,
      availabilityState: 'available',
    });
    await dataAccess.variationListings.updateRepresentativeCopy({
      groupId,
      variationId,
      copyId,
      expectedDesiredRevision: 1,
    });

    expect(createSupabaseVariationListingTransactionGatewayMock).toHaveBeenCalledWith(client);
    expect(listVariationListingGroupsMock).toHaveBeenCalledWith(client);
    expect(variationLoadAggregateMock).toHaveBeenCalledWith(groupId);
    expect(listVariationListingRevisionsByGroupIdMock).toHaveBeenCalledWith(client, groupId);
    expect(listVariationListingPublishingCheckpointsByRevisionIdMock).toHaveBeenCalledWith(client, revisionId);
    expect(variationCreateGroupMock).toHaveBeenCalledWith(expect.objectContaining({ groupId, groupKey: 'VL-G-11111111111141118111111111111111' }));
    expect(variationApplyGroupReviewDraftMock).toHaveBeenCalledWith(expect.objectContaining({ groupId, expectedDesiredRevision: 1 }));
    expect(variationMarkPublishReadyMock).toHaveBeenCalledWith({ groupId, expectedDesiredRevision: 2 });
    expect(variationReserveActionRevisionMock).toHaveBeenCalledWith({ groupId, expectedDesiredRevision: 2 });
    expect(variationCaptureRevisionMock).toHaveBeenCalledWith(expect.objectContaining({ groupId, revisionId, capturedDesiredRevision: 2 }));
    expect(variationAppendJournalCheckpointMock).toHaveBeenCalledWith(expect.objectContaining({ revisionId, operationKey: 'op' }));
    expect(variationConfirmRevisionMock).toHaveBeenCalledWith({ groupId, expectedPreviousConfirmedRevision: null, confirmedRevision: 2 });
    expect(variationAdvanceCleanupLifecycleMock).toHaveBeenCalledWith(expect.objectContaining({ groupId, revisionId, targetLifecycle: 'abandoned' }));
    expect(variationAbandonUntouchedGroupMock).toHaveBeenCalledWith({ groupId, expectedDesiredRevision: 0 });
    expect(variationUpdatePriceMock).toHaveBeenCalledWith({ groupId, variationId, expectedDesiredRevision: 1, priceAmount: 1.99 });
    expect(variationUpdateCopyAvailabilityMock).toHaveBeenCalledWith({ groupId, variationId, copyId, expectedDesiredRevision: 1, availabilityState: 'available' });
    expect(variationUpdateRepresentativeCopyMock).toHaveBeenCalledWith({ groupId, variationId, copyId, expectedDesiredRevision: 1 });
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
    await dataAccess.listings.getBySku('BSKBL-Single-000001');
    await dataAccess.listings.getByOfferId('OFFER-001');
    await dataAccess.aiModelAttempts.getLatestGeminiUsageAttempt();
    await dataAccess.listingPriceResearch.getLatestByListingId('LIST-001');
    await dataAccess.listingPriceResearch.listLatestByListingIds(['LIST-001', 'LIST-002']);
    await dataAccess.aiModelRoutes.resolveForTask({
      provider: 'google',
      requireImages: true,
      requireJsonOutput: true,
      requireStructuredOutput: true,
      taskType: 'listing_draft_generation',
    });

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
    expect(getListingBySkuMock).toHaveBeenCalledWith(client, 'BSKBL-Single-000001');
    expect(getListingByOfferIdMock).toHaveBeenCalledWith(client, 'OFFER-001');
    expect(getLatestGeminiUsageAttemptMock).toHaveBeenCalledWith(client);
    expect(getLatestListingPriceResearchByListingIdMock).toHaveBeenCalledWith(client, 'LIST-001');
    expect(listLatestListingPriceResearchByListingIdsMock).toHaveBeenCalledWith(client, [
      'LIST-001',
      'LIST-002',
    ]);
    expect(resolveAiModelRoutesForTaskMock).toHaveBeenCalledWith(client, {
      provider: 'google',
      requireImages: true,
      requireJsonOutput: true,
      requireStructuredOutput: true,
      taskType: 'listing_draft_generation',
    });
  });

  it('delegates listing mutations, order checks, and app-settings calls to shared repository helpers', async () => {
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
    await dataAccess.listings.deleteSandboxCleaned({
      expectedSku: 'BSKBL-Single-000001',
      expectedUpdatedAt: '2026-05-17T00:00:00.000Z',
      listingId: 'LIST-001',
    });
    await dataAccess.listings.deleteNeedsReview({
      expectedUpdatedAt: '2026-05-17T00:00:00.000Z',
      listingId: 'LIST-001',
    });
    await dataAccess.listings.approveForExport('LIST-001');
    await dataAccess.listings.claimApprovedForPublish('LIST-001');
    await dataAccess.listings.prepareForGenerateAi({
      autoPricingEnabled: false,
      expectedUpdatedAt: '2026-05-17T00:00:00.000Z',
      listingId: 'LIST-001',
      sellerHints: 'Use padded envelope',
    });
    await dataAccess.listings.update('LIST-001', listingUpdate);
    await dataAccess.listings.saveImageMetadata(imageMetadataUpdate);
    await dataAccess.listings.updateWorkflowState(workflowUpdate);
    await dataAccess.appSettings.get();
    await dataAccess.orders.hasByListingId('LIST-001');

    expect(createListingMock).toHaveBeenCalledWith(client, listingInsert);
    expect(deleteSandboxCleanedListingMock).toHaveBeenCalledWith(client, {
      expectedSku: 'BSKBL-Single-000001',
      expectedUpdatedAt: '2026-05-17T00:00:00.000Z',
      listingId: 'LIST-001',
    });
    expect(deleteNeedsReviewListingMock).toHaveBeenCalledWith(client, {
      expectedUpdatedAt: '2026-05-17T00:00:00.000Z',
      listingId: 'LIST-001',
    });
    expect(approveListingForExportMock).toHaveBeenCalledWith(client, 'LIST-001');
    expect(claimApprovedListingForPublishMock).toHaveBeenCalledWith(client, 'LIST-001');
    expect(prepareListingForGenerateAiMock).toHaveBeenCalledWith(client, {
      autoPricingEnabled: false,
      expectedUpdatedAt: '2026-05-17T00:00:00.000Z',
      listingId: 'LIST-001',
      sellerHints: 'Use padded envelope',
    });
    expect(updateListingMock).toHaveBeenCalledWith(client, 'LIST-001', listingUpdate);
    expect(saveListingImageMetadataMock).toHaveBeenCalledWith(client, imageMetadataUpdate);
    expect(updateListingWorkflowStateMock).toHaveBeenCalledWith(client, workflowUpdate);
    expect(getAppSettingsMock).toHaveBeenCalledWith(client, 'default');
    expect(hasOrderForListingMock).toHaveBeenCalledWith(client, 'LIST-001');
  });

  it('delegates remaining job, usage, and pricing calls to shared repository helpers', async () => {
    const { createSidecarDataAccess } = await import('@/data/sidecar-data.js');
    const dataAccess = createSidecarDataAccess();
    const client = createSupabaseServiceClientMock.mock.results[0]?.value;

    await dataAccess.aiModelAttempts.create({
      job_id: 'job-row-id',
      listing_id: 'LIST-001',
      model_name: 'gemini-3.1-flash-lite',
      provider: 'google',
      provider_model_id: 'gemini-3.1-flash-lite',
      routing_source: 'direct_gemini',
      started_at: '2026-05-25T13:00:00.000Z',
    });
    await dataAccess.aiModelAttempts.markSucceeded({
      duration_ms: 2000,
      finished_at: '2026-05-25T13:00:02.000Z',
      id: 'ai-model-attempt-row-id',
    });
    await dataAccess.aiModelAttempts.markFailed({
      duration_ms: 2000,
      failure_code: 'generate_ai_failed',
      failure_message: 'Gemini timed out',
      finished_at: '2026-05-25T13:00:02.000Z',
      id: 'ai-model-attempt-row-id',
    });
    await dataAccess.jobs.claimDueQueued('job-row-id', '2026-05-25T13:00:00.000Z');
    await dataAccess.jobs.complete('job-row-id');
    await dataAccess.jobs.enqueueGenerateAi('LIST-001');
    await dataAccess.jobs.enqueuePublish('LIST-001');
    await dataAccess.jobs.fail('job-row-id', {
      errorAt: '2026-05-25T13:00:00.000Z',
      errorCode: 'stale_worker',
      errorMessage: 'boom',
    });
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
    await dataAccess.dailyUsage.getGeminiSummary(new Date('2026-05-25T13:00:00.000Z'));
    await dataAccess.dailyUsage.incrementGeminiCallsUsed('2026-05-25');

    expect(createAiModelAttemptMock).toHaveBeenCalledWith(client, {
      job_id: 'job-row-id',
      listing_id: 'LIST-001',
      model_name: 'gemini-3.1-flash-lite',
      provider: 'google',
      provider_model_id: 'gemini-3.1-flash-lite',
      routing_source: 'direct_gemini',
      started_at: '2026-05-25T13:00:00.000Z',
    });
    expect(markAiModelAttemptSucceededMock).toHaveBeenCalledWith(client, {
      duration_ms: 2000,
      finished_at: '2026-05-25T13:00:02.000Z',
      id: 'ai-model-attempt-row-id',
    });
    expect(markAiModelAttemptFailedMock).toHaveBeenCalledWith(client, {
      duration_ms: 2000,
      failure_code: 'generate_ai_failed',
      failure_message: 'Gemini timed out',
      finished_at: '2026-05-25T13:00:02.000Z',
      id: 'ai-model-attempt-row-id',
    });
    expect(claimDueQueuedJobMock).toHaveBeenCalledWith(
      client,
      'job-row-id',
      '2026-05-25T13:00:00.000Z'
    );
    expect(completeJobMock).toHaveBeenCalledWith(client, 'job-row-id');
    expect(enqueueGenerateAiJobMock).toHaveBeenCalledWith(client, 'LIST-001');
    expect(enqueuePublishJobMock).toHaveBeenCalledWith(client, 'LIST-001');
    expect(failJobMock).toHaveBeenCalledWith(client, 'job-row-id', {
      errorAt: '2026-05-25T13:00:00.000Z',
      errorCode: 'stale_worker',
      errorMessage: 'boom',
    });
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
    expect(getGeminiDailyUsageSummaryMock).toHaveBeenCalledWith(
      client,
      new Date('2026-05-25T13:00:00.000Z')
    );
    expect(incrementGeminiCallsUsedMock).toHaveBeenCalledWith(client, '2026-05-25');
  });
});

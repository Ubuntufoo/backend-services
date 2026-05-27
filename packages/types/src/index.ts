export const LISTING_STATUSES = [
  'record_created',
  'image_processing_queued',
  'images_processed',
  'assets_ready',
  'generating',
  'needs_review',
  'approved_for_export',
  'exported',
  'listed',
  'sold',
] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const LISTING_IDLE_SUB_STATUS = 'idle' as const;

export const LISTING_SUB_STATUSES = [
  'grouping_images',
  'preparing_files',
  'waiting_for_image_worker',
  'processing_images',
  'waiting_for_r2_upload',
  'waiting_for_seller_hints',
  'ready_to_generate',
  'ai_call_in_progress',
  'review_pending',
  'publish_queued',
  'publishing_to_ebay',
  'active_live',
  'awaiting_packaging',
  'shipped',
  LISTING_IDLE_SUB_STATUS,
] as const;

export type ListingSubStatus = (typeof LISTING_SUB_STATUSES)[number];

export const LISTING_WORKFLOW_STATE_MAP = {
  record_created: ['grouping_images', 'preparing_files', LISTING_IDLE_SUB_STATUS],
  image_processing_queued: [
    'waiting_for_image_worker',
    'processing_images',
    LISTING_IDLE_SUB_STATUS,
  ],
  images_processed: ['waiting_for_r2_upload', LISTING_IDLE_SUB_STATUS],
  assets_ready: ['waiting_for_seller_hints', 'ready_to_generate', LISTING_IDLE_SUB_STATUS],
  generating: ['ai_call_in_progress', LISTING_IDLE_SUB_STATUS],
  needs_review: ['review_pending', LISTING_IDLE_SUB_STATUS],
  approved_for_export: ['publish_queued', 'publishing_to_ebay', LISTING_IDLE_SUB_STATUS],
  exported: [LISTING_IDLE_SUB_STATUS],
  listed: ['active_live', LISTING_IDLE_SUB_STATUS],
  sold: ['awaiting_packaging', 'shipped', LISTING_IDLE_SUB_STATUS],
} as const satisfies Record<ListingStatus, readonly ListingSubStatus[]>;

export type ListingWorkflowState = {
  [TStatus in ListingStatus]: {
    status: TStatus;
    subStatus: (typeof LISTING_WORKFLOW_STATE_MAP)[TStatus][number];
  };
}[ListingStatus];

const LISTING_STATUS_SET = new Set<string>(LISTING_STATUSES);
const LISTING_SUB_STATUS_SET = new Set<string>(LISTING_SUB_STATUSES);

export function isListingStatus(value: string): value is ListingStatus {
  return LISTING_STATUS_SET.has(value);
}

export function isListingSubStatus(value: string): value is ListingSubStatus {
  return LISTING_SUB_STATUS_SET.has(value);
}

export function getAllowedListingSubStatuses(status: ListingStatus): readonly ListingSubStatus[] {
  return LISTING_WORKFLOW_STATE_MAP[status];
}

export function isValidListingWorkflowState(status: string, subStatus: string): boolean {
  if (!isListingStatus(status) || !isListingSubStatus(subStatus)) {
    return false;
  }

  return getAllowedListingSubStatuses(status).includes(subStatus as ListingSubStatus);
}

export const JOB_TYPES = [
  'process_images',
  'upload_r2',
  'generate_ai',
  'publish',
  'sync_orders',
  'cleanup_r2',
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export const CAPTURE_MODES = ['single_2_image', 'lot_3_image'] as const;

export type CaptureMode = (typeof CAPTURE_MODES)[number];

export const LISTING_STATUSES = [
  'record_created',
  'image_processing_queued',
  'images_processed',
  'assets_ready',
  'generating',
  'needs_review',
  'approved_for_export',
  'listed',
  'sold',
] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const JOB_TYPES = [
  'process_images',
  'upload_r2',
  'generate_ai',
  'publish_ebay',
  'sync_orders',
  'cleanup_r2',
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export const CAPTURE_MODES = ['single_1_image', 'single_2_image', 'lot_3_image'] as const;

export type CaptureMode = (typeof CAPTURE_MODES)[number];

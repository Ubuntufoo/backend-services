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
  'research_price',
  'publish',
  'sync_orders',
  'cleanup_r2',
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export const CAPTURE_MODES = ['single_2_image', 'lot_3_image'] as const;

export type CaptureMode = (typeof CAPTURE_MODES)[number];

export const PRICING_PROVIDER_MODES = ['off', 'soldcomps', 'apify'] as const;

export type PricingProviderMode = (typeof PRICING_PROVIDER_MODES)[number];

export const PRICING_MODIFIER_OPTION_KEYS = [
  'excludeGraded',
  'excludeAutographs',
  'excludeVariants',
] as const;

export type PricingModifierOptionKey = (typeof PRICING_MODIFIER_OPTION_KEYS)[number];

export interface PricingModifierOptions {
  excludeGraded: boolean;
  excludeAutographs: boolean;
  excludeVariants: boolean;
}

export const DEFAULT_PRICING_MODIFIER_OPTIONS = {
  excludeGraded: true,
  excludeAutographs: true,
  excludeVariants: false,
} as const satisfies PricingModifierOptions;

export type PricingAnalysisWarningCode =
  | 'llm_analysis_failed'
  | 'llm_condition_adjusted_price_invalid'
  | 'llm_condition_adjusted_price_out_of_window'
  | 'llm_condition_adjusted_price_null'
  | 'provider_failure'
  | (string & {});

export interface PricingAnalysisWarningFailureSummary {
  error_code?: string;
  error_status?: string;
  provider?: string;
  reason?: string;
  retryable?: boolean;
  status_code?: number;
}

export interface ListingPricingAnalysisWarning {
  analyst: string;
  code: PricingAnalysisWarningCode;
  failure: PricingAnalysisWarningFailureSummary | null;
  listing_id: string;
  model_name: string | null;
  reason: PricingAnalysisWarningCode;
  research_id: string;
  retryable: boolean;
  severity: 'warning';
  summary: string;
}

export interface ListingLatestPricingResearchCompSummary {
  normalization_accepted_count: number;
  normalization_rejected_count: number;
  provider_reported_count?: number;
  provider_returned_count: number;
  rejected_comp_count: number;
  rejected_comp_ids: string[];
  selected_comp_count: number;
  selected_comp_ids: string[];
  total_comp_count: number;
}

export type ListingLatestPricingResearchFailureReason =
  | 'provider_zero_results'
  | 'all_comps_rejected'
  | 'provider_failure'
  | 'unknown';

export interface ListingLatestPricingResearchFailureSummary {
  accepted_comp_count?: number;
  provider?: string;
  provider_failure_category?: string;
  provider_failure_code?: string;
  provider_failure_status?: string;
  provider_returned_count?: number;
  query?: string;
  reason: ListingLatestPricingResearchFailureReason;
  rejected_comp_count?: number;
  rejected_reason_counts?: Record<string, number>;
  requested_count?: number;
}

export interface ListingLatestPricingResearchSummary {
  comp_summary: ListingLatestPricingResearchCompSummary;
  confidence: string | null;
  created_at: string;
  error_code: string | null;
  error_message: string | null;
  failure_summary: ListingLatestPricingResearchFailureSummary | null;
  listing_id: string;
  llm_price_explanation: string | null;
  median_sold_price: number | null;
  pricing_model_name: string | null;
  provider: string;
  query: string | null;
  research_id: string;
  sold_count: number | null;
  status: string;
  suggested_price: number | null;
  updated_at: string;
}

export const GENERATED_DRAFT_METADATA_KEY = '__draft_metadata' as const;
export const YEAR_UNVERIFIED_WARNING_CODE = 'year_unverified' as const;

export interface GeneratedDraftYearMetadata {
  likely_year?: string | null;
  likely_year_range?: string | null;
  status: 'unverified';
  warning_code: typeof YEAR_UNVERIFIED_WARNING_CODE;
}

export interface GeneratedDraftMetadata {
  year?: GeneratedDraftYearMetadata | null;
}

export type ListingIdentityWarningCode = typeof YEAR_UNVERIFIED_WARNING_CODE | (string & {});

export interface ListingIdentityWarning {
  code: ListingIdentityWarningCode;
  likely_year: string | null;
  likely_year_range: string | null;
  severity: 'warning';
  summary: string;
}

export * from './structured-sku.js';

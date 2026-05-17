import { describe, expect, it } from 'vitest';
import {
  LISTING_IDLE_SUB_STATUS,
  LISTING_STATUSES,
  LISTING_SUB_STATUSES,
  LISTING_WORKFLOW_STATE_MAP,
  getAllowedListingSubStatuses,
  isListingStatus,
  isListingSubStatus,
  isValidListingWorkflowState,
  type ListingStatus,
} from '../src/index.js';

describe('listing workflow types', () => {
  it('exports the expected top-level listing statuses', () => {
    expect(LISTING_STATUSES).toEqual([
      'record_created',
      'image_processing_queued',
      'images_processed',
      'assets_ready',
      'generating',
      'needs_review',
      'approved_for_export',
      'listed',
      'sold',
    ]);
  });

  it('includes the canonical idle sub-status', () => {
    expect(LISTING_SUB_STATUSES).toContain(LISTING_IDLE_SUB_STATUS);
  });

  it('keeps the sub-status registry aligned with the workflow map', () => {
    const mappedSubStatuses = new Set(
      Object.values(LISTING_WORKFLOW_STATE_MAP).flatMap((subStatuses) => subStatuses)
    );

    expect(new Set(LISTING_SUB_STATUSES)).toEqual(mappedSubStatuses);
  });

  it('returns allowed sub-statuses for each workflow phase', () => {
    expect(getAllowedListingSubStatuses('record_created')).toEqual([
      'grouping_images',
      'preparing_files',
      'idle',
    ]);
    expect(getAllowedListingSubStatuses('sold')).toEqual([
      'awaiting_packaging',
      'shipped',
      'idle',
    ]);
  });

  it('validates known statuses and sub-statuses', () => {
    expect(isListingStatus('listed')).toBe(true);
    expect(isListingStatus('active')).toBe(false);
    expect(isListingSubStatus('publish_queued')).toBe(true);
    expect(isListingSubStatus('queued')).toBe(false);
  });

  it('accepts only compatible status and sub-status pairs', () => {
    const validPairs: Array<[ListingStatus, string]> = [
      ['record_created', 'grouping_images'],
      ['record_created', 'preparing_files'],
      ['image_processing_queued', 'waiting_for_image_worker'],
      ['image_processing_queued', 'processing_images'],
      ['images_processed', 'waiting_for_r2_upload'],
      ['assets_ready', 'waiting_for_seller_hints'],
      ['assets_ready', 'ready_to_generate'],
      ['generating', 'ai_call_in_progress'],
      ['needs_review', 'review_pending'],
      ['approved_for_export', 'publish_queued'],
      ['approved_for_export', 'publishing_to_ebay'],
      ['listed', 'active_live'],
      ['sold', 'awaiting_packaging'],
      ['sold', 'shipped'],
    ];

    for (const [status, subStatus] of validPairs) {
      expect(isValidListingWorkflowState(status, subStatus)).toBe(true);
    }
  });

  it('accepts idle as the fallback sub-status for every phase', () => {
    for (const status of LISTING_STATUSES) {
      expect(isValidListingWorkflowState(status, LISTING_IDLE_SUB_STATUS)).toBe(true);
    }
  });

  it('rejects incompatible status and sub-status pairs', () => {
    expect(isValidListingWorkflowState('record_created', 'publish_queued')).toBe(false);
    expect(isValidListingWorkflowState('listed', 'processing_images')).toBe(false);
    expect(isValidListingWorkflowState('sold', 'review_pending')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { LISTING_IDLE_SUB_STATUS } from '@ebay-inventory/types';
import {
  createIdleWorkflowState,
  geminiWorkflowUpdateSchema,
  listingWorkflowStateSchema,
  watcherWorkflowUpdateSchema,
} from '@/workflow/listing-workflow.js';

describe('listing workflow validation', () => {
  it('parses a valid workflow state pair', () => {
    const parsed = listingWorkflowStateSchema.parse({
      status: 'approved_for_export',
      subStatus: 'publish_queued',
    });

    expect(parsed).toEqual({
      status: 'approved_for_export',
      subStatus: 'publish_queued',
    });
  });

  it('accepts idle as the canonical fallback sub-status', () => {
    const parsed = listingWorkflowStateSchema.parse(createIdleWorkflowState('needs_review'));

    expect(parsed).toEqual({
      status: 'needs_review',
      subStatus: LISTING_IDLE_SUB_STATUS,
    });
  });

  it('rejects incompatible workflow state pairs immediately', () => {
    const result = listingWorkflowStateSchema.safeParse({
      status: 'record_created',
      subStatus: 'publish_queued',
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('Expected workflow state validation to fail.');
    }

    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['subStatus'],
          message: 'subStatus "publish_queued" is not valid for status "record_created"',
        }),
      ])
    );
  });

  it('fails watcher payloads that assign an incompatible sub-status', () => {
    const result = watcherWorkflowUpdateSchema.safeParse({
      source: 'watcher',
      listingId: 'LIST-001',
      status: 'listed',
      subStatus: 'processing_images',
    });

    expect(result.success).toBe(false);
  });

  it('fails Gemini payloads that assign an incompatible sub-status', () => {
    const result = geminiWorkflowUpdateSchema.safeParse({
      source: 'gemini',
      listingId: 'LIST-002',
      status: 'sold',
      subStatus: 'review_pending',
    });

    expect(result.success).toBe(false);
  });

  it('requires sub-status in external workflow payloads', () => {
    const result = geminiWorkflowUpdateSchema.safeParse({
      source: 'gemini',
      listingId: 'LIST-003',
      status: 'needs_review',
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('Expected missing subStatus to fail validation.');
    }

    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['subStatus'],
        }),
      ])
    );
  });

  it('accepts valid watcher payloads', () => {
    const parsed = watcherWorkflowUpdateSchema.parse({
      source: 'watcher',
      listingId: 'LIST-004',
      status: 'image_processing_queued',
      subStatus: 'processing_images',
    });

    expect(parsed).toEqual({
      source: 'watcher',
      listingId: 'LIST-004',
      status: 'image_processing_queued',
      subStatus: 'processing_images',
    });
  });
});

import { describe, expect, it } from 'vitest';

import {
  PROCESSED_IMAGE_SEQUENCE_WIDTH,
  buildProcessedImageMovePlan,
  buildProcessedListingDirectory,
  formatProcessedImageFilename,
} from '../../src/index.js';

describe('processed path planning', () => {
  it('builds processed listing directories from configured root and listing id', () => {
    expect(buildProcessedListingDirectory('/watcher/processed', 'Single-000123')).toBe(
      '/watcher/processed/Single-000123'
    );
  });

  it('formats deterministic filenames with zero-padded numbering', () => {
    expect(PROCESSED_IMAGE_SEQUENCE_WIDTH).toBe(2);
    expect(formatProcessedImageFilename('Single-000123', 1, '/tmp/input.JPG')).toBe(
      'Single-000123_01.jpg'
    );
    expect(formatProcessedImageFilename('Lot-000456', 3, '/tmp/input.webp')).toBe(
      'Lot-000456_03.webp'
    );
  });

  it('normalizes extension casing without changing extension type', () => {
    expect(formatProcessedImageFilename('Single-000123', 1, '/tmp/input.JPEG')).toBe(
      'Single-000123_01.jpeg'
    );
    expect(formatProcessedImageFilename('Single-000123', 2, '/tmp/input.PNG')).toBe(
      'Single-000123_02.png'
    );
  });

  it('builds deterministic move records in input order', () => {
    expect(
      buildProcessedImageMovePlan({
        listingId: 'Lot-000456',
        processedDirectory: '/watcher/processed',
        images: [{ path: '/tmp/c.WEBP' }, { path: '/tmp/a.jpg' }, { path: '/tmp/b.JPEG' }],
      })
    ).toEqual([
      {
        sourcePath: '/tmp/c.WEBP',
        processedPath: '/watcher/processed/Lot-000456/Lot-000456_01.webp',
        fileName: 'Lot-000456_01.webp',
        order: 1,
        extension: '.webp',
      },
      {
        sourcePath: '/tmp/a.jpg',
        processedPath: '/watcher/processed/Lot-000456/Lot-000456_02.jpg',
        fileName: 'Lot-000456_02.jpg',
        order: 2,
        extension: '.jpg',
      },
      {
        sourcePath: '/tmp/b.JPEG',
        processedPath: '/watcher/processed/Lot-000456/Lot-000456_03.jpeg',
        fileName: 'Lot-000456_03.jpeg',
        order: 3,
        extension: '.jpeg',
      },
    ]);
  });

  it('rejects duplicate source paths before any filesystem work', () => {
    expect(() =>
      buildProcessedImageMovePlan({
        listingId: 'Single-000123',
        processedDirectory: '/watcher/processed',
        images: [{ path: '/tmp/a.jpg' }, { path: '/tmp/a.jpg' }],
      })
    ).toThrow('Duplicate source image path in processed move plan: /tmp/a.jpg.');
  });

  it('rejects missing extensions', () => {
    expect(() => formatProcessedImageFilename('Single-000123', 1, '/tmp/input')).toThrow(
      'Processed image source path is missing an extension: /tmp/input.'
    );
  });
});

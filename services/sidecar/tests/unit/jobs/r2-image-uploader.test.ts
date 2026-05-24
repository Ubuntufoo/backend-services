import { describe, expect, it, vi } from 'vitest';

import { createR2ImageUploader } from '@/jobs/r2-image-uploader.js';

describe('createR2ImageUploader', () => {
  it('uploads watcher assets through the shared R2 uploader contract', async () => {
    const readFile = vi.fn(async () => Buffer.from('image-bytes'));
    const uploadSingleImage = vi.fn(async (_input: unknown) => ({
      objectKey: 'listings/list-001/list-001_01.jpg',
      publicUrl:
        'https://images.murphyfamilyhobby.dev/listings/list-001/list-001_01.jpg',
    }));
    const uploader = createR2ImageUploader({
      readFile,
      uploadSingleImage,
    });

    const result = await uploader.uploadListingImages({
      listingId: 'LIST-001',
      images: [
        {
          filename: 'LIST-001_01.JPG',
          localPath: '/processed/LIST-001/.image-service-output/run-001/LIST-001_01.JPG',
        },
      ],
    });

    expect(uploadSingleImage).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId: 'LIST-001',
        filename: 'LIST-001_01.JPG',
        contentType: 'image/jpeg',
      })
    );
    expect(result).toEqual([
      {
        filename: 'LIST-001_01.JPG',
        objectKey: 'listings/list-001/list-001_01.jpg',
        publicUrl:
          'https://images.murphyfamilyhobby.dev/listings/list-001/list-001_01.jpg',
      },
    ]);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

const uploadImageMock = vi.fn();
const getSidecarDataAccessMock = vi.fn();
const getByListingIdMock = vi.fn();
const saveImageMetadataMock = vi.fn();

vi.mock('@ebay-inventory/data', () => ({
  uploadImage: uploadImageMock,
}));

vi.mock('@/data/sidecar-data.js', () => ({
  getSidecarDataAccess: getSidecarDataAccessMock,
}));

describe('uploadListingImage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('appends uploaded image metadata to existing listing arrays', async () => {
    getSidecarDataAccessMock.mockReturnValue({
      listings: {
        getByListingId: getByListingIdMock.mockResolvedValue({
          image_urls: ['https://cdn.example.com/existing.jpg'],
          r2_object_keys: ['listings/LIST-001/existing.jpg'],
          updated_at: '2026-05-19T14:00:00.000Z',
        }),
        saveImageMetadata: saveImageMetadataMock.mockResolvedValue({
          image_urls: [
            'https://cdn.example.com/existing.jpg',
            'https://cdn.example.com/new.jpg',
          ],
          r2_object_keys: [
            'listings/LIST-001/existing.jpg',
            'listings/LIST-001/new.jpg',
          ],
        }),
      },
    });
    uploadImageMock.mockResolvedValue({
      objectKey: 'listings/LIST-001/new.jpg',
      publicUrl: 'https://cdn.example.com/new.jpg',
    });

    const { uploadListingImage } = await import('@/data/upload-listing-image.js');

    const result = await uploadListingImage({
      listingId: 'LIST-001',
      filename: 'new.jpg',
      contentType: 'image/jpeg',
      body: Buffer.from('bytes'),
    });

    expect(getByListingIdMock).toHaveBeenCalledWith('LIST-001');
    expect(uploadImageMock).toHaveBeenCalledWith({
      listingId: 'LIST-001',
      filename: 'new.jpg',
      contentType: 'image/jpeg',
      body: Buffer.from('bytes'),
    });
    expect(saveImageMetadataMock).toHaveBeenCalledWith({
      listingId: 'LIST-001',
      imageUrls: [
        'https://cdn.example.com/existing.jpg',
        'https://cdn.example.com/new.jpg',
      ],
      r2ObjectKeys: [
        'listings/LIST-001/existing.jpg',
        'listings/LIST-001/new.jpg',
      ],
      expectedUpdatedAt: '2026-05-19T14:00:00.000Z',
    });
    expect(result).toEqual({
      listing: {
        image_urls: [
          'https://cdn.example.com/existing.jpg',
          'https://cdn.example.com/new.jpg',
        ],
        r2_object_keys: [
          'listings/LIST-001/existing.jpg',
          'listings/LIST-001/new.jpg',
        ],
      },
      objectKey: 'listings/LIST-001/new.jpg',
      publicUrl: 'https://cdn.example.com/new.jpg',
    });
  });

  it('treats null or empty metadata arrays as empty lists before appending', async () => {
    getSidecarDataAccessMock.mockReturnValue({
      listings: {
        getByListingId: getByListingIdMock.mockResolvedValue({
          image_urls: null,
          r2_object_keys: [],
          updated_at: '2026-05-19T14:00:00.000Z',
        }),
        saveImageMetadata: saveImageMetadataMock.mockResolvedValue({
          image_urls: ['https://cdn.example.com/new.jpg'],
          r2_object_keys: ['listings/LIST-001/new.jpg'],
        }),
      },
    });
    uploadImageMock.mockResolvedValue({
      objectKey: 'listings/LIST-001/new.jpg',
      publicUrl: 'https://cdn.example.com/new.jpg',
    });

    const { uploadListingImage } = await import('@/data/upload-listing-image.js');

    await uploadListingImage({
      listingId: 'LIST-001',
      filename: 'new.jpg',
      contentType: 'image/jpeg',
      body: Buffer.from('bytes'),
    });

    expect(saveImageMetadataMock).toHaveBeenCalledWith({
      listingId: 'LIST-001',
      imageUrls: ['https://cdn.example.com/new.jpg'],
      r2ObjectKeys: ['listings/LIST-001/new.jpg'],
      expectedUpdatedAt: '2026-05-19T14:00:00.000Z',
    });
  });

  it('retries with refreshed listing metadata when an optimistic concurrency update conflicts', async () => {
    getSidecarDataAccessMock.mockReturnValue({
      listings: {
        getByListingId: getByListingIdMock
          .mockResolvedValueOnce({
            image_urls: ['https://cdn.example.com/existing-a.jpg'],
            r2_object_keys: ['listings/LIST-001/existing-a.jpg'],
            updated_at: '2026-05-19T14:00:00.000Z',
          })
          .mockResolvedValueOnce({
            image_urls: [
              'https://cdn.example.com/existing-a.jpg',
              'https://cdn.example.com/existing-b.jpg',
            ],
            r2_object_keys: [
              'listings/LIST-001/existing-a.jpg',
              'listings/LIST-001/existing-b.jpg',
            ],
            updated_at: '2026-05-19T14:00:01.000Z',
          }),
        saveImageMetadata: saveImageMetadataMock
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            image_urls: [
              'https://cdn.example.com/existing-a.jpg',
              'https://cdn.example.com/existing-b.jpg',
              'https://cdn.example.com/new.jpg',
            ],
            r2_object_keys: [
              'listings/LIST-001/existing-a.jpg',
              'listings/LIST-001/existing-b.jpg',
              'listings/LIST-001/new.jpg',
            ],
          }),
      },
    });
    uploadImageMock.mockResolvedValue({
      objectKey: 'listings/LIST-001/new.jpg',
      publicUrl: 'https://cdn.example.com/new.jpg',
    });

    const { uploadListingImage } = await import('@/data/upload-listing-image.js');

    const result = await uploadListingImage({
      listingId: 'LIST-001',
      filename: 'new.jpg',
      contentType: 'image/jpeg',
      body: Buffer.from('bytes'),
    });

    expect(saveImageMetadataMock).toHaveBeenNthCalledWith(1, {
      listingId: 'LIST-001',
      expectedUpdatedAt: '2026-05-19T14:00:00.000Z',
      imageUrls: [
        'https://cdn.example.com/existing-a.jpg',
        'https://cdn.example.com/new.jpg',
      ],
      r2ObjectKeys: [
        'listings/LIST-001/existing-a.jpg',
        'listings/LIST-001/new.jpg',
      ],
    });
    expect(saveImageMetadataMock).toHaveBeenNthCalledWith(2, {
      listingId: 'LIST-001',
      expectedUpdatedAt: '2026-05-19T14:00:01.000Z',
      imageUrls: [
        'https://cdn.example.com/existing-a.jpg',
        'https://cdn.example.com/existing-b.jpg',
        'https://cdn.example.com/new.jpg',
      ],
      r2ObjectKeys: [
        'listings/LIST-001/existing-a.jpg',
        'listings/LIST-001/existing-b.jpg',
        'listings/LIST-001/new.jpg',
      ],
    });
    expect(result).toEqual({
      listing: {
        image_urls: [
          'https://cdn.example.com/existing-a.jpg',
          'https://cdn.example.com/existing-b.jpg',
          'https://cdn.example.com/new.jpg',
        ],
        r2_object_keys: [
          'listings/LIST-001/existing-a.jpg',
          'listings/LIST-001/existing-b.jpg',
          'listings/LIST-001/new.jpg',
        ],
      },
      objectKey: 'listings/LIST-001/new.jpg',
      publicUrl: 'https://cdn.example.com/new.jpg',
    });
  });

  it('includes the uploaded object key when metadata persistence fails', async () => {
    getSidecarDataAccessMock.mockReturnValue({
      listings: {
        getByListingId: getByListingIdMock.mockResolvedValue({
          image_urls: [],
          r2_object_keys: [],
          updated_at: '2026-05-19T14:00:00.000Z',
        }),
        saveImageMetadata: saveImageMetadataMock.mockRejectedValue(
          new Error('database unavailable')
        ),
      },
    });
    uploadImageMock.mockResolvedValue({
      objectKey: 'listings/LIST-001/new.jpg',
      publicUrl: 'https://cdn.example.com/new.jpg',
    });

    const { uploadListingImage } = await import('@/data/upload-listing-image.js');

    await expect(
      uploadListingImage({
        listingId: 'LIST-001',
        filename: 'new.jpg',
        contentType: 'image/jpeg',
        body: Buffer.from('bytes'),
      })
    ).rejects.toThrow(
      /Failed to persist uploaded listing image metadata for listing "LIST-001" after uploading R2 object "listings\/LIST-001\/new.jpg"/
    );
  });
});

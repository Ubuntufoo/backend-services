import { describe, expect, it } from 'vitest';
import {
  GeminiDraftValidationError,
  generateListingDraft,
} from '@/gemini/index.js';

describe('generateListingDraft', () => {
  it('rejects missing or empty listingId', async () => {
    await expect(
      generateListingDraft({
        imageUrls: ['https://cdn.example.com/listing.jpg'],
      } as never)
    ).rejects.toBeInstanceOf(GeminiDraftValidationError);

    await expect(
      generateListingDraft({
        listingId: '   ',
        imageUrls: ['https://cdn.example.com/listing.jpg'],
      })
    ).rejects.toThrow('listingId');
  });

  it('rejects missing or empty imageUrls', async () => {
    await expect(
      generateListingDraft({
        listingId: 'LIST-001',
      } as never)
    ).rejects.toThrow('imageUrls is required');

    await expect(
      generateListingDraft({
        listingId: 'LIST-001',
        imageUrls: [],
      })
    ).rejects.toThrow('imageUrls must contain at least one image URL');
  });

  it('rejects non-string or empty imageUrls entries', async () => {
    await expect(
      generateListingDraft({
        listingId: 'LIST-001',
        imageUrls: [42 as never],
      })
    ).rejects.toThrow('imageUrls.0');

    await expect(
      generateListingDraft({
        listingId: 'LIST-001',
        imageUrls: [''],
      })
    ).rejects.toThrow('imageUrls entries must be non-empty strings');
  });

  it('accepts valid input and returns a placeholder draft shape', async () => {
    await expect(
      generateListingDraft({
        listingId: 'LIST-001',
        imageUrls: ['https://cdn.example.com/listing.jpg'],
        userHints: {
          title: 'Vintage camera',
          notes: 'Needs cleaning',
          category: 'Cameras & Photo',
          aspects: {
            Brand: 'Canon',
            Features: ['Manual', 'Film'],
          },
          price: 149.99,
        },
      })
    ).resolves.toEqual({
      title: '',
      description: '',
      categorySuggestion: null,
      conditionSuggestion: null,
      aspects: {},
      priceSuggestion: null,
      confidence: {},
      warnings: ['Gemini generation is not implemented yet.'],
    });
  });
});

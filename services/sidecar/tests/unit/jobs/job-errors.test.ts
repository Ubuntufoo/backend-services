import { describe, expect, it } from 'vitest';
import { GeminiDraftServiceError, GeminiDraftTitleOverflowError } from '@/gemini/index.js';
import { classifyJobError } from '@/jobs/job-errors.js';

describe('classifyJobError generate_ai title failures', () => {
  it('marks deterministic protected title overflow user-fixable with structured context', () => {
    const error = new GeminiDraftTitleOverflowError({
      preCompactionTitle: 'x'.repeat(81),
      preCompactionLength: 81,
      finalTitle: 'x'.repeat(81),
      finalLength: 81,
      protectedComponents: ['Player'],
      omittedComponents: [],
    });
    const classified = classifyJobError('generate_ai', error);

    expect(classified.category).toBe('user_fixable');
    expect(classified.context.title_overflow).toMatchObject({
      preCompactionLength: 81,
      finalLength: 81,
      protectedComponents: ['Player'],
    });
  });

  it('keeps ordinary Gemini service failures recoverable', () => {
    expect(classifyJobError('generate_ai', new GeminiDraftServiceError('network error')).category).toBe(
      'recoverable'
    );
  });
});

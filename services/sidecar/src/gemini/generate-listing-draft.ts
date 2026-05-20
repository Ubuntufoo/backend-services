import { getGeminiDraftClient } from './client.js';
import { loadGeminiDraftConfig } from './config.js';
import {
  GeminiDraftServiceError,
  type GenerateListingDraftInput,
  type GeneratedListingDraft,
  generatedListingDraftSchema,
  validateGenerateListingDraftInput,
} from './contracts.js';
import { buildGenerateListingDraftPrompt } from './prompt.js';

export {
  GeminiDraftServiceError,
  GeminiDraftValidationError,
  aspectValueSchema,
  generateListingDraftInputSchema,
  generatedListingDraftSchema,
  type GenerateListingDraftInput,
  type GeneratedListingDraft,
  type GenerateListingDraftUserHints,
  userHintsSchema,
} from './contracts.js';

export function generateListingDraft(
  input: GenerateListingDraftInput
): Promise<GeneratedListingDraft> {
  return Promise.resolve().then(async () => {
    const validatedInput = validateGenerateListingDraftInput(input);
    const config = loadGeminiDraftConfig();

    if (!config.apiKey) {
      throw new GeminiDraftServiceError(
        'GEMINI_API_KEY is required to generate Gemini listing drafts.'
      );
    }

    const client = getGeminiDraftClient(config.apiKey);
    const prompt = buildGenerateListingDraftPrompt(validatedInput);

    try {
      const rawDraft = await client.generateDraftRaw({
        model: config.model,
        listingId: validatedInput.listingId,
        imageUrls: validatedInput.imageUrls,
        userHints: validatedInput.userHints,
        prompt,
      });

      return generatedListingDraftSchema.parse({
        title: '',
        description: '',
        categorySuggestion: null,
        conditionSuggestion: null,
        aspects: {},
        priceSuggestion: null,
        confidence: {},
        warnings: ['Gemini raw response received; structured parsing is not implemented yet.'],
        rawModelResponse: rawDraft.rawResponse,
      });
    } catch (error) {
      throw new GeminiDraftServiceError(
        `Gemini draft generation failed for listing "${validatedInput.listingId}".`,
        { cause: error }
      );
    }
  });
}

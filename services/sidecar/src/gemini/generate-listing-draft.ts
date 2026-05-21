import { getGeminiDraftClient } from './client.js';
import { loadGeminiDraftConfig } from './config.js';
import {
  GeminiDraftServiceError,
  type GenerateListingDraftInput,
  type GeneratedListingDraft,
  validateGenerateListingDraftInput,
} from './contracts.js';
import { parseGeneratedDraft } from './parse-generated-draft.js';
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

function summarizeGeminiError(error: unknown): string {
  if (error instanceof GeminiDraftServiceError) {
    return error.message;
  }

  if (error instanceof Error) {
    const message = error.message.trim();

    if (message.length > 0) {
      return message.length > 300 ? `${message.slice(0, 297)}...` : message;
    }
  }

  return 'Unknown Gemini draft generation error.';
}

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

      return parseGeneratedDraft(rawDraft.text, rawDraft.rawResponse);
    } catch (error) {
      if (error instanceof GeminiDraftServiceError) {
        throw error;
      }

      throw new GeminiDraftServiceError(
        `Gemini draft generation failed for listing "${validatedInput.listingId}": ${summarizeGeminiError(error)}`,
        { cause: error }
      );
    }
  });
}

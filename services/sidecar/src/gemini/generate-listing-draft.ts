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

export interface GenerateListingDraftOptions {
  model: string;
}

export interface PreparedGenerateListingDraft {
  input: GenerateListingDraftInput;
  execute(options: GenerateListingDraftOptions): Promise<GeneratedListingDraft>;
}

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

function wrapGeminiDraftPreflightError(listingId: string, error: unknown): GeminiDraftServiceError {
  if (error instanceof GeminiDraftServiceError) {
    return error;
  }

  return new GeminiDraftServiceError(
    `Gemini draft preflight failed for listing "${listingId}": ${summarizeGeminiError(error)}`,
    { cause: error instanceof Error ? error : undefined }
  );
}

function wrapGeminiDraftProviderExecutionError(
  listingId: string,
  error: unknown
): GeminiDraftServiceError {
  if (error instanceof GeminiDraftServiceError) {
    return error;
  }

  return new GeminiDraftServiceError(
    `Gemini draft generation failed for listing "${listingId}": ${summarizeGeminiError(error)}`,
    { cause: error instanceof Error ? error : undefined }
  );
}

export function prepareGenerateListingDraft(
  input: GenerateListingDraftInput
): Promise<PreparedGenerateListingDraft> {
  return Promise.resolve().then(async () => {
    const validatedInput = validateGenerateListingDraftInput(input);
    const config = loadGeminiDraftConfig();

    try {
      if (!config.apiKey) {
        throw new GeminiDraftServiceError(
          'GEMINI_API_KEY is required to generate Gemini listing drafts.'
        );
      }

      const client = getGeminiDraftClient(config.apiKey);
      const prompt = buildGenerateListingDraftPrompt(validatedInput);
      const imageParts = await client.prepareImageParts(validatedInput.imageUrls);

      return {
        input: validatedInput,
        execute: async (options) => {
          try {
            const rawDraft = await client.generateDraftRaw({
              imageParts,
              model: options.model,
              prompt,
            });

            return parseGeneratedDraft(rawDraft.text, rawDraft.rawResponse);
          } catch (error) {
            throw wrapGeminiDraftProviderExecutionError(validatedInput.listingId, error);
          }
        },
      };
    } catch (error) {
      throw wrapGeminiDraftPreflightError(validatedInput.listingId, error);
    }
  });
}

export function generateListingDraft(
  input: GenerateListingDraftInput,
  options: GenerateListingDraftOptions
): Promise<GeneratedListingDraft> {
  return Promise.resolve().then(async () => {
    const preparedDraft = await prepareGenerateListingDraft(input);
    return await preparedDraft.execute(options);
  });
}

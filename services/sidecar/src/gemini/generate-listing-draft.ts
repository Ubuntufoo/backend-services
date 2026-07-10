import { getGeminiDraftClient } from './client.js';
import { loadGeminiDraftConfig } from './config.js';
import {
  type GenerateAiAttemptDiagnostics,
  type GenerateAiLatencyDiagnostics,
  type GenerateAiPayloadDiagnostics,
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
  type GenerateAiAttemptDiagnostics,
  type GenerateAiLatencyDiagnostics,
  type GenerateAiPayloadDiagnostics,
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

export interface PreparedGenerateListingDraftExecutionResult {
  diagnostics: GenerateAiAttemptDiagnostics;
  draft: GeneratedListingDraft;
}

export interface PreparedGenerateListingDraft {
  diagnostics: {
    latency: {
      prepareDraftMs: number;
    };
    payload: GenerateAiPayloadDiagnostics;
  };
  input: GenerateListingDraftInput;
  execute(options: GenerateListingDraftOptions): Promise<PreparedGenerateListingDraftExecutionResult>;
}

const nowMs = () => performance.now();
const elapsedMs = (startedAt: number) => Math.max(0, Math.round(performance.now() - startedAt));

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
  error: unknown,
  diagnostics?: GenerateAiAttemptDiagnostics
): GeminiDraftServiceError {
  if (error instanceof GeminiDraftServiceError) {
    return error;
  }

  return new GeminiDraftServiceError(
    `Gemini draft generation failed for listing "${listingId}": ${summarizeGeminiError(error)}`,
    {
      cause: error instanceof Error ? error : undefined,
      diagnostics,
    }
  );
}

export function prepareGenerateListingDraft(
  input: GenerateListingDraftInput
): Promise<PreparedGenerateListingDraft> {
  return Promise.resolve().then(async () => {
    const prepareStartedAt = nowMs();
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
      const promptBytes = Buffer.byteLength(prompt);
      const preparedImageParts = await client.prepareImageParts(validatedInput.imageUrls);
      const payloadDiagnostics: GenerateAiPayloadDiagnostics = {
        imageCount: validatedInput.imageUrls.length,
        inlineImageBytesApprox: preparedImageParts.inlineImageBytesApprox,
        preparedImagePartCount: preparedImageParts.imageParts.length,
        promptBytes,
      };

      return {
        diagnostics: {
          latency: {
            prepareDraftMs: elapsedMs(prepareStartedAt),
          },
          payload: payloadDiagnostics,
        },
        input: validatedInput,
        execute: async (options) => {
          const modelStartedAt = nowMs();
          let rawDraft;

          try {
            rawDraft = await client.generateDraftRaw({
              imageParts: preparedImageParts.imageParts,
              model: options.model,
              prompt,
            });
          } catch (error) {
            throw wrapGeminiDraftProviderExecutionError(validatedInput.listingId, error, {
              latency: {
                modelMs: elapsedMs(modelStartedAt),
              },
              payload: payloadDiagnostics,
            });
          }

          const modelMs = elapsedMs(modelStartedAt);
          const parseStartedAt = nowMs();

          try {
            const draft = parseGeneratedDraft(rawDraft.text, rawDraft.rawResponse, {
              imageCount: validatedInput.imageUrls.length,
            });

            return {
              diagnostics: {
                latency: {
                  modelMs,
                  parseMs: elapsedMs(parseStartedAt),
                },
                payload: payloadDiagnostics,
              },
              draft,
            };
          } catch (error) {
            throw wrapGeminiDraftProviderExecutionError(validatedInput.listingId, error, {
              latency: {
                modelMs,
                parseMs: elapsedMs(parseStartedAt),
              },
              payload: payloadDiagnostics,
            });
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
    return (await preparedDraft.execute(options)).draft;
  });
}

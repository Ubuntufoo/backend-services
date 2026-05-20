import { loadEnv } from '@ebay-inventory/env';
import { z } from 'zod';
import { loadRootEnvironment } from '@/config/env-paths.js';

loadRootEnvironment();

const geminiDraftEnvSchema = z.object({
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
});

export const DEFAULT_GEMINI_DRAFT_MODEL = 'gemini-3-flash-preview';

export interface GeminiDraftConfig {
  apiKey?: string;
  model: string;
}

export function loadGeminiDraftConfig(env: NodeJS.ProcessEnv = process.env): GeminiDraftConfig {
  const loaded = loadEnv({
    serviceName: 'gemini',
    schema: geminiDraftEnvSchema,
    env,
  });

  const apiKey = loaded.GEMINI_API_KEY?.trim();
  const model = loaded.GEMINI_MODEL?.trim();

  return {
    apiKey: apiKey && apiKey.length > 0 ? apiKey : undefined,
    model: model && model.length > 0 ? model : DEFAULT_GEMINI_DRAFT_MODEL,
  };
}

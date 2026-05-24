import { z } from 'zod';
import type { EbayOAuthValidationConfig } from '@/ebay/config.js';

const ebayOAuthTokenResponseSchema = z.object({
  access_token: z.string().min(1, 'eBay OAuth response is missing access_token'),
  expires_in: z.number().int().positive('eBay OAuth response is missing expires_in'),
  token_type: z.string().min(1, 'eBay OAuth response is missing token_type'),
});

const ebayOAuthErrorResponseSchema = z
  .object({
    error: z.string().optional(),
    error_description: z.string().optional(),
    message: z.string().optional(),
    access_token: z.string().optional(),
    refresh_token: z.string().optional(),
  })
  .passthrough();

export interface EbayAccessTokenMetadata {
  accessToken: string;
  expiresIn: number;
  tokenType: string;
}

export interface ExchangeRefreshTokenOptions {
  fetchImpl?: typeof fetch;
}

export class EbayOAuthRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'EbayOAuthRequestError';
    this.status = status;
  }
}

function redactValue(input: string, value: string | undefined): string {
  if (!value) {
    return input;
  }

  return input.split(value).join('[REDACTED]');
}

function sanitizeMessage(message: string, sensitiveValues: Array<string | undefined>): string {
  let sanitized = message;

  for (const value of sensitiveValues) {
    sanitized = redactValue(sanitized, value);
  }

  return sanitized;
}

async function extractSafeErrorMessage(
  response: Response,
  config: EbayOAuthValidationConfig
): Promise<string> {
  const responseText = await response.text();
  const fallbackMessage = response.statusText || 'Request failed';
  let message = fallbackMessage;
  let responseSecrets: Array<string | undefined> = [];

  if (responseText.trim().length > 0) {
    try {
      const payload = ebayOAuthErrorResponseSchema.parse(JSON.parse(responseText) as unknown);
      responseSecrets = [payload.access_token, payload.refresh_token];
      message =
        payload.error_description ??
        payload.message ??
        payload.error ??
        fallbackMessage;
    } catch {
      message = responseText.trim();
    }
  }

  return sanitizeMessage(message, [
    config.clientSecret,
    config.refreshToken,
    ...responseSecrets,
  ]);
}

export async function exchangeRefreshTokenForAccessToken(
  config: EbayOAuthValidationConfig,
  options: ExchangeRefreshTokenOptions = {}
): Promise<EbayAccessTokenMetadata> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: config.refreshToken,
  });

  try {
    const response = await fetchImpl(config.oauthBaseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      const message = await extractSafeErrorMessage(response, config);
      throw new EbayOAuthRequestError(
        response.status,
        `eBay OAuth refresh failed (${response.status}): ${message}`
      );
    }

    const parsed = ebayOAuthTokenResponseSchema.parse(await response.json());

    return {
      accessToken: parsed.access_token,
      expiresIn: parsed.expires_in,
      tokenType: parsed.token_type,
    };
  } catch (error) {
    if (error instanceof EbayOAuthRequestError) {
      throw error;
    }

    const message = sanitizeMessage(
      error instanceof Error ? error.message : String(error),
      [config.clientSecret, config.refreshToken]
    );

    throw new Error(`eBay OAuth refresh failed: ${message}`);
  }
}

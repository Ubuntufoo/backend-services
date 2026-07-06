import { z } from 'zod';

export function redactPricingSensitiveText(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/\b(?:Bearer|bearer)\s+[A-Za-z0-9._~+/=-]+\b/g, 'Bearer [redacted-token]')
    .replace(
      /\b(?:token|api[_-]?key|access[_-]?token|refresh[_-]?token|key|apikey|apiKey)\s*[:=]\s*([^\s,&]+)/gi,
      (_match, secret: string) => `[redacted-secret:${maskSecret(secret)}]`
    );
}

export function truncateRedactedText(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, ' ').trim();

  if (normalized.length <= maxLength) {
    return redactPricingSensitiveText(normalized);
  }

  return `${redactPricingSensitiveText(normalized.slice(0, maxLength - 3))}...`;
}

export function compactRedactedMessage(value: string, maxLength = 240): string {
  const normalized = redactPricingSensitiveText(value).replace(/\s+/g, ' ').trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

export function extractZodErrorMessage(error: unknown, fallbackMessage: string): string {
  if (!(error instanceof z.ZodError)) {
    return error instanceof Error ? error.message : fallbackMessage;
  }

  const issue = error.issues[0];
  if (!issue) {
    return fallbackMessage;
  }

  const path = issue.path.length > 0 ? issue.path.join('.') : 'payload';
  return `${path}: ${issue.message}`;
}

export function isNetworkLikeError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('network') ||
    message.includes('socket') ||
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('enotfound') ||
    message.includes('timed out') ||
    message.includes('timeout')
  );
}

export async function readResponseText(
  response: { text(): Promise<string> },
  fallbackMessage: string
): Promise<string> {
  try {
    return await response.text();
  } catch {
    return fallbackMessage;
  }
}

export function sanitizeRedactedUnknown(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactPricingSensitiveText(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeRedactedUnknown(entry));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, sanitizeRedactedUnknown(entryValue)])
    );
  }

  return value;
}

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return '***';
  }

  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

import { EventEmitter } from 'node:events';

export type VariationListingActionName =
  | 'publish'
  | 'publish_changes'
  | 'retry'
  | 'quantity'
  | 'withdraw'
  | 'abandon'
  | 'cleanup';

export type VariationListingActionEvent = {
  action: VariationListingActionName;
  at: string;
  groupId: string;
  kind: 'action_started' | 'action_progress' | 'action_succeeded' | 'action_failed';
  stage: string;
  status?: unknown;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

const sensitiveKey = /^(?:authorization|cookie|headers?|request|response|body|data|config|cause|stack|token|access[_-]?token|refresh[_-]?token|secret|password|credential)$/i;
function sanitizeText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, '$1[redacted]:[redacted]@')
    .replace(/(https?:\/\/[^\s?#]+)\?[^#\s]*/gi, '$1?[redacted]')
    .replace(/([?&](?:token|access_token|refresh_token|signature|sig|key|api_key|auth|password|secret|cookie|x-amz-[^=&\s]+)=)[^&#\s]*/gi, '$1[redacted]')
    .replace(/\b(token|access[_-]?token|refresh[_-]?token|signature|secret|password|cookie)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 500);
}

function sanitizeStatus(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[redacted]';
  if (typeof value === 'string') return sanitizeText(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeStatus(item, depth + 1));
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (sensitiveKey.test(key)) continue;
      result[key] = sanitizeStatus(child, depth + 1);
    }
    return result;
  }
  return undefined;
}

export function emitVariationListingActionEvent(event: VariationListingActionEvent): void {
  emitter.emit(event.groupId, sanitizeStatus(event) as VariationListingActionEvent);
}

export function subscribeVariationListingActionEvents(
  groupId: string,
  listener: (event: VariationListingActionEvent) => void
): () => void {
  emitter.on(groupId, listener);
  return () => emitter.off(groupId, listener);
}

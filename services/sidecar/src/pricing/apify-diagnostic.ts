const DEFAULT_MIN_SOLD_COMPS = 12;
const DEFAULT_TIMEOUT_SECONDS = 120;
const APIFY_API_BASE_URL = 'https://api.apify.com/v2';

export const APIFY_DIAGNOSTIC_CHECK_NAMES = [
  'apify_enabled',
  'apify_token',
  'apify_actor_id',
  'apify_min_sold_comps',
  'apify_price_timeout_seconds',
  'apify_actor_metadata',
] as const;

export type ApifyDiagnosticCheckName = (typeof APIFY_DIAGNOSTIC_CHECK_NAMES)[number];
export type ApifyDiagnosticCheckStatus = 'pass' | 'fail' | 'skipped';
export type ApifyPricingDiagnosticStatus = 'pass' | 'fail';

export interface ApifyPricingDiagnosticCheck {
  details: Record<string, unknown>;
  message: string;
  name: ApifyDiagnosticCheckName;
  status: ApifyDiagnosticCheckStatus;
}

export interface ApifyActorMetadata {
  actorId: string;
  actorName?: string;
  actorUsername?: string;
}

export interface ApifyPricingDiagnosticReport {
  actorId: string | null;
  checkedAt: string;
  checks: ApifyPricingDiagnosticCheck[];
  enabled: boolean;
  metadata: {
    actor: ApifyActorMetadata | null;
    attempted: boolean;
  };
  minSoldComps: number | null;
  overallStatus: ApifyPricingDiagnosticStatus;
  timeoutSeconds: number | null;
  token: {
    configured: boolean;
    redacted: string | null;
  };
}

export interface CheckApifyActorMetadataInput {
  actorId: string;
  token: string;
}

export interface ApifyPricingDiagnosticDependencies {
  checkActorMetadata?: (input: CheckApifyActorMetadataInput) => Promise<ApifyActorMetadata>;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}

interface ParsedPositiveInteger {
  issues: string[];
  value: number | null;
}

interface RuntimeApifyConfig {
  actorId: string | null;
  enabled: boolean;
  minSoldComps: ParsedPositiveInteger;
  timeoutSeconds: ParsedPositiveInteger;
  token: string | null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseEnabled(value: unknown): boolean {
  return asTrimmedString(value)?.toLowerCase() === 'true';
}

function parsePositiveInteger(value: unknown, name: string, defaultValue: number): ParsedPositiveInteger {
  const normalized = asTrimmedString(value);

  if (normalized === null) {
    return {
      issues: [],
      value: defaultValue,
    };
  }

  if (!/^[1-9]\d*$/.test(normalized)) {
    return {
      issues: [`${name} must be a positive integer.`],
      value: null,
    };
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return {
      issues: [`${name} must be a positive integer.`],
      value: null,
    };
  }

  return {
    issues: [],
    value: parsed,
  };
}

function redactToken(token: string | null): string | null {
  if (!token) {
    return null;
  }

  return `[redacted:${Math.min(token.length, 8)}chars]`;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, 'Bearer [redacted-token]')
    .replace(/\b(?:token|api[_-]?key|access[_-]?token|refresh[_-]?token)=([^\s&]+)/gi, '[redacted-secret]');
}

function toErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = redactSensitiveText(message).replace(/\s+/g, ' ').trim();

  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 237)}...`;
}

function buildCheck(
  name: ApifyDiagnosticCheckName,
  status: ApifyDiagnosticCheckStatus,
  message: string,
  details: Record<string, unknown> = {}
): ApifyPricingDiagnosticCheck {
  return {
    details,
    message,
    name,
    status,
  };
}

function parseRuntimeApifyConfig(env: NodeJS.ProcessEnv): RuntimeApifyConfig {
  return {
    actorId: asTrimmedString(env.APIFY_PRICE_ACTOR_ID),
    enabled: parseEnabled(env.APIFY_ENABLED),
    minSoldComps: parsePositiveInteger(
      env.APIFY_MIN_SOLD_COMPS,
      'APIFY_MIN_SOLD_COMPS',
      DEFAULT_MIN_SOLD_COMPS
    ),
    timeoutSeconds: parsePositiveInteger(
      env.APIFY_PRICE_TIMEOUT_SECONDS,
      'APIFY_PRICE_TIMEOUT_SECONDS',
      DEFAULT_TIMEOUT_SECONDS
    ),
    token: asTrimmedString(env.APIFY_TOKEN),
  };
}

export async function checkApifyActorMetadata(
  input: CheckApifyActorMetadataInput,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch
): Promise<ApifyActorMetadata> {
  const endpoint = `${APIFY_API_BASE_URL}/acts/${encodeURIComponent(input.actorId)}`;
  const response = await fetchImpl(endpoint, {
    headers: {
      Authorization: `Bearer ${input.token}`,
      Accept: 'application/json',
    },
    method: 'GET',
  });

  if (!response.ok) {
    const responseText = await readResponseText(response);
    const suffix = responseText ? `: ${responseText}` : '';
    throw new Error(`Apify actor metadata request failed with status ${response.status}${suffix}`);
  }

  const payload = (await response.json()) as {
    data?: {
      id?: unknown;
      name?: unknown;
      username?: unknown;
    };
  };

  const actorId = asTrimmedString(payload.data?.id);

  if (!actorId) {
    throw new Error('Apify actor metadata response missing actor id.');
  }

  return {
    actorId,
    ...(asTrimmedString(payload.data?.name) ? { actorName: asTrimmedString(payload.data?.name)! } : {}),
    ...(asTrimmedString(payload.data?.username)
      ? { actorUsername: asTrimmedString(payload.data?.username)! }
      : {}),
  };
}

async function readResponseText(response: { text(): Promise<string> }): Promise<string> {
  try {
    return redactSensitiveText((await response.text()).replace(/\s+/g, ' ').trim());
  } catch {
    return '';
  }
}

export async function getApifyPricingDiagnostic(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: ApifyPricingDiagnosticDependencies = {}
): Promise<ApifyPricingDiagnosticReport> {
  const now = dependencies.now ?? (() => new Date());
  const config = parseRuntimeApifyConfig(env);
  const checks: ApifyPricingDiagnosticCheck[] = [];

  checks.push(
    buildCheck(
      'apify_enabled',
      'pass',
      config.enabled
        ? 'APIFY_ENABLED=true. Apify pricing diagnostics active.'
        : 'APIFY_ENABLED=false. Apify pricing diagnostics disabled by config.',
      {
        value: config.enabled,
      }
    )
  );

  if (!config.enabled) {
    checks.push(
      buildCheck('apify_token', 'skipped', 'APIFY_TOKEN not required while Apify pricing disabled.'),
      buildCheck(
        'apify_actor_id',
        'skipped',
        'APIFY_PRICE_ACTOR_ID not required while Apify pricing disabled.'
      ),
      buildCheck(
        'apify_min_sold_comps',
        config.minSoldComps.value === null ? 'fail' : 'pass',
        config.minSoldComps.value === null
          ? config.minSoldComps.issues[0]
          : 'APIFY_MIN_SOLD_COMPS valid.',
        {
          value: config.minSoldComps.value,
        }
      ),
      buildCheck(
        'apify_price_timeout_seconds',
        config.timeoutSeconds.value === null ? 'fail' : 'pass',
        config.timeoutSeconds.value === null
          ? config.timeoutSeconds.issues[0]
          : 'APIFY_PRICE_TIMEOUT_SECONDS valid.',
        {
          value: config.timeoutSeconds.value,
        }
      ),
      buildCheck(
        'apify_actor_metadata',
        'skipped',
        'Apify actor metadata check skipped while Apify pricing disabled.'
      )
    );

    return buildReport(config, checks, now().toISOString(), {
      actor: null,
      attempted: false,
    });
  }

  checks.push(
    buildCheck(
      'apify_token',
      config.token ? 'pass' : 'fail',
      config.token ? 'APIFY_TOKEN configured.' : 'APIFY_TOKEN required when APIFY_ENABLED=true.',
      {
        configured: config.token !== null,
        redacted: redactToken(config.token),
      }
    )
  );
  checks.push(
    buildCheck(
      'apify_actor_id',
      config.actorId ? 'pass' : 'fail',
      config.actorId
        ? 'APIFY_PRICE_ACTOR_ID configured.'
        : 'APIFY_PRICE_ACTOR_ID required when APIFY_ENABLED=true.',
      {
        actorId: config.actorId,
        configured: config.actorId !== null,
      }
    )
  );
  checks.push(
    buildCheck(
      'apify_min_sold_comps',
      config.minSoldComps.value === null ? 'fail' : 'pass',
      config.minSoldComps.value === null
        ? config.minSoldComps.issues[0]
        : 'APIFY_MIN_SOLD_COMPS valid.',
      {
        value: config.minSoldComps.value,
      }
    )
  );
  checks.push(
    buildCheck(
      'apify_price_timeout_seconds',
      config.timeoutSeconds.value === null ? 'fail' : 'pass',
      config.timeoutSeconds.value === null
        ? config.timeoutSeconds.issues[0]
        : 'APIFY_PRICE_TIMEOUT_SECONDS valid.',
      {
        value: config.timeoutSeconds.value,
      }
    )
  );

  const metadataEligible =
    config.token !== null &&
    config.actorId !== null &&
    config.minSoldComps.value !== null &&
    config.timeoutSeconds.value !== null;

  if (!metadataEligible) {
    checks.push(
      buildCheck(
        'apify_actor_metadata',
        'skipped',
        'Apify actor metadata check skipped until required config passes validation.'
      )
    );

    return buildReport(config, checks, now().toISOString(), {
      actor: null,
      attempted: false,
    });
  }

  const metadataChecker =
    dependencies.checkActorMetadata ??
    ((input: CheckApifyActorMetadataInput) =>
      checkApifyActorMetadata(input, dependencies.fetch ?? globalThis.fetch));

  try {
    const actor = await metadataChecker({
      actorId: config.actorId!,
      token: config.token!,
    });

    checks.push(
      buildCheck('apify_actor_metadata', 'pass', 'Apify actor metadata check succeeded.', {
        actor,
      })
    );

    return buildReport(config, checks, now().toISOString(), {
      actor,
      attempted: true,
    });
  } catch (error) {
    checks.push(
      buildCheck('apify_actor_metadata', 'fail', toErrorMessage(error), {
        actorId: config.actorId,
      })
    );

    return buildReport(config, checks, now().toISOString(), {
      actor: null,
      attempted: true,
    });
  }
}

function buildReport(
  config: RuntimeApifyConfig,
  checks: ApifyPricingDiagnosticCheck[],
  checkedAt: string,
  metadata: ApifyPricingDiagnosticReport['metadata']
): ApifyPricingDiagnosticReport {
  return {
    actorId: config.actorId,
    checkedAt,
    checks,
    enabled: config.enabled,
    metadata,
    minSoldComps: config.minSoldComps.value,
    overallStatus: checks.some((check) => check.status === 'fail') ? 'fail' : 'pass',
    timeoutSeconds: config.timeoutSeconds.value,
    token: {
      configured: config.token !== null,
      redacted: redactToken(config.token),
    },
  };
}

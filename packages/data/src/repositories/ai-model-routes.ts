import type {
  AiModelCatalogRow,
  AiModelTaskRouteRow,
} from '../database.js';
import type { SupabaseDataClient } from '../client.js';
import type { MultiResult } from './shared.js';

export interface ResolveAiModelRoutesInput {
  freeTierOnly?: boolean;
  provider?: string;
  requireImages?: boolean;
  requireJsonOutput?: boolean;
  requireStructuredOutput?: boolean;
  taskType: string;
}

export interface ResolvedAiModelRoute {
  displayName: string | null;
  fallbackOnQuotaExceeded: boolean;
  fallbackOnRateLimit: boolean;
  fallbackOnUnavailable: boolean;
  freeTierStatus: AiModelCatalogRow['free_tier_status'];
  isFreeTierEligible: boolean;
  modelName: string;
  provider: string;
  routeOrder: number;
  supportsImages: boolean;
  supportsJsonOutput: boolean;
  supportsStructuredOutput: boolean;
  supportsText: boolean;
  taskType: string;
}

export class AiModelRouteNotFoundError extends Error {
  readonly context: ResolveAiModelRoutesInput;

  constructor(input: ResolveAiModelRoutesInput) {
    super(
      `No eligible AI model route is configured for task "${input.taskType}"` +
        `${input.provider ? ` and provider "${input.provider}"` : ''}.`
    );
    this.name = 'AiModelRouteNotFoundError';
    this.context = input;
  }
}

interface JoinedCatalogRow extends Pick<
  AiModelCatalogRow,
  | 'display_name'
  | 'free_tier_status'
  | 'is_enabled'
  | 'is_free_tier_eligible'
  | 'supports_images'
  | 'supports_json_output'
  | 'supports_structured_output'
  | 'supports_text'
> {}

interface JoinedRouteRow
  extends Pick<
    AiModelTaskRouteRow,
    | 'fallback_on_quota_exceeded'
    | 'fallback_on_rate_limit'
    | 'fallback_on_unavailable'
    | 'is_enabled'
    | 'model_name'
    | 'provider'
    | 'require_images'
    | 'require_json_output'
    | 'require_structured_output'
    | 'route_order'
    | 'task_type'
  > {
  catalog: JoinedCatalogRow | JoinedCatalogRow[] | null;
}

function getJoinedCatalog(row: JoinedRouteRow): JoinedCatalogRow | null {
  if (Array.isArray(row.catalog)) {
    return row.catalog[0] ?? null;
  }

  return row.catalog;
}

function matchesRequirements(
  row: JoinedRouteRow,
  catalog: JoinedCatalogRow,
  input: ResolveAiModelRoutesInput
): boolean {
  if (!row.is_enabled || !catalog.is_enabled) {
    return false;
  }

  if (row.require_images && !catalog.supports_images) {
    return false;
  }

  if (row.require_json_output && !catalog.supports_json_output) {
    return false;
  }

  if (row.require_structured_output && !catalog.supports_structured_output) {
    return false;
  }

  if (input.freeTierOnly && !catalog.is_free_tier_eligible) {
    return false;
  }

  if (input.requireImages && !catalog.supports_images) {
    return false;
  }

  if (input.requireJsonOutput && !catalog.supports_json_output) {
    return false;
  }

  if (input.requireStructuredOutput && !catalog.supports_structured_output) {
    return false;
  }

  return true;
}

function mapResolvedRoute(
  row: JoinedRouteRow,
  catalog: JoinedCatalogRow
): ResolvedAiModelRoute {
  return {
    displayName: catalog.display_name,
    fallbackOnQuotaExceeded: row.fallback_on_quota_exceeded,
    fallbackOnRateLimit: row.fallback_on_rate_limit,
    fallbackOnUnavailable: row.fallback_on_unavailable,
    freeTierStatus: catalog.free_tier_status,
    isFreeTierEligible: catalog.is_free_tier_eligible,
    modelName: row.model_name,
    provider: row.provider,
    routeOrder: row.route_order,
    supportsImages: catalog.supports_images,
    supportsJsonOutput: catalog.supports_json_output,
    supportsStructuredOutput: catalog.supports_structured_output,
    supportsText: catalog.supports_text,
    taskType: row.task_type,
  };
}

export async function resolveAiModelRoutesForTask(
  client: SupabaseDataClient,
  input: ResolveAiModelRoutesInput
): Promise<ResolvedAiModelRoute[]> {
  let query = client
    .from('ai_model_task_routes')
    .select(
      `task_type, provider, model_name, route_order, is_enabled, require_images, require_json_output, require_structured_output, fallback_on_rate_limit, fallback_on_quota_exceeded, fallback_on_unavailable, catalog:ai_model_catalog!inner(display_name, free_tier_status, is_enabled, is_free_tier_eligible, supports_text, supports_images, supports_json_output, supports_structured_output)`
    )
    .eq('task_type', input.taskType)
    .eq('is_enabled', true);

  if (input.provider) {
    query = query.eq('provider', input.provider);
  }

  const result = (await query.order('route_order', { ascending: true })) as MultiResult<JoinedRouteRow>;

  if (result.error) {
    throw new Error(result.error.message);
  }

  return (result.data ?? []).flatMap((row) => {
    const catalog = getJoinedCatalog(row);

    if (!catalog || !matchesRequirements(row, catalog, input)) {
      return [];
    }

    return [mapResolvedRoute(row, catalog)];
  });
}

export async function resolvePrimaryAiModelRouteForTask(
  client: SupabaseDataClient,
  input: ResolveAiModelRoutesInput
): Promise<ResolvedAiModelRoute> {
  const routes = await resolveAiModelRoutesForTask(client, input);
  const primaryRoute = routes[0];

  if (!primaryRoute) {
    throw new AiModelRouteNotFoundError(input);
  }

  return primaryRoute;
}

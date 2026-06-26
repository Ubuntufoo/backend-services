import { describe, expect, it, vi } from 'vitest';
import type { SupabaseDataClient } from '../src/index.js';
import {
  AiModelRouteNotFoundError,
  resolveAiModelRoutesForTask,
  resolvePrimaryAiModelRouteForTask,
} from '../src/index.js';

interface JoinedCatalogRow {
  display_name: string | null;
  free_tier_daily_request_limit?: number | null;
  free_tier_status: string;
  is_enabled: boolean;
  is_free_tier_eligible: boolean;
  requests_per_day: number | null;
  requests_per_minute: number | null;
  supports_images: boolean;
  supports_json_output: boolean;
  supports_structured_output: boolean;
  supports_text: boolean;
}

interface JoinedRouteRow {
  catalog: JoinedCatalogRow | JoinedCatalogRow[] | null;
  fallback_on_quota_exceeded: boolean;
  fallback_on_rate_limit: boolean;
  fallback_on_unavailable: boolean;
  is_enabled: boolean;
  model_name: string;
  provider: string;
  require_images: boolean;
  require_json_output: boolean;
  require_structured_output: boolean;
  route_order: number;
  task_type: string;
}

const baseCatalogRow: JoinedCatalogRow = {
  display_name: 'Gemini 3.1 Flash Lite',
  free_tier_status: 'confirmed',
  is_enabled: true,
  is_free_tier_eligible: true,
  requests_per_day: null,
  requests_per_minute: null,
  supports_images: true,
  supports_json_output: true,
  supports_structured_output: true,
  supports_text: true,
};

function createJoinedRouteRow(overrides: Partial<JoinedRouteRow> = {}): JoinedRouteRow {
  return {
    catalog: baseCatalogRow,
    fallback_on_quota_exceeded: true,
    fallback_on_rate_limit: true,
    fallback_on_unavailable: true,
    is_enabled: true,
    model_name: 'gemini-3.1-flash-lite',
    provider: 'google',
    require_images: false,
    require_json_output: true,
    require_structured_output: true,
    route_order: 1,
    task_type: 'listing_draft_generation',
    ...overrides,
  };
}

function createAiModelRouteResolverClient(
  expectedRows: JoinedRouteRow[],
  options: {
    provider?: string;
    taskType?: string;
  } = {}
): SupabaseDataClient {
  const {
    provider = 'google',
    taskType = 'listing_draft_generation',
  } = options;

  return {
    from: vi.fn((name: string) => {
      expect(name).toBe('ai_model_task_routes');

      return {
        select: vi.fn((columns: string) => {
          expect(columns).toContain('catalog:ai_model_catalog!inner');
          expect(columns).toContain('require_images');
          expect(columns).toContain('require_json_output');
          expect(columns).toContain('require_structured_output');

          return {
            eq: vi.fn((taskColumn: string, taskValue: string) => {
              expect(taskColumn).toBe('task_type');
              expect(taskValue).toBe(taskType);

              return {
                eq: vi.fn((secondColumn: string, secondValue: boolean | string) => {
                  if (secondColumn === 'is_enabled') {
                    expect(secondValue).toBe(true);

                    return {
                      eq: vi.fn((providerColumn: string, providerValue: string) => {
                        expect(providerColumn).toBe('provider');
                        expect(providerValue).toBe(provider);

                        return {
                          order: vi.fn(async (orderColumn: string, options: { ascending: boolean }) => {
                            expect(orderColumn).toBe('route_order');
                            expect(options).toEqual({ ascending: true });

                            return {
                              data: expectedRows,
                              error: null,
                            };
                          }),
                        };
                      }),
                    };
                  }

                  throw new Error(`Unexpected eq filter ${secondColumn}`);
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

describe('ai model routes repository', () => {
  it('returns enabled routes ordered by route_order', async () => {
    const client = createAiModelRouteResolverClient([
      createJoinedRouteRow({
        catalog: {
          ...baseCatalogRow,
          display_name: 'Gemini 3 Flash Preview',
        },
        model_name: 'gemini-3-flash-preview',
        route_order: 1,
      }),
      createJoinedRouteRow({
        catalog: {
          ...baseCatalogRow,
          display_name: 'Gemini 3.5 Flash',
        },
        model_name: 'gemini-3.5-flash',
        route_order: 2,
      }),
      createJoinedRouteRow({
        catalog: {
          ...baseCatalogRow,
          display_name: 'Gemini 3.1 Flash Lite',
        },
        model_name: 'gemini-3.1-flash-lite',
        route_order: 3,
      }),
      createJoinedRouteRow({
        catalog: {
          ...baseCatalogRow,
          display_name: 'Ignored Inactive Model',
          is_enabled: false,
        },
        model_name: 'ignored-inactive-model',
        route_order: 4,
      }),
    ]);

    const routes = await resolveAiModelRoutesForTask(client, {
      provider: 'google',
      requireImages: true,
      requireJsonOutput: true,
      requireStructuredOutput: true,
      taskType: 'listing_draft_generation',
    });

    expect(routes).toEqual([
      expect.objectContaining({
        displayName: 'Gemini 3 Flash Preview',
        modelName: 'gemini-3-flash-preview',
        provider: 'google',
        requestsPerDay: null,
        requestsPerMinute: null,
        routeOrder: 1,
      }),
      expect.objectContaining({
        displayName: 'Gemini 3.5 Flash',
        modelName: 'gemini-3.5-flash',
        provider: 'google',
        requestsPerDay: null,
        requestsPerMinute: null,
        routeOrder: 2,
      }),
      expect.objectContaining({
        displayName: 'Gemini 3.1 Flash Lite',
        modelName: 'gemini-3.1-flash-lite',
        provider: 'google',
        requestsPerDay: null,
        requestsPerMinute: null,
        routeOrder: 3,
      }),
    ]);
  });

  it('returns Gemma pricing route with per-model limits', async () => {
    const client = createAiModelRouteResolverClient(
      [
        createJoinedRouteRow({
          catalog: {
            ...baseCatalogRow,
            display_name: 'Gemma 4 31B IT',
            free_tier_status: 'verified_paid_only',
            is_free_tier_eligible: false,
            requests_per_day: 1500,
            requests_per_minute: 15,
            supports_images: false,
          },
          model_name: 'gemma-4-31b-it',
          require_images: false,
          route_order: 1,
          task_type: 'pricing_reasoning',
        }),
      ],
      {
        provider: 'google',
        taskType: 'pricing_reasoning',
      }
    );

    const routes = await resolveAiModelRoutesForTask(client, {
      provider: 'google',
      requireJsonOutput: true,
      requireStructuredOutput: true,
      taskType: 'pricing_reasoning',
    });

    expect(routes).toEqual([
      expect.objectContaining({
        displayName: 'Gemma 4 31B IT',
        freeTierStatus: 'verified_paid_only',
        isFreeTierEligible: false,
        modelName: 'gemma-4-31b-it',
        provider: 'google',
        requestsPerDay: 1500,
        requestsPerMinute: 15,
        routeOrder: 1,
        supportsImages: false,
        taskType: 'pricing_reasoning',
      }),
    ]);
  });

  it('excludes disabled catalog models', async () => {
    const client = createAiModelRouteResolverClient([
      createJoinedRouteRow({
        catalog: {
          ...baseCatalogRow,
          is_enabled: false,
        },
      }),
    ]);

    const routes = await resolveAiModelRoutesForTask(client, {
      provider: 'google',
      taskType: 'listing_draft_generation',
    });

    expect(routes).toEqual([]);
  });

  it('excludes disabled task routes', async () => {
    const client = createAiModelRouteResolverClient([
      createJoinedRouteRow({
        is_enabled: false,
      }),
    ]);

    const routes = await resolveAiModelRoutesForTask(client, {
      provider: 'google',
      taskType: 'listing_draft_generation',
    });

    expect(routes).toEqual([]);
  });

  it('excludes disabled pricing task routes', async () => {
    const client = createAiModelRouteResolverClient(
      [
        createJoinedRouteRow({
          is_enabled: false,
          model_name: 'gemma-4-31b-it',
          require_images: false,
          task_type: 'pricing_reasoning',
        }),
      ],
      {
        provider: 'google',
        taskType: 'pricing_reasoning',
      }
    );

    const routes = await resolveAiModelRoutesForTask(client, {
      provider: 'google',
      taskType: 'pricing_reasoning',
    });

    expect(routes).toEqual([]);
  });

  it('excludes disabled pricing catalog models', async () => {
    const client = createAiModelRouteResolverClient(
      [
        createJoinedRouteRow({
          catalog: {
            ...baseCatalogRow,
            is_enabled: false,
            requests_per_day: 1500,
            requests_per_minute: 15,
            supports_images: false,
          },
          model_name: 'gemma-4-31b-it',
          require_images: false,
          task_type: 'pricing_reasoning',
        }),
      ],
      {
        provider: 'google',
        taskType: 'pricing_reasoning',
      }
    );

    const routes = await resolveAiModelRoutesForTask(client, {
      provider: 'google',
      taskType: 'pricing_reasoning',
    });

    expect(routes).toEqual([]);
  });

  it('excludes non-free-tier models when freeTierOnly is true', async () => {
    const client = createAiModelRouteResolverClient([
      createJoinedRouteRow({
        catalog: {
          ...baseCatalogRow,
          is_free_tier_eligible: false,
        },
      }),
    ]);

    const routes = await resolveAiModelRoutesForTask(client, {
      freeTierOnly: true,
      provider: 'google',
      taskType: 'listing_draft_generation',
    });

    expect(routes).toEqual([]);
  });

  it('excludes models without image support when requireImages is true', async () => {
    const client = createAiModelRouteResolverClient([
      createJoinedRouteRow({
        catalog: {
          ...baseCatalogRow,
          supports_images: false,
        },
      }),
    ]);

    const routes = await resolveAiModelRoutesForTask(client, {
      provider: 'google',
      requireImages: true,
      taskType: 'listing_draft_generation',
    });

    expect(routes).toEqual([]);
  });

  it('excludes route-required image models without image support even when caller does not require images', async () => {
    const client = createAiModelRouteResolverClient([
      createJoinedRouteRow({
        catalog: {
          ...baseCatalogRow,
          supports_images: false,
        },
        require_images: true,
        require_json_output: false,
        require_structured_output: false,
      }),
    ]);

    const routes = await resolveAiModelRoutesForTask(client, {
      provider: 'google',
      taskType: 'listing_draft_generation',
    });

    expect(routes).toEqual([]);
  });

  it('excludes models without JSON support when requireJsonOutput is true', async () => {
    const client = createAiModelRouteResolverClient([
      createJoinedRouteRow({
        catalog: {
          ...baseCatalogRow,
          supports_json_output: false,
        },
      }),
    ]);

    const routes = await resolveAiModelRoutesForTask(client, {
      provider: 'google',
      requireJsonOutput: true,
      taskType: 'listing_draft_generation',
    });

    expect(routes).toEqual([]);
  });

  it('excludes route-required JSON models without JSON support even when caller does not require JSON', async () => {
    const client = createAiModelRouteResolverClient([
      createJoinedRouteRow({
        catalog: {
          ...baseCatalogRow,
          supports_json_output: false,
        },
        require_images: false,
        require_json_output: true,
        require_structured_output: false,
      }),
    ]);

    const routes = await resolveAiModelRoutesForTask(client, {
      provider: 'google',
      taskType: 'listing_draft_generation',
    });

    expect(routes).toEqual([]);
  });

  it('excludes models without structured-output support when requireStructuredOutput is true', async () => {
    const client = createAiModelRouteResolverClient([
      createJoinedRouteRow({
        catalog: {
          ...baseCatalogRow,
          supports_structured_output: false,
        },
      }),
    ]);

    const routes = await resolveAiModelRoutesForTask(client, {
      provider: 'google',
      requireStructuredOutput: true,
      taskType: 'listing_draft_generation',
    });

    expect(routes).toEqual([]);
  });

  it('excludes route-required structured-output models without structured support even when caller does not require structured output', async () => {
    const client = createAiModelRouteResolverClient([
      createJoinedRouteRow({
        catalog: {
          ...baseCatalogRow,
          supports_structured_output: false,
        },
        require_images: false,
        require_json_output: false,
        require_structured_output: true,
      }),
    ]);

    const routes = await resolveAiModelRoutesForTask(client, {
      provider: 'google',
      taskType: 'listing_draft_generation',
    });

    expect(routes).toEqual([]);
  });

  it('returns first ordered route as primary', async () => {
    const client = createAiModelRouteResolverClient([
      createJoinedRouteRow({
        catalog: {
          ...baseCatalogRow,
          display_name: 'Gemini 3 Flash Preview',
        },
        model_name: 'gemini-3-flash-preview',
        route_order: 1,
      }),
      createJoinedRouteRow({
        catalog: {
          ...baseCatalogRow,
          display_name: 'Gemini 3.5 Flash',
        },
        model_name: 'gemini-3.5-flash',
        route_order: 2,
      }),
      createJoinedRouteRow({
        model_name: 'gemini-3.1-flash-lite',
        route_order: 3,
      }),
    ]);

    const route = await resolvePrimaryAiModelRouteForTask(client, {
      provider: 'google',
      requireImages: true,
      requireJsonOutput: true,
      requireStructuredOutput: true,
      taskType: 'listing_draft_generation',
    });

    expect(route).toEqual(
      expect.objectContaining({
        modelName: 'gemini-3-flash-preview',
        routeOrder: 1,
      })
    );
  });

  it('returns pricing route as primary for pricing_reasoning', async () => {
    const client = createAiModelRouteResolverClient(
      [
        createJoinedRouteRow({
          catalog: {
            ...baseCatalogRow,
            display_name: 'Gemma 4 31B IT',
            free_tier_status: 'verified_paid_only',
            is_free_tier_eligible: false,
            requests_per_day: 1500,
            requests_per_minute: 15,
            supports_images: false,
          },
          model_name: 'gemma-4-31b-it',
          require_images: false,
          route_order: 1,
          task_type: 'pricing_reasoning',
        }),
      ],
      {
        provider: 'google',
        taskType: 'pricing_reasoning',
      }
    );

    const route = await resolvePrimaryAiModelRouteForTask(client, {
      provider: 'google',
      requireJsonOutput: true,
      requireStructuredOutput: true,
      taskType: 'pricing_reasoning',
    });

    expect(route).toEqual(
      expect.objectContaining({
        modelName: 'gemma-4-31b-it',
        requestsPerDay: 1500,
        requestsPerMinute: 15,
        routeOrder: 1,
        taskType: 'pricing_reasoning',
      })
    );
  });

  it('throws AiModelRouteNotFoundError when no eligible route exists', async () => {
    const client = createAiModelRouteResolverClient([]);

    await expect(
      resolvePrimaryAiModelRouteForTask(client, {
        freeTierOnly: true,
        provider: 'google',
        requireImages: true,
        requireJsonOutput: true,
        requireStructuredOutput: true,
        taskType: 'listing_draft_generation',
      })
    ).rejects.toMatchObject({
      context: {
        freeTierOnly: true,
        provider: 'google',
        requireImages: true,
        requireJsonOutput: true,
        requireStructuredOutput: true,
        taskType: 'listing_draft_generation',
      },
      name: AiModelRouteNotFoundError.name,
    });
  });
});

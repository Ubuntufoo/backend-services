import { describe, expect, it, vi } from 'vitest';
import type { SupabaseDataClient } from '../src/index.js';
import {
  AiModelRouteNotFoundError,
  resolveAiModelRoutesForTask,
  resolvePrimaryAiModelRouteForTask,
} from '../src/index.js';

interface JoinedCatalogRow {
  display_name: string | null;
  free_tier_status: string;
  is_enabled: boolean;
  is_free_tier_eligible: boolean;
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
  route_order: number;
  task_type: string;
}

const baseCatalogRow: JoinedCatalogRow = {
  display_name: 'Gemini 3.1 Flash Lite',
  free_tier_status: 'unknown',
  is_enabled: true,
  is_free_tier_eligible: true,
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
    route_order: 1,
    task_type: 'listing_draft_generation',
    ...overrides,
  };
}

function createAiModelRouteResolverClient(expectedRows: JoinedRouteRow[]): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe('ai_model_task_routes');

      return {
        select: vi.fn((columns: string) => {
          expect(columns).toContain('catalog:ai_model_catalog!inner');

          return {
            eq: vi.fn((taskColumn: string, taskValue: string) => {
              expect(taskColumn).toBe('task_type');
              expect(taskValue).toBe('listing_draft_generation');

              return {
                eq: vi.fn((secondColumn: string, secondValue: boolean | string) => {
                  if (secondColumn === 'is_enabled') {
                    expect(secondValue).toBe(true);

                    return {
                      eq: vi.fn((providerColumn: string, providerValue: string) => {
                        expect(providerColumn).toBe('provider');
                        expect(providerValue).toBe('google');

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
                      order: vi.fn(async (orderColumn: string, options: { ascending: boolean }) => {
                        expect(orderColumn).toBe('route_order');
                        expect(options).toEqual({ ascending: true });

                        return {
                          data: expectedRows,
                          error: null,
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
        model_name: 'gemini-3.1-flash-lite',
        route_order: 1,
      }),
      createJoinedRouteRow({
        catalog: {
          ...baseCatalogRow,
          display_name: 'Gemini 3.1 Flash',
        },
        model_name: 'gemini-3.1-flash',
        route_order: 2,
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
        displayName: 'Gemini 3.1 Flash Lite',
        modelName: 'gemini-3.1-flash-lite',
        provider: 'google',
        routeOrder: 1,
      }),
      expect.objectContaining({
        displayName: 'Gemini 3.1 Flash',
        modelName: 'gemini-3.1-flash',
        provider: 'google',
        routeOrder: 2,
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

  it('returns first ordered route as primary', async () => {
    const client = createAiModelRouteResolverClient([
      createJoinedRouteRow({
        model_name: 'gemini-3.1-flash-lite',
        route_order: 1,
      }),
      createJoinedRouteRow({
        model_name: 'gemini-3.1-flash',
        route_order: 2,
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
        modelName: 'gemini-3.1-flash-lite',
        routeOrder: 1,
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

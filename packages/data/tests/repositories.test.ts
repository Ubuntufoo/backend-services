import { describe, expect, it, vi } from 'vitest';
import type {
  AppSettingsRow,
  AiModelAttemptRow,
  DailyUsageRow,
  JobRow,
  ListingPriceResearchRow,
  ListingRow,
  OrderRow,
  SupabaseDataClient,
} from '../src/index.js';
import {
  approveListingForExport,
  createAiModelAttempt,
  getLatestGeminiUsageAttempt,
  claimApprovedListingForPublish,
  claimDueQueuedJob,
  completeJob,
  createAppSettings,
  createJob,
  createListing,
  createOrder,
  DEFAULT_ORDER_SYNC_DAILY_LIMIT,
  DailyUsageLimitExceededError,
  enqueueGenerateAiJob,
  enqueueProcessImagesJob,
  enqueuePublishJob,
  enqueueResearchPriceJob,
  failJob,
  getPricingProviderMode,
  getEffectiveGeminiDailyLimit,
  getGeminiDailyUsageSummary,
  getEffectiveOrderSyncDailyLimit,
  getAppSettings,
  getActiveGenerateAiJobByListingId,
  getActiveResearchPriceJobByListingId,
  getListingByOfferId,
  getJobById,
  getLatestListingPriceResearchByListingId,
  getOrCreateDailyUsage,
  getListingByListingId,
  getOrderByOrderId,
  incrementGeminiCallsUsed,
  incrementOrderSyncCount,
  isPricingEnabled,
  isPricingProviderModeEnabled,
  listApprovedForExportListings,
  listAiModelAttemptsForListing,
  listAiModelAttemptsForListings,
  listDueQueuedJobs,
  listListings,
  listListingsByStatus,
  listJobsByListingId,
  listJobsByListingIds,
  listStaleRunningJobs,
  markListingPriceResearchFailed,
  markListingPriceResearchSucceeded,
  markAiModelAttemptFailed,
  markAiModelAttemptSucceeded,
  prepareListingForGenerateAi,
  markListingPublishFailed,
  resetJobForManualRetry,
  requeueJob,
  resolveGeminiDailyUsageWindow,
  saveListingArtifacts,
  saveListingImageMetadata,
  saveGeneratedListingFields,
  savePublishedListing,
  setGeminiJobAttemptAudit,
  createListingPriceResearch,
  updateListing,
  updateAppSettings,
  updateJob,
  updateOrder,
} from '../src/index.js';
import { requireSingleResult } from '../src/repositories/shared.js';

const listingRow: ListingRow = {
  approved_for_export_at: null,
  capture_mode: null,
  category_id: null,
  condition_id: null,
  condition_notes: null,
  created_at: '2026-05-17T00:00:00.000Z',
  description: null,
  ebay_listing_id: null,
  ebay_listing_status: null,
  ebay_listing_url: null,
  ebay_offer_id: null,
  ese_eligible: null,
  estimated_weight_oz: null,
  exported_at: null,
  handling_days: null,
  id: 'listing-row-id',
  generated_at: null,
  image_urls: [],
  item_specifics: {},
  last_error_at: null,
  last_error_code: null,
  last_error_context: {},
  last_error_message: null,
  listing_id: 'LIST-001',
  listing_type: null,
  merchant_location_key: null,
  package_type: null,
  price: null,
  r2_delete_after: null,
  r2_deleted_at: null,
  r2_object_keys: [],
  r2_retention_policy: null,
  seller_hints: null,
  shipping_profile: null,
  sku: 'SKU-001',
  sold_at: null,
  status: 'record_created',
  sub_status: 'idle',
  title: null,
  updated_at: '2026-05-17T00:00:00.000Z',
};

const jobRow: JobRow = {
  attempts: 0,
  created_at: '2026-05-17T00:00:00.000Z',
  gemini_attempt_count: 0,
  gemini_attempts: [],
  gemini_selected_model: null,
  id: 'job-row-id',
  job_type: 'process_images',
  last_error: null,
  last_error_at: null,
  last_error_code: null,
  listing_id: 'LIST-001',
  max_attempts: 2,
  next_run_at: null,
  status: 'queued',
  updated_at: '2026-05-17T00:00:00.000Z',
};

const generateAiJobRow: JobRow = {
  ...jobRow,
  id: 'job-generate-ai-row-id',
  job_type: 'generate_ai',
};

const publishJobRow: JobRow = {
  ...jobRow,
  id: 'job-publish-row-id',
  job_type: 'publish',
  max_attempts: 3,
};

const researchPriceJobRow: JobRow = {
  ...jobRow,
  id: 'job-research-price-row-id',
  job_type: 'research_price',
  max_attempts: 1,
};

const listingPriceResearchRow: ListingPriceResearchRow = {
  comps: [],
  created_at: '2026-06-09T12:00:00.000Z',
  error_code: null,
  error_message: null,
  id: 'listing-price-research-row-id',
  listing_id: 'LIST-001',
  llm_price_explanation: null,
  llm_reasoning_json: {},
  llm_rejected_comp_ids: [],
  median_sold_price: null,
  suggested_price: null,
  confidence: null,
  pricing_model_name: null,
  provider: 'apify',
  query: null,
  raw_result_json: {},
  sold_count: null,
  status: 'pending',
  updated_at: '2026-06-09T12:00:00.000Z',
};

const orderRow: OrderRow = {
  created_at: '2026-05-17T00:00:00.000Z',
  ebay_listing_id: null,
  fulfillment_status: null,
  id: 'order-row-id',
  listing_id: 'LIST-001',
  order_id: 'ORDER-001',
  order_status: 'open',
  quantity_sold: 1,
  sale_price: 12.5,
  ship_by_date: null,
  sku: 'SKU-001',
  updated_at: '2026-05-17T00:00:00.000Z',
};

const appSettingsRow: AppSettingsRow = {
  capture_mode: 'single_2_image',
  default_fulfillment_policy_id: null,
  default_package_type: null,
  default_payment_policy_id: null,
  default_return_policy_id: null,
  default_shipping_profile: null,
  ebay_marketplace_id: 'EBAY_US',
  ebay_publish_config: null,
  gemini_daily_limit: 500,
  handling_days: 2,
  id: 'default',
  incoming_folder_path: '/incoming',
  max_order_syncs_per_day: 25,
  merchant_location_key: null,
  office_location_name: null,
  pricing_provider_mode: 'soldcomps',
  processed_folder_path: '/processed',
  r2_retention_days_after_sold: 30,
  soldcomps_usage_snapshot: null,
  updated_at: '2026-05-17T00:00:00.000Z',
};

const aiModelAttemptRow: AiModelAttemptRow = {
  attempt_order: 2,
  created_at: '2026-05-25T13:00:00.000Z',
  duration_ms: null,
  failure_code: null,
  failure_message: null,
  finished_at: null,
  id: 'ai-model-attempt-row-id',
  job_id: 'job-row-id',
  listing_id: 'LIST-001',
  metadata: {},
  model_name: 'gemini-3.1-flash-lite',
  provider: 'google',
  provider_model_id: 'gemini-3.1-flash-lite',
  routing_source: 'direct_gemini',
  started_at: '2026-05-25T13:00:00.000Z',
  status: 'started',
};

const dailyUsageRow: DailyUsageRow = {
  gemini_calls_used: 0,
  gemini_daily_limit: 500,
  order_sync_count: 0,
  usage_date: '2026-05-31',
};

type GeminiRouteCapacityTestRow = {
  catalog:
    | {
        free_tier_daily_request_limit: number | null;
        is_enabled: boolean;
        is_free_tier_eligible: boolean;
      }
    | null;
  route_is_enabled: boolean;
  model_name: string;
};

function createInsertClient<TTable extends string, TRow>(
  table: TTable,
  expectedRow: TRow,
  onInsert?: (payload: unknown) => void
): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe(table);

      return {
        insert: vi.fn((payload: unknown) => {
          onInsert?.(payload);

          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: expectedRow,
                error: null,
              })),
            })),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createSelectClient<TTable extends string, TRow>(
  table: TTable,
  expectedRow: TRow | null,
  column: string,
  value: string
): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe(table);

      return {
        select: vi.fn(() => ({
          eq: vi.fn((actualColumn: string, actualValue: string) => {
            expect(actualColumn).toBe(column);
            expect(actualValue).toBe(value);

            return {
              maybeSingle: vi.fn(async () => ({
                data: expectedRow,
                error: null,
              })),
            };
          }),
        })),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createListClient<TTable extends string, TRow>(
  table: TTable,
  expectedRows: TRow[],
  column: string,
  value: string | string[]
): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe(table);

      return {
        select: vi.fn(() => ({
          eq: vi.fn(async (actualColumn: string, actualValue: string) => {
            expect(actualColumn).toBe(column);
            expect(actualValue).toBe(Array.isArray(value) ? value[0] : value);

            return {
              data: expectedRows,
              error: null,
            };
          }),
          in: vi.fn(async (actualColumn: string, actualValues: string[]) => {
            expect(actualColumn).toBe(column);
            expect(actualValues).toEqual(Array.isArray(value) ? value : [value]);

            return {
              data: expectedRows,
              error: null,
            };
          }),
        })),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createLimitedLookupClient<TTable extends string, TRow>(
  table: TTable,
  expectedRows: TRow[],
  column: string,
  value: string,
  expectedLimit: number
): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe(table);

      return {
        select: vi.fn((columns: string) => {
          expect(columns).toBe('*');

          return {
            eq: vi.fn((actualColumn: string, actualValue: string) => {
              expect(actualColumn).toBe(column);
              expect(actualValue).toBe(value);

              return {
                limit: vi.fn(async (limit: number) => {
                  expect(limit).toBe(expectedLimit);

                  return {
                    data: expectedRows,
                    error: null,
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createActiveGenerateAiLookupClient(expectedRow: JobRow | null): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe('jobs');

      return {
        select: vi.fn((columns: string) => {
          expect(columns).toBe('*');

          return {
            eq: vi.fn((firstColumn: string, firstValue: string) => {
              expect(firstColumn).toBe('listing_id');
              expect(firstValue).toBe('LIST-001');

              return {
                eq: vi.fn((secondColumn: string, secondValue: string) => {
                  expect(secondColumn).toBe('job_type');
                  expect(secondValue).toBe('generate_ai');

                  return {
                    in: vi.fn((statusColumn: string, statuses: string[]) => {
                      expect(statusColumn).toBe('status');
                      expect(statuses).toEqual(['queued', 'running']);

                      return {
                        order: vi.fn((orderColumn: string, options: { ascending: boolean }) => {
                          expect(orderColumn).toBe('created_at');
                          expect(options).toEqual({ ascending: false });

                          return {
                            limit: vi.fn((value: number) => {
                              expect(value).toBe(1);

                              return {
                                maybeSingle: vi.fn(async () => ({
                                  data: expectedRow,
                                  error: null,
                                })),
                              };
                            }),
                          };
                        }),
                      };
                    }),
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createActivePublishLookupClient(expectedRow: JobRow | null): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe('jobs');

      return {
        select: vi.fn((columns: string) => {
          expect(columns).toBe('*');

          return {
            eq: vi.fn((firstColumn: string, firstValue: string) => {
              expect(firstColumn).toBe('listing_id');
              expect(firstValue).toBe('LIST-001');

              return {
                eq: vi.fn((secondColumn: string, secondValue: string) => {
                  expect(secondColumn).toBe('job_type');
                  expect(secondValue).toBe('publish');

                  return {
                    in: vi.fn((statusColumn: string, statuses: string[]) => {
                      expect(statusColumn).toBe('status');
                      expect(statuses).toEqual(['queued', 'running']);

                      return {
                        order: vi.fn((orderColumn: string, options: { ascending: boolean }) => {
                          expect(orderColumn).toBe('created_at');
                          expect(options).toEqual({ ascending: false });

                          return {
                            limit: vi.fn((value: number) => {
                              expect(value).toBe(1);

                              return {
                                maybeSingle: vi.fn(async () => ({
                                  data: expectedRow,
                                  error: null,
                                })),
                              };
                            }),
                          };
                        }),
                      };
                    }),
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createActiveResearchPriceLookupClient(expectedRow: JobRow | null): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe('jobs');

      return {
        select: vi.fn((columns: string) => {
          expect(columns).toBe('*');

          return {
            eq: vi.fn((firstColumn: string, firstValue: string) => {
              expect(firstColumn).toBe('listing_id');
              expect(firstValue).toBe('LIST-001');

              return {
                eq: vi.fn((secondColumn: string, secondValue: string) => {
                  expect(secondColumn).toBe('job_type');
                  expect(secondValue).toBe('research_price');

                  return {
                    in: vi.fn((statusColumn: string, statuses: string[]) => {
                      expect(statusColumn).toBe('status');
                      expect(statuses).toEqual(['queued', 'running']);

                      return {
                        order: vi.fn((orderColumn: string, options: { ascending: boolean }) => {
                          expect(orderColumn).toBe('created_at');
                          expect(options).toEqual({ ascending: false });

                          return {
                            limit: vi.fn((value: number) => {
                              expect(value).toBe(1);

                              return {
                                maybeSingle: vi.fn(async () => ({
                                  data: expectedRow,
                                  error: null,
                                })),
                              };
                            }),
                          };
                        }),
                      };
                    }),
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createActiveProcessImagesLookupClient(expectedRow: JobRow | null): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe('jobs');

      return {
        select: vi.fn((columns: string) => {
          expect(columns).toBe('*');

          return {
            eq: vi.fn((firstColumn: string, firstValue: string) => {
              expect(firstColumn).toBe('job_type');
              expect(firstValue).toBe('process_images');

              return {
                is: vi.fn((secondColumn: string, secondValue: null) => {
                  expect(secondColumn).toBe('listing_id');
                  expect(secondValue).toBeNull();

                  return {
                    in: vi.fn((statusColumn: string, statuses: string[]) => {
                      expect(statusColumn).toBe('status');
                      expect(statuses).toEqual(['queued', 'running']);

                      return {
                        order: vi.fn((orderColumn: string, options: { ascending: boolean }) => {
                          expect(orderColumn).toBe('created_at');
                          expect(options).toEqual({ ascending: false });

                          return {
                            limit: vi.fn((value: number) => {
                              expect(value).toBe(1);

                              return {
                                maybeSingle: vi.fn(async () => ({
                                  data: expectedRow,
                                  error: null,
                                })),
                              };
                            }),
                          };
                        }),
                      };
                    }),
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createListAllClient<TTable extends string, TRow>(
  table: TTable,
  expectedRows: TRow[]
): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe(table);

      return {
        select: vi.fn((columns: string) => {
          expect(columns).toBe('*');

          return {
            order: vi.fn((column: string, options: { ascending: boolean }) => {
              expect(column).toBe('updated_at');
              expect(options).toEqual({ ascending: false });

              return {
                limit: vi.fn(async (value: number) => {
                  expect(value).toBe(100);

                  return {
                    data: expectedRows,
                    error: null,
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createListByStatusClient<TTable extends string, TRow>(
  table: TTable,
  expectedRows: TRow[],
  status: string,
  options: { ascending: boolean; from: number; to: number }
): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe(table);

      return {
        select: vi.fn((columns: string) => {
          expect(columns).toBe('*');

          return {
            eq: vi.fn((column: string, value: string) => {
              expect(column).toBe('status');
              expect(value).toBe(status);

              return {
                order: vi.fn((orderColumn: string, orderOptions: { ascending: boolean }) => {
                  expect(orderColumn).toBe('created_at');
                  expect(orderOptions).toEqual({ ascending: options.ascending });

                  return {
                    range: vi.fn(async (from: number, to: number) => {
                      expect(from).toBe(options.from);
                      expect(to).toBe(options.to);

                      return {
                        data: expectedRows,
                        error: null,
                      };
                    }),
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createApprovedForExportListClient(expectedRows: ListingRow[], queuedOnly: boolean): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe('listings');

      return {
        select: vi.fn((columns: string) => {
          expect(columns).toBe('*');

          return {
            eq: vi.fn((firstColumn: string, firstValue: string) => {
              expect(firstColumn).toBe('status');
              expect(firstValue).toBe('approved_for_export');

              const orderedQuery = {
                order: vi.fn((orderColumn: string, options: { ascending: boolean }) => {
                  expect(orderColumn).toBe('created_at');
                  expect(options).toEqual({ ascending: true });

                  return {
                    limit: vi.fn(async (value: number) => {
                      expect(value).toBe(5);

                      return {
                        data: expectedRows,
                        error: null,
                      };
                    }),
                  };
                }),
              };

              if (!queuedOnly) {
                return orderedQuery;
              }

              return {
                eq: vi.fn((secondColumn: string, secondValue: string) => {
                  expect(secondColumn).toBe('sub_status');
                  expect(secondValue).toBe('publish_queued');
                  return orderedQuery;
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createUpdateClient<TTable extends string, TRow>(
  table: TTable,
  expectedRow: TRow,
  column: string,
  value: string,
  onUpdate?: (payload: unknown) => void
): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe(table);

      return {
        update: vi.fn((payload: unknown) => {
          onUpdate?.(payload);

          return {
            eq: vi.fn((actualColumn: string, actualValue: string) => {
              expect(actualColumn).toBe(column);
              expect(actualValue).toBe(value);

              return {
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: expectedRow,
                    error: null,
                  })),
                })),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createLatestListingPriceResearchLookupClient(
  expectedRow: ListingPriceResearchRow | null
): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe('listing_price_research');

      return {
        select: vi.fn((columns: string) => {
          expect(columns).toBe('*');

          return {
            eq: vi.fn((column: string, value: string) => {
              expect(column).toBe('listing_id');
              expect(value).toBe('LIST-001');

              return {
                order: vi.fn((firstOrderColumn: string, firstOptions: { ascending: boolean }) => {
                  expect(firstOrderColumn).toBe('created_at');
                  expect(firstOptions).toEqual({ ascending: false });

                  return {
                    order: vi.fn(
                      (secondOrderColumn: string, secondOptions: { ascending: boolean }) => {
                        expect(secondOrderColumn).toBe('id');
                        expect(secondOptions).toEqual({ ascending: false });

                        return {
                          limit: vi.fn((limit: number) => {
                            expect(limit).toBe(1);

                            return {
                              maybeSingle: vi.fn(async () => ({
                                data: expectedRow,
                                error: null,
                              })),
                            };
                          }),
                        };
                      }
                    ),
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createApprovalForExportClient(
  listing: ListingRow,
  updatedListing: ListingRow | null,
  onUpdate: (payload: unknown) => void
): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe('listings');

      return {
        select: vi.fn((columns: string) => {
          expect(columns).toBe('*');

          return {
            eq: vi.fn((column: string, value: string) => {
              expect(column).toBe('listing_id');
              expect(value).toBe(listing.listing_id);

              return {
                maybeSingle: vi.fn(async () => ({
                  data: listing,
                  error: null,
                })),
              };
            }),
          };
        }),
        update: vi.fn((payload: unknown) => {
          onUpdate(payload);

          return {
            eq: vi.fn((column: string, value: string) => {
              expect(column).toBe('listing_id');
              expect(value).toBe(listing.listing_id);

              return {
                eq: vi.fn((statusColumn: string, statusValue: string) => {
                  expect(statusColumn).toBe('status');
                  expect(statusValue).toBe('needs_review');

                  return {
                    select: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => ({
                        data: updatedListing,
                        error: null,
                      })),
                    })),
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createDailyUsageClient({
  appSettings = appSettingsRow,
  dailyUsage = dailyUsageRow,
  insertedDailyUsage = dailyUsage ?? dailyUsageRow,
  routeCapacityRows = [],
  updateResult,
  onDailyUsageInsert,
  onDailyUsageUpdate,
}: {
  appSettings?: AppSettingsRow | null;
  dailyUsage?: DailyUsageRow | null;
  insertedDailyUsage?: DailyUsageRow;
  routeCapacityRows?: GeminiRouteCapacityTestRow[];
  updateResult?: DailyUsageRow | null;
  onDailyUsageInsert?: (payload: unknown) => void;
  onDailyUsageUpdate?: (payload: unknown) => void;
}): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      if (name === 'ai_model_task_routes') {
        return {
          select: vi.fn((columns: string) => {
            expect(columns).toContain('catalog:ai_model_catalog!inner');
            expect(columns).toContain('route_is_enabled:is_enabled');

            return {
              eq: vi.fn((firstColumn: string, firstValue: string | boolean) => {
                expect(firstColumn).toBe('task_type');
                expect(firstValue).toBe('listing_draft_generation');

                return {
                  eq: vi.fn((secondColumn: string, secondValue: string | boolean) => {
                    expect(secondColumn).toBe('provider');
                    expect(secondValue).toBe('google');

                    return {
                      eq: vi.fn((thirdColumn: string, thirdValue: string | boolean) => {
                        expect(thirdColumn).toBe('is_enabled');
                        expect(thirdValue).toBe(true);

                        return {
                          eq: vi.fn((fourthColumn: string, fourthValue: string | boolean) => {
                            expect(fourthColumn).toBe('catalog.is_enabled');
                            expect(fourthValue).toBe(true);

                            return {
                              eq: vi.fn((fifthColumn: string, fifthValue: string | boolean) => {
                                expect(fifthColumn).toBe('catalog.is_free_tier_eligible');
                                expect(fifthValue).toBe(true);

                                return {
                                  data: routeCapacityRows,
                                  error: null,
                                };
                              }),
                            };
                          }),
                        };
                      }),
                    };
                  }),
                };
              }),
            };
          }),
        };
      }

      if (name === 'app_settings') {
        return {
          select: vi.fn((columns: string) => {
            expect(columns).toBe('*');

            return {
              eq: vi.fn((column: string, value: string) => {
                expect(column).toBe('id');
                expect(value).toBe('default');

                return {
                  maybeSingle: vi.fn(async () => ({
                    data: appSettings,
                    error: null,
                  })),
                };
              }),
            };
          }),
        };
      }

      expect(name).toBe('daily_usage');

      return {
        insert: vi.fn((payload: unknown) => {
          onDailyUsageInsert?.(payload);

          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: insertedDailyUsage,
                error: null,
              })),
            })),
          };
        }),
        select: vi.fn((columns: string) => {
          expect(columns).toBe('*');

          return {
            eq: vi.fn((column: string, value: string) => {
              expect(column).toBe('usage_date');
              expect(value).toBe(dailyUsage?.usage_date ?? insertedDailyUsage.usage_date);

              return {
                maybeSingle: vi.fn(async () => ({
                  data: dailyUsage,
                  error: null,
                })),
              };
            }),
          };
        }),
        update: vi.fn((payload: unknown) => {
          onDailyUsageUpdate?.(payload);

          return {
            eq: vi.fn((firstColumn: string, firstValue: string) => {
              expect(firstColumn).toBe('usage_date');
              expect(firstValue).toBe(dailyUsage?.usage_date ?? insertedDailyUsage.usage_date);

              return {
                eq: vi.fn((secondColumn: string, secondValue: number) => {
                  expect(['gemini_calls_used', 'order_sync_count']).toContain(secondColumn);
                  expect(secondValue).toBe(dailyUsage?.[secondColumn as 'gemini_calls_used' | 'order_sync_count'] ?? 0);

                  return {
                    select: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => ({
                        data: updateResult ?? null,
                        error: null,
                      })),
                    })),
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createAiModelAttemptInsertClient(
  expectedRow: AiModelAttemptRow,
  existingAttemptOrder: number | null,
  onInsert?: (payload: unknown) => void
): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe('ai_model_attempts');

      return {
        insert: vi.fn((payload: unknown) => {
          onInsert?.(payload);

          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: expectedRow,
                error: null,
              })),
            })),
          };
        }),
        select: vi.fn((columns: string) => {
          expect(columns).toBe('attempt_order');

          return {
            eq: vi.fn((firstColumn: string, firstValue: string) => {
              expect(firstColumn).toBe('listing_id');
              expect(firstValue).toBe(expectedRow.listing_id);

              const orderedQuery = {
                order: vi.fn((orderColumn: string, options: { ascending: boolean }) => {
                  expect(orderColumn).toBe('attempt_order');
                  expect(options).toEqual({ ascending: false });

                  return {
                    limit: vi.fn(async (limit: number) => {
                      expect(limit).toBe(1);

                      return {
                        data:
                          existingAttemptOrder === null
                            ? []
                            : [{ attempt_order: existingAttemptOrder }],
                        error: null,
                      };
                    }),
                  };
                }),
              };

              if (expectedRow.job_id === null) {
                return {
                  is: vi.fn((secondColumn: string, secondValue: null) => {
                    expect(secondColumn).toBe('job_id');
                    expect(secondValue).toBeNull();
                    return orderedQuery;
                  }),
                };
              }

              return {
                eq: vi.fn((secondColumn: string, secondValue: string) => {
                  expect(secondColumn).toBe('job_id');
                  expect(secondValue).toBe(expectedRow.job_id);
                  return orderedQuery;
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createAiModelAttemptListClient(expectedRows: AiModelAttemptRow[]): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe('ai_model_attempts');

      return {
        select: vi.fn((columns: string) => {
          expect(columns).toBe('*');

          return {
            eq: vi.fn((column: string, value: string) => {
              expect(column).toBe('listing_id');
              expect(value).toBe('LIST-001');

              return {
                order: vi.fn((firstOrderColumn: string, firstOptions: { ascending: boolean }) => {
                  expect(firstOrderColumn).toBe('attempt_order');
                  expect(firstOptions).toEqual({ ascending: true });

                  return {
                    order: vi.fn(async (secondOrderColumn: string, secondOptions: { ascending: boolean }) => {
                      expect(secondOrderColumn).toBe('created_at');
                      expect(secondOptions).toEqual({ ascending: true });

                      return {
                        data: expectedRows,
                        error: null,
                      };
                    }),
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createAiModelAttemptListByListingIdsClient(
  expectedRows: AiModelAttemptRow[],
  listingIds: string[]
): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe('ai_model_attempts');

      return {
        select: vi.fn((columns: string) => {
          expect(columns).toBe('*');

          return {
            in: vi.fn((column: string, value: string[]) => {
              expect(column).toBe('listing_id');
              expect(value).toEqual(listingIds);

              return {
                order: vi.fn((firstOrderColumn: string, firstOptions: { ascending: boolean }) => {
                  expect(firstOrderColumn).toBe('listing_id');
                  expect(firstOptions).toEqual({ ascending: true });

                  return {
                    order: vi.fn((secondOrderColumn: string, secondOptions: { ascending: boolean }) => {
                      expect(secondOrderColumn).toBe('created_at');
                      expect(secondOptions).toEqual({ ascending: true });

                      return {
                        order: vi.fn(async (thirdOrderColumn: string, thirdOptions: { ascending: boolean }) => {
                          expect(thirdOrderColumn).toBe('attempt_order');
                          expect(thirdOptions).toEqual({ ascending: true });

                          return {
                            data: expectedRows,
                            error: null,
                          };
                        }),
                      };
                    }),
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createLatestGeminiUsageAttemptClient(input: {
  attemptError?: string | null;
  attemptRow: {
    finished_at: string | null;
    id: string;
    model_name: string;
    provider: string;
    started_at: string;
    status: string;
  } | null;
  catalogError?: string | null;
  catalogRow?: {
    display_name: string | null;
  } | null;
}): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      if (name === 'ai_model_attempts') {
        return {
          select: vi.fn((columns: string) => {
            expect(columns).toBe(
              'provider, model_name, status, started_at, finished_at, id, job:jobs!inner(job_type)'
            );

            return {
              eq: vi.fn((firstColumn: string, firstValue: string) => {
                expect(firstColumn).toBe('provider');
                expect(firstValue).toBe('google');

                return {
                  eq: vi.fn((secondColumn: string, secondValue: string) => {
                    expect(secondColumn).toBe('job.job_type');
                    expect(secondValue).toBe('generate_ai');

                    return {
                      order: vi.fn((firstOrderColumn: string, firstOptions: { ascending: boolean }) => {
                        expect(firstOrderColumn).toBe('created_at');
                        expect(firstOptions).toEqual({ ascending: false });

                        return {
                          order: vi.fn((secondOrderColumn: string, secondOptions: { ascending: boolean }) => {
                            expect(secondOrderColumn).toBe('id');
                            expect(secondOptions).toEqual({ ascending: false });

                            return {
                              limit: vi.fn((limit: number) => {
                                expect(limit).toBe(1);

                                return {
                                  maybeSingle: vi.fn(async () => ({
                                    data: input.attemptRow,
                                    error: input.attemptError
                                      ? { message: input.attemptError }
                                      : null,
                                  })),
                                };
                              }),
                            };
                          }),
                        };
                      }),
                    };
                  }),
                };
              }),
            };
          }),
        };
      }

      expect(name).toBe('ai_model_catalog');

      return {
        select: vi.fn((columns: string) => {
          expect(columns).toBe('display_name');

          return {
            eq: vi.fn((firstColumn: string, firstValue: string) => {
              expect(firstColumn).toBe('provider');
              expect(firstValue).toBe(input.attemptRow?.provider ?? 'google');

              return {
                eq: vi.fn((secondColumn: string, secondValue: string) => {
                  expect(secondColumn).toBe('model_name');
                  expect(secondValue).toBe(input.attemptRow?.model_name ?? 'gemini-3.5-flash');

                  return {
                    maybeSingle: vi.fn(async () => ({
                      data: input.catalogRow ?? null,
                      error: input.catalogError ? { message: input.catalogError } : null,
                    })),
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createClaimApprovedListingClient(expectedRow: ListingRow | null): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe('listings');

      return {
        update: vi.fn((payload: unknown) => {
          expect(payload).toEqual({
            last_error_at: null,
            last_error_code: null,
            last_error_context: {},
            last_error_message: null,
            sub_status: 'publishing_to_ebay',
          });

          return {
            eq: vi.fn((firstColumn: string, firstValue: string) => {
              expect(firstColumn).toBe('listing_id');
              expect(firstValue).toBe('LIST-001');

              return {
                eq: vi.fn((secondColumn: string, secondValue: string) => {
                  expect(secondColumn).toBe('status');
                  expect(secondValue).toBe('approved_for_export');

                  return {
                    eq: vi.fn((thirdColumn: string, thirdValue: string) => {
                      expect(thirdColumn).toBe('sub_status');
                      expect(thirdValue).toBe('publish_queued');

                      return {
                        select: vi.fn(() => ({
                          maybeSingle: vi.fn(async () => ({
                            data: expectedRow,
                            error: null,
                          })),
                        })),
                      };
                    }),
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createGenerateAiPreparationClient(
  expectedRow: ListingRow | null,
  expectedUpdatedAt: string,
  onUpdate?: (payload: unknown) => void
): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe('listings');

      return {
        update: vi.fn((payload: unknown) => {
          onUpdate?.(payload);

          return {
            eq: vi.fn((firstColumn: string, firstValue: string) => {
              expect(firstColumn).toBe('listing_id');
              expect(firstValue).toBe('LIST-001');

              return {
                eq: vi.fn((secondColumn: string, secondValue: string) => {
                  expect(secondColumn).toBe('status');
                  expect(secondValue).toBe('assets_ready');

                  return {
                    eq: vi.fn((thirdColumn: string, thirdValue: string) => {
                      expect(thirdColumn).toBe('updated_at');
                      expect(thirdValue).toBe(expectedUpdatedAt);

                      return {
                        select: vi.fn(() => ({
                          maybeSingle: vi.fn(async () => ({
                            data: expectedRow,
                            error: null,
                          })),
                        })),
                      };
                    }),
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createDueQueuedJobsListClient(
  expectedRows: JobRow[],
  expectedLimit: number,
  expectedNow: string
): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe('jobs');

      return {
        select: vi.fn((columns: string) => {
          expect(columns).toBe('*');

          return {
            eq: vi.fn((column: string, value: string) => {
              expect(column).toBe('status');
              expect(value).toBe('queued');

              return {
                or: vi.fn((filter: string) => {
                  expect(filter).toBe(`next_run_at.is.null,next_run_at.lte.${expectedNow}`);

                  return {
                    order: vi.fn((orderColumn: string, options: { ascending: boolean }) => {
                      expect(orderColumn).toBe('created_at');
                      expect(options).toEqual({ ascending: true });

                      return {
                        limit: vi.fn(async (value: number) => {
                          expect(value).toBe(expectedLimit);

                          return {
                            data: expectedRows,
                            error: null,
                          };
                        }),
                      };
                    }),
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createClaimDueQueuedJobClient(
  currentRow: JobRow | null,
  expectedRow: JobRow | null,
  expectedNow: string
): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe('jobs');

      if (!currentRow) {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                or: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: null,
                    error: null,
                  })),
                })),
              })),
            })),
          })),
        };
      }

      return {
        select: vi.fn((columns: string) => {
          expect(columns).toBe('*');

          return {
            eq: vi.fn((firstColumn: string, firstValue: string) => {
              expect(firstColumn).toBe('id');
              expect(firstValue).toBe('job-row-id');

              return {
                eq: vi.fn((secondColumn: string, secondValue: string) => {
                  expect(secondColumn).toBe('status');
                  expect(secondValue).toBe('queued');

                  return {
                    or: vi.fn((filter: string) => {
                      expect(filter).toBe(`next_run_at.is.null,next_run_at.lte.${expectedNow}`);

                      return {
                        maybeSingle: vi.fn(async () => ({
                          data: currentRow,
                          error: null,
                        })),
                      };
                    }),
                  };
                }),
              };
            }),
          };
        }),
        update: vi.fn((payload: unknown) => {
          expect(payload).toEqual({
            attempts: currentRow.attempts + 1,
            next_run_at: null,
            status: 'running',
          });

          return {
            eq: vi.fn((firstColumn: string, firstValue: string) => {
              expect(firstColumn).toBe('id');
              expect(firstValue).toBe('job-row-id');

              return {
                eq: vi.fn((secondColumn: string, secondValue: string) => {
                  expect(secondColumn).toBe('status');
                  expect(secondValue).toBe('queued');

                  return {
                    eq: vi.fn((thirdColumn: string, thirdValue: number) => {
                      expect(thirdColumn).toBe('attempts');
                      expect(thirdValue).toBe(currentRow.attempts);

                      return {
                        is: vi.fn((fourthColumn: string, fourthValue: null) => {
                          expect(fourthColumn).toBe('next_run_at');
                          expect(fourthValue).toBeNull();

                          return {
                            select: vi.fn(() => ({
                              maybeSingle: vi.fn(async () => ({
                                data: expectedRow,
                                error: null,
                              })),
                            })),
                          };
                        }),
                      };
                    }),
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

function createResetJobForManualRetryClient(
  currentRow: JobRow | null,
  expectedRow: JobRow | null,
  expectedNow: string
): SupabaseDataClient {
  return {
    from: vi.fn((name: string) => {
      expect(name).toBe('jobs');

      return {
        select: vi.fn((columns: string) => {
          expect(columns).toBe('*');

          return {
            eq: vi.fn((firstColumn: string, firstValue: string) => {
              expect(firstColumn).toBe('id');
              expect(firstValue).toBe('job-row-id');

              return {
                maybeSingle: vi.fn(async () => ({
                  data: currentRow,
                  error: null,
                })),
              };
            }),
          };
        }),
        update: vi.fn((payload: unknown) => {
          expect(payload).toEqual({
            attempts: 0,
            gemini_attempt_count: 0,
            gemini_attempts: [],
            gemini_selected_model: null,
            last_error: null,
            last_error_at: null,
            last_error_code: null,
            next_run_at: null,
            status: 'queued',
            updated_at: expectedNow,
          });

          return {
            eq: vi.fn((firstColumn: string, firstValue: string) => {
              expect(firstColumn).toBe('id');
              expect(firstValue).toBe('job-row-id');

              return {
                eq: vi.fn((secondColumn: string, secondValue: string) => {
                  expect(secondColumn).toBe('status');
                  expect(secondValue).toBe('failed');

                  return {
                    eq: vi.fn((thirdColumn: string, thirdValue: string) => {
                      expect(thirdColumn).toBe('updated_at');
                      expect(thirdValue).toBe(currentRow?.updated_at);

                      return {
                        eq: vi.fn((fourthColumn: string, fourthValue: string) => {
                          expect(fourthColumn).toBe('last_error_code');
                          expect(fourthValue).toBe(currentRow?.last_error_code);

                          return {
                            select: vi.fn(() => ({
                              maybeSingle: vi.fn(async () => ({
                                data: expectedRow,
                                error: null,
                              })),
                            })),
                          };
                        }),
                        is: vi.fn((fourthColumn: string, fourthValue: null) => {
                          expect(fourthColumn).toBe('last_error_code');
                          expect(fourthValue).toBeNull();

                          return {
                            select: vi.fn(() => ({
                              maybeSingle: vi.fn(async () => ({
                                data: expectedRow,
                                error: null,
                              })),
                            })),
                          };
                        }),
                      };
                    }),
                  };
                }),
              };
            }),
          };
        }),
      };
    }),
  } as unknown as SupabaseDataClient;
}

describe('shared repositories', () => {
  it('creates and fetches listings', async () => {
    const createClient = createInsertClient('listings', listingRow, (payload) => {
      expect(payload).toEqual({
        listing_id: 'Single-000001',
        sku: 'Single-000001',
        status: 'record_created',
        sub_status: 'idle',
      });
    });

    const created = await createListing(createClient, {
      listing_id: 'Single-000001',
      sku: 'Single-000001',
      status: 'record_created',
      sub_status: 'idle',
    });

    expect(created).toEqual(listingRow);

    const fetchClient = createSelectClient('listings', listingRow, 'listing_id', 'LIST-001');
    await expect(getListingByListingId(fetchClient, 'LIST-001')).resolves.toEqual(listingRow);

    const offerLookupClient = createLimitedLookupClient(
      'listings',
      [listingRow],
      'ebay_offer_id',
      'OFFER-001',
      2
    );
    await expect(getListingByOfferId(offerLookupClient, 'OFFER-001')).resolves.toEqual(listingRow);

    const noOfferLookupClient = createLimitedLookupClient(
      'listings',
      [],
      'ebay_offer_id',
      'OFFER-MISSING',
      2
    );
    await expect(getListingByOfferId(noOfferLookupClient, 'OFFER-MISSING')).resolves.toBeNull();

    const duplicateOfferLookupClient = createLimitedLookupClient(
      'listings',
      [listingRow, { ...listingRow, id: 'listing-row-id-2', listing_id: 'LIST-002' }],
      'ebay_offer_id',
      'OFFER-DUPE',
      2
    );
    await expect(getListingByOfferId(duplicateOfferLookupClient, 'OFFER-DUPE')).rejects.toThrow(
      'Multiple local listings found for ebay_offer_id "OFFER-DUPE".'
    );

    const listClient = createListAllClient('listings', [listingRow]);
    await expect(listListings(listClient)).resolves.toEqual([listingRow]);

    const listByStatusClient = createListByStatusClient(
      'listings',
      [listingRow],
      'record_created',
      { ascending: true, from: 25, to: 49 }
    );
    await expect(
      listListingsByStatus(listByStatusClient, 'record_created', {
        limit: 25,
        offset: 25,
        orderByCreatedAt: 'asc',
      })
    ).resolves.toEqual([listingRow]);

    const approvedQueuedClient = createApprovedForExportListClient(
      [
        {
          ...listingRow,
          status: 'approved_for_export',
          sub_status: 'publish_queued',
        },
      ],
      true
    );
    await expect(
      listApprovedForExportListings(approvedQueuedClient, {
        limit: 5,
        queuedOnly: true,
      })
    ).resolves.toEqual([
      {
        ...listingRow,
        status: 'approved_for_export',
        sub_status: 'publish_queued',
      },
    ]);

    const approvedAnyClient = createApprovedForExportListClient(
      [
        {
          ...listingRow,
          status: 'approved_for_export',
          sub_status: 'idle',
        },
      ],
      false
    );
    await expect(
      listApprovedForExportListings(approvedAnyClient, {
        limit: 5,
      })
    ).resolves.toEqual([
      {
        ...listingRow,
        status: 'approved_for_export',
        sub_status: 'idle',
      },
    ]);
  });

  it('accepts base and structured sku values while keeping listing ids immutable', async () => {
    const realisticListingRow = {
      ...listingRow,
      listing_id: 'Single-000001',
      sku: 'Single-000001',
    };

    const baseCreateClient = createInsertClient('listings', realisticListingRow, (payload) => {
      expect(payload).toEqual({
        listing_id: 'Single-000001',
        sku: 'Single-000001',
        status: 'record_created',
        sub_status: 'idle',
      });
    });

    await expect(
      createListing(baseCreateClient, {
        listing_id: 'Single-000001',
        sku: 'Single-000001',
        status: 'record_created',
        sub_status: 'idle',
      })
    ).resolves.toEqual(realisticListingRow);

    const structuredCreateClient = createInsertClient('listings', realisticListingRow, (payload) => {
      expect(payload).toEqual({
        listing_id: 'Single-000001',
        sku: 'BSKBL-Single-000001',
        status: 'record_created',
        sub_status: 'idle',
      });
    });

    await expect(
      createListing(structuredCreateClient, {
        listing_id: 'Single-000001',
        sku: 'BSKBL-Single-000001',
        status: 'record_created',
        sub_status: 'idle',
      })
    ).resolves.toEqual(realisticListingRow);

    await expect(
      createListing(structuredCreateClient, {
        listing_id: 'LIST-001',
        sku: 'OTHER-Single-000001',
        status: 'record_created',
        sub_status: 'idle',
      })
    ).rejects.toThrow('Invalid base SKU "LIST-001"');

    await expect(
      createListing(structuredCreateClient, {
        listing_id: 'Single-000001',
        sku: 'BSKBL-Single-000000',
        status: 'record_created',
        sub_status: 'idle',
      })
    ).rejects.toThrow('Invalid structured SKU "BSKBL-Single-000000"');

    await expect(
      createListing(structuredCreateClient, {
        listing_id: 'Single-000001',
        sku: 'Single-000000',
        status: 'record_created',
        sub_status: 'idle',
      })
    ).rejects.toThrow('Invalid structured SKU "Single-000000"');

    const updateClient = createUpdateClient(
      'listings',
      realisticListingRow,
      'listing_id',
      'Single-000001',
      (payload) => {
        expect(payload).toEqual({
          sku: 'BSKBL-Single-000001',
        });
      }
    );

    await expect(
      updateListing(updateClient, 'Single-000001', { sku: 'BSKBL-Single-000001' })
    ).resolves.toEqual(
      realisticListingRow
    );

    const baseUpdateClient = createUpdateClient(
      'listings',
      realisticListingRow,
      'listing_id',
      'Single-000001',
      (payload) => {
        expect(payload).toEqual({
          sku: 'Single-000001',
        });
      }
    );

    await expect(updateListing(baseUpdateClient, 'Single-000001', { sku: 'Single-000001' })).resolves.toEqual(
      realisticListingRow
    );

    await expect(
      updateListing(updateClient, 'Single-000001', { sku: 'BSKBL-Single-000000' })
    ).rejects.toThrow('Invalid structured SKU "BSKBL-Single-000000"');

    await expect(updateListing(updateClient, 'Single-000001', { sku: 'Single-000000' })).rejects.toThrow(
      'Invalid structured SKU "Single-000000"'
    );

    await expect(updateListing(updateClient, 'Single-000001', { listing_id: 'Single-000002' })).rejects.toThrow(
      'Listing ID is immutable and cannot be changed.'
    );
  });

  it.each([
    ['BSKBL single', 'Single-000001', 'BSKBL', 'BSKBL-Single-000001'],
    ['BSBL lot', 'Lot-000002', 'BSBL', 'BSBL-Lot-000002'],
    ['OTHER explicit', 'Single-000003', 'OTHER', 'OTHER-Single-000003'],
    ['missing category', 'Single-000004', undefined, 'OTHER-Single-000004'],
    ['invalid category Basketball', 'Single-000005', 'Basketball', 'OTHER-Single-000005'],
    ['invalid category TCG', 'Single-000006', 'TCG', 'OTHER-Single-000006'],
    [
      'invalid full sku category',
      'Single-000007',
      'BSKBL-Single-000001',
      'OTHER-Single-000007',
    ],
    ['normalized lowercase category', 'Single-000008', ' bskbl ', 'BSKBL-Single-000008'],
  ])('finalizes SKU on export approval for %s', async (_label, listingId, skuCategoryCode, expectedSku) => {
    const approvalListing: ListingRow = {
      ...listingRow,
      ebay_listing_id: 'EBAY-LISTING',
      ebay_offer_id: 'EBAY-OFFER',
      item_specifics:
        skuCategoryCode === undefined
          ? {}
          : {
              skuCategoryCode,
            },
      listing_id: listingId,
      sku: listingId,
      status: 'needs_review',
      sub_status: 'review_pending',
    };
    const updatedListing: ListingRow = {
      ...approvalListing,
      sku: expectedSku,
      status: 'approved_for_export',
      sub_status: 'publish_queued',
    };
    const client = createApprovalForExportClient(approvalListing, updatedListing, (payload) => {
      expect(payload).toEqual({
        sku: expectedSku,
        status: 'approved_for_export',
        sub_status: 'publish_queued',
      });
    });

    await expect(approveListingForExport(client, listingId)).resolves.toEqual(updatedListing);
  });

  it('overwrites mismatched structured sku on needs_review approval', async () => {
    const approvalListing: ListingRow = {
      ...listingRow,
      item_specifics: {
        skuCategoryCode: 'BSBL',
      },
      listing_id: 'Single-000009',
      sku: 'BSKBL-Single-000009',
      status: 'needs_review',
      sub_status: 'review_pending',
    };
    const updatedListing: ListingRow = {
      ...approvalListing,
      sku: 'BSBL-Single-000009',
      status: 'approved_for_export',
      sub_status: 'publish_queued',
    };
    const client = createApprovalForExportClient(approvalListing, updatedListing, (payload) => {
      expect(payload).toEqual({
        sku: 'BSBL-Single-000009',
        status: 'approved_for_export',
        sub_status: 'publish_queued',
      });
    });

    await expect(approveListingForExport(client, approvalListing.listing_id)).resolves.toEqual(
      updatedListing
    );
  });

  it('respects manual skuCategoryCode override while preserving sibling item_specifics on approval', async () => {
    const approvalListing: ListingRow = {
      ...listingRow,
      ebay_listing_id: 'EBAY-LISTING-004',
      ebay_offer_id: 'EBAY-OFFER-004',
      item_specifics: {
        Brand: 'Topps',
        Player: 'Michael Jordan',
        skuCategoryCode: 'BSKBL',
      },
      listing_id: 'Single-000004',
      sku: 'OTHER-Single-000004',
      status: 'needs_review',
      sub_status: 'review_pending',
    };
    const updatedListing: ListingRow = {
      ...approvalListing,
      sku: 'BSKBL-Single-000004',
      status: 'approved_for_export',
      sub_status: 'publish_queued',
    };
    const client = createApprovalForExportClient(approvalListing, updatedListing, (payload) => {
      expect(payload).toEqual({
        sku: 'BSKBL-Single-000004',
        status: 'approved_for_export',
        sub_status: 'publish_queued',
      });
    });

    const result = await approveListingForExport(client, approvalListing.listing_id);

    expect(result.item_specifics).toEqual({
      Brand: 'Topps',
      Player: 'Michael Jordan',
      skuCategoryCode: 'BSKBL',
    });
    expect(result.listing_id).toBe('Single-000004');
    expect(result.ebay_offer_id).toBe('EBAY-OFFER-004');
    expect(result.ebay_listing_id).toBe('EBAY-LISTING-004');
    expect(result.sku).toBe('BSKBL-Single-000004');
  });

  it.each(['exported', 'listed', 'sold'] as const)(
    'does not mutate %s listings during export approval',
    async (status) => {
      const approvalListing: ListingRow = {
        ...listingRow,
        ebay_listing_id: 'EBAY-LISTING',
        ebay_offer_id: 'EBAY-OFFER',
        listing_id: 'Single-000010',
        sku: 'BSKBL-Single-000010',
        status,
      };
      const client = createApprovalForExportClient(approvalListing, null, () => {
        throw new Error('approval update should not run');
      });

      await expect(approveListingForExport(client, approvalListing.listing_id)).rejects.toThrow(
        `Listing "${approvalListing.listing_id}" must be in needs_review before approval for export. Current status: "${status}".`
      );
    }
  );

  it('preserves stale-status protection when approval update loses race', async () => {
    const approvalListing: ListingRow = {
      ...listingRow,
      item_specifics: {
        skuCategoryCode: 'BSKBL',
      },
      listing_id: 'Single-000011',
      sku: 'Single-000011',
      status: 'needs_review',
      sub_status: 'review_pending',
    };
    const client = createApprovalForExportClient(approvalListing, null, () => {});

    await expect(approveListingForExport(client, approvalListing.listing_id)).rejects.toThrow(
      'changed before approval for export could be saved'
    );
  });

  it('updates listings and persists stateless worker outputs', async () => {
    const updateClient = createUpdateClient('listings', listingRow, 'listing_id', 'LIST-001', (payload) => {
      expect(payload).toEqual({
        title: 'Updated title',
      });
    });

    await expect(updateListing(updateClient, 'LIST-001', { title: 'Updated title' })).resolves.toEqual(
      listingRow
    );

    const artifactsClient = createUpdateClient('listings', listingRow, 'listing_id', 'LIST-001', (payload) => {
      expect(payload).toEqual({
        image_urls: ['https://cdn.example.com/1.jpg'],
        r2_delete_after: undefined,
        r2_deleted_at: undefined,
        r2_object_keys: ['images/LIST-001/1.jpg'],
        r2_retention_policy: 'delete_after_sold',
      });
    });

    await expect(
      saveListingArtifacts(artifactsClient, {
        imageUrls: ['https://cdn.example.com/1.jpg'],
        listingId: 'LIST-001',
        r2ObjectKeys: ['images/LIST-001/1.jpg'],
        r2RetentionPolicy: 'delete_after_sold',
      })
    ).resolves.toEqual(listingRow);

    const imageMetadataClient = createUpdateClient(
      'listings',
      listingRow,
      'listing_id',
      'LIST-001',
      (payload) => {
        expect(payload).toEqual({
          image_urls: ['https://cdn.example.com/1.jpg'],
          r2_object_keys: ['images/LIST-001/1.jpg'],
        });
      }
    );

    await expect(
      saveListingImageMetadata(imageMetadataClient, {
        imageUrls: ['https://cdn.example.com/1.jpg'],
        listingId: 'LIST-001',
        r2ObjectKeys: ['images/LIST-001/1.jpg'],
      })
    ).resolves.toEqual(listingRow);

    const optimisticMetadataClient = {
      from: vi.fn((name: string) => {
        expect(name).toBe('listings');

        return {
          update: vi.fn((payload: unknown) => {
            expect(payload).toEqual({
              image_urls: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'],
              r2_object_keys: ['images/LIST-001/1.jpg', 'images/LIST-001/2.jpg'],
            });

            return {
              eq: vi.fn((firstColumn: string, firstValue: string) => {
                expect(firstColumn).toBe('listing_id');
                expect(firstValue).toBe('LIST-001');

                return {
                  eq: vi.fn((secondColumn: string, secondValue: string) => {
                    expect(secondColumn).toBe('updated_at');
                    expect(secondValue).toBe('2026-05-17T00:00:00.000Z');

                    return {
                      select: vi.fn(() => ({
                        maybeSingle: vi.fn(async () => ({
                          data: null,
                          error: null,
                        })),
                      })),
                    };
                  }),
                };
              }),
            };
          }),
        };
      }),
    } as unknown as SupabaseDataClient;

    await expect(
      saveListingImageMetadata(optimisticMetadataClient, {
        imageUrls: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'],
        listingId: 'LIST-001',
        r2ObjectKeys: ['images/LIST-001/1.jpg', 'images/LIST-001/2.jpg'],
        expectedUpdatedAt: '2026-05-17T00:00:00.000Z',
      })
    ).resolves.toBeNull();

    const generatedClient = createUpdateClient('listings', listingRow, 'listing_id', 'LIST-001', (payload) => {
      expect(payload).toEqual({
        capture_mode: 'single_2_image',
        category_id: 'CATEGORY-1',
        condition_id: '3000',
        condition_notes: 'Minor wear',
        description: 'Updated description',
        ese_eligible: true,
        estimated_weight_oz: 12,
        handling_days: 3,
        item_specifics: { Brand: 'Acme' },
        listing_type: 'single',
        merchant_location_key: 'LOC-1',
        package_type: 'box',
        price: 24.99,
        seller_hints: 'Use padded envelope',
        shipping_profile: 'standard',
        title: 'Updated title',
      });
    });

    await expect(
      saveGeneratedListingFields(generatedClient, {
        listingId: 'LIST-001',
        captureMode: 'single_2_image',
        categoryId: 'CATEGORY-1',
        conditionId: '3000',
        conditionNotes: 'Minor wear',
        description: 'Updated description',
        eseEligible: true,
        estimatedWeightOz: 12,
        handlingDays: 3,
        itemSpecifics: { Brand: 'Acme' },
        listingType: 'single',
        merchantLocationKey: 'LOC-1',
        packageType: 'box',
        price: 24.99,
        sellerHints: 'Use padded envelope',
        shippingProfile: 'standard',
        title: 'Updated title',
      })
    ).resolves.toEqual(listingRow);

    const publishClient = createUpdateClient('listings', listingRow, 'listing_id', 'LIST-001', (payload) => {
      expect(payload).toEqual({
        ebay_listing_id: 'EBAY-001',
        exported_at: '2026-05-17T01:00:00.000Z',
      });
    });

    await expect(
      savePublishedListing(publishClient, {
        listingId: 'LIST-001',
        ebayListingId: 'EBAY-001',
        exportedAt: '2026-05-17T01:00:00.000Z',
      })
    ).resolves.toEqual(listingRow);

    const generateAiReadyListing = {
      ...listingRow,
      seller_hints: 'Use padded envelope',
      status: 'assets_ready',
      sub_status: 'ready_to_generate',
    } satisfies ListingRow;
    const generateAiClient = createGenerateAiPreparationClient(
      generateAiReadyListing,
      '2026-05-17T00:00:00.000Z',
      (payload) => {
        expect(payload).toEqual({
          seller_hints: 'Use padded envelope',
          status: 'assets_ready',
          sub_status: 'ready_to_generate',
        });
      }
    );

    await expect(
      prepareListingForGenerateAi(generateAiClient, {
        expectedUpdatedAt: '2026-05-17T00:00:00.000Z',
        listingId: 'LIST-001',
        sellerHints: 'Use padded envelope',
      })
    ).resolves.toEqual(generateAiReadyListing);

    const staleGenerateAiClient = createGenerateAiPreparationClient(
      null,
      '2026-05-17T00:00:00.000Z',
      (payload) => {
        expect(payload).toEqual({
          status: 'assets_ready',
          sub_status: 'ready_to_generate',
        });
      }
    );

    await expect(
      prepareListingForGenerateAi(staleGenerateAiClient, {
        expectedUpdatedAt: '2026-05-17T00:00:00.000Z',
        listingId: 'LIST-001',
      })
    ).resolves.toBeNull();
  });

  it('claims approved publish listings conditionally and persists publish failures', async () => {
    const claimedListing = {
      ...listingRow,
      status: 'approved_for_export',
      sub_status: 'publishing_to_ebay',
    } satisfies ListingRow;
    const claimClient = createClaimApprovedListingClient(claimedListing);

    await expect(claimApprovedListingForPublish(claimClient, 'LIST-001')).resolves.toEqual(
      claimedListing
    );

    const staleClaimClient = createClaimApprovedListingClient(null);
    await expect(claimApprovedListingForPublish(staleClaimClient, 'LIST-001')).resolves.toBeNull();

    const markFailedClient = createUpdateClient(
      'listings',
      {
        ...listingRow,
        last_error_at: '2026-05-25T12:00:00.000Z',
        last_error_code: 'OFFER_PUBLISH_FAILED',
        last_error_context: {
          code: 'OFFER_PUBLISH_FAILED',
          issues: ['Listing "LIST-001" is missing title.'],
          message: 'sandbox unavailable',
          name: 'PublishListingError',
          stage: 'publish',
        },
        last_error_message: 'sandbox unavailable',
        status: 'approved_for_export',
        sub_status: 'publish_queued',
      } satisfies ListingRow,
      'listing_id',
      'LIST-001',
      (payload) => {
        expect(payload).toEqual({
          last_error_at: '2026-05-25T12:00:00.000Z',
          last_error_code: 'OFFER_PUBLISH_FAILED',
          last_error_context: {
            code: 'OFFER_PUBLISH_FAILED',
            issues: ['Listing "LIST-001" is missing title.'],
            message: 'sandbox unavailable',
            name: 'PublishListingError',
            stage: 'publish',
          },
          last_error_message: 'sandbox unavailable',
          status: 'approved_for_export',
          sub_status: 'publish_queued',
        });
      }
    );

    await expect(
      markListingPublishFailed(
        markFailedClient,
        'LIST-001',
        '2026-05-25T12:00:00.000Z',
        Object.assign(new Error('sandbox unavailable'), {
          code: 'OFFER_PUBLISH_FAILED',
          context: {
            issues: ['Listing "LIST-001" is missing title.'],
            stage: 'publish',
          },
          name: 'PublishListingError',
        })
      )
    ).resolves.toEqual({
      ...listingRow,
      last_error_at: '2026-05-25T12:00:00.000Z',
      last_error_code: 'OFFER_PUBLISH_FAILED',
      last_error_context: {
        code: 'OFFER_PUBLISH_FAILED',
        issues: ['Listing "LIST-001" is missing title.'],
        message: 'sandbox unavailable',
        name: 'PublishListingError',
        stage: 'publish',
      },
      last_error_message: 'sandbox unavailable',
      status: 'approved_for_export',
      sub_status: 'publish_queued',
    });
  });

  it('keeps falsey single-row data values intact', () => {
    expect(
      requireSingleResult(
        {
          data: 0,
          error: null,
        },
        'missing'
      )
    ).toBe(0);
  });

  it('creates, fetches, lists, and updates jobs', async () => {
    const createClient = createInsertClient('jobs', jobRow, (payload) => {
      expect(payload).toEqual({
        job_type: 'process_images',
        listing_id: 'LIST-001',
        status: 'queued',
      });
    });

    await expect(
      createJob(createClient, {
        job_type: 'process_images',
        listing_id: 'LIST-001',
        status: 'queued',
      })
    ).resolves.toEqual(jobRow);

    const getClient = createSelectClient('jobs', jobRow, 'id', 'job-row-id');
    await expect(getJobById(getClient, 'job-row-id')).resolves.toEqual(jobRow);

    const listClient = createListClient('jobs', [jobRow], 'listing_id', 'LIST-001');
    await expect(listJobsByListingId(listClient, 'LIST-001')).resolves.toEqual([jobRow]);

    const listByIdsClient = createListClient('jobs', [jobRow], 'listing_id', 'LIST-001');
    await expect(listJobsByListingIds(listByIdsClient, ['LIST-001'])).resolves.toEqual([jobRow]);

    const queuedListClient = createDueQueuedJobsListClient([jobRow], 2, '2026-05-25T13:00:00.000Z');
    await expect(
      listDueQueuedJobs(queuedListClient, '2026-05-25T13:00:00.000Z', { limit: 2 })
    ).resolves.toEqual([jobRow]);

    const updateClient = createUpdateClient('jobs', jobRow, 'id', 'job-row-id', (payload) => {
      expect(payload).toEqual({
        status: 'running',
      });
    });

    await expect(updateJob(updateClient, 'job-row-id', { status: 'running' })).resolves.toEqual(jobRow);

    const succeededAttempt = {
      attempt_order: 1,
      completed_at: '2026-05-25T13:00:02.000Z',
      duration_ms: 2000,
      failure_code: null,
      failure_message: null,
      model_name: 'gemini-3.1-flash-lite',
      started_at: '2026-05-25T13:00:00.000Z',
      status: 'succeeded' as const,
    };
    const setSucceededAuditClient = createUpdateClient(
      'jobs',
      {
        ...jobRow,
        gemini_attempt_count: 1,
        gemini_attempts: [succeededAttempt],
        gemini_selected_model: 'gemini-3.1-flash-lite',
      },
      'id',
      'job-row-id',
      (payload) => {
        expect(payload).toEqual({
          gemini_attempt_count: 1,
          gemini_attempts: [succeededAttempt],
          gemini_selected_model: 'gemini-3.1-flash-lite',
        });
      }
    );

    await expect(
      setGeminiJobAttemptAudit(setSucceededAuditClient, 'job-row-id', {
        gemini_attempt_count: 1,
        gemini_attempts: [succeededAttempt],
        gemini_selected_model: 'gemini-3.1-flash-lite',
      })
    ).resolves.toEqual({
      ...jobRow,
      gemini_attempt_count: 1,
      gemini_attempts: [succeededAttempt],
      gemini_selected_model: 'gemini-3.1-flash-lite',
    });

    const failedAttempt = {
      attempt_order: 1,
      completed_at: '2026-05-25T13:00:02.000Z',
      duration_ms: 2000,
      failure_code: 'generate_ai_failed',
      failure_message: 'Gemini timed out',
      model_name: 'gemini-3.1-flash-lite',
      started_at: '2026-05-25T13:00:00.000Z',
      status: 'failed' as const,
    };
    const setFailedAuditClient = createUpdateClient(
      'jobs',
      {
        ...jobRow,
        gemini_attempt_count: 1,
        gemini_attempts: [failedAttempt],
        gemini_selected_model: null,
      },
      'id',
      'job-row-id',
      (payload) => {
        expect(payload).toEqual({
          gemini_attempt_count: 1,
          gemini_attempts: [failedAttempt],
          gemini_selected_model: null,
        });
      }
    );

    await expect(
      setGeminiJobAttemptAudit(setFailedAuditClient, 'job-row-id', {
        gemini_attempt_count: 1,
        gemini_attempts: [failedAttempt],
        gemini_selected_model: null,
      })
    ).resolves.toEqual({
      ...jobRow,
      gemini_attempt_count: 1,
      gemini_attempts: [failedAttempt],
      gemini_selected_model: null,
    });

    const claimClient = createClaimDueQueuedJobClient(jobRow, {
      ...jobRow,
      attempts: 1,
      status: 'running',
    }, '2026-05-25T13:00:00.000Z');
    await expect(
      claimDueQueuedJob(claimClient, 'job-row-id', '2026-05-25T13:00:00.000Z')
    ).resolves.toEqual({
      ...jobRow,
      attempts: 1,
      status: 'running',
    });
  });

  it('returns null when queued claim loses race', async () => {
    const claimClient = createClaimDueQueuedJobClient(null, null, '2026-05-25T13:00:00.000Z');

    await expect(
      claimDueQueuedJob(claimClient, 'job-row-id', '2026-05-25T13:00:00.000Z')
    ).resolves.toBeNull();
  });

  it('creates, lists, and updates ai model attempts', async () => {
    const startedAttemptRow = {
      ...aiModelAttemptRow,
      attempt_order: 2,
      id: 'ai-model-attempt-row-id',
      job_id: 'job-row-id',
      status: 'started',
    };
    const createClient = createAiModelAttemptInsertClient(startedAttemptRow, 1, (payload) => {
      expect(payload).toEqual({
        attempt_order: 2,
        job_id: 'job-row-id',
        listing_id: 'LIST-001',
        metadata: {},
        model_name: 'gemini-3.1-flash-lite',
        provider: 'google',
        provider_model_id: 'gemini-3.1-flash-lite',
        routing_source: 'direct_gemini',
        started_at: '2026-05-25T13:00:00.000Z',
        status: 'started',
      });
    });

    await expect(
      createAiModelAttempt(createClient, {
        job_id: 'job-row-id',
        listing_id: 'LIST-001',
        model_name: 'gemini-3.1-flash-lite',
        provider: 'google',
        provider_model_id: 'gemini-3.1-flash-lite',
        routing_source: 'direct_gemini',
        started_at: '2026-05-25T13:00:00.000Z',
      })
    ).resolves.toEqual(startedAttemptRow);

    const nullJobAttemptRow = {
      ...aiModelAttemptRow,
      attempt_order: 1,
      id: 'ai-model-attempt-row-null-job-id',
      job_id: null,
      started_at: '2026-05-25T13:05:00.000Z',
    };
    const createNullJobClient = createAiModelAttemptInsertClient(
      nullJobAttemptRow,
      null,
      (payload) => {
        expect(payload).toEqual({
          attempt_order: 1,
          job_id: null,
          listing_id: 'LIST-001',
          metadata: {},
          model_name: 'gemini-3.1-flash-lite',
          provider: 'google',
          provider_model_id: null,
          routing_source: null,
          started_at: '2026-05-25T13:05:00.000Z',
          status: 'started',
        });
      }
    );

    await expect(
      createAiModelAttempt(createNullJobClient, {
        job_id: null,
        listing_id: 'LIST-001',
        model_name: 'gemini-3.1-flash-lite',
        provider: 'google',
        started_at: '2026-05-25T13:05:00.000Z',
      })
    ).resolves.toEqual(nullJobAttemptRow);

    const listClient = createAiModelAttemptListClient([
      {
        ...startedAttemptRow,
        attempt_order: 1,
        created_at: '2026-05-25T13:00:00.000Z',
        id: 'ai-model-attempt-row-1',
      },
      {
        ...startedAttemptRow,
        attempt_order: 2,
        created_at: '2026-05-25T13:01:00.000Z',
        id: 'ai-model-attempt-row-2',
      },
    ]);

    await expect(listAiModelAttemptsForListing(listClient, 'LIST-001')).resolves.toEqual([
      {
        ...startedAttemptRow,
        attempt_order: 1,
        created_at: '2026-05-25T13:00:00.000Z',
        id: 'ai-model-attempt-row-1',
      },
      {
        ...startedAttemptRow,
        attempt_order: 2,
        created_at: '2026-05-25T13:01:00.000Z',
        id: 'ai-model-attempt-row-2',
      },
    ]);

    const listByIdsClient = createAiModelAttemptListByListingIdsClient(
      [
        {
          ...startedAttemptRow,
          attempt_order: 1,
          created_at: '2026-05-25T13:00:00.000Z',
          id: 'ai-model-attempt-row-1',
        },
        {
          ...startedAttemptRow,
          attempt_order: 1,
          created_at: '2026-05-25T13:02:00.000Z',
          id: 'ai-model-attempt-row-3',
          listing_id: 'LIST-002',
        },
      ],
      ['LIST-001', 'LIST-002']
    );

    await expect(
      listAiModelAttemptsForListings(listByIdsClient, ['LIST-001', 'LIST-002'])
    ).resolves.toEqual([
      {
        ...startedAttemptRow,
        attempt_order: 1,
        created_at: '2026-05-25T13:00:00.000Z',
        id: 'ai-model-attempt-row-1',
      },
      {
        ...startedAttemptRow,
        attempt_order: 1,
        created_at: '2026-05-25T13:02:00.000Z',
        id: 'ai-model-attempt-row-3',
        listing_id: 'LIST-002',
      },
    ]);

    const latestGeminiClient = createLatestGeminiUsageAttemptClient({
      attemptRow: {
        finished_at: '2026-05-25T13:00:02.000Z',
        id: 'ai-model-attempt-row-id',
        model_name: 'gemini-3.5-flash',
        provider: 'google',
        started_at: '2026-05-25T13:00:00.000Z',
        status: 'succeeded',
      },
      catalogRow: {
        display_name: 'Gemini 3.5 Flash',
      },
    });

    await expect(getLatestGeminiUsageAttempt(latestGeminiClient)).resolves.toEqual({
      display_name: 'Gemini 3.5 Flash',
      finished_at: '2026-05-25T13:00:02.000Z',
      model_name: 'gemini-3.5-flash',
      provider: 'google',
      started_at: '2026-05-25T13:00:00.000Z',
      status: 'succeeded',
    });

    const latestGeminiWithoutCatalogClient = createLatestGeminiUsageAttemptClient({
      attemptRow: {
        finished_at: '2026-05-25T13:00:02.000Z',
        id: 'ai-model-attempt-row-id',
        model_name: 'gemini-3.5-flash',
        provider: 'google',
        started_at: '2026-05-25T13:00:00.000Z',
        status: 'succeeded',
      },
      catalogRow: null,
    });

    await expect(
      getLatestGeminiUsageAttempt(latestGeminiWithoutCatalogClient)
    ).resolves.toEqual({
      display_name: null,
      finished_at: '2026-05-25T13:00:02.000Z',
      model_name: 'gemini-3.5-flash',
      provider: 'google',
      started_at: '2026-05-25T13:00:00.000Z',
      status: 'succeeded',
    });

    const latestGeminiCatalogErrorClient = createLatestGeminiUsageAttemptClient({
      attemptRow: {
        finished_at: '2026-05-25T13:00:02.000Z',
        id: 'ai-model-attempt-row-id',
        model_name: 'gemini-3.5-flash',
        provider: 'google',
        started_at: '2026-05-25T13:00:00.000Z',
        status: 'succeeded',
      },
      catalogError: 'catalog lookup failed',
    });

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(getLatestGeminiUsageAttempt(latestGeminiCatalogErrorClient)).resolves.toEqual({
      display_name: null,
      finished_at: '2026-05-25T13:00:02.000Z',
      model_name: 'gemini-3.5-flash',
      provider: 'google',
      started_at: '2026-05-25T13:00:00.000Z',
      status: 'succeeded',
    });
    expect(consoleWarnSpy).toHaveBeenCalledOnce();
    consoleWarnSpy.mockRestore();

    const latestGeminiMissingClient = createLatestGeminiUsageAttemptClient({
      attemptRow: null,
    });

    await expect(getLatestGeminiUsageAttempt(latestGeminiMissingClient)).resolves.toBeNull();

    const succeededClient = createUpdateClient(
      'ai_model_attempts',
      {
        ...startedAttemptRow,
        duration_ms: 2000,
        finished_at: '2026-05-25T13:00:02.000Z',
        status: 'succeeded',
      },
      'id',
      'ai-model-attempt-row-id',
      (payload) => {
        expect(payload).toEqual({
          duration_ms: 2000,
          finished_at: '2026-05-25T13:00:02.000Z',
          status: 'succeeded',
        });
      }
    );

    await expect(
      markAiModelAttemptSucceeded(succeededClient, {
        duration_ms: 2000,
        finished_at: '2026-05-25T13:00:02.000Z',
        id: 'ai-model-attempt-row-id',
      })
    ).resolves.toEqual({
      ...startedAttemptRow,
      duration_ms: 2000,
      finished_at: '2026-05-25T13:00:02.000Z',
      status: 'succeeded',
    });

    const failedClient = createUpdateClient(
      'ai_model_attempts',
      {
        ...startedAttemptRow,
        duration_ms: 2000,
        failure_code: 'generate_ai_failed',
        failure_message: 'Gemini timed out',
        finished_at: '2026-05-25T13:00:02.000Z',
        status: 'failed',
      },
      'id',
      'ai-model-attempt-row-id',
      (payload) => {
        expect(payload).toEqual({
          duration_ms: 2000,
          failure_code: 'generate_ai_failed',
          failure_message: 'Gemini timed out',
          finished_at: '2026-05-25T13:00:02.000Z',
          status: 'failed',
        });
      }
    );

    await expect(
      markAiModelAttemptFailed(failedClient, {
        duration_ms: 2000,
        failure_code: 'generate_ai_failed',
        failure_message: 'Gemini timed out',
        finished_at: '2026-05-25T13:00:02.000Z',
        id: 'ai-model-attempt-row-id',
      })
    ).resolves.toEqual({
      ...startedAttemptRow,
      duration_ms: 2000,
      failure_code: 'generate_ai_failed',
      failure_message: 'Gemini timed out',
      finished_at: '2026-05-25T13:00:02.000Z',
      status: 'failed',
    });
  });

  it('retries ai model attempt creation on attempt-order unique conflicts', async () => {
    let selectCount = 0;
    let insertCount = 0;

    const retryClient = {
      from: vi.fn((name: string) => {
        expect(name).toBe('ai_model_attempts');

        return {
          select: vi.fn((columns: string) => {
            expect(columns).toBe('attempt_order');

            return {
              eq: vi.fn((firstColumn: string, firstValue: string) => {
                expect(firstColumn).toBe('listing_id');
                expect(firstValue).toBe('LIST-001');

                return {
                  eq: vi.fn((secondColumn: string, secondValue: string) => {
                    expect(secondColumn).toBe('job_id');
                    expect(secondValue).toBe('job-row-id');

                    return {
                      order: vi.fn((orderColumn: string, options: { ascending: boolean }) => {
                        expect(orderColumn).toBe('attempt_order');
                        expect(options).toEqual({ ascending: false });

                        return {
                          limit: vi.fn(async (limit: number) => {
                            expect(limit).toBe(1);
                            selectCount += 1;

                            return {
                              data: [{ attempt_order: selectCount }],
                              error: null,
                            };
                          }),
                        };
                      }),
                    };
                  }),
                };
              }),
            };
          }),
          insert: vi.fn((payload: unknown) => {
            insertCount += 1;
            expect(payload).toEqual({
              attempt_order: insertCount === 1 ? 2 : 3,
              job_id: 'job-row-id',
              listing_id: 'LIST-001',
              metadata: {},
              model_name: 'gemini-3.1-flash-lite',
              provider: 'google',
              provider_model_id: 'gemini-3.1-flash-lite',
              routing_source: 'direct_gemini',
              started_at: '2026-05-25T13:00:00.000Z',
              status: 'started',
            });

            return {
              select: vi.fn(() => ({
                single: vi.fn(async () =>
                  insertCount === 1
                    ? {
                        data: null,
                        error: {
                          code: '23505',
                          message:
                            'duplicate key value violates unique constraint "ai_model_attempts_listing_job_attempt_order_uidx"',
                        },
                      }
                    : {
                        data: {
                          ...aiModelAttemptRow,
                          attempt_order: 3,
                          id: 'ai-model-attempt-row-retried',
                        },
                        error: null,
                      }
                ),
              })),
            };
          }),
        };
      }),
    } as unknown as SupabaseDataClient;

    await expect(
      createAiModelAttempt(retryClient, {
        job_id: 'job-row-id',
        listing_id: 'LIST-001',
        model_name: 'gemini-3.1-flash-lite',
        provider: 'google',
        provider_model_id: 'gemini-3.1-flash-lite',
        routing_source: 'direct_gemini',
        started_at: '2026-05-25T13:00:00.000Z',
      })
    ).resolves.toEqual({
      ...aiModelAttemptRow,
      attempt_order: 3,
      id: 'ai-model-attempt-row-retried',
    });
  });

  it('lists stale running jobs and wraps retry helper updates', async () => {
    const staleJob: JobRow = {
      ...jobRow,
      attempts: 1,
      last_error: 'boom',
      last_error_at: '2026-05-25T12:00:00.000Z',
      last_error_code: 'stale_worker',
      next_run_at: '2026-05-25T13:01:00.000Z',
      status: 'running',
      updated_at: '2026-05-25T11:00:00.000Z',
    };
    const staleListClient = {
      from: vi.fn((name: string) => {
        expect(name).toBe('jobs');

        return {
          select: vi.fn((columns: string) => {
            expect(columns).toBe('*');

            return {
              eq: vi.fn((firstColumn: string, firstValue: string) => {
                expect(firstColumn).toBe('status');
                expect(firstValue).toBe('running');

                return {
                  lt: vi.fn((secondColumn: string, secondValue: string) => {
                    expect(secondColumn).toBe('updated_at');
                    expect(secondValue).toBe('2026-05-25T12:00:00.000Z');

                    return {
                      order: vi.fn((thirdColumn: string, options: { ascending: boolean }) => {
                        expect(thirdColumn).toBe('updated_at');
                        expect(options).toEqual({ ascending: true });

                        return {
                          data: [staleJob],
                          error: null,
                        };
                      }),
                    };
                  }),
                };
              }),
            };
          }),
        };
      }),
    } as unknown as SupabaseDataClient;

    await expect(listStaleRunningJobs(staleListClient, '2026-05-25T12:00:00.000Z')).resolves.toEqual([
      staleJob,
    ]);

    const requeueClient = createUpdateClient('jobs', jobRow, 'id', 'job-row-id', (payload) => {
      expect(payload).toEqual({
        last_error: 'boom',
        last_error_at: '2026-05-25T13:00:00.000Z',
        last_error_code: 'stale_worker',
        next_run_at: '2026-05-25T13:01:00.000Z',
        status: 'queued',
      });
    });
    await expect(
      requeueJob(
        requeueClient,
        'job-row-id',
        {
          errorAt: '2026-05-25T13:00:00.000Z',
          errorCode: 'stale_worker',
          errorMessage: 'boom',
        },
        '2026-05-25T13:01:00.000Z'
      )
    ).resolves.toEqual(jobRow);

    const failClient = createUpdateClient('jobs', jobRow, 'id', 'job-row-id', (payload) => {
      expect(payload).toEqual({
        last_error: 'boom',
        last_error_at: '2026-05-25T13:00:00.000Z',
        last_error_code: 'retry_exhausted',
        next_run_at: null,
        status: 'failed',
      });
    });
    await expect(
      failJob(failClient, 'job-row-id', {
        errorAt: '2026-05-25T13:00:00.000Z',
        errorCode: 'retry_exhausted',
        errorMessage: 'boom',
      })
    ).resolves.toEqual(jobRow);

    const completeClient = createUpdateClient('jobs', jobRow, 'id', 'job-row-id', (payload) => {
      expect(payload).toEqual({
        last_error: null,
        last_error_at: null,
        last_error_code: null,
        next_run_at: null,
        status: 'completed',
      });
    });
    await expect(completeJob(completeClient, 'job-row-id')).resolves.toEqual(jobRow);
  });

  it('resets failed jobs for manual retry and leaves non-failed jobs untouched', async () => {
    const failedJob: JobRow = {
      ...publishJobRow,
      attempts: 3,
      last_error: 'boom',
      last_error_at: '2026-05-25T12:00:00.000Z',
      last_error_code: 'retry_exhausted',
      status: 'failed',
      updated_at: '2026-05-25T12:00:00.000Z',
    };
    const resetJob: JobRow = {
      ...failedJob,
      attempts: 0,
      last_error: null,
      last_error_at: null,
      last_error_code: null,
      next_run_at: null,
      status: 'queued',
      updated_at: '2026-05-25T13:00:00.000Z',
    };

    await expect(
      resetJobForManualRetry(
        createResetJobForManualRetryClient(
          failedJob,
          resetJob,
          '2026-05-25T13:00:00.000Z'
        ),
        'job-row-id',
        '2026-05-25T13:00:00.000Z'
      )
    ).resolves.toEqual(resetJob);

    await expect(
      resetJobForManualRetry(
        createResetJobForManualRetryClient(
          {
            ...failedJob,
            status: 'completed',
          },
          null,
          '2026-05-25T13:00:00.000Z'
        ),
        'job-row-id',
        '2026-05-25T13:00:00.000Z'
      )
    ).resolves.toBeNull();
  });

  it('returns null when publish manual retry reset loses to an active job conflict', async () => {
    const failedPublishJob: JobRow = {
      ...publishJobRow,
      attempts: 2,
      last_error: 'publish failed',
      last_error_at: '2026-05-25T12:00:00.000Z',
      last_error_code: 'publish_offer_publish_failed',
      status: 'failed',
      updated_at: '2026-05-25T12:00:00.000Z',
    };
    const conflictClient = {
      from: vi.fn((name: string) => {
        expect(name).toBe('jobs');

        return {
          select: vi.fn((columns: string) => {
            expect(columns).toBe('*');

            return {
              eq: vi.fn((firstColumn: string, firstValue: string) => {
                expect(firstColumn).toBe('id');
                expect(firstValue).toBe('job-row-id');

                return {
                  maybeSingle: vi.fn(async () => ({
                    data: failedPublishJob,
                    error: null,
                  })),
                };
              }),
            };
          }),
          update: vi.fn((payload: unknown) => {
            expect(payload).toEqual({
              attempts: 0,
              gemini_attempt_count: 0,
              gemini_attempts: [],
              gemini_selected_model: null,
              last_error: null,
              last_error_at: null,
              last_error_code: null,
              next_run_at: null,
              status: 'queued',
              updated_at: '2026-05-25T13:00:00.000Z',
            });

            return {
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    eq: vi.fn(() => ({
                      select: vi.fn(() => ({
                        maybeSingle: vi.fn(async () => ({
                          data: null,
                          error: {
                            code: '23505',
                            message:
                              'duplicate key value violates unique constraint "jobs_publish_active_listing_idx"',
                          },
                        })),
                      })),
                    })),
                  })),
                })),
              })),
            };
          }),
        };
      }),
    } as unknown as SupabaseDataClient;

    await expect(
      resetJobForManualRetry(conflictClient, 'job-row-id', '2026-05-25T13:00:00.000Z')
    ).resolves.toBeNull();
  });

  it('looks up the newest active generate_ai job by listing id', async () => {
    const lookupClient = createActiveGenerateAiLookupClient(generateAiJobRow);

    await expect(getActiveGenerateAiJobByListingId(lookupClient, 'LIST-001')).resolves.toEqual(
      generateAiJobRow
    );
  });

  it('looks up the newest active research_price job by listing id', async () => {
    const lookupClient = createActiveResearchPriceLookupClient(researchPriceJobRow);

    await expect(getActiveResearchPriceJobByListingId(lookupClient, 'LIST-001')).resolves.toEqual(
      researchPriceJobRow
    );
  });

  it('enqueues generate_ai jobs and reports fresh create vs already queued', async () => {
    const createClient = createInsertClient('jobs', generateAiJobRow, (payload) => {
      expect(payload).toEqual({
        job_type: 'generate_ai',
        listing_id: 'LIST-001',
        max_attempts: 3,
        status: 'queued',
      });
    });

    await expect(enqueueGenerateAiJob(createClient, 'LIST-001')).resolves.toEqual({
      alreadyQueued: false,
      job: generateAiJobRow,
    });
  });

  it('enqueues research_price jobs with default max attempts 1', async () => {
    const createClient = createInsertClient('jobs', researchPriceJobRow, (payload) => {
      expect(payload).toEqual({
        job_type: 'research_price',
        listing_id: 'LIST-001',
        max_attempts: 1,
        status: 'queued',
      });
    });

    await expect(enqueueResearchPriceJob(createClient, 'LIST-001')).resolves.toEqual({
      alreadyQueued: false,
      job: researchPriceJobRow,
    });
  });

  it('returns existing active research_price job when duplicate insert hits DB protection', async () => {
    const lookupClient = createActiveResearchPriceLookupClient(researchPriceJobRow);
    const duplicateClient = {
      from: vi.fn((name: string) => {
        expect(name).toBe('jobs');

        return {
          insert: vi.fn((payload: unknown) => {
            expect(payload).toEqual({
              job_type: 'research_price',
              listing_id: 'LIST-001',
              max_attempts: 1,
              status: 'queued',
            });

            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: null,
                  error: {
                    code: '23505',
                    message:
                      'duplicate key value violates unique constraint "jobs_research_price_active_listing_idx"',
                  },
                })),
              })),
            };
          }),
          select: lookupClient.from('jobs').select,
        };
      }),
    } as unknown as SupabaseDataClient;

    await expect(enqueueResearchPriceJob(duplicateClient, 'LIST-001')).resolves.toEqual({
      alreadyQueued: true,
      job: researchPriceJobRow,
    });
  });

  it('returns existing queued research_price job on repeated enqueue attempts', async () => {
    let insertCount = 0;
    let createdJob: JobRow | null = null;

    const duplicateClient = {
      from: vi.fn((name: string) => {
        expect(name).toBe('jobs');

        return {
          insert: vi.fn((payload: unknown) => {
            expect(payload).toEqual({
              job_type: 'research_price',
              listing_id: 'LIST-001',
              max_attempts: 1,
              status: 'queued',
            });

            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => {
                  insertCount += 1;

                  if (insertCount === 1) {
                    createdJob = {
                      ...researchPriceJobRow,
                      id: 'job-research-price-repeat',
                      status: 'queued',
                    };

                    return {
                      data: createdJob,
                      error: null,
                    };
                  }

                  return {
                    data: null,
                    error: {
                      code: '23505',
                      message:
                        'duplicate key value violates unique constraint "jobs_research_price_active_listing_idx"',
                    },
                  };
                }),
              })),
            };
          }),
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn((statusColumn: string, statuses: string[]) => {
                  expect(statusColumn).toBe('status');
                  expect(statuses).toEqual(['queued', 'running']);

                  return {
                    order: vi.fn(() => ({
                      limit: vi.fn(() => ({
                        maybeSingle: vi.fn(async () => ({
                          data: createdJob,
                          error: null,
                        })),
                      })),
                    })),
                  };
                }),
              })),
            })),
          })),
        };
      }),
    } as unknown as SupabaseDataClient;

    const firstResult = await enqueueResearchPriceJob(duplicateClient, 'LIST-001');
    const secondResult = await enqueueResearchPriceJob(duplicateClient, 'LIST-001');

    expect(firstResult).toEqual({
      alreadyQueued: false,
      job: expect.objectContaining({ id: 'job-research-price-repeat', status: 'queued' }),
    });
    expect(secondResult).toEqual({
      alreadyQueued: true,
      job: expect.objectContaining({ id: 'job-research-price-repeat', status: 'queued' }),
    });
  });

  it('returns existing running research_price job when duplicate insert hits DB protection', async () => {
    const runningResearchPriceJobRow: JobRow = {
      ...researchPriceJobRow,
      id: 'job-research-price-running',
      status: 'running',
    };
    const lookupClient = createActiveResearchPriceLookupClient(runningResearchPriceJobRow);
    const duplicateClient = {
      from: vi.fn((name: string) => {
        expect(name).toBe('jobs');

        return {
          insert: vi.fn((payload: unknown) => {
            expect(payload).toEqual({
              job_type: 'research_price',
              listing_id: 'LIST-001',
              max_attempts: 1,
              status: 'queued',
            });

            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: null,
                  error: {
                    code: '23505',
                    message:
                      'duplicate key value violates unique constraint "jobs_research_price_active_listing_idx"',
                  },
                })),
              })),
            };
          }),
          select: lookupClient.from('jobs').select,
        };
      }),
    } as unknown as SupabaseDataClient;

    await expect(enqueueResearchPriceJob(duplicateClient, 'LIST-001')).resolves.toEqual({
      alreadyQueued: true,
      job: runningResearchPriceJobRow,
    });
  });

  it('allows a second research_price enqueue after historical jobs because only active jobs conflict', async () => {
    const completedReplacementJob: JobRow = {
      ...researchPriceJobRow,
      id: 'job-research-price-row-id-completed-replacement',
      status: 'queued',
    };
    const createClient = createInsertClient('jobs', completedReplacementJob, (payload) => {
      expect(payload).toEqual({
        job_type: 'research_price',
        listing_id: 'LIST-001',
        max_attempts: 1,
        status: 'queued',
      });
    });

    await expect(enqueueResearchPriceJob(createClient, 'LIST-001')).resolves.toEqual({
      alreadyQueued: false,
      job: completedReplacementJob,
    });
  });

  it('respects explicit research_price max attempts override', async () => {
    const overrideRow: JobRow = {
      ...researchPriceJobRow,
      id: 'job-research-price-row-id-override',
      max_attempts: 4,
    };
    const createClient = createInsertClient('jobs', overrideRow, (payload) => {
      expect(payload).toEqual({
        job_type: 'research_price',
        listing_id: 'LIST-001',
        max_attempts: 4,
        status: 'queued',
      });
    });

    await expect(enqueueResearchPriceJob(createClient, 'LIST-001', 4)).resolves.toEqual({
      alreadyQueued: false,
      job: overrideRow,
    });
  });

  it('makes concurrent research_price enqueue idempotent under duplicate constraint race', async () => {
    let createdJob: JobRow | null = null;

    const concurrentClient = {
      from: vi.fn((name: string) => {
        expect(name).toBe('jobs');

        return {
          insert: vi.fn((payload: unknown) => {
            expect(payload).toEqual({
              job_type: 'research_price',
              listing_id: 'LIST-001',
              max_attempts: 1,
              status: 'queued',
            });

            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => {
                  if (!createdJob) {
                    createdJob = {
                      ...researchPriceJobRow,
                      id: 'job-research-price-concurrent-create',
                    };

                    return {
                      data: createdJob,
                      error: null,
                    };
                  }

                  return {
                    data: null,
                    error: {
                      code: '23505',
                      message:
                        'duplicate key value violates unique constraint "jobs_research_price_active_listing_idx"',
                    },
                  };
                }),
              })),
            };
          }),
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => ({
                        data: createdJob,
                        error: null,
                      })),
                    })),
                  })),
                })),
              })),
            })),
          })),
        };
      }),
    } as unknown as SupabaseDataClient;

    const [firstResult, secondResult] = await Promise.all([
      enqueueResearchPriceJob(concurrentClient, 'LIST-001'),
      enqueueResearchPriceJob(concurrentClient, 'LIST-001'),
    ]);

    expect(firstResult).toEqual({
      alreadyQueued: false,
      job: expect.objectContaining({ id: 'job-research-price-concurrent-create' }),
    });
    expect(secondResult).toEqual({
      alreadyQueued: true,
      job: expect.objectContaining({ id: 'job-research-price-concurrent-create' }),
    });
  });

  it('enqueues publish jobs and returns the active publish job on duplicate conflicts', async () => {
    const createClient = createInsertClient('jobs', publishJobRow, (payload) => {
      expect(payload).toEqual({
        job_type: 'publish',
        listing_id: 'LIST-001',
        max_attempts: 3,
        status: 'queued',
      });
    });

    await expect(enqueuePublishJob(createClient, 'LIST-001')).resolves.toEqual({
      alreadyQueued: false,
      job: publishJobRow,
    });

    const lookupClient = createActivePublishLookupClient(publishJobRow);
    const duplicateClient = {
      from: vi.fn((name: string) => {
        expect(name).toBe('jobs');

        return {
          insert: vi.fn((payload: unknown) => {
            expect(payload).toEqual({
              job_type: 'publish',
              listing_id: 'LIST-001',
              max_attempts: 3,
              status: 'queued',
            });

            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: null,
                  error: {
                    code: '23505',
                    message:
                      'duplicate key value violates unique constraint "jobs_publish_active_listing_idx"',
                  },
                })),
              })),
            };
          }),
          select: lookupClient.from('jobs').select,
        };
      }),
    } as unknown as SupabaseDataClient;

    await expect(enqueuePublishJob(duplicateClient, 'LIST-001')).resolves.toEqual({
      alreadyQueued: true,
      job: publishJobRow,
    });
  });

  it('makes concurrent publish enqueue idempotent under duplicate constraint race', async () => {
    let createdJob: JobRow | null = null;

    const concurrentClient = {
      from: vi.fn((name: string) => {
        expect(name).toBe('jobs');

        return {
          insert: vi.fn((payload: unknown) => {
            expect(payload).toEqual({
              job_type: 'publish',
              listing_id: 'LIST-001',
              max_attempts: 3,
              status: 'queued',
            });

            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => {
                  if (!createdJob) {
                    createdJob = {
                      ...publishJobRow,
                      id: 'job-publish-concurrent-create',
                    };

                    return {
                      data: createdJob,
                      error: null,
                    };
                  }

                  return {
                    data: null,
                    error: {
                      code: '23505',
                      message:
                        'duplicate key value violates unique constraint "jobs_publish_active_listing_idx"',
                    },
                  };
                }),
              })),
            };
          }),
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => ({
                        data: createdJob,
                        error: null,
                      })),
                    })),
                  })),
                })),
              })),
            })),
          })),
        };
      }),
    } as unknown as SupabaseDataClient;

    const [firstResult, secondResult] = await Promise.all([
      enqueuePublishJob(concurrentClient, 'LIST-001'),
      enqueuePublishJob(concurrentClient, 'LIST-001'),
    ]);

    expect(firstResult).toEqual({
      alreadyQueued: false,
      job: expect.objectContaining({ id: 'job-publish-concurrent-create' }),
    });
    expect(secondResult).toEqual({
      alreadyQueued: true,
      job: expect.objectContaining({ id: 'job-publish-concurrent-create' }),
    });
  });

  it('enqueues global process_images jobs and returns the active batch on duplicate conflicts', async () => {
    const processImagesJobRow: JobRow = {
      ...jobRow,
      id: 'job-process-images-row-id',
      listing_id: null,
      job_type: 'process_images',
    };
    const createClient = createInsertClient('jobs', processImagesJobRow, (payload) => {
      expect(payload).toEqual({
        job_type: 'process_images',
        listing_id: null,
        max_attempts: 2,
        status: 'queued',
      });
    });

    await expect(enqueueProcessImagesJob(createClient)).resolves.toEqual({
      alreadyQueued: false,
      job: processImagesJobRow,
    });

    const lookupClient = createActiveProcessImagesLookupClient(processImagesJobRow);
    const duplicateClient = {
      from: vi.fn((name: string) => {
        expect(name).toBe('jobs');

        return {
          insert: vi.fn((payload: unknown) => {
            expect(payload).toEqual({
              job_type: 'process_images',
              listing_id: null,
              max_attempts: 2,
              status: 'queued',
            });

            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: null,
                  error: {
                    code: '23505',
                    message:
                      'duplicate key value violates unique constraint "jobs_process_images_active_batch_idx"',
                  },
                })),
              })),
            };
          }),
          select: lookupClient.from('jobs').select,
        };
      }),
    } as unknown as SupabaseDataClient;

    await expect(enqueueProcessImagesJob(duplicateClient)).resolves.toEqual({
      alreadyQueued: true,
      job: processImagesJobRow,
    });
  });

  it('returns existing active generate_ai job when duplicate insert hits DB protection', async () => {
    const duplicateClient = {
      from: vi.fn((name: string) => {
        expect(name).toBe('jobs');

        return {
          insert: vi.fn((payload: unknown) => {
            expect(payload).toEqual({
              job_type: 'generate_ai',
              listing_id: 'LIST-001',
              max_attempts: 3,
              status: 'queued',
            });

            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: null,
                  error: {
                    code: '23505',
                    message:
                      'duplicate key value violates unique constraint "jobs_generate_ai_active_listing_idx"',
                  },
                })),
              })),
            };
          }),
          select: vi.fn((columns: string) => {
            expect(columns).toBe('*');

            return {
              eq: vi.fn((firstColumn: string, firstValue: string) => {
                expect(firstColumn).toBe('listing_id');
                expect(firstValue).toBe('LIST-001');

                return {
                  eq: vi.fn((secondColumn: string, secondValue: string) => {
                    expect(secondColumn).toBe('job_type');
                    expect(secondValue).toBe('generate_ai');

                    return {
                      in: vi.fn((statusColumn: string, statuses: string[]) => {
                        expect(statusColumn).toBe('status');
                        expect(statuses).toEqual(['queued', 'running']);

                        return {
                          order: vi.fn(() => ({
                            limit: vi.fn(() => ({
                              maybeSingle: vi.fn(async () => ({
                                data: generateAiJobRow,
                                error: null,
                              })),
                            })),
                          })),
                        };
                      }),
                    };
                  }),
                };
              }),
            };
          }),
        };
      }),
    } as unknown as SupabaseDataClient;

    await expect(enqueueGenerateAiJob(duplicateClient, 'LIST-001')).resolves.toEqual({
      alreadyQueued: true,
      job: generateAiJobRow,
    });
  });

  it('allows a second enqueue after historical generate_ai jobs because only active jobs conflict', async () => {
    const queuedReplacementJob: JobRow = {
      ...generateAiJobRow,
      id: 'job-generate-ai-row-id-2',
      status: 'queued',
    };
    const createClient = createInsertClient('jobs', queuedReplacementJob, (payload) => {
      expect(payload).toEqual({
        job_type: 'generate_ai',
        listing_id: 'LIST-001',
        max_attempts: 3,
        status: 'queued',
      });
    });

    await expect(enqueueGenerateAiJob(createClient, 'LIST-001')).resolves.toEqual({
      alreadyQueued: false,
      job: queuedReplacementJob,
    });
  });

  it('makes concurrent generate_ai enqueue idempotent under duplicate constraint race', async () => {
    let createdJob: JobRow | null = null;

    const concurrentClient = {
      from: vi.fn((name: string) => {
        expect(name).toBe('jobs');

        return {
          insert: vi.fn((payload: unknown) => {
            expect(payload).toEqual({
              job_type: 'generate_ai',
              listing_id: 'LIST-001',
              max_attempts: 3,
              status: 'queued',
            });

            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => {
                  if (!createdJob) {
                    createdJob = {
                      ...generateAiJobRow,
                      id: 'job-concurrent-create',
                    };

                    return {
                      data: createdJob,
                      error: null,
                    };
                  }

                  return {
                    data: null,
                    error: {
                      code: '23505',
                      message:
                        'duplicate key value violates unique constraint "jobs_generate_ai_active_listing_idx"',
                    },
                  };
                }),
              })),
            };
          }),
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => ({
                        data: createdJob,
                        error: null,
                      })),
                    })),
                  })),
                })),
              })),
            })),
          })),
        };
      }),
    } as unknown as SupabaseDataClient;

    const [firstResult, secondResult] = await Promise.all([
      enqueueGenerateAiJob(concurrentClient, 'LIST-001'),
      enqueueGenerateAiJob(concurrentClient, 'LIST-001'),
    ]);

    expect(firstResult).toEqual({
      alreadyQueued: false,
      job: expect.objectContaining({ id: 'job-concurrent-create' }),
    });
    expect(secondResult).toEqual({
      alreadyQueued: true,
      job: expect.objectContaining({ id: 'job-concurrent-create' }),
    });
  });

  it('creates, fetches latest, and marks listing price research rows terminal', async () => {
    const createClient = createInsertClient('listing_price_research', listingPriceResearchRow, (payload) => {
      expect(payload).toEqual({
        listing_id: 'LIST-001',
        provider: 'apify',
        status: 'pending',
      });
    });

    await expect(
      createListingPriceResearch(createClient, {
        listing_id: 'LIST-001',
        provider: 'apify',
        status: 'pending',
      })
    ).resolves.toEqual(listingPriceResearchRow);

    const latestClient = createLatestListingPriceResearchLookupClient(listingPriceResearchRow);
    await expect(getLatestListingPriceResearchByListingId(latestClient, 'LIST-001')).resolves.toEqual(
      listingPriceResearchRow
    );

    const succeededRow: ListingPriceResearchRow = {
      ...listingPriceResearchRow,
      confidence: 'high',
      comps: [{ id: 'comp-1' }],
      llm_price_explanation: 'Median sold supports range.',
      median_sold_price: 41.5,
      pricing_model_name: 'median-v1',
      query: 'vintage fisher price camera',
      raw_result_json: { source: 'apify' },
      sold_count: 18,
      status: 'succeeded',
      suggested_price: 44,
    };
    const succeededClient = createUpdateClient(
      'listing_price_research',
      succeededRow,
      'id',
      'listing-price-research-row-id',
      (payload) => {
        expect(payload).toEqual({
          comps: [{ id: 'comp-1' }],
          confidence: 'high',
          error_code: null,
          error_message: null,
          llm_price_explanation: 'Median sold supports range.',
          median_sold_price: 41.5,
          pricing_model_name: 'median-v1',
          query: 'vintage fisher price camera',
          raw_result_json: { source: 'apify' },
          sold_count: 18,
          status: 'succeeded',
          suggested_price: 44,
        });
      }
    );

    await expect(
      markListingPriceResearchSucceeded(succeededClient, {
        id: 'listing-price-research-row-id',
        comps: [{ id: 'comp-1' }],
        confidence: 'high',
        llm_price_explanation: 'Median sold supports range.',
        median_sold_price: 41.5,
        pricing_model_name: 'median-v1',
        query: 'vintage fisher price camera',
        raw_result_json: { source: 'apify' },
        sold_count: 18,
        suggested_price: 44,
      })
    ).resolves.toEqual(succeededRow);

    const failedRow: ListingPriceResearchRow = {
      ...listingPriceResearchRow,
      error_code: 'apify_timeout',
      error_message: 'Actor timed out',
      pricing_model_name: 'median-v1',
      raw_result_json: { runId: 'run-123' },
      status: 'failed',
    };
    const failedClient = createUpdateClient(
      'listing_price_research',
      failedRow,
      'id',
      'listing-price-research-row-id',
      (payload) => {
        expect(payload).toEqual({
          error_code: 'apify_timeout',
          error_message: 'Actor timed out',
          pricing_model_name: 'median-v1',
          raw_result_json: { runId: 'run-123' },
          status: 'failed',
        });
      }
    );

    await expect(
      markListingPriceResearchFailed(failedClient, {
        id: 'listing-price-research-row-id',
        error_code: 'apify_timeout',
        error_message: 'Actor timed out',
        pricing_model_name: 'median-v1',
        raw_result_json: { runId: 'run-123' },
      })
    ).resolves.toEqual(failedRow);
  });

  it('creates, fetches, and updates orders', async () => {
    const createClient = createInsertClient('orders', orderRow, (payload) => {
      expect(payload).toEqual({
        listing_id: 'LIST-001',
        order_id: 'ORDER-001',
      });
    });

    await expect(
      createOrder(createClient, {
        listing_id: 'LIST-001',
        order_id: 'ORDER-001',
      })
    ).resolves.toEqual(orderRow);

    const getClient = createSelectClient('orders', orderRow, 'order_id', 'ORDER-001');
    await expect(getOrderByOrderId(getClient, 'ORDER-001')).resolves.toEqual(orderRow);

    const updateClient = createUpdateClient('orders', orderRow, 'order_id', 'ORDER-001', (payload) => {
      expect(payload).toEqual({
        fulfillment_status: 'shipped',
      });
    });

    await expect(updateOrder(updateClient, 'ORDER-001', { fulfillment_status: 'shipped' })).resolves.toEqual(
      orderRow
    );
  });

  it('creates today daily usage row when missing', async () => {
    const createdRow: DailyUsageRow = {
      ...dailyUsageRow,
      usage_date: '2026-05-31',
    };
    const client = createDailyUsageClient({
      dailyUsage: null,
      insertedDailyUsage: createdRow,
      onDailyUsageInsert: (payload) => {
        expect(payload).toEqual({
          usage_date: '2026-05-31',
        });
      },
    });

    await expect(getOrCreateDailyUsage(client, '2026-05-31')).resolves.toEqual(createdRow);
  });

  it('resolves Gemini limit from app settings when present', async () => {
    const client = createDailyUsageClient({
      appSettings: {
        ...appSettingsRow,
        gemini_daily_limit: 750,
      },
      routeCapacityRows: [
        {
          catalog: {
            free_tier_daily_request_limit: 20,
            is_enabled: true,
            is_free_tier_eligible: true,
          },
          route_is_enabled: true,
          model_name: 'gemini-3.5-flash',
        },
        {
          catalog: {
            free_tier_daily_request_limit: 20,
            is_enabled: true,
            is_free_tier_eligible: true,
          },
          route_is_enabled: true,
          model_name: 'gemini-3-flash-preview',
        },
        {
          catalog: {
            free_tier_daily_request_limit: 500,
            is_enabled: true,
            is_free_tier_eligible: true,
          },
          route_is_enabled: true,
          model_name: 'gemini-3.1-flash-lite',
        },
      ],
    });

    await expect(getEffectiveGeminiDailyLimit(client, '2026-05-31')).resolves.toEqual({
      effectiveLimit: 750,
      source: 'app_settings',
      usage: dailyUsageRow,
    });
  });

  it('falls back Gemini limit to daily usage row, then aggregates only enabled free-tier route capacity, then default', async () => {
    const dailyUsageLimitClient = createDailyUsageClient({
      appSettings: {
        ...appSettingsRow,
        gemini_daily_limit: null,
      },
      dailyUsage: {
        ...dailyUsageRow,
        gemini_daily_limit: 610,
      },
    });

    await expect(getEffectiveGeminiDailyLimit(dailyUsageLimitClient, '2026-05-31')).resolves.toEqual({
      effectiveLimit: 610,
      source: 'daily_usage',
      usage: {
        ...dailyUsageRow,
        gemini_daily_limit: 610,
      },
    });

    const routeCapacityClient = createDailyUsageClient({
      appSettings: {
        ...appSettingsRow,
        gemini_daily_limit: null,
      },
      dailyUsage: {
        ...dailyUsageRow,
        gemini_daily_limit: 0,
      },
      routeCapacityRows: [
        {
          catalog: {
            free_tier_daily_request_limit: 20,
            is_enabled: true,
            is_free_tier_eligible: true,
          },
          route_is_enabled: true,
          model_name: 'gemini-3.5-flash',
        },
        {
          catalog: {
            free_tier_daily_request_limit: 20,
            is_enabled: true,
            is_free_tier_eligible: true,
          },
          route_is_enabled: true,
          model_name: 'gemini-3-flash-preview',
        },
        {
          catalog: {
            free_tier_daily_request_limit: 500,
            is_enabled: true,
            is_free_tier_eligible: true,
          },
          route_is_enabled: true,
          model_name: 'gemini-3.1-flash-lite',
        },
        {
          catalog: {
            free_tier_daily_request_limit: 999,
            is_enabled: false,
            is_free_tier_eligible: true,
          },
          route_is_enabled: true,
          model_name: 'ignored-disabled-catalog',
        },
        {
          catalog: {
            free_tier_daily_request_limit: 999,
            is_enabled: true,
            is_free_tier_eligible: false,
          },
          route_is_enabled: true,
          model_name: 'ignored-paid-only-catalog',
        },
        {
          catalog: {
            free_tier_daily_request_limit: 999,
            is_enabled: true,
            is_free_tier_eligible: true,
          },
          route_is_enabled: false,
          model_name: 'ignored-disabled-route',
        },
      ],
    });

    await expect(getEffectiveGeminiDailyLimit(routeCapacityClient, '2026-05-31')).resolves.toEqual({
      effectiveLimit: 540,
      source: 'route_capacity',
      usage: {
        ...dailyUsageRow,
        gemini_daily_limit: 0,
      },
    });

    const defaultClient = createDailyUsageClient({
      appSettings: {
        ...appSettingsRow,
        gemini_daily_limit: null,
      },
      dailyUsage: {
        ...dailyUsageRow,
        gemini_daily_limit: 0,
      },
    });

    await expect(getEffectiveGeminiDailyLimit(defaultClient, '2026-05-31')).resolves.toEqual({
      effectiveLimit: 500,
      source: 'default',
      usage: {
        ...dailyUsageRow,
        gemini_daily_limit: 0,
      },
    });
  });

  it('builds Gemini Pacific usage windows for standard, daylight, and DST-adjacent dates', () => {
    expect(resolveGeminiDailyUsageWindow(new Date('2026-01-15T12:00:00.000Z'))).toEqual({
      resetAt: '2026-01-16T08:00:00.000Z',
      resetTimeZone: 'America/Los_Angeles',
      usageDate: '2026-01-15',
    });

    expect(resolveGeminiDailyUsageWindow(new Date('2026-07-15T12:00:00.000Z'))).toEqual({
      resetAt: '2026-07-16T07:00:00.000Z',
      resetTimeZone: 'America/Los_Angeles',
      usageDate: '2026-07-15',
    });

    expect(resolveGeminiDailyUsageWindow(new Date('2026-03-08T09:30:00.000Z'))).toEqual({
      resetAt: '2026-03-09T07:00:00.000Z',
      resetTimeZone: 'America/Los_Angeles',
      usageDate: '2026-03-08',
    });
  });

  it('summarizes Gemini usage with Pacific usage date, clamped remaining, and reset time', async () => {
    const client = createDailyUsageClient({
      appSettings: {
        ...appSettingsRow,
        gemini_daily_limit: 500,
      },
      dailyUsage: {
        ...dailyUsageRow,
        gemini_calls_used: 21,
        usage_date: '2026-07-15',
      },
    });

    await expect(
      getGeminiDailyUsageSummary(client, new Date('2026-07-15T12:00:00.000Z'))
    ).resolves.toEqual({
      effectiveLimit: 500,
      remaining: 479,
      resetAt: '2026-07-16T07:00:00.000Z',
      resetTimeZone: 'America/Los_Angeles',
      usageDate: '2026-07-15',
      used: 21,
    });
  });

  it('summarizes Gemini usage with aggregated free-tier route capacity of 540', async () => {
    const client = createDailyUsageClient({
      appSettings: {
        ...appSettingsRow,
        gemini_daily_limit: null,
      },
      dailyUsage: {
        ...dailyUsageRow,
        gemini_calls_used: 21,
        gemini_daily_limit: 0,
        usage_date: '2026-07-15',
      },
      routeCapacityRows: [
        {
          catalog: {
            free_tier_daily_request_limit: 20,
            is_enabled: true,
            is_free_tier_eligible: true,
          },
          route_is_enabled: true,
          model_name: 'gemini-3.5-flash',
        },
        {
          catalog: {
            free_tier_daily_request_limit: 20,
            is_enabled: true,
            is_free_tier_eligible: true,
          },
          route_is_enabled: true,
          model_name: 'gemini-3-flash-preview',
        },
        {
          catalog: {
            free_tier_daily_request_limit: 500,
            is_enabled: true,
            is_free_tier_eligible: true,
          },
          route_is_enabled: true,
          model_name: 'gemini-3.1-flash-lite',
        },
      ],
    });

    await expect(
      getGeminiDailyUsageSummary(client, new Date('2026-07-15T12:00:00.000Z'))
    ).resolves.toEqual({
      effectiveLimit: 540,
      remaining: 519,
      resetAt: '2026-07-16T07:00:00.000Z',
      resetTimeZone: 'America/Los_Angeles',
      usageDate: '2026-07-15',
      used: 21,
    });
  });

  it('uses Pacific usage date when Gemini limit and increment default date arguments are omitted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T06:30:00.000Z'));

    try {
      const limitClient = createDailyUsageClient({
        dailyUsage: {
          ...dailyUsageRow,
          usage_date: '2026-07-14',
        },
      });

      await expect(getEffectiveGeminiDailyLimit(limitClient)).resolves.toEqual({
        effectiveLimit: 500,
        source: 'app_settings',
        usage: {
          ...dailyUsageRow,
          usage_date: '2026-07-14',
        },
      });

      const incrementClient = createDailyUsageClient({
        dailyUsage: {
          ...dailyUsageRow,
          gemini_calls_used: 2,
          usage_date: '2026-07-14',
        },
        updateResult: {
          ...dailyUsageRow,
          gemini_calls_used: 3,
          usage_date: '2026-07-14',
        },
      });

      await expect(incrementGeminiCallsUsed(incrementClient)).resolves.toEqual({
        effectiveLimit: 500,
        resource: 'gemini',
        source: 'app_settings',
        updatedUsage: {
          ...dailyUsageRow,
          gemini_calls_used: 3,
          usage_date: '2026-07-14',
        },
        usage: {
          ...dailyUsageRow,
          gemini_calls_used: 2,
          usage_date: '2026-07-14',
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves order sync limit from app settings then default constant', async () => {
    const appSettingClient = createDailyUsageClient({
      appSettings: {
        ...appSettingsRow,
        max_order_syncs_per_day: 9,
      },
    });

    await expect(getEffectiveOrderSyncDailyLimit(appSettingClient, '2026-05-31')).resolves.toEqual({
      effectiveLimit: 9,
      source: 'app_settings',
      usage: dailyUsageRow,
    });

    const defaultClient = createDailyUsageClient({
      appSettings: {
        ...appSettingsRow,
        max_order_syncs_per_day: null,
      },
    });

    await expect(getEffectiveOrderSyncDailyLimit(defaultClient, '2026-05-31')).resolves.toEqual({
      effectiveLimit: DEFAULT_ORDER_SYNC_DAILY_LIMIT,
      source: 'default',
      usage: dailyUsageRow,
    });
  });

  it('increments Gemini usage when under limit and blocks once exhausted', async () => {
    const updateRow: DailyUsageRow = {
      ...dailyUsageRow,
      gemini_calls_used: 5,
    };
    const incrementClient = createDailyUsageClient({
      appSettings: {
        ...appSettingsRow,
        gemini_daily_limit: 10,
      },
      dailyUsage: {
        ...dailyUsageRow,
        gemini_calls_used: 4,
      },
      updateResult: updateRow,
      onDailyUsageUpdate: (payload) => {
        expect(payload).toEqual({
          gemini_calls_used: 5,
        });
      },
    });

    await expect(incrementGeminiCallsUsed(incrementClient, '2026-05-31')).resolves.toEqual({
      effectiveLimit: 10,
      resource: 'gemini',
      source: 'app_settings',
      updatedUsage: updateRow,
      usage: {
        ...dailyUsageRow,
        gemini_calls_used: 4,
      },
    });

    const blockedClient = createDailyUsageClient({
      appSettings: {
        ...appSettingsRow,
        gemini_daily_limit: 4,
      },
      dailyUsage: {
        ...dailyUsageRow,
        gemini_calls_used: 4,
      },
    });

    await expect(incrementGeminiCallsUsed(blockedClient, '2026-05-31')).rejects.toEqual(
      expect.objectContaining<Partial<DailyUsageLimitExceededError>>({
        effectiveLimit: 4,
        resource: 'gemini',
        source: 'app_settings',
        usageDate: '2026-05-31',
        used: 4,
      })
    );
  });

  it('clamps Gemini remaining calls at zero when usage exceeds effective limit', async () => {
    const client = createDailyUsageClient({
      appSettings: {
        ...appSettingsRow,
        gemini_daily_limit: 500,
      },
      dailyUsage: {
        ...dailyUsageRow,
        gemini_calls_used: 650,
        usage_date: '2026-05-31',
      },
    });

    await expect(
      getGeminiDailyUsageSummary(client, new Date('2026-06-01T06:00:00.000Z'))
    ).resolves.toEqual({
      effectiveLimit: 500,
      remaining: 0,
      resetAt: '2026-06-01T07:00:00.000Z',
      resetTimeZone: 'America/Los_Angeles',
      usageDate: '2026-05-31',
      used: 650,
    });
  });

  it('increments order sync usage when under limit and blocks once exhausted', async () => {
    const updateRow: DailyUsageRow = {
      ...dailyUsageRow,
      order_sync_count: 3,
    };
    const incrementClient = createDailyUsageClient({
      appSettings: {
        ...appSettingsRow,
        max_order_syncs_per_day: 5,
      },
      dailyUsage: {
        ...dailyUsageRow,
        order_sync_count: 2,
      },
      updateResult: updateRow,
      onDailyUsageUpdate: (payload) => {
        expect(payload).toEqual({
          order_sync_count: 3,
        });
      },
    });

    await expect(incrementOrderSyncCount(incrementClient, '2026-05-31')).resolves.toEqual({
      effectiveLimit: 5,
      resource: 'order_sync',
      source: 'app_settings',
      updatedUsage: updateRow,
      usage: {
        ...dailyUsageRow,
        order_sync_count: 2,
      },
    });

    const blockedClient = createDailyUsageClient({
      appSettings: {
        ...appSettingsRow,
        max_order_syncs_per_day: null,
      },
      dailyUsage: {
        ...dailyUsageRow,
        order_sync_count: DEFAULT_ORDER_SYNC_DAILY_LIMIT,
      },
    });

    await expect(incrementOrderSyncCount(blockedClient, '2026-05-31')).rejects.toEqual(
      expect.objectContaining<Partial<DailyUsageLimitExceededError>>({
        effectiveLimit: DEFAULT_ORDER_SYNC_DAILY_LIMIT,
        resource: 'order_sync',
        source: 'default',
        usageDate: '2026-05-31',
        used: DEFAULT_ORDER_SYNC_DAILY_LIMIT,
      })
    );
  });

  it('creates, fetches, and updates app settings', async () => {
    const createClient = createInsertClient('app_settings', appSettingsRow, (payload) => {
      expect(payload).toEqual({
        capture_mode: 'single_2_image',
        id: 'default',
      });
    });

    await expect(
      createAppSettings(createClient, {
        capture_mode: 'single_2_image',
        id: 'default',
      })
    ).resolves.toEqual(appSettingsRow);

    const getClient = createSelectClient('app_settings', appSettingsRow, 'id', 'default');
    await expect(getAppSettings(getClient)).resolves.toEqual(appSettingsRow);

    const updateClient = createUpdateClient('app_settings', appSettingsRow, 'id', 'default', (payload) => {
      expect(payload).toEqual({
        handling_days: 3,
      });
    });

    await expect(updateAppSettings(updateClient, { handling_days: 3 })).resolves.toEqual(appSettingsRow);
  });

  it('normalizes pricing provider mode from canonical, legacy, and missing settings', () => {
    expect(getPricingProviderMode(appSettingsRow)).toBe('soldcomps');
    expect(getPricingProviderMode({ pricing_provider_mode: 'apify' })).toBe('apify');
    expect(getPricingProviderMode({ pricing_service_enabled: false })).toBe('off');
    expect(getPricingProviderMode({ pricing_provider_mode: null })).toBe('soldcomps');
    expect(getPricingProviderMode(null)).toBe('soldcomps');
  });

  it('treats only off as disabled pricing mode', () => {
    expect(isPricingProviderModeEnabled('off')).toBe(false);
    expect(isPricingProviderModeEnabled('soldcomps')).toBe(true);
    expect(isPricingProviderModeEnabled('apify')).toBe(true);
    expect(isPricingEnabled({ pricing_provider_mode: 'off' })).toBe(false);
    expect(isPricingEnabled({ pricing_provider_mode: 'soldcomps' })).toBe(true);
    expect(isPricingEnabled({ pricing_provider_mode: 'apify' })).toBe(true);
    expect(isPricingEnabled({ pricing_service_enabled: false })).toBe(false);
    expect(isPricingEnabled(null)).toBe(true);
  });
});

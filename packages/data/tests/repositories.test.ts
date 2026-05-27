import { describe, expect, it, vi } from 'vitest';
import type {
  AppSettingsRow,
  JobRow,
  ListingRow,
  OrderRow,
  SupabaseDataClient,
} from '../src/index.js';
import {
  claimApprovedListingForPublish,
  claimDueQueuedJob,
  completeJob,
  createAppSettings,
  createJob,
  createListing,
  createOrder,
  enqueueGenerateAiJob,
  enqueueProcessImagesJob,
  enqueuePublishJob,
  failJob,
  getAppSettings,
  getActiveGenerateAiJobByListingId,
  getJobById,
  getListingByListingId,
  getOrderByOrderId,
  listApprovedForExportListings,
  listDueQueuedJobs,
  listListings,
  listListingsByStatus,
  listJobsByListingId,
  listJobsByListingIds,
  listStaleRunningJobs,
  prepareListingForGenerateAi,
  markListingPublishFailed,
  resetJobForManualRetry,
  requeueJob,
  saveListingArtifacts,
  saveListingImageMetadata,
  saveGeneratedListingFields,
  savePublishedListing,
  setGeminiJobAttemptAudit,
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
  gemini_daily_limit: 500,
  handling_days: 2,
  id: 'default',
  incoming_folder_path: '/incoming',
  max_order_syncs_per_day: 25,
  merchant_location_key: null,
  office_location_name: null,
  processed_folder_path: '/processed',
  r2_retention_days_after_sold: 30,
  updated_at: '2026-05-17T00:00:00.000Z',
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
        listing_id: 'LIST-001',
        sku: 'SKU-001',
        status: 'record_created',
        sub_status: 'idle',
      });
    });

    const created = await createListing(createClient, {
      listing_id: 'LIST-001',
      sku: 'SKU-001',
      status: 'record_created',
      sub_status: 'idle',
    });

    expect(created).toEqual(listingRow);

    const fetchClient = createSelectClient('listings', listingRow, 'listing_id', 'LIST-001');
    await expect(getListingByListingId(fetchClient, 'LIST-001')).resolves.toEqual(listingRow);

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
});

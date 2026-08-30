# Supabase migration reconciliation

This repository now tracks the canonical migration versions used by the linked
production Supabase project. The reconciliation is repository-only: it does not
write `supabase_migrations.schema_migrations`, execute SQL, or change the hosted
schema. The canonical history snapshot used for this ledger now includes the
YP2.4 variation-listing migration through `20260828150000`; the YP2.5 journal
migration is authored locally and remains the sole expected next pending file.

## Local versus canonical history ledger

The first three rows already had the canonical version. The next 31 rows were
renamed so Supabase CLI compares the same version identifiers as the live history;
their SQL was carried forward, with the pricing-foundation row also restoring
the live `llm_selected_comp_ids` column. Every row marked `applied-equivalent`
is represented in live history under the canonical version/name.

| Previous local file | Canonical local file | Live status / reconciliation |
| --- | --- | --- |
| `20260516220000_create_listings_table.sql` | same | applied-equivalent; unchanged |
| `20260516233000_create_operational_tables.sql` | same | applied-equivalent; unchanged |
| `20260517033525_enforce_operational_table_integrity.sql` | same | applied-equivalent; unchanged |
| `20260517160453_enforce_listing_workflow_status_integrity.sql` | `20260601194124_enforce_listing_workflow_status_integrity.sql` | applied-equivalent; version/name corrected |
| `20260518120000_seed_default_app_settings.sql` | `20260601194135_seed_default_app_settings.sql` | applied-equivalent; version/name corrected |
| `20260519120000_listings_image_arrays_text.sql` | `20260519163107_listings_image_arrays_text.sql` | applied-equivalent; version/name corrected |
| `20260520153000_prevent_duplicate_active_generate_ai_jobs.sql` | `20260520160140_prevent_duplicate_active_generate_ai_jobs.sql` | applied-equivalent; version/name corrected |
| `20260520180000_add_listing_debug_metadata.sql` | `20260521124701_add_listing_debug_metadata.sql` | applied-equivalent; version/name corrected |
| `20260521150000_remove_single_1_image_capture_mode.sql` | `20260601194140_remove_single_1_image_capture_mode.sql` | applied-equivalent; version/name corrected |
| `20260522130000_prevent_duplicate_active_process_images_jobs.sql` | `20260601194144_prevent_duplicate_active_process_images_jobs.sql` | applied-equivalent; version/name corrected |
| `20260527120000_allow_browser_read_access_to_listings.sql` | `20260527032227_allow_browser_read_access_to_listings.sql` | applied-equivalent; version/name corrected |
| `20260527153000_add_job_retry_metadata.sql` | `20260527190728_add_job_retry_metadata.sql` | applied-equivalent; version/name corrected |
| `20260527170000_add_publish_job_guard.sql` | `20260601194156_add_publish_job_guard.sql` | applied-equivalent; version/name corrected |
| `20260527183000_add_job_gemini_attempt_audit.sql` | `20260527211227_add_job_gemini_attempt_audit.sql` | applied-equivalent; version/name corrected |
| `20260531120000_explicit_api_table_grants.sql` | `20260601194206_explicit_api_table_grants.sql` | applied-equivalent; version/name corrected |
| `20260601002932_create_ai_model_attempts.sql` | `20260601011106_create_ai_model_attempts.sql` | applied-equivalent; version/name corrected |
| `20260601110000_add_ai_model_catalog_and_routes.sql` | `20260601145744_add_ai_model_catalog_and_routes.sql` | applied-equivalent; version/name corrected |
| `20260601123000_update_gemini_catalog_and_listing_routes.sql` | `20260601194420_update_gemini_catalog_and_listing_routes.sql` | applied-equivalent; version/name corrected |
| `20260601133000_set_daily_usage_gemini_limit_default_zero.sql` | `20260614011918_set_daily_usage_gemini_limit_default_zero.sql` | applied-equivalent; version/name corrected |
| `20260603120000_add_ebay_publish_config_to_app_settings.sql` | `20260603183913_add_ebay_publish_config_to_app_settings.sql` | applied-equivalent; version/name corrected |
| `20260603120000_expand_listing_publish_status_constraints.sql` | `20260603191141_expand_listing_publish_status_constraints.sql` | applied-equivalent; duplicate timestamp resolved |
| `20260604120000_align_listing_structured_sku_format.sql` | `20260610193159_align_listing_structured_sku_format.sql` | applied-equivalent; version/name corrected |
| `20260609120000_add_listing_price_research_foundation.sql` | `20260610193202_add_listing_price_research_foundation.sql` | applied-equivalent; version/name corrected; live `llm_selected_comp_ids` definition restored |
| `20260610120000_add_ai_model_usage_windows.sql` | `20260610193205_add_ai_model_usage_windows.sql` | applied-equivalent; version/name corrected |
| `20260610130000_add_gemma_pricing_route_config.sql` | `20260610193207_add_gemma_pricing_route_config.sql` | applied-equivalent; version/name corrected |
| `20260612120000_add_pricing_service_enabled_to_app_settings.sql` | `20260614011923_add_pricing_service_enabled_to_app_settings.sql` | applied-equivalent; version/name corrected |
| `20260615134200_replace_pricing_service_enabled_with_provider_mode.sql` | `20260615140208_replace_pricing_service_enabled_with_provider_mode.sql` | applied-equivalent; version/name corrected |
| `20260616170000_add_soldcomps_usage_snapshot_to_app_settings.sql` | `20260616194126_add_soldcomps_usage_snapshot_to_app_settings.sql` | applied-equivalent; version/name corrected |
| `20260622120000_add_dismissed_pricing_warning_codes.sql` | `20260623020049_add_dismissed_pricing_warning_codes.sql` | applied-equivalent; version/name corrected |
| `20260625113000_reorder_listing_draft_gemini_routes.sql` | `20260626031413_reorder_listing_draft_gemini_routes.sql` | applied-equivalent; version/name corrected |
| `20260701113000_reorder_gemini_routes_lite_first.sql` | `20260701170140_reorder_gemini_routes_lite_first.sql` | applied-equivalent; version/name corrected |
| `20260721213353_add_gemini_3_5_flash_lite_primary_route.sql` | `20260722025404_add_gemini_3_5_flash_lite_primary_route.sql` | applied-equivalent; version/name corrected |
| `20260729202152_add_listing_auto_pricing_enabled.sql` | `20260729204026_add_listing_auto_pricing_enabled.sql` | applied-equivalent; version/name corrected |
| `20260730140615_add_needs_review_listing_abandonment_cascades.sql` | `20260730161901_add_needs_review_listing_abandonment_cascades.sql` | applied-equivalent; version/name corrected |
| `20260616164800_trim_pricing_research_persistence.sql` | `supabase/retired-migrations/20260616164800_trim_pricing_research_persistence.sql` | **retired; never include in automatic CLI migrations** |
| — | `20260828150000_create_variation_listing_persistence.sql` | applied exactly once; 35/35 history alignment; four tables verified empty |
| — | `20260829150000_create_variation_listing_publishing_journal.sql` | **pending; sole expected next additive YP2.5 migration; author/validate only** |

The retired file is byte-preserved historical intent. Its `drop column if
exists listing_price_research.llm_selected_comp_ids` statement is unsafe to
replay: that live column remains required by the pricing runtime and canonical
schema. Removal, if ever desired, needs a separate product/schema decision and
explicit migration; this reconciliation does not remove or alter the column.

## Generated schema reconciliation

`packages/data/src/database-generated.ts` is the fresh canonical live type
surface plus the four applied YP2.4 variation-listing table blocks and the
three locally validated pending YP2.5 journal table blocks.
The reconciliation restores live `listing_price_research.llm_selected_comp_ids`,
`public.jsonb_text_array()`, `reserve_ai_model_usage` argument/return nullability,
and non-null `listings.Update.status` / `sub_status`. The canonical pricing
foundation migration also defines `llm_selected_comp_ids`, so disposable schema
recreation and generated types agree with production while the retired drop is
excluded from automatic migration discovery.

## Deterministic migration workflow

Run from this repository with the canonical project already linked. Do not link
or select a different project in this workflow. Use the repository-recorded CLI
version `2.116.0`; substitute a globally installed `supabase` binary only after
confirming `supabase --version` prints `2.116.0`.

1. YP2.4 was applied exactly once and read back as 35/35 aligned history rows;
   all four YP2.4 tables were empty. YP2.5 authoring and validation use only
   disposable/local PostgreSQL and do not call the hosted project.

2. For the separately authorized YP2.6 apply gate, run the read-only preflight:

   ```sh
   npx --yes supabase@2.116.0 migration list --linked
   npx --yes supabase@2.116.0 db push --dry-run --linked
   ```

   The list must show every canonical applied version above and no local/remote
   mismatch. The dry-run must report exactly one pending file:
   `20260829150000_create_variation_listing_publishing_journal.sql`. Stop if any other
   migration is pending, missing remotely, out of order, or described as a
   destructive legacy change.

3. After separate operator authorization for YP2.6, apply once:

   ```sh
   npx --yes supabase@2.116.0 db push --linked
   ```

   Never add `--include-all`; it bypasses the chronological safety check and is
   not a migration selector. Do not use `migration repair`, `db reset`, or a
   semantic one-off apply in place of this workflow.

4. Immediately read back, without changing data: rerun
   `npx --yes supabase@2.116.0 migration list --linked` and confirm the target version/name occurs
   exactly once with no pending rows; then use the canonical read-only schema
   inspection/type-generation tools to confirm the three YP2.5 journal tables,
   all four preserved YP2.4 tables, their constraints/RLS/grants/functions, and
   unchanged legacy Single/Lot tables/helpers. Any unknown or partial result is
   a stop condition; do not replay the push.

Authenticated YP2.4 read-back completed on 2026-08-29 with Supabase CLI
`2.116.0`: all 35 canonical history rows aligned, the four YP2.4 tables were
empty, and critical Single/Lot schema remained unchanged. The YP2.5 file is the
sole expected next pending migration after this author/validate task. Never use
`--include-all`, migration repair, reset, or replay after an unknown result.

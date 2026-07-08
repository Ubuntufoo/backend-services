# Pricing

Pricing is a sidecar-local subsystem. Architecture ownership lives in [architecture.md](architecture.md); this page covers provider modes, runtime flow, persistence, diagnostics, and review-workflow integration.

## Current Ownership

- Runtime code: `services/sidecar/src/pricing/`
- Job entry: `services/sidecar/src/jobs/research-price-job.ts`
- LLM-only warning retry: `services/sidecar/src/jobs/retry-pricing-analysis.ts`
- API integration: `services/sidecar/src/http/data-router.ts`, `services/sidecar/src/http/listing-pricing-analysis.ts`
- Persistence: `public.listing_price_research`, `packages/data/src/repositories/listing-price-research.ts`
- Provider-mode resolution: `packages/data/src/repositories/app-settings.ts`

There is no dedicated extracted pricing service in the current runtime.

## Provider Modes

Authoritative runtime selection comes from `public.app_settings.pricing_provider_mode`.

- `off`: pricing disabled
- `soldcomps`: live SoldComps provider
- `apify`: live Apify provider

Current helper behavior:

- if `pricing_provider_mode` is set to one of the supported values, that value wins
- if old compatibility state leaves `pricing_service_enabled=false`, provider resolution falls back to `off`
- if `pricing_provider_mode` is unset or invalid, the current default resolves to `soldcomps`

## Current Runtime Flow

1. A `research_price` job runs only for eligible `single` listings already in `needs_review` with `sub_status=review_pending`.
2. Sidecar creates a pending `listing_price_research` row.
3. Sidecar resolves the selected live provider from `pricing_provider_mode`.
4. The selected provider fetches sold comps. If that provider fails with a recoverable runtime failure, sidecar attempts the other live provider as a fallback.
5. Sidecar normalizes sold comps, computes deterministic stats, and computes confidence.
6. If a pricing analyst is available, sidecar optionally runs LLM pricing analysis on the normalized comps and deterministic stats.
7. Sidecar persists the succeeded or failed pricing research row, including warning/failure metadata when present.
8. On success, sidecar may update `listings.price`, but pricing does not advance the listing out of review or publish it.

## Providers

### Live Providers

- `soldcomps`: resolved through `resolveProductionPricingProvider()` and current SoldComps env
- `apify`: resolved through `resolveProductionPricingProvider()` and current Apify env

### Test / Injected Provider

- `fixture`: `createFixturePricingProvider()` exists for tests and injected runs
- the fixture provider is not the normal production provider-mode path

### Current Provider Notes

- Sidecar provider input is built from listing context such as `listingId`, `title`, `itemSpecifics`, and requested comp count.
- Apify actor payload intentionally avoids direct eBay `category_id` and `condition_id` filters until explicit repo-side mapping exists.
- `soldPrice` from Apify can overstate actual realized value when `isBestOfferAccepted=true`; downstream pricing logic must account for that.
- Fewer-than-requested sold comps can still be a successful provider response; downstream normalization, stats, and confidence decide usefulness.

## Deterministic Pricing And Optional LLM Analysis

Deterministic pricing remains the baseline path.

- comp normalization: `normalizer.ts`
- stats: `stats.ts`
- confidence: `confidence.ts`
- condition adjustment summary: `condition-adjustment.ts`

Optional LLM analysis runs after deterministic stats are available.

- it can refine the suggested price through condition adjustment
- if it fails, returns an invalid price, returns `null`, or returns an out-of-window price, sidecar falls back to the deterministic suggested price
- warnings are persisted in `llm_reasoning_json` instead of blocking review

Current warning reasons include:

- `llm_analysis_failed`
- `llm_condition_adjusted_price_invalid`
- `llm_condition_adjusted_price_out_of_window`
- `llm_condition_adjusted_price_null`
- `provider_failure`

## Review Workflow Integration

Listing API serialization includes pricing context:

- `latest_pricing_research`
- `pricing_analysis_warnings`

Relevant review routes:

- `POST /listings/:listingId/retry-pricing-analysis`
  - reruns only the LLM pricing-analysis step against persisted comps and existing listing data
  - does not refetch provider comps
- `POST /listings/:listingId/pricing-analysis-warnings/dismiss`
  - persists dismissed warning codes on the current research row
- `POST /listings/:listingId/retry-pricing`
  - reruns the broader pricing review workflow rather than only the LLM warning path
- `GET /app-settings` and `PATCH /app-settings`
  - expose and update `pricing_provider_mode`

## Persistence

### `listing_price_research`

Each pricing run persists:

- selected provider name on the row
- provider query and raw provider/runtime result payload
- normalized comps and sold-count summary
- deterministic/LLM-derived suggested price outcome
- `llm_price_explanation`
- `llm_reasoning_json`
- `llm_rejected_comp_ids`
- `dismissed_pricing_warning_codes`
- failure code/message when the run fails

Workflow-safe provider failures can still produce persisted pricing warnings for the review UI even when the overall research row fails.

### `app_settings`

Pricing-related runtime config currently lives in the singleton settings row:

- `pricing_provider_mode`
- `soldcomps_usage_snapshot`

When SoldComps is used, sidecar attempts to persist usage snapshot metadata back onto `app_settings`.

## Diagnostics And Commands

Read-only diagnostics:

```bash
pnpm pricing:diagnose-soldcomps-config
pnpm pricing:diagnose-apify-config
```

Manual provider smoke:

```bash
pnpm pricing:smoke-soldcomps -- --listing-id <listing_id>
pnpm pricing:smoke-apify -- --listing-id <listing_id>
```

Pricing one real listing:

```bash
pnpm pricing:price-one -- --listing-id <listing_id>
```

Command behavior:

- `pricing:smoke-soldcomps` and `pricing:smoke-apify` verify live provider behavior for exactly one listing without enqueueing jobs, mutating listings, or persisting `listing_price_research`
- `pricing:price-one` intentionally runs the real pricing persistence path for exactly one listing and can update both `listing_price_research` and `listings.price`

## Current Guarantees

- pricing is sidecar-local today
- pricing currently targets eligible `single` listings in `needs_review` / `review_pending`
- pricing success may update `listings.price`
- pricing does not approve or publish the listing
- pricing failure should not block review/export
- pricing failure should not write listing `last_error_*`; failure state belongs on the job and `listing_price_research`

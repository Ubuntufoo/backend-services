# Pricing

## Implemented

- Sidecar-local pricing code under `services/sidecar/src/pricing/`
- Job entry: `services/sidecar/src/jobs/research-price-job.ts`
- Job type: `research_price`
- Persistence: `public.listing_price_research` plus `packages/data/src/repositories/listing-price-research.ts`
- Fixture provider path via `createFixturePricingProvider()`
- Comp normalization in `normalizer.ts`
- Deterministic median-based stats in `stats.ts`
- Confidence scoring in `confidence.ts`
- Validated LLM pricing support/config behind deterministic fallback
- Noisy Apify-like fixture coverage in `services/sidecar/tests/unit/pricing/`

## Current Data Flow

1. Create `research_price` job for listing.
2. Create pending `listing_price_research` row.
3. Fetch sold comps from fixture provider.
4. Normalize comps, compute deterministic stats, compute confidence.
5. Mark `listing_price_research` row succeeded or failed.
6. On success, update `listings.price` with deterministic suggested price.

## Workflow Guarantees

- Pricing currently targets `listing_type === 'single'`.
- Listing must already be in `needs_review`.
- Successful pricing may update `listings.price`.
- Listing remains in `needs_review` / `review_pending`; pricing does not approve or publish it.
- Pricing failure should not block review/export.
- Pricing failure should not write listing `last_error_*`; failure stays on job state and `listing_price_research`.

## Pending

- Live Apify pricing adapter/pilot
- Pricing service extracted from sidecar

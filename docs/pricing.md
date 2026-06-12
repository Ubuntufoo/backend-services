# Pricing

## Implemented

- Sidecar-local pricing code under `services/sidecar/src/pricing/`
- Job entry: `services/sidecar/src/jobs/research-price-job.ts`
- Job type: `research_price`
- Persistence: `public.listing_price_research` plus `packages/data/src/repositories/listing-price-research.ts`
- Fixture provider path via `createFixturePricingProvider()`
- Live Apify smoke script via `pnpm pricing:smoke-apify -- --listing-id <listing_id>`
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

## Primary Live Actor Contract

Primary live sold-comps actor:
- Configured by `APIFY_PRICE_ACTOR_ID`
- Purpose: scrape sold eBay listings; return structured sold-card/item comps

Actor input shape used by actor docs:

```json
{
  "keywords": ["rtx 4080", "rtx 4090"],
  "categoryId": "58058",
  "subcategoryId": "",
  "daysToScrape": 30,
  "count": 100,
  "ebaySite": "ebay.com",
  "sortOrder": "endedRecently",
  "minPrice": 100,
  "maxPrice": 500,
  "itemLocation": "default",
  "itemCondition": "any"
}
```

Actor output shape excerpt:

```json
{
  "itemId": "306671421088",
  "url": "https://www.ebay.com/itm/306671421088",
  "title": "Apple iPhone 13 Pro Max - 128GB - Unlocked - Cracked Back",
  "condition": "Pre-Owned",
  "conditionId": 3000,
  "categoryId": "58058",
  "endedAt": "2025-12-22T05:00:00.000Z",
  "soldPrice": "215",
  "soldCurrency": "USD",
  "listingType": "buy_it_now",
  "isBestOfferAccepted": false,
  "shippingPrice": "6.20",
  "shippingCurrency": "USD",
  "shippingType": "paid",
  "totalPrice": "221.20",
  "thumbnailUrl": "https://i.ebayimg.com/thumbs/images/g/abc123/s-l500.jpg",
  "sellerUsername": "example_seller",
  "sellerPositivePercent": 99.2,
  "sellerFeedbackScore": 1842,
  "sellerType": null,
  "scrapedAt": "2026-01-19T21:53:17.613Z"
}
```

## Actor Usage Rules

- Do not send eBay `listings.category_id` directly as actor `categoryId`.
- Do not send eBay `listings.condition_id` directly as actor structured condition field.
- Only send actor `categoryId`, `subcategoryId`, `itemCondition`, or other structured filters when explicit Apify-side mapping exists in code.
- Sidecar search query should use plain marketplace search text. Do not include synthetic `category:<id>` or `condition:<id>` fragments unless a future actor-specific query syntax explicitly supports them.
- Preserve provider input fields useful for search text generation: `listingId`, `title`, `itemSpecifics`, `minSoldComps`.
- Treat actor `condition` string as authoritative output label.
- Treat actor `conditionId` output as best-effort lookup only; do not assume exhaustive/stable locale coverage.
- `soldPrice` may overstate actual transaction value when `isBestOfferAccepted=true`; downstream logic must account for this.
- `keywords` array is actor-native primary search input. Current sidecar adapter still uses single query text and transforms internally; if adapter expands to true multi-keyword mode, keep same filters across all generated keywords.
- `subcategoryId` overrides actor `categoryId` when present per actor docs.
- Supported sites from actor docs: `ebay.com`, `ebay.co.uk`, `ebay.de`, `ebay.fr`, `ebay.it`, `ebay.es`, `ebay.ca`, `ebay.com.au`.

## Current Sidecar Mapping

- Sidecar provider normalizes listing context into `query`, `facets`, `itemSpecifics`, `listingId`, `title`, `minSoldComps`.
- Structured actor payload intentionally omits `categoryId` and `conditionId` until repo contains explicit mapping from eBay taxonomy/condition ids to actor-accepted values.
- Live Apify default requested sold comps: `8` when `APIFY_MIN_SOLD_COMPS` unset.
- Smoke script exists only to verify live provider path safely; it must not enqueue jobs, mutate listings, or persist `listing_price_research`.
- Offline Apify fixtures under `services/sidecar/tests/fixtures/apify/` exist for unit coverage only; live calls belong only in `pnpm pricing:smoke-apify`.
- Fewer-than-requested sold comps remain valid provider success; downstream stats/confidence decides usefulness.

## Controlled Apify Pilot

Use live smoke only for first CLI validation of real Apify pricing output. Keep initial pilot manual and narrow.

```bash
pnpm pricing:smoke-apify -- --listing-id <listing_id>
```

Safety:

- CLI smoke only
- no job enqueue
- no DB writes
- no listing mutation
- real Apify call; can spend credits

Prereqs:

- valid Apify token/env configured
- listing exists locally
- use real listing with assets/draft context sufficient for pricing search

Recommended pilot behavior:

- run 1 listing first
- inspect logs/output manually
- do not enable automated pricing until smoke output looks sane
- keep `app_settings.pricing_service_enabled=false` during initial CLI-only testing
- global pricing toggle not required for CLI smoke

Failure interpretation:

- rate-limit/quota/provider failures: external; retry later
- malformed comps or zero/few comps: valid pilot observation, not automatic app failure
- missing token/config: local setup problem

## Workflow Guarantees

- Pricing currently targets `listing_type === 'single'`.
- Listing must already be in `needs_review`.
- Successful pricing may update `listings.price`.
- Listing remains in `needs_review` / `review_pending`; pricing does not approve or publish it.
- Pricing failure should not block review/export.
- Pricing failure should not write listing `last_error_*`; failure stays on job state and `listing_price_research`.

## Pending

- Explicit mapping layer from eBay category/condition ids to actor-native filters
- Full live Apify pricing rollout in normal `research_price` flow
- Pricing service extracted from sidecar

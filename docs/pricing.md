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
- `soldcomps`: selectable live SoldComps provider

Apify is a live provider implementation used as the recoverable SoldComps
fallback in the production research path and directly by its diagnostic/smoke
commands. It is not a selectable `pricing_provider_mode` value and cannot be
enabled through the app-settings API.

Current helper behavior:

- if `pricing_provider_mode` is `off` or `soldcomps`, that value wins
- if old compatibility state leaves `pricing_service_enabled=false` and no provider mode is present, provider resolution falls back to `off`
- if `pricing_provider_mode` is unset, the current default resolves to `soldcomps`
- an explicitly invalid provider mode resolves to `off`

## Current Runtime Flow

1. A `research_price` job runs only for eligible `single` listings already in `needs_review` with `sub_status=review_pending`.
2. Sidecar creates a pending `listing_price_research` row.
3. Sidecar resolves the selected live provider from `pricing_provider_mode`.
4. SoldComps fetches sold comps. If it fails with a recoverable runtime failure and Apify is configured, sidecar attempts Apify as a fallback.
5. Sidecar normalizes sold comps, computes deterministic stats, and computes confidence.
6. If a pricing analyst is available, sidecar optionally runs LLM pricing analysis on the normalized comps and deterministic stats.
7. Sidecar persists the succeeded or failed pricing research row, including warning/failure metadata when present.
8. On success, sidecar may update `listings.price`, but pricing does not advance the listing out of review or publish it.

## Providers

### Live Providers

- `soldcomps`: resolved through `resolveProductionPricingProvider()` and current SoldComps env
- `apify`: resolved through `resolveProductionPricingProvider()` only for the recoverable SoldComps fallback and current Apify env

### Test / Injected Provider

- `fixture`: `createFixturePricingProvider()` exists for tests and injected runs
- the fixture provider is not the normal production provider-mode path

### Current Provider Notes

- Sidecar provider input is built from listing context such as `listingId`, `title`, `itemSpecifics`, and requested comp count.
- SoldComps live requests currently ask for `75` comps by default unless a narrower explicit `requestedCompCount` is injected.
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

- `POST /api/listings/:listingId/retry-pricing-analysis`
  - reruns only the LLM pricing-analysis step against persisted comps and existing listing data
  - does not refetch provider comps
- `POST /api/listings/:listingId/pricing-analysis-warnings/dismiss`
  - persists dismissed warning codes on the current research row
- `POST /api/listings/:listingId/retry-pricing`
  - reruns the broader pricing review workflow rather than only the LLM warning path
- `GET /api/app-settings` and `PATCH /api/app-settings`
  - expose and update the selectable `pricing_provider_mode` values `off` and `soldcomps`

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

## Browse Shadow Runtime Contract

Browse is an optional, read-only shadow after a successful baseline pricing run.
It is skipped when `listing.auto_pricing_enabled=false` or the baseline price
has no currency. When Browse is requested, both `EBAY_BROWSE_CONTEXT_COUNTRY`
and `EBAY_BROWSE_CONTEXT_POSTAL_CODE` must be configured; a partial pair is
rejected rather than replaced with an implicit location.

Traversal or snapshot attachment failures are best-effort: the baseline
Suggested price and research result remain intact. Persisted `raw_result_json.activeMarket`
contains a sanitized projection of accepted competitors and distributions; raw
Browse pages, seller identity, OAuth material, and arbitrary provider fields are
not persisted.

## Active-Market Browse Shadow Pilot (10F.1)

The following is a historical pilot observation, not a current runtime status report. It was captured on 2026-08-16 at 15:09:01Z against production `EBAY_US` with the existing typed `BrowseApi` and `ActiveMarketTraversal` seam. It used one Commerce Identity read for seller exclusion and 11 Browse searches (7 + 2 + 1 + 1). User-token refresh and the Application token were held in memory for the probe; no `.env`, database row, listing, offer, inventory, policy, or seller state was written. `tacticalSellPrice` was `null` in that probe because tactical-price computation had not yet been enabled in the runtime.

The configured contextual shipping location was `US` / `19406`. Prices and distributions below are USD. A snapshot is exact only because traversal exhausted `next`; `total` from Browse/UI was treated as diagnostic, not as pagination authority. Accepted competitors remain in eBay-returned order and are not re-sorted by item or landed price.

| Supply band / card | Canonical query | Anchor; item-price window | Pages; candidates; accepted / rejected | Exact item-price low / median / high | Shipping-known accepted; landed low / median / high | Latency; Browse calls | State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Very high — Barry Sanders 1990 Pro Set #102 | `Barry Sanders 1990 Pro Set 102` | `$2.50`; `$0.82–$7.50` | 7; 1,226; 1,030 / 195 | `$0.90 / $1.75 / $7.50` | 783 (76.0%); `$1.29 / $2.53 / $12.97` | 6,502 ms; 7 | complete |
| High — Willie Stargell 1973 Topps #370 | `Willie Stargell 1973 Topps 370` | `$4.05`; `$1.33–$12.15` | 2; 251; 213 / 38 | `$1.49 / $5.00 / $12.00` | 162 (76.1%); `$2.28 / $7.99 / $19.99` | 1,655 ms; 2 | complete |
| Low — Willie Mays 1996 Topps Chrome #261 | `Willie Mays 1996 Topps 261` | `$3.99`; `$1.31–$11.97` | 1; 20; 1 / 19 | `$9.99 / $9.99 / $9.99` | 0 (0%); unavailable | 642 ms; 1 | complete |
| Normal — Dennis Thurman 1984 Topps #246 | `Dennis Thurman 1984 Topps 246` | `$1.27`; `$0.41–$3.81` | 1; 132; 75 / 57 | `$0.99 / $1.64 / $3.70` | 74 (98.7%); `$1.29 / $2.04 / $8.69` | 745 ms; 1 | complete |

Rejection counts were: Barry `active_set_mismatch=88`, `exact_card_number_mismatch=17`, `exact_set_mismatch=25`, `active_card_number_evidence_mismatch=10`, `exact_player_mismatch=48`, `exact_year_mismatch=4`, `active_multi_card_mismatch=3`; Stargell `exact_player_mismatch=11`, `active_set_mismatch=9`, `exact_card_number_mismatch=1`, `active_multi_card_mismatch=1`, `exact_set_mismatch=4`, `exact_year_mismatch=8`, `active_card_number_evidence_mismatch=3`, `active_reprint_mismatch=1`; Mays `active_set_mismatch=4`, `active_reprint_mismatch=1`, `exact_card_number_mismatch=7`, `exact_year_mismatch=6`, `exact_player_mismatch=1`; Dennis `exact_player_mismatch=40`, `exact_card_number_mismatch=12`, `active_multi_card_mismatch=1`, `active_autograph_mismatch=1`, `active_card_number_evidence_mismatch=3`. Barry's 1,226 scanned rows comprise 1,030 accepted, 195 title-rejected, and one repeated legacy item ID discarded by traversal deduplication before title classification.

Representative accepted rows below are the first five rows in the eBay order returned by each complete traversal. They show why item price and landed price must remain separate; `?` means shipping was not returned and total stayed `null`.

| Card | eBay-order examples (`item + shipping = total`) |
| --- | --- |
| Barry | `1990 Pro Set #102 Barry Sanders` `$1.69 + $0 = $1.69`; `1990 Pro Set Barry Sanders #102 HOF` `$1.39 + $0 = $1.39`; `1990 Pro Set #102 Barry Sanders` `$1.49 + $0 = $1.49`; `1990 Pro Set - Barry Sanders #102` `$0.99 + $0.74 = $1.73`; `1990 Pro Set Barry Sanders #102` `$1.55 + $0 = $1.55` |
| Stargell | `1973 Topps #370 Willie Stargell Pittsburgh Pirates VG-EX` `$3.99 + ?`; `1973 Topps #370 Willie Stargell ... WRITING ON BACK` `$2.99 + $0 = $2.99`; `1973 Topps - Willie Stargell #370 Pittsburgh Pirates` `$4.00 + ?`; `1973 Topps Willie Stargell #370 Pittsburgh Pirates soft corners` `$1.50 + $0.78 = $2.28`; `1973 Topps #370 Willie Stargell Pittsburgh Pirates 5.3A` `$4.99 + $0 = $4.99` |
| Mays | `Willie Mays 1996 Topps Chrome Commemorative Set #261` `$9.99 + ?` (only accepted row) |
| Dennis | `1984 Topps - Dennis Thurman #246` `$1.39 + $0 = $1.39`; `1984 Topps - #246 Dennis Thurman` `$1.89 + $0 = $1.89`; `1984 Topps Football #246 Dennis Thurman Dallas Cowboys` `$1.79 + $0 = $1.79`; `1984 Topps #246 - Dennis Thurman - Dallas Cowboys` `$1.29 + $0 = $1.29`; `1984 Topps #246 Dennis Thurman` `$2.47 + $0 = $2.47` |

Manual eBay review used bounded first-page checks plus current result headings: Barry showed 1,400+ BIN listings with the API's low `$0.99–$1.99` exact-card band and shipping variation; Stargell showed 473 results, matching the API's first 12 exact-card rows while visible `$49.99`/graded outliers were outside the raw-condition/window scope; Dennis showed 154 results, with visible You Pick/autograph false positives rejected by the API; Mays showed 48 Chrome-query results and the single `$9.99` accepted Commemorative Set row was credible but had no shipping. The Mays result is intentionally too thin for a tactical recommendation.

The Mays canonical query intentionally reflects the current query builder (`Willie Mays 1996 Topps 261`); the structured `Set=Topps Chrome` identity remains enforced by the Browse title predicate and was checked against the returned title during manual review.

## Deterministic Tactical Price Rule (10F.2; implemented)

The implementation is a pure calculation over one completed `activeMarket` snapshot plus one explicit nullable `ourEffectiveBuyerShipping` money input (`{ value: number, currency: string }`; `null` means unknown). It never reads or mutates the baseline Suggested price or infers our shipping from competitor rows. The current research job supplies `null` for own shipping, so it uses the item-price basis unless a future caller supplies an explicit known-free value. Treat own shipping as free only when its value is finite, its currency is `USD`, and its value is exactly `$0.00`.

1. Evidence gate: derive item values from `competitors[].itemPrice.value` and landed values only from non-null `competitors[].totalPrice.value`. Return `null` unless `complete === true`, `exactAcceptedCount` is an integer at least `20` and equals `competitors.length`, and every accepted competitor has one finite non-negative item-price value in the same `USD` currency. Incomplete, skipped, unavailable, mixed-currency, count-inconsistent, malformed, or thin snapshots are non-exact and return `null`; this is why the one-row Mays result returns `null`.
2. Basis selection: let `usableLandedValues` be the finite non-negative `USD` totals derived above. Existing landed coverage qualifies only when its count is at least `20`, equals `shippingKnownAcceptedCount`, its count divided by `exactAcceptedCount` is at least `0.75`, and `shippingKnownTotalDistribution` is present. Use competitor landed totals only when that coverage qualifies **and** `ourEffectiveBuyerShipping` is known-free by the preceding rule; otherwise use all accepted item values. Unknown, unavailable, malformed, non-`USD`, or nonzero own buyer-paid shipping always falls back to the item-price basis. Do not subtract, estimate, or otherwise adjust competitor values for our shipping. Missing competitor shipping is never estimated. The 75% gate keeps the 76% Barry/Stargell and 98.7% Dennis cases eligible for landed pricing when our shipping is free, while still failing closed when shipping is entirely absent.
3. Statistic: take the lower quartile (Q1) of the selected complete basis using nearest-rank indexing: sort ascending and select `values[Math.ceil(0.25 * values.length) - 1]`. Q1 is a deterministic bulk-competition reference: a price just below it is below roughly three quarters of comparable asks, without chasing the isolated low or high. With known-free own shipping, pilot landed Q1 values were Barry `$1.99`, Stargell `$5.75`, Dennis `$1.79`; with unknown or nonzero own shipping, the item-price Q1 values are Barry `$1.28`, Stargell `$3.99`, Dennis `$1.00`. Mays had no usable landed basis and failed the evidence gate.
4. Undercut and rounding: subtract exactly `$0.01` from Q1, then apply the same independent nickel/psychological rounding order as `roundFinalListingPrice()` (`floor((value + 1e-9) * 20) / 20`, convert to cents, and when at least `$1.00` with cents `00–10`, move to the prior `x.95`). Return `null` if the post-undercut value or rounded result is not finite or is less than `$0.01`. Do not mutate or feed the tactical value back into baseline pricing. For reference, applying the current rule to the historical pilot evidence yields landed/free-own-shipping `$1.95` Barry, `$5.70` Stargell, `$1.75` Dennis, and item-basis fallback `$1.25`, `$3.95`, `$0.95` respectively; Mays is `null` under either branch because it fails the evidence gate.

This rule is intentionally conservative: it uses only complete exact evidence, avoids a single low or high listing, and prefers landed competition only with strong shipping coverage and known-free own buyer shipping. Current implementation returns `null` when the evidence gate fails and persists the rounded tactical value for qualified complete snapshots without changing the baseline Suggested price. The dated pilot observations above remain historical evidence.

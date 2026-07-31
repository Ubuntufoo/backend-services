# Troubleshooting

## Env File Confusion

- Canonical env files are repo-root `.env` and `.env.local`.
- If a guide mentions `services/sidecar/.env`, treat it as stale.

## OAuth Token Problems

- `EBAY_REFRESH_TOKEN` should contain refresh token, not callback `code=...`.
- Do not paste short-lived `Authorization: Bearer ...` access tokens into refresh-token vars.
- Quote token values in env files.
- Re-run `pnpm validate:ebay-oauth` after updates.

## Sandbox Business Policy Ineligible

- `ebay:setup-sandbox` may fail with Business Policy eligibility errors for some sandbox sellers.
- Manually seed canonical policy/location fields in `public.app_settings`.
- Continue local workflow with mocked or injected IDs until better sandbox account exists.

## Publish State Drift

- Use `pnpm ebay:diagnose-live-readiness` or `pnpm ebay:list-live-publish-config` for config checks.
- Use `pnpm ebay:reconcile-published-listing -- --listing-id <listingId>` or `--offer-id <offerId>` to repair local exported-state tracking.

## Sandbox Listing Still Visible After Remote Cleanup

- Use the exact structured `listings.sku`/eBay inventory SKU, for example `BSKBL-Single-000016`; `Single-000016` is a local listing ID and is rejected.
- Preview with `pnpm ebay:cleanup-sandbox -- --sku BSKBL-Single-000016`.
- With `EBAY_ENVIRONMENT=sandbox`, rerun `pnpm ebay:cleanup-sandbox -- --sku BSKBL-Single-000016 --delete --confirm-sandbox-cleanup`. Missing remote resources are idempotent success, allowing the eligible local Supabase/R2/watcher traces to be permanently purged after an earlier remote-only cleanup.
- Sold, order-bearing, active-job, ambiguous, stale, trace-free, or unsafe rows are intentionally refused. Do not bypass the refusal by using a remote-only SKU.

## Pricing Expectations

- Current runtime selection comes from `public.app_settings.pricing_provider_mode`.
- `pricing_provider_mode=off` disables pricing; unset mode currently resolves to `soldcomps`.
- `apify` and `soldcomps` are the live provider modes; the fixture provider exists for tests and injected runs, not normal production mode selection.
- Presence of Apify env vars or fixture coverage alone does not mean that live Apify pricing is active.
- `retry-pricing-analysis` reruns only the LLM pricing-analysis step against persisted comps; it does not refetch provider comps.

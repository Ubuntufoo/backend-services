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

## Pricing Expectations

- Current documented pricing path is fixture-backed.
- Presence of Apify env vars or Apify-like fixtures does not mean live pricing provider is enabled in normal flow.

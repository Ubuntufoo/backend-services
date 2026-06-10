# eBay Integration

## Current Ownership

`services/sidecar` owns eBay runtime behavior:

- OAuth setup and refresh-token validation
- publish flow and publish-state reconciliation
- sandbox bootstrap/diagnostics
- readiness checks and live config inspection

## Environment Rules

- Configure eBay credentials in repo-root `.env`
- Keep tokens and machine-local overrides in repo-root `.env.local`
- Preferred refresh token var: `EBAY_REFRESH_TOKEN`
- Compatibility fallback: `EBAY_USER_REFRESH_TOKEN`
- Quote refresh tokens in env files because eBay values contain `#`

## Common Commands

```bash
pnpm setup
pnpm validate:ebay-oauth
pnpm ebay:diagnose-live-readiness
pnpm ebay:list-live-publish-config
pnpm ebay:diagnose-sandbox
pnpm ebay:diagnose-sandbox-config
pnpm ebay:setup-sandbox
pnpm ebay:opt-in-selling-policies
pnpm ebay:reconcile-published-listing -- --listing-id <listingId>
pnpm ebay:reconcile-published-listing -- --offer-id <offerId>
```

## Publish Readiness

Before live publish:

- valid production OAuth
- correct marketplace/policy/location values in `public.app_settings`
- listing has title, category, condition, price, images, required item specifics
- public image URLs resolve

Live-pilot checklist: [../live-pilot-notes.md](../live-pilot-notes.md)

## Sandbox Notes

- `pnpm ebay:diagnose-sandbox` and `pnpm ebay:diagnose-sandbox-config` are read-only.
- `pnpm ebay:setup-sandbox` bootstraps policies/location when sandbox account is eligible.
- Some sandbox sellers are not eligible for Business Policy. In that case, manually seed canonical `public.app_settings` policy/location values and continue with mocked or injected IDs.

## Generated Reference

- eBay API status snapshot: [API_STATUS.md](API_STATUS.md)
- Category reference: [ebay-category-ids.md](ebay-category-ids.md)

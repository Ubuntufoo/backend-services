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

## `app_settings` Environment Config

Current live project keeps environment-specific publish defaults in `public.app_settings.ebay_publish_config`:

```json
{
  "sandbox": {
    "marketplaceId": "EBAY_US",
    "paymentPolicyId": "6227962000",
    "fulfillmentPolicyId": "6227963000",
    "returnPolicyId": "6227964000",
    "merchantLocationKey": "default-main-location"
  },
  "production": {
    "marketplaceId": "EBAY_US",
    "paymentPolicyId": "260524452013",
    "fulfillmentPolicyId": "260524990013",
    "returnPolicyId": "260524680013",
    "merchantLocationKey": "mfh-main-location"
  }
}
```

The same row currently also carries active/default top-level values for production:

- `ebay_marketplace_id`
- `default_payment_policy_id`
- `default_fulfillment_policy_id`
- `default_return_policy_id`
- `merchant_location_key`

## Sandbox Notes

- `pnpm ebay:diagnose-sandbox` and `pnpm ebay:diagnose-sandbox-config` are read-only.
- `pnpm ebay:setup-sandbox` bootstraps policies/location when sandbox account is eligible.
- Some sandbox sellers are not eligible for Business Policy. In that case, manually seed canonical `public.app_settings` policy/location values and continue with mocked or injected IDs.

## Generated Reference

- eBay API status snapshot: [API_STATUS.md](API_STATUS.md)
- Category reference: [ebay-category-ids.md](ebay-category-ids.md)

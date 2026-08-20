# eBay Integration

## Current Ownership

`services/sidecar` owns eBay runtime behavior:

- OAuth setup and refresh-token validation
- publish flow and publish-state reconciliation
- sandbox bootstrap/diagnostics
- readiness checks and live config inspection

## Environment Rules

- Configure eBay credentials in the repo-root `.env`; sidecar startup reads this file.
- `pnpm setup` and refreshed OAuth credentials persist to the repo-root `.env`.
- The watcher service is the exception: its CLI loads repo-root `.env` and then `.env.local` without replacing keys already loaded from `.env`.
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
pnpm ebay:cleanup-sandbox -- --sku BSKBL-Single-000016
pnpm ebay:reconcile-published-listing -- --listing-id <listingId>
pnpm ebay:reconcile-published-listing -- --offer-id <offerId>
```

## Publish Readiness

Before live publish:

- valid production OAuth
- production consent must include exactly the setup workflow scopes:
  - `https://api.ebay.com/oauth/api_scope`
  - `https://api.ebay.com/oauth/api_scope/sell.inventory`
  - `https://api.ebay.com/oauth/api_scope/sell.account`
  - `https://api.ebay.com/oauth/api_scope/commerce.identity.readonly`
- correct marketplace/policy/location values in `public.app_settings`
- listing has title, category, condition, price, images, required item specifics
- public image URLs resolve

Live-pilot checklist: [../live-pilot-notes.md](../live-pilot-notes.md)

## `app_settings` Environment Config

`public.app_settings.ebay_publish_config` stores environment-specific publish
defaults. Use the following complete shape as an illustrative template only;
replace every `replace-with-...` value with an ID discovered from the matching
eBay environment. These are not live IDs:

```json
{
  "sandbox": {
    "marketplaceId": "EBAY_US",
      "paymentPolicyId": "replace-with-sandbox-payment-policy-id",
      "combinedFulfillmentPolicyId": "replace-with-sandbox-combined-fulfillment-policy-id",
      "groundFulfillmentPolicyId": "replace-with-sandbox-ground-fulfillment-policy-id",
      "returnPolicyId": "replace-with-sandbox-return-policy-id",
    "merchantLocationKey": "replace-with-sandbox-merchant-location-key"
  },
  "production": {
    "marketplaceId": "EBAY_US",
      "paymentPolicyId": "replace-with-production-payment-policy-id",
      "combinedFulfillmentPolicyId": "replace-with-production-combined-fulfillment-policy-id",
      "groundFulfillmentPolicyId": "replace-with-production-ground-fulfillment-policy-id",
      "returnPolicyId": "replace-with-production-return-policy-id",
    "merchantLocationKey": "replace-with-production-merchant-location-key"
  }
}
```

Both `combinedFulfillmentPolicyId` and `groundFulfillmentPolicyId` are
required. For structurally eBay Standard Envelope-eligible raw sports-card
singles priced below `$20`, publish selects the combined policy when
`ese_eligible=true`; all other listings select the Ground policy. The
resolved `fulfillmentPolicyId` is retained as a compatibility alias for the
Ground policy.

The same row may also carry top-level values:

- `ebay_marketplace_id`
- `default_payment_policy_id`
- `default_fulfillment_policy_id`
- `default_return_policy_id`
- `merchant_location_key`

Those legacy flat fields are not a production fallback. Production publish requires a complete `ebay_publish_config.production` object.

## Published Description

The shared publish mapper escapes and formats the stored description, then
prepends a compact eBay-only promotion: a bold green `1.1em` shipping sentence
followed immediately by one `Follow / Save this seller` link to the
`mfhbusiness` eBay profile. The existing escaped description content follows
unchanged.

## Sandbox Notes

- `pnpm ebay:diagnose-sandbox` and `pnpm ebay:diagnose-sandbox-config` are read-only.
- `pnpm ebay:setup-sandbox` bootstraps policies/location when sandbox account is eligible.
- Some sandbox sellers are not eligible for Business Policy. In that case, manually seed canonical `public.app_settings` policy/location values and continue with mocked or injected IDs.
- Sandbox cleanup targets the exact structured inventory SKU persisted in `listings.sku`, not local `listing_id`. The destructive CLI and `POST /api/listings/:listingId/delete-sandbox` share the permanent remote-plus-local deletion workflow documented in [operations.md](operations.md#sandbox-listing-cleanup).
- Cleanup refuses production, sold/order-bearing/active-job/ambiguous/unsafe rows. Rerun the same structured-SKU destructive action after a prior remote-only cleanup to remove the remaining eligible local row and artifacts.

## Generated Reference

- eBay API status snapshot: [API_STATUS.md](API_STATUS.md)
- Category reference: [ebay-category-ids.md](ebay-category-ids.md)

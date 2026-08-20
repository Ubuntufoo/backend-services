# Controlled Live Pilot Notes

## Purpose

Minimal notes for safely testing first real eBay listings while fulfillment/admin remains in Seller Hub.

## Scope

- App handles intake, draft generation, review, and publish.
- Seller Hub remains source of truth for shipping labels, order handling, buyer messages, and manual admin.
- Use only a small number of low-risk listings.

## Before First Live Publish

- Confirm `EBAY_ENVIRONMENT=production`.
- Keep `SIDECAR_JOB_RUNNER_ENABLED=false` until the controlled publish window.
- Keep `EBAY_PUBLISH_ENABLED=false` until all readiness checks pass; false or missing blocks publish execution before eBay API initialization.
- Confirm production OAuth is valid.
- Confirm production policy/location config is correct in `public.app_settings`.
- Current env-specific values live under `public.app_settings.ebay_publish_config.production`.
- Confirm `public.app_settings.pricing_provider_mode` is intentionally set for the pilot: `off` or `soldcomps`. Explicit invalid or legacy values, including `apify`, resolve to `off`; Apify is used only by runtime fallback/diagnostic paths.
- Confirm image URLs are public and load correctly.
- Confirm listing has title, price, category, condition, images, and required item specifics.
- Confirm item is physically available and easy to ship.
- For exact setup/validation commands, use [docs/ebay-integration.md](docs/ebay-integration.md).

## Pilot Rules

- Start with 1 listing.
- Prefer a low-value single card.
- Do not batch publish.
- Do not rely on app order sync yet.
- Check live listing manually in Seller Hub after publish.
- Handle shipping and buyer/admin workflows in Seller Hub.

## After Publish

- Verify listing is live.
- Verify title, price, images, condition, item specifics, shipping, and return policy.
- Confirm `ebay_listing_id`, `ebay_offer_id`, and listing URL are present locally.
- If anything looks wrong, revise/end listing in Seller Hub first.

## Known Boundaries

- App does not yet manage shipping labels.
- App does not yet fully own order fulfillment.
- Sold status and cleanup automation are future tasks.
- Seller Hub remains operational fallback.

## Stop Conditions

Stop live publishing if:

- duplicate listing is created
- images are wrong or inaccessible
- policy/location config is wrong
- item specifics are materially wrong
- app status does not match eBay state

## Candidate Publish Config

Verify these candidate values against the production account, then store the confirmed object at `public.app_settings.ebay_publish_config.production`:

```sql
update public.app_settings
set ebay_publish_config = jsonb_set(
  coalesce(ebay_publish_config, '{}'::jsonb),
  '{production}',
  '{
    "marketplaceId": "EBAY_US",
    "paymentPolicyId": "260524452013",
    "combinedFulfillmentPolicyId": "<verify-production-combined-policy-id>",
    "groundFulfillmentPolicyId": "<verify-production-ground-policy-id>",
    "returnPolicyId": "260524680013",
    "merchantLocationKey": "mfh-main-location"
  }'::jsonb,
  true
)
where id = 'default';
```

Production publish never falls back to the legacy flat policy/location columns. Do not run this SQL blindly; the operator must first verify the policy IDs and merchant location through the production read-only discovery command.

Sandbox test-listing deletion uses the exact structured inventory SKU, not `listing_id`. Preview and permanent cleanup examples plus refusal rules are documented in [docs/operations.md](docs/operations.md#sandbox-listing-cleanup). The CLI and UI-backed API remain sandbox-only and refuse sold or order-bearing listings.

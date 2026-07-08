# Controlled Live Pilot Notes

## Purpose

Minimal notes for safely testing first real eBay listings while fulfillment/admin remains in Seller Hub.

## Scope

- App handles intake, draft generation, review, and publish.
- Seller Hub remains source of truth for shipping labels, order handling, buyer messages, and manual admin.
- Use only a small number of low-risk listings.

## Before First Live Publish

- Confirm `EBAY_ENVIRONMENT=production`.
- Confirm production OAuth is valid.
- Confirm production policy/location config is correct in `public.app_settings`.
- Current env-specific values live under `public.app_settings.ebay_publish_config.production`.
- Confirm `public.app_settings.pricing_provider_mode` is intentionally set for the pilot: `off`, `soldcomps`, or `apify`.
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

## Config 

For Prod:
update public.app_settings
set
ebay_marketplace_id = 'EBAY_US',
default_payment_policy_id = '260524452013',
default_fulfillment_policy_id = '260524990013',
default_return_policy_id = '260524680013',
merchant_location_key = 'mfh-main-location'
where id = 'default';

For Sandbox:
update public.app_settings
set
ebay_marketplace_id = 'EBAY_US',
default_payment_policy_id = '6227962000',
default_fulfillment_policy_id = '6227963000',
default_return_policy_id = '6227964000',
merchant_location_key = 'default-main-location'
where id = 'default';

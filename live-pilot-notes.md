# Controlled Live Pilot Notes

## Purpose
Minimal notes for safely testing the first real eBay listings while fulfillment/admin remains in eBay Seller Hub.

## Scope
- App handles intake, draft generation, review, and publish.
- eBay Seller Hub remains source of truth for shipping labels, order handling, buyer messages, and manual admin.
- Use only a small number of low-risk listings.

## Before First Live Publish
- Confirm `EBAY_ENVIRONMENT=production`.
- Confirm production OAuth is valid.
- Confirm production policy IDs are configured.
- Confirm merchant location key is `mfh-main-location`.
- Confirm image URLs use the public R2 custom domain.
- Confirm listing has title, price, category, condition, images, and required item specifics.
- Confirm the item is physically available and easy to ship.

## Pilot Rules
- Start with 1 listing.
- Prefer a low-value single card.
- Do not batch publish.
- Do not rely on app order sync yet.
- Check the live listing manually in eBay Seller Hub after publish.
- Handle shipping and buyer/admin workflows in Seller Hub.

## After Publish
- Verify listing is live.
- Verify title, price, images, condition, item specifics, shipping, and return policy.
- Save/confirm `ebay_listing_id`, `ebay_offer_id`, and listing URL are present locally.
- If anything looks wrong, revise/end the listing in Seller Hub first.

## Known Boundaries
- App does not yet manage shipping labels.
- App does not yet fully own order fulfillment.
- Sold status and cleanup automation are future tasks.
- Seller Hub remains the operational fallback.

## Stop Conditions
Stop live publishing if:
- duplicate listing is created
- images are wrong or inaccessible
- policy/location config is wrong
- item specifics are materially wrong
- app status does not match eBay state
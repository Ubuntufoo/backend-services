# You Pick backend foundation

## Verified Inventory API model

You Pick is a dedicated fixed-price multiple-variation workflow, not a third legacy
capture/listing type. The Inventory API flow is:

1. Create one inventory item and immutable SKU per selectable card.
2. Create one offer per child inventory item.
3. Create one `InventoryItemGroup` whose `variantSKUs` contains the complete child set.
4. Define the selector in `variesBy.specifications`; use the same exact aspect name/value
   on each child's `product.aspects`.
5. Set `variesBy.aspectsImageVariesBy` to the selector aspect when images pivot with the
   selected card.
6. Publish the group with `publishOfferByInventoryItemGroup`.

Official eBay documentation defines group replacement as a complete snapshot, requires
all child offers to be compatible, and warns that Inventory API listings cannot later be
managed through Trading API listing calls:

- [Creating and managing inventory item groups](https://developer.ebay.com/api-docs/sell/static/inventory/inventory-item-groups.html)
- [Inventory item to marketplace offer](https://developer.ebay.com/api-docs/sell/static/inventory/inventory-item-to-offer.html)
- [InventoryItemGroup](https://developer.ebay.com/api-docs/sell/inventory/types/slr%3AInventoryItemGroup)
- [Inventory API error details](https://developer.ebay.com/api-docs/sell/static/inventory/inventory-error-details.html)

## MVP contract

`YouPickGroupDraft` and its nested types are discovery/foundation contracts for the domain
boundary. They are not complete publish-ready Inventory API payloads. Sandbox findings must
settle the unresolved API placements below before persistence or orchestration is designed.

- Marketplace: `EBAY_US`; initial category: Sports Trading Card Singles (`261328`) only.
- One group: one title, description, category, marketplace, merchant location, business
  policy set, shared aspects, and shared condition tier/descriptors.
- One variant: one immutable child SKU, unique immutable selector value, front/back image
  pair, available quantity, and price.
- Format: fixed price. Quantity and price remain child-owned even when initially uniform.
- Images: each child owns its front/back source identity. Inventory API placement remains
  unresolved: child `product.imageUrls`, group `imageUrls`, or a derived combination. The
  sandbox pilot must prove the accepted payload and buyer-facing pairing/order; the reference
  listing alone cannot prove its API mapping.
- Title and description: the group owns buyer-facing content. The sandbox pilot must determine
  whether child inventory-item product payloads omit these fields or repeat group-compatible
  values; the foundation contract does not choose either submission shape.
- Group replacement: always build a complete payload from persisted current state. Never
  patch by omission.
- Existing Single and Lot types, SKU grammar, tables, jobs, routes, watcher grouping,
  publishing, reconciliation, pricing, and generation remain unchanged.
- Frontend: a separate You Pick tab/workspace and group editor. Never add You Pick to the
  existing Single/Lot capture selector or singular listing state machine.

## Field ownership

| Field | Owner | Inventory API placement |
| --- | --- | --- |
| Group key | Group | URI `inventoryItemGroupKey` |
| Title, description | Group | Group fields; child omit/repeat treatment unresolved pending sandbox proof |
| Shared aspects | Group | `InventoryItemGroup.aspects` |
| Selector name and complete values | Group | `variesBy.specifications` |
| Image-pivot selector | Group | `variesBy.aspectsImageVariesBy` |
| Category, marketplace, format, location, policies | Group-owned invariant | Repeated identically on child offers |
| Condition tier and descriptors | Group-owned invariant | Repeated identically on child inventory items |
| Child SKU | Variant | Inventory item identity and offer `sku` |
| Selector value | Variant | Child `product.aspects[selectorName]` |
| Front/back images | Variant source identity | Unresolved: child, group, or derived API placement pending sandbox proof |
| Quantity | Variant | Inventory availability and offer allocation |
| Price | Variant | Child offer pricing summary |
| Offer ID | Variant remote state | Offer response/read-back |
| eBay listing ID | Group remote state | Group publish response |

## Selector convention

Persist one non-empty, case-sensitive `selectorValue` per variant. Values must be unique
within the group, stable across retries/read-back, independent of price/stock/condition,
and must never include UI suffixes such as `(Out of stock)`. The initial display candidate
is a stable zero-padded ordinal followed by a short identity label, for example
`001 - 1998 Upper Deck #10`. Punctuation, label content, and sort behavior remain
configurable until the sandbox pilot verifies accepted aspect names, buyer display, and
ordering. SKU and selector value are separate identities.

## Lifecycle boundary

This foundation defines contracts only. A later dedicated workflow must own draft,
validation, staged remote writes, group publish, active, withdraw, and cleanup states.
Every remote child/item/offer step needs a durable checkpoint and idempotent read-before-
create recovery. Publication is group-scoped; order reconciliation is child-SKU-scoped.
Do not reuse listing-keyed legacy jobs or singular reconciliation.

## Reversible sandbox pilot gate

[`sandbox-pilot.md`](sandbox-pilot.md) is the authoritative operational runbook. This section
summarizes its architecture gate; use the runbook for harness contracts, mutation checkpoints,
bounded payload experiments, failure recovery, evidence, and cleanup.

Before any write, the harness must bind the Inventory user OAuth authorization to the canonical
sandbox `UserID` returned by a narrow Trading `GetUser` call; Commerce Identity Sandbox mock data
is not ownership proof. It must also require `Content-Language: en-US` on the guarded Inventory
write path. One run may publish only one material payload arrangement: a buyer-facing failure
requires withdrawal, full cleanup, verified absence, and a fresh run for any declared fallback.

Do not run until worktree-local credentials, ports, storage, and background workers are
isolated. Then use 2-3 unsold cards and prove, in order:

1. `261328` supports the exact proposed selector aspect for the intended sandbox account.
2. Selector values round-trip exactly and display in the intended order.
3. Child title/description fields can be omitted or must repeat group-compatible values while
   the group remains the buyer-facing owner.
4. Child source images map through child fields, group fields, or a derived combination so each
   selection displays the correct front and back images in the intended order.
5. Different child prices render correctly.
6. The valid group first publishes with every child quantity positive.
7. A post-publish revision sets one child quantity to zero and proves that its selector value is
   unavailable without deleting the child or sold history; then restore it or clean it up.
8. Group GET, child item GET, and offer GET reconstruct the submitted state.
9. Withdraw ends the listing; explicit cleanup removes offers, group, and child items.
10. No resource from the original checkout/account is read as owned or mutated.

Any failure stops the pilot and preserves diagnostics. No production write follows from a
sandbox success without a separate gate.

## Unresolved before persistence or orchestration

- Exact selector aspect accepted for `261328` by the intended account.
- Buyer display/order rules for the proposed selector convention.
- Whether child product payloads omit title/description or repeat group-compatible values.
- Whether selected-card images belong on child items, the group, or a derived combination, plus
  the exact payload that yields two images in the intended front/back order.
- Effective category/account limits beyond documented and observed evidence.
- Mutation rules after sales, revision caps, operational group-size cap, and recovery UX.
- Dedicated persistence, job subjects, operation ledger, order lines, and deletion policy.

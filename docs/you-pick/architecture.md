# You Pick backend architecture

## Scope and evidence levels

You Pick is a dedicated fixed-price multiple-variation workflow, not a third legacy
Single/Lot capture type. This document separates:

- **Proven MVP decisions:** observed in the completed two-child `EBAY_US` Sandbox pilot and
  accepted for the MVP.
- **Derived design choices:** application contracts chosen from those proofs and the Inventory
  API ownership model.
- **Unresolved limits:** behavior that still needs scale, production, or post-sale evidence.

Sandbox success does not authorize a production write. It also does not turn a two-child result
or the 87-value reference listing into a universal eBay limit.

## Inventory API ownership model

One buyer-facing listing consists of one `InventoryItemGroup`, the complete child inventory-item
set, and one offer per child:

1. Create one inventory item and immutable SKU per selectable card.
2. Create one offer per child inventory item.
3. Replace one complete `InventoryItemGroup` whose `variantSKUs` contains every child SKU.
4. Define the selector in `variesBy.specifications` and repeat the same exact aspect name/value
   in each child's `product.aspects`.
5. Keep `variesBy.aspectsImageVariesBy` on that selector.
6. Publish with `publishOfferByInventoryItemGroup`.

Group replacement is a complete snapshot; omission-based patching is unsafe. Inventory API owns
all listing mutation after creation. Trading API remains limited to the Sandbox identity proof in
the pilot runbook and must not create, revise, end, or relist these resources.

- [Creating and managing inventory item groups](https://developer.ebay.com/api-docs/sell/static/inventory/inventory-item-groups.html)
- [Inventory item to marketplace offer](https://developer.ebay.com/api-docs/sell/static/inventory/inventory-item-to-offer.html)
- [InventoryItemGroup](https://developer.ebay.com/api-docs/sell/inventory/types/slr%3AInventoryItemGroup)
- [Inventory API error details](https://developer.ebay.com/api-docs/sell/static/inventory/inventory-error-details.html)

## Proven MVP decisions

### Group, child, and content ownership

- The group owns buyer-facing title and description, shared aspects, selector definition,
  category, marketplace, merchant location, business policies, and one shared condition contract.
- Child inventory-item product payloads omit title and description. Child offers omit
  `listingDescription`; group content remains buyer-facing.
- Each child owns one immutable SKU, one unique selector value, one inventory item, one offer,
  one price, one quantity, and one ordered image pair.
- Every child repeats the same compatible condition tier and descriptors. A card requiring a
  different condition belongs in another group.

### Selector order and remote reconciliation

- Application-declared `variesBy.specifications[].values` order is authoritative for selector
  display and child-to-selector mapping.
- The application writes the full child membership in `variantSKUs`, but eBay may return that
  array in another order. Reconciliation requires exact membership with no missing, extra, or
  duplicate SKU; response-order equality is not required.
- SKU sorting, remote array order, and image adjacency must never reconstruct selector order.

### Images and Media lifecycle

- External source images are ingested through eBay Media before Inventory publication.
- Each child owns seller EPS URLs in deterministic `product.imageUrls: [front, back]` order.
- The group keeps `aspectsImageVariesBy` on the selector and omits group-level `imageUrls`.
  Group front pivots produced unbound duplicate buyer images and are not an MVP design.
- Media resource IDs are opaque. Validate the trusted HTTPS eBay host/path boundary, URI safety,
  and exact returned identity; do not impose a locally invented identifier alphabet.
- The current Media integration has no image-delete operation or source-keyed recovery lookup.
  A started create with unknown identity is not replayable. Unused EPS resources are outside
  Inventory cleanup ownership and remain to expire.

### Publication, quantity, and cleanup

- Publication and buyer listing identity are group-scoped. Price, quantity, order
  reconciliation, and sold history are child-SKU-scoped.
- Setting one child's inventory and offer quantities to zero removes that selector from buyer
  view while other positive-quantity children remain purchasable. Group membership remains
  complete; zero quantity is not child deletion.
- Withdrawal and dependency-ordered cleanup may proceed directly from that zero-quantity state.
  Restoration is not a cleanup precondition.
- Cleanup withdraws the active group when required, deletes exact manifest-owned offers, deletes
  the group, deletes child inventory items, and then proves exact absence. Ambiguous ownership or
  lifecycle evidence stops destructive cleanup.
- Publication, listing, and offer IDs remain durable historical ownership facts after cleanup.
  Current remote state is represented separately by reconciled lifecycle/absence evidence,
  terminal cleanup state, and final-absence verification. Historical identity must not be erased
  or presented as proof that a resource still exists.

## Field ownership

| Field | Owner | Inventory/Media placement and reconciliation |
| --- | --- | --- |
| Group key | Group | Inventory group URI identity; retain historically after cleanup |
| Title, description | Group | Group fields; omitted from child product and offer description payloads |
| Shared aspects | Group | `InventoryItemGroup.aspects` |
| Selector name and ordered values | Group/application | `variesBy.specifications`; canonical display and mapping order |
| Complete child membership | Group | `variantSKUs`; exact set reconciliation, not remote response order |
| Image-pivot selector | Group | `variesBy.aspectsImageVariesBy` |
| Group images | None for MVP | Omit group-level `imageUrls` |
| Category, marketplace, format, location, policies | Group invariant | Repeat identically on child offers where required |
| Condition tier and descriptors | Group invariant | Repeat identically on child inventory items |
| Child SKU | Child | Inventory item identity and offer `sku` |
| Selector value | Child | Child `product.aspects[selectorName]`; unique and immutable within group |
| Front/back images | Child | Seller EPS URLs in exact `product.imageUrls: [front, back]` order |
| Media identity and expiry | Prepublication support resource | Opaque eBay identity; separate from Inventory cleanup |
| Quantity | Child | Inventory availability and offer allocation |
| Price | Child | Offer pricing summary |
| Offer ID | Child remote history | Read-back identity retained after deletion |
| eBay listing ID | Group remote history | Publish identity retained after final absence |

## Derived MVP design choices

- Persist one canonical ordered child/selector sequence. Build selector values, child payloads,
  and complete group replacements from it; reconcile remote group membership as a set.
- Persist Media ownership separately from Inventory resources, including exact trusted returned
  identity, role, child association, creation outcome, and expiry evidence. Do not imply that
  Inventory deletion deletes Media.
- Model historical remote identities separately from current lifecycle and absence evidence.
- Treat zero quantity as an unavailable-child state and support cleanup from it without an
  artificial restore transition.
- Start with a conservative operational cap of two or three children. The cap is an application
  safety choice, not a platform maximum, and changes only after later recorded evidence.
- Keep You Pick persistence, jobs, routes, reconciliation, UI, and SKU rules isolated from
  existing Single/Lot behavior. Detailed aggregate identities belong to YP1.2; detailed lifecycle
  transitions and recovery classes belong to YP1.3.

## Sanitized Phase 0 provenance

The accepted child-only EPS proof used run `20260811T161151Z-184533` and Sandbox listing
`110590182836`. Buyer verification passed selector order, distinct prices, group title and
description, shared condition, and exactly two ordered images for each of two children. A later
quantity-zero step removed only the target selector, and final cleanup proceeded without restoring
it. Exact reads then proved the listing, offers, group, and children absent. These identifiers are
provenance only; they are not current-resource claims. Raw `.local/you-pick-sandbox/**` evidence
must remain untracked.

[`sandbox-pilot.md`](sandbox-pilot.md) remains the operational and recovery reference. Its failed
historical arrangements remain evidence only and must not be copied into the production contract.

## Unresolved limits and later evidence gates

- Effective group size, selector-value, image-count, revision, and performance limits beyond the
  initial two-to-three-child cap.
- Whether the Sandbox results generalize to production accounts, categories, policies, Media
  processing, buyer rendering, and out-of-stock settings.
- Post-sale and order behavior: partial sales, oversell prevention, cancellations, returns,
  refunds, sold-history retention, and order-line reconciliation across variants.
- Safe mutation rules after sales, long-lived revision behavior, operational recovery UX, and
  support procedures at larger scale.
- Exact useful selector names and normalization behavior for other categories/accounts. The
  accepted pilot selector does not establish a universal taxonomy contract.
- Durable aggregate IDs/SKU grammar/persistence schema (YP1.2) and the complete lifecycle,
  failure, retry, abandonment, and deletion state machine (YP1.3).
- A production-ready operational cap. The 87-value reference listing proves only that a universal
  30-value assumption is false; it does not establish this application's safe maximum.

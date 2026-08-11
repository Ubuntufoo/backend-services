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

## Canonical aggregate and application identities

The persistence boundary is one `YouPickGroup` aggregate. It is loaded and validated as one root
with one ordered child collection; a child is never a standalone aggregate and may belong to
exactly one group. These names describe the durable contract for later schema/DTO work, not a
runtime type or persistence implementation:

```text
YouPickGroup
  groupId
  orderedChildren[]
  selectorName
  content { title, description, sharedAspects }
  invariants { categoryId, marketplaceId, format, merchantLocationKey,
               fulfillmentPolicyId, paymentPolicyId, returnPolicyId, condition }
  remote { inventoryItemGroupKey, publicationHistory[], currentEvidence }

YouPickChild
  childId
  position
  sku
  selectorValue
  price
  quantity
  images { front, back }
  remote { mediaByRole, offerHistory[], currentEvidence }
```

- `groupId` and `childId` are application identities: canonical UUIDs generated once, globally
  unique, immutable, and never reused. They remain the primary identities after withdrawal or
  cleanup and do not come from titles, selector text, array positions, SKUs, or eBay state.
- A child's identity is `childId`, not its current `position`. `position` is unique and contiguous
  within the group and owns application display/payload order. Only an explicit aggregate reorder
  may change positions; reads, sorting, image adjacency, or remote order never do.
- The child ID is also the canonical selector identity; no second selector-ID namespace is needed.
  Each child additionally owns exactly one non-empty `selectorValue`, normalized once at creation
  by Unicode NFC plus outer-whitespace trimming. Values are case-sensitive, unique within the
  group, immutable, and sent verbatim as the single value for the group's `selectorName`.
- `selectorName` is one immutable, non-empty group field. Every child uses that exact aspect name.
  Selector values contain card identity only: no price, stock, sold/unavailable marker, position,
  or UI-only suffix. Correcting a canonical selector identity/value requires a new child under the
  lifecycle rules to be defined by YP1.3, not an in-place rename.
- `inventoryItemGroupKey`, child `sku`, offer IDs, listing IDs, and Media IDs/URLs are remote
  identities or remote-facing keys. None replaces `groupId` or `childId` as application identity.

## You Pick remote-key and SKU grammar

Use a dedicated namespace derived only from the immutable application ID:

```text
inventory item group key: YP-G-<GROUP_UUID_HEX>
child SKU:               YP-C-<CHILD_UUID_HEX>
GROUP_UUID_HEX / CHILD_UUID_HEX: canonical UUID with hyphens removed and a-f uppercased
```

Both grammars are exactly 37 ASCII characters, match `^YP-[GC]-[0-9A-F]{32}$`, and stay below
the repo's known 50-character Inventory key/SKU boundary. Generation is a pure projection of the
corresponding immutable UUID, making retries deterministic; UUID uniqueness plus a database unique
constraint and the existing remote collision preflight provide collision defense. Once allocated,
keys are immutable and never reused even after terminal absence. Caller-supplied arbitrary keys,
display-text slugs, child positions, and mutable timestamps are invalid sources.

This namespace is intentionally disjoint from the existing
`<category>-<Single|Lot>-<six digits>` grammar. You Pick code must not add `YouPick` to the legacy
listing-type union, parse a You Pick SKU with Single/Lot helpers, or change existing Single/Lot
generation, validation, and publication behavior.

## Complete aggregate invariants

Every aggregate mutation and complete group payload must validate all of these together:

- at least two children; no more than the configured admission cap; unique `childId`, `sku`,
  `position`, and `selectorValue`; positions exactly `0..n-1` with no gaps;
- exactly one selector name and one canonical selector value per child; ordered
  `variesBy.specifications` values equal `orderedChildren.map(selectorValue)`;
- exact child membership: `variantSKUs` is built from every and only the ordered children, although
  its remote read-back is compared as a set;
- one shared category, marketplace, fixed-price format, merchant location, fulfillment/payment/
  return policies, and condition tier/descriptors for the whole group; fields repeated on child
  items/offers must equal the group invariant exactly;
- group-owned title, description, and shared aspects appear only in their documented group
  placement; child product/offer content cannot override them;
- each child owns its price, quantity, exact front/back image roles, Media records, inventory item,
  and offer history. A child field may vary without weakening the shared invariants.

## Remote identity and evidence model

- The group owns its immutable Inventory item group key and an append-only `publicationHistory`.
  Each publication record binds the observed listing ID to the exact child-offer IDs and child
  SKUs participating in that publication. Listing IDs are group-scoped; offer IDs are child-scoped.
- A child owns its immutable SKU, inventory-item observations, append-only offer history, and two
  role-addressed Media records. Each Media record keeps role, opaque Media ID, seller EPS URL,
  creation outcome, and observed expiry/availability evidence. Media ID and URL are related remote
  facts, not interchangeable IDs and not Inventory cleanup targets.
- Historical group keys, SKUs, offer IDs, listing IDs, Media IDs, URLs, publication bindings, and
  cleanup evidence are never cleared or overwritten to mean “current.” They establish ownership
  and audit history only.
- `currentEvidence` is a separate, timestamped read result for the exact remote identity. It records
  present state, proven absence, or unknown/ambiguous state plus the observation source. A stale
  historical ID never proves presence. A missing local value never proves remote absence.
- Terminal absence is affirmative evidence from the exact final read set: listing, every historical
  offer targeted by cleanup, group key, and every child SKU are absent. Auth, timeout, malformed
  response, partial reads, or identity mismatch produce unknown—not absence. Terminal absence does
  not erase identity/history and does not imply Media deletion or expiry.

## Exact reconciliation contract

Let `expected` be the aggregate's unique child-SKU set and `actual` the remote group's
`variantSKUs`. Reconciliation first validates each array for non-empty unique strings, then requires
set equality. Remote array order is ignored only for this membership comparison; application order
continues to come exclusively from persisted child positions and ordered selector values.

- **Missing:** a SKU in `expected` is absent from `actual`.
- **Extra:** a SKU in `actual` is absent from `expected`.
- **Duplicate:** either side repeats a SKU, even if deduplication would make the sets equal.
- **Foreign:** any extra remote SKU, including one with a `YP-C-` prefix or known to another group.

Any missing, extra, duplicate, malformed, or foreign membership fails closed: no adoption,
position reconstruction, payload repair, publish/replay, or destructive cleanup follows from that
read. Exact membership alone is not complete reconciliation. Each child item must have exactly the
aggregate's group association, the selector aspect must be the exact singleton canonical value,
shared item/offer fields must match group invariants, each intended offer must unambiguously bind
the child SKU and target marketplace, and a published aggregate's child offers must resolve to one
listing ID. Missing/extra offers, multiple group associations, selector mismatch, split listing
IDs, or ambiguous reads also fail closed for YP1.3 recovery handling.

## Configurable MVP admission cap

Group-size admission is an application-service policy, not an aggregate identity, database column,
or eBay constant. Initial configuration accepts integer `2` or `3` (default `2`); validation still
requires at least two children and rejects a create/add operation above the configured value before
any remote work. Existing aggregates remain loadable when configuration changes.

Later recorded scale evidence may raise the maximum by changing validation/configuration only.
UUID identities, SKU grammar, ordered-child persistence, complete payload construction, and exact
set reconciliation do not change. The initial range is deliberately not described as an eBay
platform maximum.

## Field ownership

| Field | Owner | Inventory/Media placement and reconciliation |
| --- | --- | --- |
| Application group ID | Group | Canonical UUID; aggregate identity, never reused |
| Group key | Group remote key | `YP-G-<GROUP_UUID_HEX>` Inventory URI identity; retain historically after cleanup |
| Title, description | Group | Group fields; omitted from child product and offer description payloads |
| Shared aspects | Group | `InventoryItemGroup.aspects` |
| Selector name and ordered values | Group/application | `variesBy.specifications`; canonical display and mapping order |
| Complete child membership | Group | `variantSKUs`; exact set reconciliation, not remote response order |
| Image-pivot selector | Group | `variesBy.aspectsImageVariesBy` |
| Group images | None for MVP | Omit group-level `imageUrls` |
| Category, marketplace, format, location, policies | Group invariant | Repeat identically on child offers where required |
| Condition tier and descriptors | Group invariant | Repeat identically on child inventory items |
| Application child ID | Child | Canonical UUID; child and selector identity, independent of position |
| Position | Group ordered collection | Unique contiguous application order; never reconstructed remotely |
| Child SKU | Child remote key | `YP-C-<CHILD_UUID_HEX>` inventory identity and offer `sku`; immutable |
| Selector value | Child | Exact singleton `product.aspects[selectorName]`; unique and immutable within group |
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
- Enforce the configurable two-or-three-child admission cap at the application-service boundary.
  It is a safety choice, not a persisted aggregate property or platform maximum.
- Keep You Pick persistence, jobs, routes, reconciliation, UI, and SKU rules isolated from
  existing Single/Lot behavior. Detailed lifecycle transitions and recovery classes belong to
  YP1.3.

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
- The complete lifecycle, failure, retry, abandonment, and deletion state machine (YP1.3), plus
  its later persistence schema (YP2.1).
- A production-ready operational cap. The 87-value reference listing proves only that a universal
  30-value assumption is false; it does not establish this application's safe maximum.

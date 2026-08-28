# Variation listing backend architecture

## Scope and evidence levels

The variation listing is a dedicated fixed-price multiple-variation workflow, not a third legacy
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

### Group, variation, and content ownership

- The group owns buyer-facing title and description, a derived common-aspect projection, selector
  definition, category, marketplace, merchant location, business policies, and one shared
  condition contract.
- Child inventory-item product payloads omit title and description. Child offers omit
  `listingDescription`; group content remains buyer-facing.
- Each variation owns one immutable SKU, one unique selector value, one eBay child inventory item,
  one child offer, one price, one derived quantity projection, and one representative-copy reference.
- Every variation's child inventory item repeats the same compatible condition tier and descriptors. A card requiring a
  different condition belongs in another group.
- Variation-owned operational fields (price, derived quantity, representative images, and remote histories) may differ. Each
  variation also retains application metadata for its card-specific facts; those facts may differ and
  are not automatically emitted as eBay child aspects.

### Selector order and remote reconciliation

- Application-declared `variesBy.specifications[].values` order is authoritative for selector
  display and variation-to-selector mapping.
- The application writes the full child membership in `variantSKUs`, but eBay may return that
  array in another order. Reconciliation requires exact membership with no missing, extra, or
  duplicate SKU; response-order equality is not required.
- SKU sorting, remote array order, and image adjacency must never reconstruct selector order.

### Images and Media lifecycle

- External source images are ingested through eBay Media before Inventory publication.
- Each variation's child inventory item owns seller EPS URLs in deterministic `product.imageUrls: [front, back]` order.
- The group keeps `aspectsImageVariesBy` on the selector and omits group-level `imageUrls`.
  Group front pivots produced unbound duplicate buyer images and are not an MVP design.
- Media resource IDs are opaque. Validate the trusted HTTPS eBay host/path boundary, URI safety,
  and exact returned identity; do not impose a locally invented identifier alphabet.
- The current Media integration has no image-delete operation or source-keyed recovery lookup.
  A started create with unknown identity is not replayable. Unused EPS resources are outside
  Inventory cleanup ownership and remain to expire.

### Publication, quantity, and cleanup

- Publication and buyer listing identity are group-scoped. Price, quantity, order
  reconciliation, and sold history are variation-SKU-scoped.
- Setting one variation's child inventory item and offer quantities to zero removes that selector from buyer
  view while other positive-quantity variations remain purchasable. Group membership remains
  complete; zero quantity is not variation deletion.
- Withdrawal and dependency-ordered cleanup may proceed directly from that zero-quantity state.
  Restoration is not a cleanup precondition.
- Cleanup withdraws the active group when required, deletes exact manifest-owned child offers, deletes
  the group, deletes variation child inventory items, and then proves exact absence. Ambiguous ownership or
  lifecycle evidence stops destructive cleanup.
- Publication, listing, and offer IDs remain durable historical ownership facts after cleanup.
  Current remote state is represented separately by reconciled lifecycle/absence evidence,
  terminal cleanup state, and final-absence verification. Historical identity must not be erased
  or presented as proof that a resource still exists.

## Canonical aggregate and application identities

The persistence boundary is one `VariationListingGroup` aggregate. It is loaded and validated as one root
with one ordered variation collection; each variation owns one or more physical copies. A variation
is never a standalone aggregate and may belong to exactly one group. A physical copy belongs to
exactly one variation and is not itself an eBay variation. These names describe the durable contract
for later schema/DTO work, not a runtime type or persistence implementation:

```text
VariationListingGroup
  groupId
  orderedVariations[]
  selectorName
  content { title, description, derivedCommonEbayAspects }
  invariants { categoryId, marketplaceId, format, merchantLocationKey,
               fulfillmentPolicyId, paymentPolicyId, returnPolicyId, condition }
  publication { confirmedRevision, pendingLocalChanges }
  remote { inventoryItemGroupKey, publicationHistory[], currentEvidence }

VariationListingVariation
  variationId
  position
  sku
  selectorValue
  variationMetadata { player, team, yearOrSeason, set, cardNumber, parallelOrInsert, ... }
  price
  representativeCopyId
  copies[]
  remote { mediaByRoleForRepresentativeCopy, offerHistory[], currentEvidence }

VariationListingCopy
  copyId
  variationId
  copyCondition
  availabilityState
  images { front, back }
  captureEvidence
```

The pseudocode names are ownership boundaries for later DTO/persistence work, not a final schema.
`variationMetadata` is application-owned source data. `derivedCommonEbayAspects` is rebuilt from the
complete variation set and is the only taxonomy-aspect projection sent in the group payload. Desired
variation quantity is derived from eligible available physical copies; it is not a second independent
inventory authority. The detailed capture/replenishment contract is in
[`intake-workflow.md`](intake-workflow.md).

The initial durable boundary is fixed to four additive tables: `variation_listing_groups`,
`variation_listing_variations`, `variation_listing_copies`, and the dedicated
`variation_listing_intake_sessions`. Group rows own SKU category/token, next-serial high-water, and
`desired_revision`/`last_confirmed_revision` watermarks; session rows own station target/mode/price and
pending-pair snapshots. Revision snapshots, digests, remote IDs, and operation checkpoints remain the
later YP2.5 ledger, so no publish occurs before that ledger exists. Exact columns, SQL names, triggers,
FKs, RLS, and CAS semantics are in [`persistence-design.md`](persistence-design.md).

- `groupId` and `variationId` are application identities: canonical UUIDs generated once, globally
  unique, immutable, and never reused. They remain the primary identities after withdrawal or
  cleanup and do not come from titles, selector text, array positions, SKUs, or eBay state.
- A variation's identity is `variationId`, not its current `position`. `position` is unique and contiguous
  within the group and owns application display/payload order. Only an explicit aggregate reorder
  may change positions; reads, sorting, image adjacency, or remote order never do.
- The variation ID is also the canonical selector identity; no second selector-ID namespace is needed.
  Each variation additionally owns exactly one non-empty `selectorValue`, normalized once at creation
  by Unicode NFC plus outer-whitespace trimming. Values are case-sensitive, unique within the
  group, immutable, and sent verbatim as the single value for the group's `selectorName`.
- `selectorName` is one immutable, non-empty group field. Every variation uses that exact aspect name.
  Selector values contain card identity only: no price, stock, sold/unavailable marker, position,
  or UI-only suffix. Correcting a canonical selector identity/value requires a new variation under the
  lifecycle rules below, not an in-place rename.
- `inventoryItemGroupKey`, variation `sku`, offer IDs, listing IDs, and Media IDs/URLs are remote
  identities or remote-facing keys. None replaces `groupId` or `variationId` as application identity.

## Variation listing remote-key and structured inventory SKU grammar

The Inventory group key remains a deterministic UUID-derived remote key, but the variation SKU extends
the application's existing structured inventory SKU convention so it remains useful for physically
locating sold cards.

Existing example:

```text
BSKBL-Single-000241
```

Variation listing examples:

```text
BSKBL-McGrady-000241
BSKBL-2003Topps-000242
```

The shape is:

```text
<category-prefix>-<bucket-token>-<six-digit-inventory-serial>
```

`BSKBL` continues to serve the same category/inventory role it already serves for standard card
SKUs. The middle segment becomes a stable variation-listing bucket token chosen for practical inventory
organization: for example `McGrady` for a Tracy McGrady bucket or `2003Topps` for a 2003 Topps
Basketball bucket. The six-digit suffix reuses the existing inventory-management range and formatting,
but allocation is a dedicated variation service primitive: the group row stores category/token and a
next-serial high-water mark, while each variation stores the allocated integer and exact full SKU.
The token is an allocation/search namespace analogous to the legacy Single/Lot prefix; the suffix alone
is not globally unique across those namespaces.

`groupId` and `variationId` remain the canonical immutable application identities. The human-readable
SKU is a separate immutable inventory/business identifier. Changing a bucket title or display text
must not rewrite existing variation SKUs. The bucket token is chosen before group insertion and is
immutable from insertion onward. Reordering variations never changes the six-digit suffix or SKU.
Duplicate physical copies do not receive new SKUs: all copies of one variation share that variation's
SKU and contribute to its quantity.

The Inventory group key remains `VL-G-<GROUP_UUID_HEX>` using the canonical group UUID with hyphens
removed and hexadecimal letters uppercased. That remote key is separate from the human-readable
variation SKU convention.

`VL-G-*` is the intended future production namespace. The `YPSBX-*` keys, Sandbox listing/resource
identities, and `.local/you-pick-sandbox/**` paths recorded by the pilot remain historical harness
provenance and must not be rewritten or treated as current production identifiers.

This is an additive variation-listing extension of the existing structured SKU naming convention, not a
change to current Single/Lot SKUs. Existing `BSKBL-Single-*` / Lot generation, latest-plus-collision
allocation, parsing, and output remain unchanged; variation listing gets dedicated validation/allocation
logic that locks its group row, consumes serials `1..999999` monotonically, fails closed at overflow,
and relies on unique group `(category, bucket token)` namespaces plus a variation-SKU unique constraint.
Reserved `Single`/`Lot` tokens keep valid variation and legacy grammars disjoint, so no racy cross-table
preflight is used. A group that allocated any serial is retained with its high-water; committed serials
are never reused.

## Complete aggregate invariants

Every aggregate mutation and complete group payload must validate all of these together:

- an intake bucket may contain zero variations, and one variation is allowed while its first card is
  being built; `publish-ready`/publish requires at least two variations and no more than the configured
  admission cap; every non-empty set has unique `variationId`, `sku`, `position`, and `selectorValue`,
  with positions exactly `0..n-1` and no gaps;
- exactly one selector name and one canonical selector value per variation; ordered
  `variesBy.specifications` values equal `orderedVariations.map(selectorValue)`;
- exact variation membership: `variantSKUs` is built from every and only the ordered variations, although
  its remote read-back is compared as a set;
- one shared category, marketplace, fixed-price format, merchant location, fulfillment/payment/
  return policies, and condition tier/descriptors for the whole group; fields repeated on child
  items/offers must equal the group invariant exactly;
- for initial category `261328`, the group also owns one minimum condition token and available copies
  must meet or exceed it under `POOR < VERY_GOOD < EXCELLENT < NEAR_MINT_OR_BETTER`; the raw-card
  eBay condition remains `4000` and descriptors are validated through the existing category mapping;
- group-owned title, description, and derived common eBay aspects appear only in their documented
  group placement; child product/offer content cannot override them;
- every variation retains application `variationMetadata` without requiring equality to another variation;
  metadata is never erased or rewritten merely to make a group aspect appear common;
- `derivedCommonEbayAspects` contains only normalized values truthfully common to every variation. An
  optional/recommended heterogeneous aspect is omitted; a required aspect with no truthful common
  value/set blocks publication or requires regrouping. MULTI values use intersection, never union;
- each variation owns its price, selector identity, representative-copy choice, inventory item, and
  offer history; each physical copy owns its exact front/back image pair, internal condition,
  availability, and capture evidence;
- desired variation quantity is exactly the count of eligible `available` physical copies. Additional
  duplicate copies replenish the existing variation/SKU instead of creating duplicate selectors or an
  independently editable quantity authority;
- exactly one copy is the representative image source for each variation. The first copy is selected by
  default, and later representative changes are explicit staged local changes rather than automatic
  consequences of a sale or availability change.

## Category 261328 item-specific ownership (YP1.4)

The current category contract is recorded in the sanitized
[`item-specific-ownership.md`](item-specific-ownership.md) evidence note. It is based on
read-only Sandbox Taxonomy/Metadata calls observed 2026-08-27 for `EBAY_US`, category tree `0`,
category `261328`; it is not production metadata. `ListingStructurePolicy` reported
`variationsSupported=true`. All requested named sports-card fields reported
`aspectEnabledForVariations=false`; across all 30 returned aspects, taxonomy `Customized` was
the sole `true` row.

The Inventory API ownership rule is deliberately narrower than taxonomy applicability and has
three layers:

1. **Application variation metadata:** each variation persists Gemini-derived/reviewed card-specific facts
   such as Player/Athlete, Team, Year/Season, Set, Card Number, Parallel/Insert, League,
   Manufacturer, autograph facts, and other evidence. These values may differ freely and remain
   available to persistence, UI, review, and selector construction even when omitted from eBay.
2. **eBay common group aspects:** `InventoryItemGroup.aspects` is a derived projection containing
   only normalized values truthfully common to every variation. Optional/recommended heterogeneous or
   unknown values are omitted; no value is unioned, falsified, or removed from variation metadata to
   fabricate commonality. A required aspect with no truthful common value/set blocks publication or
   requires regrouping. `ITEM` versus `PRODUCT` from `AspectApplicableToEnum` is classification
  metadata, not permission to vary eBay child aspects.
3. **Single eBay child variation:** only the canonical application-owned custom `Card` selector
   varies per variation. Its exact singleton appears in each child `product.aspects`, in group
   `variesBy.specifications` with persisted selector order, and in
   `variesBy.aspectsImageVariesBy`. Existing Sandbox proof in [`sandbox-pilot.md`](sandbox-pilot.md)
   establishes this buyer-visible selector/image behavior; it does not generalize to arbitrary
   custom aspects.

Taxonomy `Customized` is not the card selector and is never a second pivot absent a separately
reviewed truthful buyer need. No extra child product aspects may act as hidden metadata channels,
and no Player, Team, Card Number, Year, Set, Parallel/Variety, or other buyer-facing dimension is
invented. A merchandising theme may define group membership when required/common projection and
the single-`Card` selector contracts pass. Thus Tracy McGrady mixed cards, 2003 Topps Basketball
across different players/card numbers, and 1995 Fleer Ultra Gold Medallion inserts across
different players/card numbers are valid heterogeneous groups.

For SINGLE aspects, project one value only when every variation has that value. For MULTI aspects,
project the intersection of values present on every variation, never a union. A difference or
present-vs-absent optional/recommended value does not split a group; it is omitted from the eBay
projection while retained in variation metadata. Required absence or lack of a common truthful value
is fail-closed (block or regroup).

Evidence levels are explicit: eBay Inventory/Taxonomy/Metadata documentation establishes field
placement and variation constraints; the 2026-08-27 read-only Sandbox metadata establishes the
category values and flags; the existing Sandbox pilot establishes only the custom `Card` selector
plus `aspectsImageVariesBy` buyer proof; and the common-projection/heterogeneous-group rules are
this application's derived contract.

Official contract references: [Inventory item groups](https://developer.ebay.com/api-docs/sell/static/inventory/inventory-item-groups.html),
[Listing Creation](https://developer.ebay.com/develop/guides/sell/listing-creation),
[Inventory API error details](https://developer.ebay.com/api-docs/sell/static/inventory/inventory-error-details.html),
[AspectConstraint](https://developer.ebay.com/api-docs/sell/taxonomy/types/txn%3AAspectConstraint),
[AspectApplicableToEnum](https://developer.ebay.com/api-docs/sell/taxonomy/types/txn%3AAspectApplicableToEnum),
and [ListingStructurePolicy](https://developer.ebay.com/api-docs/sell/metadata/types/sel%3AListingStructurePolicy).

## Remote identity and evidence model

- The group owns its immutable Inventory item group key and an append-only `publicationHistory`.
  Each publication record binds the observed listing ID to the exact child-offer IDs and variation
  SKUs participating in that publication. Listing IDs are group-scoped; offer IDs are variation-scoped.
- A variation owns its immutable SKU, child inventory-item observations, append-only child offer history, and two
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
  offer targeted by cleanup, group key, and every variation SKU are absent. Auth, timeout, malformed
  response, partial reads, or identity mismatch produce unknown—not absence. Terminal absence does
  not erase identity/history and does not imply Media deletion or expiry.

## Exact reconciliation contract

Let `expected` be the aggregate's unique variation-SKU set and `actual` the remote group's
`variantSKUs`. Reconciliation first validates each array for non-empty unique strings, then requires
set equality. Remote array order is ignored only for this membership comparison; application order
continues to come exclusively from persisted variation positions and ordered selector values.

- **Missing:** a SKU in `expected` is absent from `actual`.
- **Extra:** a SKU in `actual` is absent from `expected`.
- **Duplicate:** either side repeats a SKU, even if deduplication would make the sets equal.
- **Foreign:** any extra remote SKU, including one with a `VL-C-` prefix or known to another group.

Any missing, extra, duplicate, malformed, or foreign membership fails closed: no adoption,
position reconstruction, payload repair, publish/replay, or destructive cleanup follows from that
read. Exact membership alone is not complete reconciliation. Each variation's child item must have exactly the
aggregate's group association, the selector aspect must be the exact singleton canonical value,
shared item/offer fields must match group invariants, each intended offer must unambiguously bind
the child SKU and target marketplace, and a published aggregate's child offers must resolve to one
listing ID. Missing/extra offers, multiple group associations, selector mismatch, split listing
IDs, or ambiguous reads also fail closed under the recovery contract below.

## Lifecycle ownership and states

Lifecycle is aggregate-scoped; variation/SKU identity is variation-scoped; physical availability and
copy-level condition evidence are copy-scoped. Remote operation progress is checkpoint evidence,
not a fourth lifecycle. Published groups are long-lived inventory buckets: local additions,
replenishments, price edits, representative-image changes, and quantity changes may be staged while
the last confirmed remote revision remains active. The exact durable columns, constraints, and mutation
guards are fixed in [`persistence-design.md`](persistence-design.md); semantic scopes may not be
derived from another scope by label.

### Aggregate lifecycle

| State | Meaning and entry requirement | Allowed direction |
| --- | --- | --- |
| `intake` | Local group identity and ordered variations are being assembled; no buyer-facing publication and no remote mutation started | complete required input to `draft`, or abandon |
| `draft` | Complete local aggregate exists but generation/review may be incomplete | edit, add/remove/reorder eligible variations, advance to `review`, or abandon |
| `review` | Generated and seller-entered content is awaiting approval or correction | edit, return to `draft`, advance to `publish-ready`, or abandon |
| `publish-ready` | Full aggregate passes current admission, content, image, pricing, quantity, policy, and remote-collision validation | publish, edit back to `review`, or abandon if no remote resources require withdrawal |
| `publishing` | One or more staged remote publication operations have started, but active publication is not yet exactly reconciled | reconcile forward, retry only a proven no-op, withdraw if publication is found active, or recover/clean owned unpublished resources |
| `active` | Exact reads prove one buyer-facing listing at the last confirmed revision with unambiguous variation offers; newer local changes may be pending | stage local additions/replenishment/price/image changes, explicitly publish a revision batch, reconcile, or withdraw |
| `withdrawn` | Publication history exists and exact current evidence proves no active listing; owned Inventory resources may remain | cleanup, or republish only through a separately validated publish-ready transition that preserves protected history |
| `abandoned` | Local intent ended without buyer-facing publication and exact evidence proves no owned Inventory resources remain; any attempted remote identities/history are retained | terminal for this local intent; no identity reuse or resumed publication |
| `cleanup` | Dependency-ordered Inventory removal is in progress; no create, edit, restore, publish, or sale-bearing mutation is allowed | reconcile/continue safe cleanup or reach `terminal-absent` |
| `terminal-absent` | Affirmative bounded reads prove final Inventory/listing absence; historical identities and Media evidence remain | terminal for these remote identities; no reuse or replay |
| `recovery_required = true` overlay | Current evidence is unknown, mismatched, foreign, split, or otherwise unsafe for an automatic transition; the last normal `lifecycle_state` remains stored | bounded read-only reconciliation or operator-directed recovery only |

`recovery_required = true` records a fail-closed aggregate condition while retaining the last known normal
lifecycle. It must not be used to conceal whether publication, withdrawal, or cleanup had started.
A validation defect or known provider rejection before any effect may leave the aggregate in its
prior editable state instead of entering recovery.

### Variation state and protections

Each variation's desired quantity is derived exactly by counting its physical-copy rows with
`availability_state = 'available'`; no quantity column exists. Before publication, a variation is
`draft`. In an active group, a positive derived count is available and a zero derived count is
`unavailable`, not removed or deleted. Order/sold evidence and any `partially-sold`/`sold` protections
are added by YP2.8/YP8.1/YP8.2 without introducing a competing quantity authority.

- Aggregate `active` does not mean every variation is available. Unavailable variations remain aggregate
  members and retain immutable identity, selector value, position history, SKU, and copy evidence.
  Later sold-protected variations likewise remain members with their order/sale evidence.
- Any credible order-line or sold evidence activates a permanent destructive-erasure guard for the
  variation. Removing the variation from current selection, deleting its local record, reusing its identity,
  deleting history, or treating remote absence as permission to erase it is forbidden.
- Until order matching is proven, conflicting, incomplete, or possibly variation-relevant order evidence
  is conservative: block destructive variation/group deletion and escalate. It does not authorize an
  inferred decrement, selector rewrite, or adoption.
- Unsold variations may be removed only before remote publication work begins. Correcting an immutable
  selector value creates a new variation and retires the old eligible variation; it is never an in-place
  rename. After remote staging begins, membership change requires withdrawal, exact reconciliation,
  and the later explicit revision/republication contract—never omission from a group replacement.

## Actions and transition preconditions

| Action | Preconditions and result |
| --- | --- |
| Create | New immutable group/variation UUIDs; valid ordered collection and admission cap; no remote work. Creates `intake`/`draft`. |
| Edit shared or variation fields | `draft`/`review`; or an explicitly supported active price/quantity action. Immutable IDs, remote keys, selector identity/value, sale evidence, and publication history never change. Buyer-facing structural edits after staging require withdrawal and later revision rules. |
| Reorder | `draft`/`review`, all affected variations unsold, and no remote publication operation started. Rewrites contiguous positions and selector order atomically. Remote array order never triggers it. |
| Add variation / add copy | `draft`/`review` or an `active` long-lived group with no incompatible recovery blocker. New variations and duplicate copies are first staged locally. A duplicate copy attaches to an existing variation and changes desired quantity; it never creates a duplicate SKU/selector. Remote membership/quantity is changed only by an explicit revision batch built from complete desired group state. |
| Update price | Variation belongs to exact reconciled aggregate. Before publish, edit in `draft`/`review`; while `active`, require supported full offer intent, exact before-read, sold guard evaluation, and post-read. Unknown outcome blocks replay. |
| Update quantity / set zero | Local desired quantity is derived from eligible physical-copy state rather than directly edited. Copy availability/sold transitions change the derived quantity. An explicit publication batch updates the intended eBay child item/offer consistently and reconciles both; derived zero enters variation `unavailable` while retaining full group membership. It is not delete, withdraw, sold proof, or abandonment. |
| Restore quantity | Deliberate operator/user request only; current exact reads prove the variation is unsold, owned, zero, and otherwise eligible, and the aggregate is `active`. Never automatic and never required before withdrawal or cleanup. |
| Post-sale variation action | Any sold/order evidence freezes membership, identity, selector, position history, local record/history, and bound remote resources. Read-only reconciliation and safe aggregate withdrawal remain allowed; removal, reorder, rename, restore/increase, reprice, republish/revise, and destructive cleanup stay blocked unless later YP8.1/YP8.2 evidence and rules explicitly authorize the exact action. |
| Publish | `publish-ready`; all variations have positive initial quantity, exact complete payloads, trusted Media results, collision reads prove intended keys absent or exact owned staged state, and no sold/recovery blocker exists. Enters `publishing`; only exact reconciliation enters `active`. |
| Retry/reconcile | Read-only reconciliation is allowed from any nonterminal remote-bearing state. Mutation retry requires exact proof that the prior attempt had no effect and remains bounded to that same immutable intent. Exact complete state reconciles forward. Any other state sets/retains `recovery_required = true`. |
| Withdraw | Required for a current active publication before Inventory deletion. Exact read proves ownership and a withdrawable listing lifecycle; success is exact read-back showing no active publication. A zero-quantity variation does not block it. |
| Abandon | Local intent termination only before buyer-facing publication, or when exact reads prove no remote resources require withdrawal. Enter `abandoned` only when no owned Inventory resources remain; otherwise clean exact owned unpublished staging first. It is not a synonym for ending a published listing and cannot bypass sale guards. |
| Cleanup/delete | Aggregate is withdrawn, was never buyer-facing with exact proof no withdrawal is needed, or is eligible for cleanup directly from zero after withdrawal. Exact ownership/current-state reads and no sale/order guard are required before every destructive dependency. Enters `cleanup`; only final reads enter `terminal-absent`. |

No action is authorized merely because a UI/local status says it is allowed. The operation must load
one valid aggregate, evaluate current variation protections, and reconcile every remote identity needed
for that action immediately before mutation.

## Failure and recovery classes

| Class | Classification | Automatic behavior |
| --- | --- | --- |
| Local validation defect | No remote call was constructed | Remain in prior editable state; correct intent and validate again |
| Known no-op/provider rejection | Definitive response and reads prove the intended mutation made no change | Record rejection; retry only if the defect is corrected and bounded rules still permit the same operation |
| Retryable transport failure with proven unchanged state | Transport failed, then complete authoritative reads exactly equal the recorded pre-state | At most one bounded replay of identical intent; otherwise stop |
| Ambiguous mutation outcome | Timeout, disconnect, malformed/partial response, or reads cannot prove exact pre- or post-state | Set `recovery_required = true`; no blind replay, compensating mutation, or destructive cleanup |
| Remote semantic mismatch | Owned resources exist but membership, aspects, invariants, quantities, price, lifecycle, or bindings differ from exact pre/post intent | Stop; preserve evidence; operator/recovery path, never opportunistic repair |
| Foreign ownership/collision | Key, SKU, offer, listing, or group membership cannot be proven exclusively aggregate-owned | Stop; never adopt, overwrite, withdraw, or delete it |
| Split listing/offer state | Child offers resolve to multiple/conflicting listings, duplicates, or incompatible lifecycle classes | Stop in recovery; no partial publish, withdraw, or cleanup inference |
| Auth/permission failure | Reads or writes are unauthorized/forbidden, including account/marketplace mismatch | Current state is unknown; refresh/repair authority, then reconcile before any mutation |
| Media create with unknown identity | Create began but exact returned Media identity/URL was not captured | Never replay that create automatically; preserve source/attempt evidence and escalate or deliberately start a separately identified ingest |
| Destructive-cleanup ambiguity | Any ownership, lifecycle, dependency absence, sold guard, or delete result is unknown | Stop at the last proven checkpoint; preserve all remaining identities and perform bounded reads only |

Provider messages and HTTP status alone do not prove effect or no effect when a mutation could have
reached eBay. A known complete outcome is advanced by reconciliation, not replay. A proven no-op may
retry only within its operation's bounded rule. Mismatched or foreign state is never normalized by
adoption, overwrite, withdrawal, or deletion.

## Operation and checkpoint contract

Every remote mutation has one immutable intent and durable evidence sufficient to distinguish:
`planned`, `started`, `confirmed-complete`, `confirmed-no-op`, and `unknown`. These are semantic
checkpoints for later YP2.5 persistence design, not a database schema. Record identity, target,
request digest/version, exact pre-evidence, attempt, response/error evidence, exact post-evidence,
and decision before advancing. Never overwrite an earlier attempt to make a later observation look
like its result.

| Operation | Completion evidence and replay boundary |
| --- | --- |
| Media ingest per representative child/role | Confirm only from one trusted returned opaque Media ID and seller EPS URL bound to the exact child, representative copy, role, and source. Non-representative copy images remain application/R2 evidence until explicitly promoted. Unknown identity is non-replayable. |
| Child inventory-item write | Exact SKU read matches complete intended item, group association, selector singleton, shared condition, images, and quantity. Exact absence/pre-state may permit bounded create/replace; semantic mismatch stops. |
| Child offer write | Exact offer read/list-by-SKU proves one owned marketplace offer with intended SKU, policies, location, price, quantity, and unpublished/published binding expected at that stage. Duplicate/foreign offers stop. |
| Complete group replacement | Exact group read has expected invariants and exact unordered SKU membership; selector values/order are checked against application intent, not remote SKU array order. Never patch by omission. |
| Group publish | Exact group/offers reads prove every child offer belongs to one common listing with compatible active lifecycle. Existing exact published state confirms forward; exact unpublished pre-state alone may allow one bounded replay. |
| Price/quantity revision | Exact child item and offer before/after reads prove the same owned child and consistent intended values. Partial or conflicting application is unknown/mismatch, not permission to repeat. |
| Withdrawal | Exact pre-read proves the owned active group/listing; completion requires all intended offers/listing evidence in a compatible non-active state. Unknown or split state blocks retry and cleanup. |
| Dependency-ordered cleanup | For each dependency, read ownership/current state, delete exact owned offer(s), then group, then unsold/unprotected child item(s); confirm absence after each step. A missing dependency is complete only when the exact read is authoritative. Media is excluded. |
| Final absence | Bounded affirmative reads prove listing, every historical/targeted offer, group key, and every child SKU absent. Only then enter `terminal-absent`; auth, timeout, malformed, partial, or mismatched reads remain unknown. |

Cleanup may start with one or more unsold variations already at zero and must not restore them. If any
variation has sold/order evidence, cleanup may withdraw the buyer-facing group, but must not delete that
variation's child item, child offer, identity, or history under the current contract. It may remove only other exact
resources that later order-safe rules affirm are independent and destructible; it cannot claim
whole-aggregate terminal deletion while protected history/resources require retention. Exact
post-sale remote mechanics stay deferred to YP8.1 and production proof.

## Abandonment, withdrawal, cleanup, and terminal state

- **Abandon** ends unpublished local intent. It is valid before buyer-facing publication or after
  exact reconciliation proves that no active remote resource requires withdrawal. Unknown remote
  state is not proof that abandonment is local-only. Untouched local intent may enter `abandoned`
  directly; staged unpublished resources require cleanup and final-absence evidence first.
- **Withdraw** ends buyer-facing availability while retaining aggregate, variations, remote resources,
  and all history. Every published group must be withdrawn before Inventory deletion.
- **Cleanup** removes only exact aggregate-owned, unsold/unprotected Inventory dependencies in
  reverse order. It may follow withdrawal or clean unpublished partial staging. It may start from
  quantity zero and never targets Media.
- **Terminal absence** is a current-evidence conclusion, not erasure. Historical IDs remain
  append-only. Media may still exist or expire independently. Any incomplete final read leaves the
  aggregate in cleanup/recovery, not terminal absence.

Sandbox observation supports the MVP cleanup-from-zero path, but selector disappearance,
out-of-stock display, revision capacity, and post-sale behavior are not universal production eBay
guarantees. Later scale, account/category, order, and production gates may narrow allowed actions;
they must not weaken identity retention, no-blind-replay, ownership, or sold-erasure protections.

## Configurable MVP admission cap

Group-size admission is an application-service policy, not an aggregate identity, database column,
or eBay constant. Initial configuration accepts integer `2` or `3` (default `2`); validation still
requires at least two variations only for `publish-ready`/publish and rejects an add operation above
the configured value before any remote work. Intake may persist zero or one variation while a card is
being built. Existing aggregates remain loadable when configuration changes.

Later recorded scale evidence may raise the maximum by changing validation/configuration only.
UUID identities, SKU grammar, ordered-variation persistence, complete payload construction, and exact
set reconciliation do not change. The initial range is deliberately not described as an eBay
platform maximum.

## Field ownership

| Field | Owner | Inventory/Media placement and reconciliation |
| --- | --- | --- |
| Application group ID | Group | Canonical UUID; aggregate identity, never reused |
| Group key | Group remote key | `VL-G-<GROUP_UUID_HEX>` Inventory URI identity; retain historically after cleanup |
| SKU category/token and next serial | Group allocation namespace | `sku_category_code`, `sku_bucket_token`, and monotonic `next_inventory_serial`; allocator-only high-water mutation |
| Revision watermarks | Group local state | `desired_revision` increments once per committed aggregate mutation; `last_confirmed_revision` is YP2.5 confirmation; pending is derived, with no snapshot/digest here |
| Title, description | Group | Group fields; omitted from child product and offer description payloads |
| Variation-specific card metadata | Variation/application | Gemini-derived or reviewed facts retained per variation; may differ and may be omitted from eBay |
| Common eBay aspects | Derived group projection | `InventoryItemGroup.aspects`; only normalized values truthful/common to every variation; optional/recommended heterogeneous values omitted; required no-common value blocks/regroups |
| Selector name and ordered values | Group/application | Canonical custom `Card` only; `variesBy.specifications`; display/mapping order |
| Complete child membership | Group | `variantSKUs`; exact set reconciliation, not remote response order |
| Image-pivot selector | Group | `variesBy.aspectsImageVariesBy` |
| Group images | None for MVP | Omit group-level `imageUrls` |
| Category, marketplace, format, location, policies | Group invariant | Repeat identically on child offers where required |
| Condition tier, minimum token, and descriptors | Group invariant | Repeat the eBay contract identically; available-copy token rank must meet or exceed the group minimum |
| Application variation ID | Variation | Canonical UUID; variation and selector identity, independent of position |
| Position | Group ordered collection | Unique contiguous application order; never reconstructed remotely |
| Variation SKU | Variation inventory/remote key | Existing structured SKU convention extended to `<category-prefix>-<bucket-token>-<six-digit-inventory-serial>` (for example `BSKBL-McGrady-000241`); immutable, searchable for physical order pulling, and shared by duplicate copies of the same variation |
| Selector value | Variation | Exact singleton custom-`Card` `product.aspects[selectorName]`; unique and immutable within group |
| Physical-copy ID | Copy/application | Immutable UUID for one actual card; belongs to exactly one variation and never becomes an eBay SKU |
| Copy front/back images | Copy | Application/R2 references for every physical copy; retained independently of eBay representation |
| Copy condition | Copy/application | Exact normalized token `NEAR_MINT_OR_BETTER`, `EXCELLENT`, `VERY_GOOD`, or `POOR`; available rank must meet/exceed the group's minimum token |
| Copy availability | Copy/application | Source of truth for sellable physical inventory; sold/unavailable evidence is retained |
| Representative copy | Variation/application | Exactly one copy supplies the variation's eBay image pair; first copy defaults, later changes are explicit |
| Representative front/back EPS images | Variation remote projection | Seller EPS URLs in exact `product.imageUrls: [front, back]` order from the representative copy |
| Media identity and expiry | Representative-image support resource | Opaque eBay identity; separate from Inventory cleanup and from non-representative copy images |
| Quantity | Derived variation projection | Exact count of copies with `availability_state = available`; no competing quantity column |
| Price | Variation | Offer pricing summary |
| Offer ID | Variation remote history | Read-back identity retained after deletion |
| eBay listing ID | Group remote history | Publish identity retained after final absence |

## Derived MVP design choices

- Persist one canonical ordered variation/selector sequence. Build selector values, child payloads,
  and complete group replacements from it; reconcile remote group membership as a set.
- Persist every physical copy and its front/back application image references independently from
  the variation/SKU. Persist representative-image Media ownership separately from Inventory resources,
  including exact trusted returned identity, role, variation/copy association, creation outcome, and
  expiry evidence. Do not imply that Inventory deletion deletes Media or that every copy is uploaded
  to eBay Media.
- Model historical remote identities separately from current lifecycle and absence evidence.
- Derive quantity from eligible available physical copies. Treat derived zero as an unavailable-variation
  state and support cleanup from it without an artificial restore transition.
- Enforce the configurable two-or-three-variation admission cap at the application-service boundary.
  It is a safety choice, not a persisted aggregate property or platform maximum.
- Keep variation listing persistence, jobs, routes, reconciliation, UI, and SKU rules isolated from
  existing Single/Lot behavior. Implement the lifecycle and recovery contract without widening
  legacy listing state.

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
In particular, its `Card Selection` fallback records historical harness compatibility only; the active
production persistence/payload contract is exact immutable selector name `Card`. Do not widen YP2.2a
or later runtime schemas from that fallback.

## Unresolved limits and later evidence gates

- Effective group size, selector-value, image-count, revision, and performance limits beyond the
  initial two-to-three-variation cap. Current eBay documentation describes a general maximum of 250
  variations for a multiple-variation listing, but the application cap must be raised only through
  category/account-specific recorded scale evidence rather than hardcoding that ceiling.
- Whether the Sandbox results generalize to production accounts, categories, policies, Media
  processing, buyer rendering, and out-of-stock settings.
- Post-sale and order behavior: partial sales, oversell prevention, cancellations, returns,
  refunds, sold-history retention, and order-line reconciliation across variants.
- Safe mutation rules after sales, long-lived revision behavior, operational recovery UX, and
  support procedures at larger scale.
- Exact useful selector names and normalization behavior for other categories/accounts. The
  accepted pilot selector does not establish a universal taxonomy contract.
- The later operation-ledger representation of revision snapshots and remote operation evidence (YP2.5).
- A production-ready operational cap. The 87-value reference listing proves only that a universal
  30-value assumption is false; it does not establish this application's safe maximum.

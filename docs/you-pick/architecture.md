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
  lifecycle rules below, not an in-place rename.
- `inventoryItemGroupKey`, child `sku`, offer IDs, listing IDs, and Media IDs/URLs are remote
  identities or remote-facing keys. None replaces `groupId` or `childId` as application identity.

## You Pick remote-key and SKU grammar

Use a dedicated namespace derived only from the immutable application ID:

```text
inventory item group key: YP-G-<GROUP_UUID_HEX>
child SKU:               YP-C-<CHILD_UUID_HEX>
GROUP_UUID_HEX / CHILD_UUID_HEX: canonical UUID with hyphens removed and a-f uppercased
```

Both grammars are exactly 37 ASCII characters and match `^YP-[GC]-[0-9A-F]{32}$`. The child SKU
stays below eBay's documented 50-character SKU constraint. The 37-character group-key grammar is
an application contract; this document does not claim that the same documented maximum applies to
Inventory item group keys. Generation is a pure projection of the corresponding immutable UUID,
making retries deterministic; UUID uniqueness plus a database unique constraint and the existing
remote collision preflight provide collision defense. Once allocated, keys are immutable and never
reused even after terminal absence. Caller-supplied arbitrary keys, display-text slugs, child
positions, and mutable timestamps are invalid sources.

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
IDs, or ambiguous reads also fail closed under the recovery contract below.

## Lifecycle ownership and states

Lifecycle is aggregate-scoped; availability and sale protection are child-scoped. Remote operation
progress is checkpoint evidence, not a third lifecycle. Implementations may choose different stored
names, but must preserve these semantic states and may not derive one scope from another by label.

### Aggregate lifecycle

| State | Meaning and entry requirement | Allowed direction |
| --- | --- | --- |
| `intake` | Local group identity and ordered children are being assembled; no buyer-facing publication and no remote mutation started | complete required input to `draft`, or abandon |
| `draft` | Complete local aggregate exists but generation/review may be incomplete | edit, add/remove/reorder eligible children, advance to `review`, or abandon |
| `review` | Generated and seller-entered content is awaiting approval or correction | edit, return to `draft`, advance to `publish-ready`, or abandon |
| `publish-ready` | Full aggregate passes current admission, content, image, pricing, quantity, policy, and remote-collision validation | publish, edit back to `review`, or abandon if no remote resources require withdrawal |
| `publishing` | One or more staged remote publication operations have started, but active publication is not yet exactly reconciled | reconcile forward, retry only a proven no-op, withdraw if publication is found active, or recover/clean owned unpublished resources |
| `active` | Exact reads prove one buyer-facing listing with the complete intended group and unambiguous child offers | child price/quantity actions, reconcile, or withdraw |
| `withdrawn` | Publication history exists and exact current evidence proves no active listing; owned Inventory resources may remain | cleanup, or republish only through a separately validated publish-ready transition that preserves protected history |
| `abandoned` | Local intent ended without buyer-facing publication and exact evidence proves no owned Inventory resources remain; any attempted remote identities/history are retained | terminal for this local intent; no identity reuse or resumed publication |
| `cleanup` | Dependency-ordered Inventory removal is in progress; no create, edit, restore, publish, or sale-bearing mutation is allowed | reconcile/continue safe cleanup or reach `terminal-absent` |
| `terminal-absent` | Affirmative bounded reads prove final Inventory/listing absence; historical identities and Media evidence remain | terminal for these remote identities; no reuse or replay |
| `recovery-required` | Current evidence is unknown, mismatched, foreign, split, or otherwise unsafe for an automatic transition | bounded read-only reconciliation or operator-directed recovery only |

`recovery-required` records a fail-closed aggregate condition while retaining the last known normal
lifecycle. It must not be used to conceal whether publication, withdrawal, or cleanup had started.
A validation defect or known provider rejection before any effect may leave the aggregate in its
prior editable state instead of entering recovery.

### Child state and protections

Each child independently carries current intended quantity/availability plus append-only sale/order
evidence. Before publication, an eligible child is `draft`. In an active group, positive available
quantity is `available`; deliberate quantity zero is `unavailable`, not removed or deleted. A child
with evidence that at least one unit sold is `partially-sold` while legitimate remaining quantity
exists, and `sold` when no sellable quantity remains. Exact quantity arithmetic and order-payload
matching remain deferred to YP8.1/YP8.2.

- Aggregate `active` does not mean every child is available. Unavailable and sold-protected children
  remain aggregate members and retain immutable identity, selector value, position history, SKU,
  offers, Media, and order/sale evidence.
- Any credible order-line or sold evidence activates a permanent destructive-erasure guard for the
  child. Removing the child from current selection, deleting its local record, reusing its identity,
  deleting history, or treating remote absence as permission to erase it is forbidden.
- Until order matching is proven, conflicting, incomplete, or possibly child-relevant order evidence
  is conservative: block destructive child/group deletion and escalate. It does not authorize an
  inferred decrement, selector rewrite, or adoption.
- Unsold children may be removed only before remote publication work begins. Correcting an immutable
  selector value creates a new child and retires the old eligible child; it is never an in-place
  rename. After remote staging begins, membership change requires withdrawal, exact reconciliation,
  and the later explicit revision/republication contract—never omission from a group replacement.

## Actions and transition preconditions

| Action | Preconditions and result |
| --- | --- |
| Create | New immutable group/child UUIDs; valid ordered collection and admission cap; no remote work. Creates `intake`/`draft`. |
| Edit shared or child fields | `draft`/`review`; or an explicitly supported active price/quantity action. Immutable IDs, remote keys, selector identity/value, sale evidence, and publication history never change. Buyer-facing structural edits after staging require withdrawal and later revision rules. |
| Reorder | `draft`/`review`, all affected children unsold, and no remote publication operation started. Rewrites contiguous positions and selector order atomically. Remote array order never triggers it. |
| Add/remove child | `draft`/`review`, within cap/minimum, child unsold, and no remote staging. Removal is retirement of an un-published child, not identity reuse. Published/staged membership is never patched by omission. |
| Update price | Child belongs to exact reconciled aggregate. Before publish, edit in `draft`/`review`; while `active`, require supported full offer intent, exact before-read, sold guard evaluation, and post-read. Unknown outcome blocks replay. |
| Update quantity / set zero | Same ownership and reconciliation rules as price. Zero must update the intended child item/offer consistently and reconcile both; it enters child `unavailable` while retaining full group membership. It is not delete, withdraw, sold proof, or abandonment. |
| Restore quantity | Deliberate operator/user request only; current exact reads prove the child is unsold, owned, zero, and otherwise eligible, and the aggregate is `active`. Never automatic and never required before withdrawal or cleanup. |
| Post-sale child action | Any sold/order evidence freezes membership, identity, selector, position history, local record/history, and bound remote resources. Read-only reconciliation and safe aggregate withdrawal remain allowed; removal, reorder, rename, restore/increase, reprice, republish/revise, and destructive cleanup stay blocked unless later YP8.1/YP8.2 evidence and rules explicitly authorize the exact action. |
| Publish | `publish-ready`; all children have positive initial quantity, exact complete payloads, trusted Media results, collision reads prove intended keys absent or exact owned staged state, and no sold/recovery blocker exists. Enters `publishing`; only exact reconciliation enters `active`. |
| Retry/reconcile | Read-only reconciliation is allowed from any nonterminal remote-bearing state. Mutation retry requires exact proof that the prior attempt had no effect and remains bounded to that same immutable intent. Exact complete state reconciles forward. Any other state enters/retains `recovery-required`. |
| Withdraw | Required for a current active publication before Inventory deletion. Exact read proves ownership and a withdrawable listing lifecycle; success is exact read-back showing no active publication. A zero-quantity child does not block it. |
| Abandon | Local intent termination only before buyer-facing publication, or when exact reads prove no remote resources require withdrawal. Enter `abandoned` only when no owned Inventory resources remain; otherwise clean exact owned unpublished staging first. It is not a synonym for ending a published listing and cannot bypass sale guards. |
| Cleanup/delete | Aggregate is withdrawn, was never buyer-facing with exact proof no withdrawal is needed, or is eligible for cleanup directly from zero after withdrawal. Exact ownership/current-state reads and no sale/order guard are required before every destructive dependency. Enters `cleanup`; only final reads enter `terminal-absent`. |

No action is authorized merely because a UI/local status says it is allowed. The operation must load
one valid aggregate, evaluate current child protections, and reconcile every remote identity needed
for that action immediately before mutation.

## Failure and recovery classes

| Class | Classification | Automatic behavior |
| --- | --- | --- |
| Local validation defect | No remote call was constructed | Remain in prior editable state; correct intent and validate again |
| Known no-op/provider rejection | Definitive response and reads prove the intended mutation made no change | Record rejection; retry only if the defect is corrected and bounded rules still permit the same operation |
| Retryable transport failure with proven unchanged state | Transport failed, then complete authoritative reads exactly equal the recorded pre-state | At most one bounded replay of identical intent; otherwise stop |
| Ambiguous mutation outcome | Timeout, disconnect, malformed/partial response, or reads cannot prove exact pre- or post-state | `recovery-required`; no blind replay, compensating mutation, or destructive cleanup |
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
| Media ingest per child/role | Confirm only from one trusted returned opaque Media ID and seller EPS URL bound to the exact child/role/source. Unknown identity is non-replayable. |
| Child inventory-item write | Exact SKU read matches complete intended item, group association, selector singleton, shared condition, images, and quantity. Exact absence/pre-state may permit bounded create/replace; semantic mismatch stops. |
| Child offer write | Exact offer read/list-by-SKU proves one owned marketplace offer with intended SKU, policies, location, price, quantity, and unpublished/published binding expected at that stage. Duplicate/foreign offers stop. |
| Complete group replacement | Exact group read has expected invariants and exact unordered SKU membership; selector values/order are checked against application intent, not remote SKU array order. Never patch by omission. |
| Group publish | Exact group/offers reads prove every child offer belongs to one common listing with compatible active lifecycle. Existing exact published state confirms forward; exact unpublished pre-state alone may allow one bounded replay. |
| Price/quantity revision | Exact child item and offer before/after reads prove the same owned child and consistent intended values. Partial or conflicting application is unknown/mismatch, not permission to repeat. |
| Withdrawal | Exact pre-read proves the owned active group/listing; completion requires all intended offers/listing evidence in a compatible non-active state. Unknown or split state blocks retry and cleanup. |
| Dependency-ordered cleanup | For each dependency, read ownership/current state, delete exact owned offer(s), then group, then unsold/unprotected child item(s); confirm absence after each step. A missing dependency is complete only when the exact read is authoritative. Media is excluded. |
| Final absence | Bounded affirmative reads prove listing, every historical/targeted offer, group key, and every child SKU absent. Only then enter `terminal-absent`; auth, timeout, malformed, partial, or mismatched reads remain unknown. |

Cleanup may start with one or more unsold children already at zero and must not restore them. If any
child has sold/order evidence, cleanup may withdraw the buyer-facing group, but must not delete that
child's item, offer, identity, or history under the current contract. It may remove only other exact
resources that later order-safe rules affirm are independent and destructible; it cannot claim
whole-aggregate terminal deletion while protected history/resources require retention. Exact
post-sale remote mechanics stay deferred to YP8.1 and production proof.

## Abandonment, withdrawal, cleanup, and terminal state

- **Abandon** ends unpublished local intent. It is valid before buyer-facing publication or after
  exact reconciliation proves that no active remote resource requires withdrawal. Unknown remote
  state is not proof that abandonment is local-only. Untouched local intent may enter `abandoned`
  directly; staged unpublished resources require cleanup and final-absence evidence first.
- **Withdraw** ends buyer-facing availability while retaining aggregate, children, remote resources,
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
- The later persistence representation of this lifecycle and operation evidence (YP2.1/YP2.5).
- A production-ready operational cap. The 87-value reference listing proves only that a universal
  30-value assumption is false; it does not establish this application's safe maximum.

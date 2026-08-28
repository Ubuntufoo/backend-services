# Variation listing item-specific ownership for category 261328

## Evidence scope

This record closes YP1.4 for `EBAY_US`, category tree `0`, leaf category `261328`
(Sports Trading Card Singles). The live metadata observation was read-only against the
Sandbox endpoints on 2026-08-27. It recorded the exact endpoint shapes and sanitized
summaries only; credentials and raw responses are not retained. It is Sandbox metadata,
not production metadata.

- Taxonomy: `GET /commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=261328`
- Metadata: `GET /sell/metadata/v1/marketplace/EBAY_US/get_listing_structure_policies?filter=categoryIds:{261328}`
- `ListingStructurePolicy` returned `variationsSupported=true`.
- Taxonomy returned 30 aspects. The tables below record all 30 sanitized constraint rows; no
  omitted aspect creates a supported hidden variation-specific channel.

The metadata fields have different meanings. `aspectRequired` and `aspectUsage` describe
listing completeness; `aspectDataType`, `itemToAspectCardinality`, and
`aspectApplicableTo` describe value shape/catalog classification; and
`aspectEnabledForVariations` indicates whether an aspect may identify a variation. An
`ITEM`/`PRODUCT` value is classification metadata, not permission to bypass the variation listing
ownership rules below.

## Category metadata (sanitized)

`FT` = free text; `SELECTION_ONLY` = taxonomy selection; `SINGLE`/`MULTI` = cardinality.
`*` on Sport means `aspectRequired=true` while eBay reports
`aspectUsage=RECOMMENDED` (the documented representation for a required aspect).
`—` means the sanitized read did not return an `aspectApplicableTo` value for that row;
`PRODUCT` and `ITEM` are recorded only where returned; the latter appears on the additional
autograph-related rows below.

| Aspect | Status | Shape | Applicable to | `variationEnabled` | variation listing treatment | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Sport | **Required*** | FT, MULTI | — | false | Variation metadata; project one truthful common value set, otherwise block/regroup | Live Taxonomy + derived contract |
| League | Recommended | FT, MULTI | — | false | Variation metadata; project only values common to every variation; omit if heterogeneous | Live Taxonomy + derived contract |
| Set | Recommended | FT, SINGLE | PRODUCT | false | Variation metadata; project one common value; omit if heterogeneous | Live Taxonomy + derived contract |
| Manufacturer | Recommended | FT, SINGLE | PRODUCT | false | Variation metadata; project one common value; omit if heterogeneous | Live Taxonomy + derived contract |
| Player/Athlete | Recommended | FT, MULTI | — | false | Variation metadata; project only common values; omit if heterogeneous | Live Taxonomy + derived contract |
| Team | Recommended | FT, MULTI | — | false | Variation metadata; project only common values; omit if heterogeneous | Live Taxonomy + derived contract |
| Card Number | Recommended | FT, SINGLE | PRODUCT | false | Variation metadata; project one common value; omit if heterogeneous | Live Taxonomy + derived contract |
| Year Manufactured | Optional | SELECTION_ONLY, SINGLE | — | false | Variation metadata; project one common value when common; otherwise omit | Live Taxonomy + derived contract |
| Season | Recommended | FT, SINGLE | — | false | Variation metadata; project one common value; omit if heterogeneous | Live Taxonomy + derived contract |
| Original/Licensed Reprint | Optional | SELECTION_ONLY, SINGLE | — | false | Variation metadata; project one common value; omit if heterogeneous | Live Taxonomy + derived contract |
| Vintage | Optional | SELECTION_ONLY, SINGLE | PRODUCT | false | Variation metadata; project one common value when common; otherwise omit | Live Taxonomy + derived contract |
| Features | Recommended | FT, MULTI | — | false | Variation metadata; project only values common to every variation; omit heterogeneous values | Live Taxonomy + derived contract |
| Parallel/Variety | Recommended | FT, SINGLE | PRODUCT | false | Variation metadata; project one common value; omit if heterogeneous | Live Taxonomy + derived contract |
| Card Name | Recommended | FT, SINGLE | — | false | Variation metadata; project one common value; omit if heterogeneous | Live Taxonomy + derived contract |
| Type | Recommended | SELECTION_ONLY, SINGLE | PRODUCT | false | Variation metadata; project one truthful common value; omit if heterogeneous | Live Taxonomy + derived contract |
| Print Run | Optional | FT, SINGLE | PRODUCT | false | Variation metadata; project one common value when common; never guess a denominator | Live Taxonomy + derived contract |
| Language | Optional | FT, SINGLE | PRODUCT | false | Variation metadata; project one common value when common; otherwise omit | Live Taxonomy + derived contract |
| Customized | Optional | FT, SINGLE | — | **true** | Variation metadata/common group projection only; not the Card selector or a second pivot | Live Taxonomy + derived contract |

Additional returned aspects:

| Aspect | Status | Shape | Applicable to | `variationEnabled` | variation listing treatment | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Autograph Authentication | Optional | SELECTION_ONLY, SINGLE | ITEM | false | Variation metadata; project one common value when common; otherwise omit | Live Taxonomy + derived contract |
| Autograph Authentication Number | Optional | FT, SINGLE | ITEM | false | Variation metadata; project one common value when common; otherwise omit | Live Taxonomy + derived contract |
| Autograph Format | Optional | FT, SINGLE | ITEM | false | Variation metadata; project one common value when common; otherwise omit | Live Taxonomy + derived contract |
| Autographed | Recommended | SELECTION_ONLY, SINGLE | ITEM | false | Variation metadata; project one truthful common value; omit if heterogeneous | Live Taxonomy + derived contract |
| California Prop 65 Warning | Optional | FT, SINGLE | — | false | Variation metadata; project one common value when applicable; otherwise omit | Live Taxonomy + derived contract |
| Card Size | Optional | FT, SINGLE | — | false | Variation metadata; project one common value when known; otherwise omit | Live Taxonomy + derived contract |
| Card Thickness | Optional | FT, SINGLE | — | false | Variation metadata; project one common value when known; otherwise omit | Live Taxonomy + derived contract |
| Country of Origin | Optional | SELECTION_ONLY, SINGLE | — | false | Variation metadata; project one common value when known; otherwise omit | Live Taxonomy + derived contract |
| Event/Tournament | Optional | FT, SINGLE | PRODUCT | false | Variation metadata; project one common value when known; otherwise omit | Live Taxonomy + derived contract |
| Insert Set | Optional | FT, SINGLE | PRODUCT | false | Variation metadata; project one common value when known; otherwise omit | Live Taxonomy + derived contract |
| Material | Optional | FT, MULTI | PRODUCT | false | Variation metadata; project only values common to every variation; omit heterogeneous values | Live Taxonomy + derived contract |
| Signed By | Optional | FT, MULTI | ITEM | false | Variation metadata; project only values common to every variation; omit heterogeneous values | Live Taxonomy + derived contract |

All requested named sports-card fields reported `aspectEnabledForVariations=false`.
Across all 30 returned aspects, `Customized` was the sole variation-enabled taxonomy aspect in
this read. Its technical eligibility does not make it the application selector.

## Ownership contract

The persistence boundary for these layers is explicit: variation-specific facts are stored in
`variation_listing_variations.variation_metadata`; the recomputed truthful group projection is stored
in `variation_listing_groups.derived_common_ebay_aspects`; and neither is copied into physical-copy
rows or used as a hidden eBay variation axis. The four-table persistence design (including revision
watermarks and durable intake sessions) is authoritative for storage mechanics; this document remains
authoritative for category-aspect ownership and projection semantics.

The contract has three explicit layers:

1. **Application variation metadata.** Each variation retains Gemini-derived or human-reviewed
   card-specific facts (for example Player/Athlete, Team, Year/Season, Set, Card Number,
   Parallel/Insert, League, Manufacturer, autograph facts, and other evidence). These facts
   may differ freely between variations and remain available for persistence, review, UI, and
   selector construction even when they are not emitted to eBay. They are not a license to add
   arbitrary child `product.aspects`.
2. **eBay common group aspects.** `InventoryItemGroup.aspects` is a derived projection, not the
   source of truth for variation metadata. For each taxonomy aspect, emit only a normalized value
   or value set truthfully common to every variation. Optional/recommended aspects with heterogeneous
   values, or with no common known value, are omitted; values are never unioned, falsified, or
   removed from application metadata to manufacture commonality. A required aspect that cannot
   be satisfied by one truthful common value/set blocks publication or requires regrouping.
   Taxonomy `ITEM` versus `PRODUCT` classification does not change these ownership rules.
3. **eBay child variation.** The MVP has exactly one buyer-facing varying dimension: the proven
   custom `Card` selector. Its exact singleton value appears in every child `product.aspects`; the
   same name and ordered values appear in group `variesBy.specifications`; and the group repeats
   the name in `variesBy.aspectsImageVariesBy`. No Player, Team, Card Number, Year, Set,
   Parallel/Variety, or other hidden child aspect is an additional pivot. This is existing
   Sandbox buyer-visible selector/image proof, not a claim that every custom aspect is accepted in
   every category or account.

`Customized` is not the card identity selector. If present in variation metadata, it can enter the
derived common group projection under the same truthfulness rules, but it is never a second pivot
without a separately reviewed contract and buyer need.

## Heterogeneous-card rule

Cards may be intentionally heterogeneous when a merchandising theme and the three-layer
contract hold. A difference in Player/Athlete, Team, Card Number, Year/Season, Set,
Parallel/Variety, or any other optional/recommended taxonomy fact does **not** automatically
split the group. Examples valid under this rule include Tracy McGrady mixed cards, 2003 Topps
Basketball cards across different players and card numbers, and 1995 Fleer Ultra Gold Medallion
inserts across different players and card numbers.

Before persistence/publication, retain each variation's normalized metadata and derive the group
projection independently. For SINGLE aspects, project one value only when every variation has the same
truthful value. For MULTI aspects, project only the values present for every variation (set
intersection), never a union. If an optional/recommended aspect is heterogeneous or unknown, omit
it from `InventoryItemGroup.aspects`; do not erase or replace the differing variation facts. If a
required aspect has no truthful common value/set (including required `Sport`), block publication
or regroup into compatible groups. A theme may define group membership when these required/common
projection and single-`Card` selector contracts pass.

No extra child product aspects may be used as hidden metadata channels, and no additional
buyer-facing variation dimensions may be invented. The custom `Card` selector remains the sole
child eBay variation.

## Official sources

- [Creating and managing inventory item groups](https://developer.ebay.com/api-docs/sell/static/inventory/inventory-item-groups.html)
- [Listing Creation guide](https://developer.ebay.com/develop/guides/sell/listing-creation)
- [Inventory API error details](https://developer.ebay.com/api-docs/sell/static/inventory/inventory-error-details.html)
- [AspectConstraint](https://developer.ebay.com/api-docs/sell/taxonomy/types/txn%3AAspectConstraint)
- [AspectApplicableToEnum](https://developer.ebay.com/api-docs/sell/taxonomy/types/txn%3AAspectApplicableToEnum)
- [ListingStructurePolicy](https://developer.ebay.com/api-docs/sell/metadata/types/sel%3AListingStructurePolicy)

The existing [Sandbox pilot](sandbox-pilot.md) records the custom `Card` selector and
`aspectsImageVariesBy` buyer-visible proof. It remains the source for that one selector
decision; this document adds the category metadata and persistence ownership boundary.

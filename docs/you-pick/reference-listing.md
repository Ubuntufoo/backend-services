# You Pick reference listing evidence

Observed read-only on 2026-08-03 at canonical item URL
[`285274212401`](https://www.ebay.com/itm/285274212401). Page behavior is buyer-facing
evidence only; it does not reveal which seller API created the listing.

## Directly observed

- Category: Sports Trading Card Singles (`261328`).
- Listing condition: `Ungraded - Near mint or better`. It is displayed once above the
  selector, not per selection.
- Selector: `Sticker #` with 87 distinct values. At observation time, 78 were available
  and 9 were disabled as `(Out of stock)`.
- Price: the unselected listing showed US $1.50. Selecting `#10` and `#11` each showed
  US $1.50. This proves the two sampled selections' prices, not that every selection has
  the same price.
- Gallery: 182 pictures. Selecting `#10` moved the active gallery position to picture
  11; selecting `#11` moved it to picture 13. The two-position step is strong evidence
  that these selectable cards expose paired images. The visible page does not label the
  pair as front/back, so exact role and ordering remain an inference pending a sandbox
  payload/read-back test.

## Practical condition rule

The initial sports-card workflow owns condition at group level. Every included card must
satisfy the selected group condition tier and descriptors. A card that needs a different
condition tier belongs in another group. Per-card notes may describe card-specific detail,
but must not contradict the shared condition.

## Limit interpretation

The observed 87 selector values disprove a universal 30-value operational cap for this
buyer surface. It does not establish a new universal limit. Keep four separate facts:

1. Observed: this listing exposed 87 values and 182 pictures.
2. Documented Trading API guidance: eBay's Trading API multiple-variation guide currently
   describes up to 250 variations, five variation dimensions, and 30 values per dimension.
   These are not established as a universal Inventory API submission contract.
3. Category/account-specific: Metadata `variationsSupported`, accepted selector aspects,
   account eligibility, and effective limits can vary.
4. Sandbox-proven: only an isolated reversible pilot can establish what this application's
   account, category, selector payload, and image payload actually accept.

Official references:

- [Multiple-variation listings](https://developer.ebay.com/api-docs/user-guides/static/trading-user-guide/variations.html)
- [ListingStructurePolicy](https://developer.ebay.com/api-docs/sell/metadata/types/sel%3AListingStructurePolicy)

No fixed group-size constant should be introduced before sandbox evidence and an explicit
operational cap decision.

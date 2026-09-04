# Variation order reconciliation evidence (YP8.1)

## Evidence status

This run has generated-contract evidence and synthetic fixtures only. A bounded read with the configured Sandbox credentials for creation dates 2026-08-01 through 2026-08-12 returned `{"orders":[]}`; no qualifying purchased variation order payload was available, so real-payload proof remains pending. No eBay, Supabase, or local persistence mutation was performed.

## Fulfillment contract

The generated `sellFulfillmentV1Oas3` `Order` type exposes:

- `orderId?: string`: eBay documents this as always returned and the unique order identifier.
- `lineItems?: LineItem[]`: the details for every line in the order.

Each generated `LineItem` exposes these candidate identity/matching fields:

- `lineItemId?: string`: eBay's unique order-line identifier, created when the buyer commits to buy.
- `sku?: string`: seller-defined inventory SKU.
- `quantity?: number`: units grouped by one `lineItemId`; generated as an optional int32.
- `legacyItemId?: string` and `legacyVariationId?: string`: legacy listing/variation identifiers.
- `variationAspects?: NameValuePair[]`: variation aspect name/value pairs for multi-variation purchases.

Titles, prices, buyer/payment/shipping fields, aspect labels, and response position are not identity evidence. The parser requires `orderId`, `lineItemId`, `sku`, and a positive int32 `quantity`; it preserves their exact text and ignores every other field. It sorts parsed lines by exact `lineItemId` so response order cannot affect evidence.

## Sanitized example

```json
{
  "orders": [
    {
      "orderId": "SANDBOX-ORDER-001",
      "lines": [
        {
          "orderId": "SANDBOX-ORDER-001",
          "lineItemId": "SANDBOX-LINE-001",
          "sku": "261328-BUCKET-000001",
          "quantity": 2,
          "idempotencyKey": "[\"SANDBOX-ORDER-001\",\"SANDBOX-LINE-001\"]"
        }
      ]
    }
  ]
}
```

The example contains no buyer, address, contact, payment, tracking, token, or raw response data.

## Matching and idempotency contract

`parseVariationOrderEvidence` is a pure fail-closed parser. `matchVariationOrderEvidence` receives that evidence and an explicit local variation SKU collection; it performs exact string equality only:

1. exactly one local entry with the line SKU returns `matched` and that SKU;
2. zero entries returns `unresolved` (`sku_not_in_local_variations`);
3. more than one entry returns `ambiguous` (`duplicate_local_sku`) and never returns a match.

The proposed smallest stable idempotency identity is the ordered tuple `(orderId, lineItemId)`, exposed as a JSON-encoded `idempotencyKey`. `quantity` is line data, not identity. This recommendation is grounded in the generated contract's unique line-item description, but a real order must still be observed before treating that stability as a global operational guarantee.

Re-reading or replaying the same proven order-line identity is a no-op in YP8.2. YP8.1 exposes the key but does not persist seen-state. A duplicate `lineItemId` inside one parsed order is surfaced as corruption and rejected.

Each line in a partial or multi-line order is matched independently. An unresolved/non-variation line cannot mark a matched variation line twice or affect another listing. Different variation SKUs remain separate line identities. `quantity > 1` remains one line identity with its quantity; YP8.1 does not assign speculative physical copies.

The parser rejects missing/blank `orderId`, `lineItemId`, or `sku`; non-object lines; missing/empty `lineItems`; duplicate line IDs; and zero, negative, fractional, non-finite, or out-of-range int32 quantities. Unknown remote/order state is therefore unresolved rather than guessed.

## Read-only diagnostic

`services/sidecar/src/scripts/inspect-variation-listing-order.ts` uses only `FulfillmentApi.getOrder` for `--order-id`, or `getOrders` for an explicitly narrow `creationdate:`, `lastmodifieddate:`, or `orderfulfillmentstatus:` filter. It rejects no-target and broad-filter invocations, bounds filtered reads to 50 orders, and prints only parser output. Raw eBay responses are never logged or written.

Example (after an operator has an exact Sandbox order ID):

```sh
pnpm --filter sidecar exec tsx src/scripts/inspect-variation-listing-order.ts --order-id SANDBOX-ORDER-001
```

## YP8.2 handoff

After real-payload review, YP8.2 may persist the exact order-line idempotency key, eBay order/line identifiers, exact SKU, quantity, and an explicitly owned local variation reference, with uniqueness enforcing replay no-op. It may then reconcile sold state and availability under its reviewed schema. No persistence, migration, copy decrement, or cleanup change belongs in YP8.1.

## Remaining evidence gap

The configured Sandbox credentials were available, but the bounded 2026-08-01 through 2026-08-12 read returned no orders and therefore no qualifying variation purchase. An operator must create/complete one authorized Sandbox purchase against an existing variation listing, then run the diagnostic with its exact order ID and review the sanitized output. Until that evidence exists, YP8.1 remains evidence-pending and YP8.2 stays blocked.

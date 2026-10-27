# C2BRemoval01 read-only recovery preflight

Date: 2026-10-25 EDT / 2026-10-26 UTC  
Scope: Sandbox and canonical hosted Supabase reads only  
Remote-state classification: **`EXACT_PRE`**

No eBay listing, Inventory Item, Offer, group, Supabase row, journal checkpoint, local image, R2 object, credential file, or running process was changed. OAuth refresh and Trading `GetUser` used POST because those protocols require it; every Inventory API request was GET-only.

## Identity and configuration proof

- Git began at clean `9eee3f6253e96f3a480f3684a3af774e2b658b4e`.
- Existing Sidecar health: healthy on `localhost:3002`, eBay enabled, HTTP OAuth disabled. It was not restarted or reconfigured.
- Root `.env` was used through the supported loader; `services/sidecar/.env` is absent. Values were never printed. Effective configuration was Sandbox, `EBAY_US`, `en-US`, REST/OAuth/Trading origin `https://api.sandbox.ebay.com`, and Supabase project `fmiliwxthjonjwywuqta`.
- A fresh access token was obtained from the existing Sandbox refresh token without using `EbaySellerApi.initialize()`, so no refreshed credential was persisted.
- Trading `GetUser`, using the same fresh token as the Inventory reads, returned public canonical `User.UserID` `testuser_variationbuyer`. Successful exact Inventory reads under that token establish that the inspected resources belong to that authenticated Sandbox seller. Commerce Identity mock data was not used.
- Sandbox Inventory GETs required both `Accept-Language: en-US` and `Content-Language: en-US`; omission of `Accept-Language` returned provider error 25709. The inspector now sends both.

## Canonical local and journal evidence

The required local GET returned group UUID `586051b7-970a-45bd-a53a-1d1a10285b42`, group key `VL-G-586051B7970A45BDA53A1D1A10285B42`, desired/confirmed revisions `6/5`, all three local SKUs, and latest revision `0f8a4786-12a3-45d9-b293-63e2a6318260` requiring reconciliation.

Canonical Supabase read-only evidence:

- frozen snapshot: v3, digest `602f38a42f0beb0f940a6f222c105ffa0914bbe0b0d3eff03a2830a0a6737727`, captured desired revision 6, exactly one `remove-group-membership` operation;
- frozen target: `BSKBL-C2BRemoval01-000001`, Offer `11951367010`, Item/Offer/sellable quantities `0/0/0`;
- frozen survivors: `BSKBL-C2BRemoval01-000002` / `11951368010` and `BSKBL-C2BRemoval01-000003` / `11951369010`, quantities `1/1/1` each;
- expected group: three SKUs and the corresponding three `Card` values;
- malformed frozen replacement: two survivor SKUs but all three `Card` values;
- checkpoints: attempt 1 `started`, then attempt 1 `unknown` with observed state `unknown`; no terminal c2 checkpoint;
- c2b retirement lookup: no row for the frozen revision.

The existing Retry path must not replay this revision. Current hydration rejects its malformed frozen replacement, and c2b preparation correctly requires a terminal c2 checkpoint.

## Authoritative Sandbox evidence

All Offer reads were unfiltered by marketplace and fully paginated. Each exact SKU returned one page with `total=1`, `size=1`, and no `next` URL; therefore no continuation host remained to follow or validate.

| Resource | Observed GET evidence |
|---|---|
| Group | HTTP 200; ordered SKUs `000002`, `000003`, `000001`; `Card` values are the corresponding frozen survivor B, survivor C, and target A values; shared aspects/title/description match the frozen pre-state; group `imageUrls` omitted |
| Target Item `000001` | HTTP 200; group key present; quantity 0; target `Card` value; two product images, host only `i.sandbox.ebayimg.com` |
| Survivor Item `000002` | HTTP 200; group key present; quantity 1; frozen B `Card` value; two product images on the same sanitized host |
| Survivor Item `000003` | HTTP 200; group key present; quantity 1; frozen C `Card` value; two product images on the same sanitized host |
| Target Offer `11951367010` | only Offer for target SKU; `EBAY_US`; `PUBLISHED`; available quantity 0; listing `110591443545`; listing status `OUT_OF_STOCK` |
| Survivor Offer `11951368010` | only Offer for survivor B; `EBAY_US`; `PUBLISHED`; available quantity 1; listing `110591443545`; listing status `ACTIVE` |
| Survivor Offer `11951369010` | only Offer for survivor C; `EBAY_US`; `PUBLISHED`; available quantity 1; listing `110591443545`; listing status `ACTIVE` |

The user's buyer-view observation that target A is hidden is secondary evidence only. It is consistent with the authoritative `OUT_OF_STOCK` Offer but cannot establish group membership.

## Classification

| Candidate | Required authoritative state | Result |
|---|---|---|
| `EXACT_PRE` | Three frozen group members and three selectors; all three Items still grouped; target Item/Offer quantity 0 and Offer published; survivors unchanged | **Match** |
| `EXACT_CORRECTED_POST` | Group and selectors contain only survivors; target Item exists at quantity 0 without group association; target Offer is unpublished; survivors unchanged | No match |
| `MIXED` | Any partial, foreign, drifted, or internally inconsistent provider state | No evidence |
| `UNKNOWN` | Seller/auth/read/pagination evidence incomplete | No; all required reads completed |

The HTTP 400/25082 response did not prove failure atomicity, but the later seller-verified reads prove that the current durable provider state is exact pre-state. They do not prove whether eBay transiently changed state between the failed request and these reads.

**A corrected group PUT is required to advance from the current `EXACT_PRE` state. It was not authorized or executed in this task. c2b must not start.**

## Minimal append-only repair design

Do not alter revision `0f8a...8260`, its snapshot/digest, or either checkpoint. The database uniqueness constraint on `(group_id, captured_desired_revision)` also prevents a second normal revision at desired revision 6. Add a separate service-role-only repair ledger linked to the original revision, seller identity, frozen snapshot digest, corrected payload digest, and CAS watermarks.

Recommended states:

1. `planned`: immutable lineage and corrected survivor projection persisted before any possible write.
2. `reconciled_post`: read-only proof found exact corrected post-state; no PUT occurred.
3. `started`: exact pre-state was freshly re-read under locks/CAS and durable intent was committed immediately before the sole PUT.
4. `confirmed_post`: authoritative group, all Item, and exhaustive all-marketplace Offer reads proved exact corrected post-state.
5. `unknown`: timeout, provider ambiguity, auth failure, incomplete pagination, foreign resource, or any mixed state; terminal for automatic execution and never a retry cue.

Case behavior:

- `EXACT_CORRECTED_POST`: record the seller-verified evidence and `reconciled_post`; do not PUT. Append the original c2 terminal checkpoint only through the existing guarded RPC and only after independently validating exact evidence `{listingId,targetSku,survivorSkus,state:'removed'}`.
- `EXACT_PRE` (current case): lock intake/group/revision in the existing order; recheck desired/confirmed revision, pending-removal identity, unchanged frozen parent, no c2b row, and no competing repair. Build the complete corrected payload from immutable SKU-to-selector/image evidence: survivor SKUs and exactly their two `Card` values, with all other frozen group fields. Persist `started`, perform at most one authorized corrected group PUT, then re-read the complete remote state. Any ambiguous response or non-exact result becomes `unknown`; never replay. Exact corrected post permits `confirmed_post` and then the guarded original c2 terminal append.
- `MIXED` or `UNKNOWN`: no PUT, terminal c2 checkpoint, c2b preparation, deletion, or local finalization. Require a new incident-specific plan.

Only after c2 is terminal may a separately authorized task call the existing c2b prepare flow. Preserve its durable `ready -> started -> unknown|confirmed_complete` boundary, write `started` before deletion, and require exact target Item plus exhaustive Offer absence before completion. The current c2b survivor verifier uses marketplace-scoped Offer reads while the preflight requirement is exhaustive all-marketplace coverage; repair or explicitly close that verifier gap before authorizing destructive c2b execution. Image cleanup remains a separate authorization.

Required repair tests:

- exact corrected post performs zero PUTs and can only finalize after complete evidence;
- exact pre performs exactly one corrected PUT after durable `started` and fresh CAS;
- timeout/5xx/invalid JSON/post-read mismatch transitions repair to `unknown` and a rerun performs no second PUT;
- selector/image/order drift, foreign SKU/Offer, wrong listing, quantity drift, incomplete pagination, changed seller, and concurrent revision all stop;
- c2b remains unavailable without the exact c2 terminal checkpoint;
- lock contention and repeated invocations are idempotent;
- original frozen revision/digest/checkpoints remain byte-for-byte unchanged.

## Provider caveats

eBay documents that replacing an existing Inventory Item Group requires the complete group payload and that omitted SKUs are removed. Its error guidance documents variation-specific mismatches and restricted-revise cases where a zero-quantity variation cannot be removed or variation specifics cannot be changed. These are general caveats, not proof that restricted revise caused this listing's response. Error 25082 is not present in the current published Inventory error-details page, so its exact meaning remains unconfirmed.

Official references: [Inventory Item Groups](https://developer.ebay.com/api-docs/sell/static/inventory/inventory-item-groups.html), [Inventory API error details](https://developer.ebay.com/api-docs/sell/static/inventory/inventory-error-details.html), [Trading GetUser identity](https://developer.ebay.com/api-docs/user-guides/static/trading-user-guide/user-mgmt-user-info.html).

## Next authorization

Next safe authorization is implementation-only: add and review the additive repair ledger/RPC, exact-state reconciler/executor, c2b survivor all-marketplace completeness fix, and focused tests, with no Sandbox write or hosted migration apply. After that code and migration are reviewed and the hosted additive migration is separately authorized/applied, a later explicit execution authorization must name this exact seller, group, revision, and permit one corrected Sandbox group PUT only after fresh `EXACT_PRE` proof. c2b retirement remains another separate authorization after exact corrected post and terminal c2 proof.

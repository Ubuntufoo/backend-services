# YP-FINAL.TEST-LISTING-DISPOSAL — gated execution result

**Status: BLOCKED — no destructive action executed.** Read-only preflight ran on 2026-11-19 ET / 2026-11-20 UTC and was repeated after the verifier repair on 2026-11-20. The operator authorization remains valid, but no group passed every remote identity, buyer-obligation, media-ownership and database gate. No eBay resource, R2 object, local image, Supabase row, schema object, Standard listing, order, source, test, script, migration, configuration or generated file was changed by the second attempt.

## 2026-11-20 verifier regression and autonomous preflight

- Independent review found no defect in the existing two-file verifier patch. Focused Vitest passed 16/16, Sidecar typecheck passed, and both backend and frontend `git diff --check` passed. No new code edit was needed or made.
- With process-only `EBAY_PUBLISH_ENABLED=false`, the Production verifier read all 27 groups and 63 current SKUs. It found 7 Inventory Item Groups, 18 Inventory Items, 18 Offers and 5 active listing IDs; the other 20 groups and 45 current SKUs were exact Production 404s. Result remained `NO-GO`, correctly, because five listings are active and six historical durable identities are malformed against current-SKU-only expectations.
- Exact direct Production reads mapped the five active listings: `800881949284` (ProductionOOSPilot01), `800918523252` (ProductionOOSPilot03), `800930537411` (ExternalZeroSmoke01), `800931080270` (PolicyCheck03), and `800939268048` (GeneratedDescripTest01). ProductionOOSPilot02 retains three unpublished Offers plus its Group/Items; WithdrawalSmoke01 retains two unpublished Offers plus its Group/Items. Every present Group had exactly the expected current `variantSKUs`; every present Offer was read directly by Offer ID. Trading GetItem independently returned exact IDs, active status and quantity sold 0 for all five active listings; WithdrawalSmoke01 listing `800930443657` returned exact identity, `Completed`, and quantity sold 0.
- Production Fulfillment pagination covered 2024-11-21 through the read time: 68 fulfilled/in-progress orders over two pages and zero target listing/SKU matches; the separate open/in-progress query returned zero. Payment-dispute summary returned 404, Post-Order returns returned 401 even with a fresh non-persisted Production token, and the repository has no exact listing-bound return/cancellation enumeration seam. These responses are `unknown`, not absence, so no listing was ended or remote resource deleted.
- Sandbox inspection remains blocked before any seller/resource read. The currently loaded root key/token set is Production; process-only Sandbox host/environment overrides return OAuth 401 `client authentication failed`. No credential value was printed, and no credential or environment file was edited or persisted.
- Hosted counts remain 27 groups, 63 variations, 65 copies, 85 revisions, 928 checkpoints, 4 removed-SKU retirements, 1 intake session, 1 C2B repair row, 1 C2B delete row, 207 Standard listings and 0 local orders. Both C2B rows remain `unknown`; all eight installed C2B mutation-guard triggers remain enabled.
- Media remains blocked. The 130 Variation front/back R2 keys are distinct, each belongs to one Variation group, and none is exactly or URL-path referenced by Standard listings or another group's revision snapshot. However, all 65 copy rows share capture source `iphone-capture-1`; R2 metadata/hash/owner, configured local roots, archives, symlink/hardlink ownership and delete-time identity remain unverified. No key/path is deletion-authorized.
- The data gateway exposes lifecycle/revision/journal operations but no aggregate-row purge. All relevant FKs use `NO ACTION`. Any physical Supabase row purge would require reviewed, explicit group-bound SQL or a migration after remote/media proof; that fresh code/SQL approval was neither needed for preflight nor requested. Published groups may use withdrawal only, never unpublished destructive cleanup. C2B remains additionally frozen by `VR003`.

Deletion totals: **0 listings ended; 0 Groups, Items or Offers deleted; 0 R2/local objects deleted; 0 Supabase rows deleted.** No read-after-write links exist because no write was attempted.

## Current per-group result

Legend: `P` = Production; `S` = Sandbox. `P absent` means exact current Group/Item/Offer reads returned 404 for all current identities; it does not substitute for Sandbox or buyer-obligation evidence. Media and database remain blocked for every nonempty group.

| Group ID | Local state | Authoritative remote result | Listing/Offer result | Buyer obligations | Media | Database | Action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `a563c046-07be-4c9c-bf2b-8f79237eaea3` | withdrawn | P absent; S unknown | durable `110591299629`; S unread | unknown | blocked | blocked | none |
| `64d8726e-ff18-449e-bdd2-3f67ff014fed` | active | P absent; S unknown | durable `110591374198`; S unread | unknown | blocked | blocked | none |
| `586051b7-970a-45bd-a53a-1d1a10285b42` | active | P absent; S OAuth 401 | C2B `110591443545`; S unread | unknown | blocked | `VR003` blocked | none |
| `32bb3c1c-1f31-4e91-918e-91196f201302` | active | P absent; S unknown | durable `110591475570`; S unread | unknown | blocked | blocked | none |
| `43165728-05ca-4315-90cd-a4d913093a70` | active | P absent; S unknown | durable `110591475875`; S unread | unknown | blocked | blocked | none |
| `3fe0d1fb-2323-4a88-916e-a9198b658270` | active | P absent; S unknown | durable `110591476144`; S unread | unknown | blocked | blocked | none |
| `75a59be0-0115-4be1-8e07-a72c7fdc68a5` | active | P absent; S unknown | durable `110591476270`; S unread | unknown | blocked | blocked | none |
| `d92dd52d-e817-449c-b957-e3b3e0acc36b` | active | P absent; S unknown | durable `110591479471`; S unread | unknown | blocked | blocked | none |
| `9203d8fb-8873-461d-a653-f893e557dfa2` | active | P absent; S unknown | durable `110591486626`; S unread | unknown | blocked | blocked | none |
| `1d80dacb-8cad-42a1-a327-ea7d4957be9d` | active | P absent; S unknown | durable `110591490975`; S unread | unknown | blocked | blocked | none |
| `920928e2-f9ab-4784-9361-6f677b7aea17` | active | P absent; S unknown | durable `110591497545`; S unread | unknown | blocked | blocked | none |
| `146de206-1edc-4d0e-b13f-d9a1ebde0694` | publish-ready | P absent; S unknown | no authoritative S identity | unknown | blocked | blocked | none |
| `06004db1-00d9-4a80-9b2e-edd8b48042a0` | publish-ready | P absent; S unknown | no authoritative S identity | unknown | blocked | blocked | none |
| `f7a9b77b-726a-4722-86d6-10412f787e1e` | publish-ready | P absent; S unknown | no authoritative S identity | unknown | blocked | blocked | none |
| `5f7d5962-7937-4d39-93bd-8291d21cbf7d` | publish-ready | P absent; S unknown | no authoritative S identity | unknown | blocked | blocked | none |
| `12ef1b89-a325-46c0-a848-5776608f1a55` | intake | P absent; S unknown | no authoritative S identity | unknown | blocked | blocked | none |
| `0f5fe2bb-82ba-420a-84c0-91c3e3b9804e` | publish-ready | P absent; S unknown | no authoritative S identity | unknown | blocked | blocked | none |
| `38f45c57-608e-40ad-bac3-95eeb8d74cb6` | active | P exact Group + 2 Items + 2 Offers | `800881949284` ACTIVE/PUBLISHED | orders clear; returns/disputes unknown | blocked | blocked | none |
| `73b96aa6-501a-4797-8d6a-2d4d9d3d2d21` | active | P exact Group + 3 Items + 3 Offers | current unpublished; historical `800918504847` | orders clear; returns/disputes unknown | blocked | published-history retention | none |
| `a865fa87-a9a2-44b4-b40f-772ed4c60dc7` | active | P exact Group + 4 Items + 4 Offers | `800918523252` ACTIVE/PUBLISHED | orders clear; returns/disputes unknown | blocked | blocked | none |
| `9193b4e0-235b-489a-a817-e17e178289fa` | abandoned | P Group absent; S unknown | zero-SKU; no Offer/Item | unknown | n/a | no native purge; S absence unknown | none |
| `378c728a-3e4c-427b-a9d8-8d96e1ff0cd9` | withdrawn | P exact Group + 2 Items + 2 Offers | `800930443657` Completed/sold 0; Offers unpublished | orders clear; returns/disputes unknown | blocked | retained withdrawn history | none |
| `27f5e67b-ce07-4c28-b9a5-2109802a8694` | active | P exact Group + 3 Items + 3 Offers | `800930537411` ACTIVE/PUBLISHED | orders clear; returns/disputes unknown | blocked | blocked | none |
| `c266befa-44fc-487d-bb04-f20c906999b8` | intake | P absent; S unknown | no authoritative S identity | unknown | blocked | blocked | none |
| `001e6af3-3356-45da-a899-89dea833a7ae` | intake | P absent; S unknown | no authoritative S identity | unknown | blocked | blocked | none |
| `ac5eab68-d300-4b5f-adb2-836edfeba1a5` | active | P exact Group + 2 Items + 2 Offers | `800931080270` ACTIVE/PUBLISHED | orders clear; returns/disputes unknown | blocked | blocked | none |
| `b1f81358-a4a3-4b5c-9468-fdbc0a33530e` | active | P exact Group + 2 Items + 2 Offers | `800939268048` ACTIVE/PUBLISHED | orders clear; returns/disputes unknown | blocked | blocked | none |

## First-attempt read-only evidence (superseded by the current result above)

- Hosted Supabase matched the manifest exactly: 27 groups, 63 variations, 65 copies, 85 revisions, 928 checkpoints, 4 removed-SKU retirements, 1 intake session, 1 C2B repair row, 1 C2B delete row, 207 Standard listings, and 0 local orders. Lifecycle counts remain 16 active, 2 withdrawn, 5 publish-ready, 3 intake, and 1 abandoned. Both C2B incident rows remain `unknown` for group `586051b7-970a-45bd-a53a-1d1a10285b42` / revision `0f8a4786-12a3-45d9-b293-63e2a6318260`.
- Production readiness passed only with the process-local safety override `EBAY_PUBLISH_ENABLED=false`. The native all-group verifier then loaded all 27 groups and 63 SKUs but stopped with `authoritative_counts_mismatch` before any group, Inventory Item, or Offer read. Its historical invariant rejects the legitimate zero-SKU abandoned group `9193b4e0-235b-489a-a817-e17e178289fa`; reported remote read counters were all zero.
- Purpose-built C2BRemoval01 Sandbox inspection failed closed at OAuth refresh. No Sandbox seller, group, Inventory Item, Offer, listing, order, return, dispute, or fulfillment evidence was obtained.
- Native Production listing inspection reported candidate listings `800881949284`, `800918523252`, and `800930443657` not found. This is listing-level evidence only; it does not prove absence or ownership of the corresponding Offers, Inventory Items, or Inventory Item Groups.
- Bounded Production fulfillment inspection for `NOT_STARTED|IN_PROGRESS` returned no orders on offset 0 / limit 50. This is not a complete historical order, return, cancellation, or dispute proof for every target.
- ProductionOOSPilot01's frozen read-only digest preflight rejected current group/revision state as changed. No stale mutation plan was used.
- Media evidence remains the inventory-time 130 unique front/back copy keys with zero exact overlap against `public.listings.r2_object_keys`. Full URL, snapshot, archive, local-file identity, other-writer, and delete-time R2 identity checks remain incomplete. No exact-key deletion authority was established.

## First-attempt per-group matrix (superseded)

Legend: `v/c/r/p/t` = variations/copies/revisions/checkpoints/removed-SKU retirements. `BLOCKED*` means the common all-group prerequisite failed: authoritative seller/environment plus complete group/SKU/Offer/listing and buyer-obligation reconciliation. Media and database deletion also remain blocked by incomplete ownership proof and the remote-terminal prerequisite.

| Group ID | Local state | Local dependencies | Candidate remote identity | Remote | Local rows | Media | Database | Exact blocker / next read-only action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `a563c046-07be-4c9c-bf2b-8f79237eaea3` | withdrawn | 2/3/3/33/0 | listing `110591299629`; env unverified | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Restore Sandbox access; resolve seller, group, 2 SKUs, Offers, terminal listing and obligations. |
| `64d8726e-ff18-449e-bdd2-3f67ff014fed` | active | 3/3/4/51/0 | listing `110591374198`; env unverified | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Restore Sandbox access; exact group/SKU/Offer/listing and obligation reads. |
| `586051b7-970a-45bd-a53a-1d1a10285b42` | active | 3/3/3/43/0 | Sandbox listing `110591443545` | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Sandbox OAuth failed; then reconcile frozen group/3 SKUs/3 Offers and both `unknown` incident rows. Never bypass `VR003` guard. |
| `32bb3c1c-1f31-4e91-918e-91196f201302` | active | 3/3/4/51/0 | listing `110591475570`; env unverified | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Restore Sandbox access; exact group/SKU/Offer/listing and obligation reads. |
| `43165728-05ca-4315-90cd-a4d913093a70` | active | 3/3/6/60/0 | listing `110591475875`; env unverified | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Restore Sandbox access; exact group/SKU/Offer/listing and obligation reads. |
| `3fe0d1fb-2323-4a88-916e-a9198b658270` | active | 3/3/6/61/0 | listing `110591476144`; env unverified | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Restore Sandbox access; exact group/SKU/Offer/listing and obligation reads. |
| `75a59be0-0115-4be1-8e07-a72c7fdc68a5` | active | 2/2/2/31/0 | listing `110591476270`; env unverified | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Restore Sandbox access; exact group/SKU/Offer/listing and obligation reads. |
| `d92dd52d-e817-449c-b957-e3b3e0acc36b` | active | 2/2/10/71/0 | listing `110591479471`; env unverified | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Restore Sandbox access; exact group/SKU/Offer/listing and obligation reads. |
| `9203d8fb-8873-461d-a653-f893e557dfa2` | active | 2/2/5/47/0 | listing `110591486626`; env unverified | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Restore Sandbox access; exact group/SKU/Offer/listing and obligation reads. |
| `1d80dacb-8cad-42a1-a327-ea7d4957be9d` | active | 2/2/2/29/0 | listing `110591490975`; env unverified | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Restore Sandbox access; exact group/SKU/Offer/listing and obligation reads. |
| `920928e2-f9ab-4784-9361-6f677b7aea17` | active | 2/2/3/35/0 | listing `110591497545`; env unverified | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Restore Sandbox access; resolve historical partial/unknown retirement evidence before mutation. |
| `146de206-1edc-4d0e-b13f-d9a1ebde0694` | publish-ready | 3/3/1/2/0 | not proven | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Inventory both seller environments by exact group key and 3 SKUs; prove no partial publication. |
| `06004db1-00d9-4a80-9b2e-edd8b48042a0` | publish-ready | 3/3/1/2/0 | not proven | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Inventory both seller environments by exact group key and 3 SKUs; prove no partial publication. |
| `f7a9b77b-726a-4722-86d6-10412f787e1e` | publish-ready | 3/3/1/2/0 | not proven | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Inventory both seller environments by exact group key and 3 SKUs; prove no partial publication. |
| `5f7d5962-7937-4d39-93bd-8291d21cbf7d` | publish-ready | 3/3/1/2/0 | not proven | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Inventory both seller environments by exact group key and 3 SKUs; prove no partial publication. |
| `12ef1b89-a325-46c0-a848-5776608f1a55` | intake | 1/1/0/0/0 | not proven | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Prove exact group key/SKU absent in both environments; complete media ownership proof. |
| `0f5fe2bb-82ba-420a-84c0-91c3e3b9804e` | publish-ready | 3/3/1/2/0 | not proven | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Inventory both seller environments by exact group key and 3 SKUs; prove no partial publication. |
| `38f45c57-608e-40ad-bac3-95eeb8d74cb6` | active | 2/2/10/96/2 | Production listing `800881949284` | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Listing read says absent, but frozen revision preflight is stale; reconcile exact group, 2 current SKUs, historical retired SKUs, Offers and obligations. |
| `73b96aa6-501a-4797-8d6a-2d4d9d3d2d21` | active | 3/3/1/35/0 | not proven | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Production candidate group lacks durable listing ID; resolve group/SKUs/Offers and buyer obligations directly. |
| `a865fa87-a9a2-44b4-b40f-772ed4c60dc7` | active | 4/5/16/163/2 | Production listing `800918523252` | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Listing read says absent; reconcile exact group, 4 current SKUs, retired SKU history, Offers and obligations. |
| `9193b4e0-235b-489a-a817-e17e178289fa` | abandoned | 0/0/0/0/0 | not proven | BLOCKED* | BLOCKED | n/a | BLOCKED | Zero-SKU group triggers native verifier mismatch; prove exact group key absent in both environments before scoped row removal. |
| `378c728a-3e4c-427b-a9d8-8d96e1ff0cd9` | withdrawn | 2/2/2/27/0 | Production listing `800930443657` | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Listing read says absent; reconcile exact group, 2 SKUs, Offers, terminal status and obligations. |
| `27f5e67b-ce07-4c28-b9a5-2109802a8694` | active | 3/3/1/35/0 | not proven | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Exact seller environment and remote identities absent from durable listing evidence; inspect both accounts. |
| `c266befa-44fc-487d-bb04-f20c906999b8` | intake | 1/1/0/0/0 | not proven | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Prove exact group key/SKU absent in both environments; complete media ownership proof. |
| `001e6af3-3356-45da-a899-89dea833a7ae` | intake | 1/1/0/0/0 | not proven | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Prove exact group key/SKU absent in both environments; complete media ownership proof. |
| `ac5eab68-d300-4b5f-adb2-836edfeba1a5` | active | 2/2/1/25/0 | not proven | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Resolve environment, group, 2 SKUs, Offers, listing and obligations directly. |
| `b1f81358-a4a3-4b5c-9468-fdbc0a33530e` | active | 2/2/1/25/0 | not proven | BLOCKED* | BLOCKED | BLOCKED | BLOCKED | Resolve environment, group, 2 SKUs, Offers, listing and obligations directly. |

## Safe continuation

1. Restore the canonical Sandbox credential path and rerun the non-persisting C2B read-only inspector successfully.
2. Use a reviewed read-only verifier that accepts the exact 27-group/63-SKU manifest, including the legitimate zero-SKU abandoned group, and performs complete paginated reads in both seller environments without changing source under this run.
3. Add complete open/processed order, fulfillment, cancellation, return and dispute checks bound to each listing/SKU; listing-level 404 is insufficient.
4. Freeze and verify every exact media key/path against all current references and writers. No recursive prefix deletion.
5. Only then create per-object CAS mutation plans. C2B incident resolution requires separate additive migration review if its installed guard still blocks cleanup; never disable or bypass it.

No operator mutation command is supplied because no object passed all gates.

## 2026-11-20 verifier repair — verified

Updated `services/sidecar/src/scripts/verify-variation-listing-live-status.ts` to remove obsolete fixed 10-group/53-SKU expectations and to accept an empty group **only** when its durable lifecycle is `abandoned`. Added exact count validation for group and per-group SKU Supabase reads, duplicate group/SKU identity checks, wrong-marketplace rejection and an empty-inventory fail-closed gate. Added focused tests in `services/sidecar/tests/unit/ebay/verify-variation-listing-live-status.test.ts`.

ChatGPT reviewed the resulting file diffs but could not run native pnpm tests through GPT Repo MCP. Codex independently reviewed the exact diff, ran the focused 16-test suite and Sidecar typecheck successfully, and exercised the verifier against live Production read-only state. This verifier is **Production-only**; Sandbox still requires separate authenticated read-only access. Passing local inventory validation does not authorize remote deletion or prove that a published listing has ended.

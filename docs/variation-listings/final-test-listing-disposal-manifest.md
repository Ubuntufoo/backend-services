# YP-FINAL.TEST-LISTING-DISPOSAL — Operator-authorized accelerated cleanup manifest

**Status: PRE-FLIGHT ONLY. No deletion yet.** User authorized removal of **all 27 Variation test listings/groups**, including C2BRemoval01, on 2026-11-19 ET (2026-11-20 UTC), superseding the earlier post-merge sequencing preference. This authorization does **not** permit deleting Standard Singles/Lots, shared image keys, unrelated listings, customer/order evidence, or retrying an unknown eBay mutation blindly.

## Read-only hosted inventory

- Shared Supabase project `fmiliwxthjonjwywuqta` (`ebay-inventory-manager`); the public Variation tables contain 27 groups, 63 variations, 65 copies, 85 revisions, 928 checkpoints, and 4 removed-SKU remote-retirement rows.
- Group lifecycles: 16 active, 2 withdrawn, 5 publish-ready, 3 intake, 1 abandoned. Lifecycle is **local DB state, not evidence of current eBay listing status**.
- Exact read-only `public.orders` count = 0; variation-SKU matches in local orders = 0. Does not prove absence of live eBay orders, returns, disputes, pending fulfillment, or buyers: fetch eBay authoritative records first.
- Every one of 65 physical-copy rows has front/back R2 keys. Unique keys = 130; exact intersection between keys and `public.listings.r2_object_keys` = 0 at inventory time. This is only one ownership check; full URL reference, stored snapshots, local archives, and cross-group identity must be checked before R2 removal.
- **Candidate listing IDs below are extracted from the most recent durable revision.** They are not authoritative eBay state or exhaustive remote identity, especially for V1/publish-ready and recovery-blocked groups. Codex must reconcile Offer, Inventory Item, group and published listing identity directly with eBay **in the correct environment/account**.

| Group ID | Local state | Variations | Copies | Revisions | Checkpoints | Candidate eBay listing ID |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `a563c046-07be-4c9c-bf2b-8f79237eaea3` | withdrawn | 2 | 3 | 3 | 33 | 110591299629 |
| `64d8726e-ff18-449e-bdd2-3f67ff014fed` | active | 3 | 3 | 4 | 51 | 110591374198 |
| `586051b7-970a-45bd-a53a-1d1a10285b42` | active | 3 | 3 | 3 | 43 | 110591443545 |
| `32bb3c1c-1f31-4e91-918e-91196f201302` | active | 3 | 3 | 4 | 51 | 110591475570 |
| `43165728-05ca-4315-90cd-a4d913093a70` | active | 3 | 3 | 6 | 60 | 110591475875 |
| `3fe0d1fb-2323-4a88-916e-a9198b658270` | active | 3 | 3 | 6 | 61 | 110591476144 |
| `75a59be0-0115-4be1-8e07-a72c7fdc68a5` | active | 2 | 2 | 2 | 31 | 110591476270 |
| `d92dd52d-e817-449c-b957-e3b3e0acc36b` | active | 2 | 2 | 10 | 71 | 110591479471 |
| `9203d8fb-8873-461d-a653-f893e557dfa2` | active | 2 | 2 | 5 | 47 | 110591486626 |
| `1d80dacb-8cad-42a1-a327-ea7d4957be9d` | active | 2 | 2 | 2 | 29 | 110591490975 |
| `920928e2-f9ab-4784-9361-6f677b7aea17` | active | 2 | 2 | 3 | 35 | 110591497545 |
| `146de206-1edc-4d0e-b13f-d9a1ebde0694` | publish-ready | 3 | 3 | 1 | 2 | not proven |
| `06004db1-00d9-4a80-9b2e-edd8b48042a0` | publish-ready | 3 | 3 | 1 | 2 | not proven |
| `f7a9b77b-726a-4722-86d6-10412f787e1e` | publish-ready | 3 | 3 | 1 | 2 | not proven |
| `5f7d5962-7937-4d39-93bd-8291d21cbf7d` | publish-ready | 3 | 3 | 1 | 2 | not proven |
| `12ef1b89-a325-46c0-a848-5776608f1a55` | intake | 1 | 1 | 0 | 0 | not proven |
| `0f5fe2bb-82ba-420a-84c0-91c3e3b9804e` | publish-ready | 3 | 3 | 1 | 2 | not proven |
| `38f45c57-608e-40ad-bac3-95eeb8d74cb6` | active | 2 | 2 | 10 | 96 | 800881949284 |
| `73b96aa6-501a-4797-8d6a-2d4d9d3d2d21` | active | 3 | 3 | 1 | 35 | not proven |
| `a865fa87-a9a2-44b4-b40f-772ed4c60dc7` | active | 4 | 5 | 16 | 163 | 800918523252 |
| `9193b4e0-235b-489a-a817-e17e178289fa` | abandoned | 0 | 0 | 0 | 0 | not proven |
| `378c728a-3e4c-427b-a9d8-8d96e1ff0cd9` | withdrawn | 2 | 2 | 2 | 27 | 800930443657 |
| `27f5e67b-ce07-4c28-b9a5-2109802a8694` | active | 3 | 3 | 1 | 35 | not proven |
| `c266befa-44fc-487d-bb04-f20c906999b8` | intake | 1 | 1 | 0 | 0 | not proven |
| `001e6af3-3356-45da-a899-89dea833a7ae` | intake | 1 | 1 | 0 | 0 | not proven |
| `ac5eab68-d300-4b5f-adb2-836edfeba1a5` | active | 2 | 2 | 1 | 25 | not proven |
| `b1f81358-a4a3-4b5c-9468-fdbc0a33530e` | active | 2 | 2 | 1 | 25 | not proven |

**Highest risk:** groups with Production-looking listing IDs `800881949284` and `800918523252` and a withdrawn Production-looking `800930443657`; other IDs `110591...` may be Sandbox; **do not classify environment by ID format alone**. Two C2BRemoval01 incident records remain `unknown` and one installed guard freezes mutation of their group/revision; do not bypass blindly.

## Destructive execution gates — all must pass per object

1. Establish exact live eBay account / environment / listing / group key / SKUs / Offer IDs and ownership for each of 27 groups. Inventory all remotes even if no durable listing ID exists (including partially published, unknown-recovery, and withdrawn states). Check open/processed orders, returns, disputes and outstanding fulfillment on **remote eBay**. Unknown/unavailable evidence = blocked per item, not permission to assume absent.
2. For each confirmed test-only listing, use supported eBay **end/withdraw** process and read-after-write verification. Never blind-retry ambiguous eBay mutations. Do not delete eBay resource identities before a proven terminal state; verify child/group/Offer/Inventory Item absence or expected retired state, and do not affect unrelated Standard offers.
3. Only after safe remote retirement and exact local image ownership proof, delete uniquely owned R2 objects and eligible local image artifacts using explicit keys/paths, with hashes/content checks where possible. No bucket/folder recursive delete, no generic prefix purge, no assumed URL-to-key mapping.
4. Only after remote and media checks, use **explicit group-ID-bound** database cleanup ordered around FK/trigger dependencies. Preserve Standard rows. The C2B incident-specific installed `unknown` guards may prevent normal deletion; do not disable/drop them without an independently reviewed, additive, narrowly scoped migration and evidence-preserving recovery plan. Never use unrestricted `DELETE FROM variation_listing_groups`, `TRUNCATE`, `CASCADE`, or blanket RLS/trigger disable.
5. Maintain per-group action checkpoints and post-action authoritative reads, stopping on any mismatch. Retain minimal, sanitized provenance and final manifest; exclude credentials, live user data and source-image bytes. No Git stage/commit/push. Confirm final count 0 only if every object and dependent remote/local/media resource is authoritatively gone. Any blocked group must remain intact with a reason.

## Known blockers before execution

- Live eBay remote state, orders/disputes/fulfillment and authoritative child/Offer identity have **not yet been checked** via connected eBay API.
- Hosted C2B incident-delete migration was applied but its local source file is missing. Both incident repair/delete rows are `unknown` and an installed guard prevents targeted mutations. No migration, trigger disable or forced transition is authorized by this manifest.
- Shared media ownership evidence is limited to exact Variation keys vs Standard `r2_object_keys`; full R2 source, current URL references, local archive and snapshot cross-reference checks are pending.
- Earlier roadmap prescribed disposal after feature merge/main baseline; operator explicitly requested accelerating removal now. Record this deviation and require the same safety conditions; **do not force a live eBay deletion solely to satisfy timing**.

**Next executor:** Codex in the two approved You Pick worktrees using native eBay credentials and scoped read-only preflight. Commit verified actions only for targets satisfying all checks; unknown remote results remain blocked and intact. Record each successful mutation and unmet gate in the result document.

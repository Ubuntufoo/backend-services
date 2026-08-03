# Reversible You Pick sandbox pilot

## Authority and hard stop

This is the operational design for a future Inventory API sandbox pilot. **This task is
no-write.** It must not call eBay, create remote resources, start a write-capable service,
or load production credentials. Finishing this document does not authorize sandbox execution
or production rollout.

The future pilot is limited to one run-scoped group containing two or three unsold, ungraded
sports cards in `EBAY_US` category `261328`. It must not read or mutate an existing Single or
Lot listing row, structured SKU, watcher intake, database record, object-storage object, job,
or remote listing. Inventory API owns every remote object created by the pilot; Trading API and
Seller Hub must not revise it.

## Objective and verdict

The pilot passes only if all of these are demonstrated in one fully cleaned run:

- one useful buyer-facing card selector with a unique value for every child;
- one shared compatible condition tier across all children;
- distinct child prices that map to the selected card;
- the selected card's front and back images, front first, without images from another child;
- successful publication with all child quantities positive;
- a post-publication quantity-zero revision that produces the expected unavailable selector;
- complete item, offer, and group API read-back;
- withdrawal and deletion of every pilot-owned offer, group, and inventory item; and
- verified absence of all run identifiers after cleanup.

Any technically accepted payload that produces an unclear selector, wrong price, wrong image
pair/order, mixed condition, or ambiguous resource ownership is a product failure. The run
stops at the first failed gate or experiment. It does not expand the fixture or improvise new
payload combinations.

## Run identity and ownership manifest

Generate one UTC run ID before loading credentials:

```text
runId:      20260803T143100Z-a1b2c3
groupKey:   YPSBX-20260803T143100Z-a1b2c3-G
child SKU:  YPSBX-20260803T143100Z-a1b2c3-C01  (then C02 and optional C03)
```

The six random lowercase hexadecimal characters make accidental collisions unlikely; the exact
remote absence gate below is the actual collision protection. The `YPSBX-` namespace is reserved
for this harness and deliberately does not match the existing structured Single/Lot SKU grammar.
Never accept a caller-supplied group key or child SKU outside the current run prefix. Do not reuse
an identifier, listing row, or resource found during preflight.

Persist a non-secret manifest at
`<repo>/.local/you-pick-sandbox/<runId>/manifest.json`. The harness implementation must add this
directory to local ignore rules before use. Create the file before the first remote read and
replace it immediately after every mutation using a same-directory temporary file, file sync,
and atomic rename; never rewrite the live JSON in place. It contains:

- manifest version, run ID, creation/update timestamps, mode, and current lifecycle checkpoint;
- expected sandbox API/OAuth hosts, `EBAY_US`, category `261328`, exact resolved
  `Content-Language`, and the immutable canonical sandbox seller fingerprint from Trading `GetUser`
  (`User.UserID`; never a token). A returned username may be stored only as supplementary
  display evidence;
- group key, ordered child SKUs, selector candidate/value, source image fingerprints and roles,
  quantities, prices, shared condition, policy IDs, and merchant location key;
- the complete payload-arrangement identifier, whether publication was ever reached, and any
  predecessor run ID whose declared fallback this fresh run is testing;
- each offer ID, group/listing ID, buyer URL, attempted payload variant, mutation status, and
  last sanitized error; and
- cleanup attempts, per-resource results, and final absence checks.

Use offer labels or seller metadata only if the Inventory API surface actually supports them.
Do not overload title, description, or policy fields as ownership tags. Group key, child SKUs,
seller fingerprint, and the manifest are the ownership proof. Redacted console output may show
run IDs, SKUs, offer/listing IDs, HTTP status, eBay error IDs, and field paths; it must omit
credentials, tokens, authorization headers, cookies, full request/response bodies, addresses,
and image URLs containing signatures or secret query strings.

If the manifest is missing, corrupt, names another seller, or contains identifiers outside the
run prefix, refuse mutation and cleanup. Preserve it until final absence verification succeeds.

## Isolation gates

All gates are fail-closed and must be recorded as pass/fail in the manifest.

1. **Explicit authority:** default mode is dry-run. Remote mutation requires a separately
   authorized task plus both `--execute` and `--confirm-sandbox-seller <UserID>`. Cleanup
   mutation additionally requires `--cleanup --execute` and the same seller confirmation.
2. **Host:** `EBAY_ENVIRONMENT` equals `sandbox`; the resolved REST and OAuth origins equal
   `https://api.sandbox.ebay.com`; marketplace equals `EBAY_US`. Reject overrides, redirects,
   proxies, or origins containing `api.ebay.com` without `.sandbox.`.
3. **Credentials:** load only the intended sandbox keyset and user refresh token. Reject any
   configured production key material, production token, production environment, unknown
   credential origin, or seller identity that differs from the explicit confirmation.
4. **Account:** Commerce Identity API `getUser` is not ownership proof in Sandbox because eBay
   documents that response as mock data. Make a narrow, read-only Trading API `GetUser` request
   with no target user and with the same sandbox user OAuth authorization that the Inventory API
   harness will use. Extract non-empty `User.UserID` as the canonical seller fingerprint. The
   returned username is supplementary only and cannot replace `UserID`. `UserID` must exactly
   equal `--confirm-sandbox-seller` and the manifest value at preflight, every resume, before the
   first mutation, and before cleanup. Call failure, missing `UserID`, mock/placeholder identity,
   token-account mismatch, changed identity, or ambiguous ownership is a hard stop. The operator
   must confirm that this `UserID` owns the selected policies and location.
5. **Content language:** resolved Sidecar/eBay client configuration must be exactly
   `Content-Language: en-US`, and the guarded client must attach that exact header to every
   Inventory item, group, and offer mutation in this `EBAY_US` pilot. Missing, empty,
   inherited-but-unverified, or different values refuse execution. Do not rely on an incidental
   optional environment/default path; dry-run must display the resolved non-secret value and
   prove the guarded request path supplies the header.
6. **Resource collision:** `getInventoryItemGroup(groupKey)` must return `404`, each
   `getInventoryItem(sku)` must return `404`, and `getOffers(sku, EBAY_US)` must return an empty
   offer list. Any existing group, item, or SKU-associated offer is a collision and is not
   adoptable, even when it shares `YPSBX-`; generate a new run or stop. Auth, rate-limit,
   timeout, and server errors never count as absence.
7. **Runtime:** prefer a direct CLI with no server. If a server is unavoidable, bind a checked,
   unique loopback port and record it. Do not use default/shared ports.
8. **Background work:** `SIDECAR_JOB_RUNNER_ENABLED=false`, `APIFY_ENABLED=false`,
   `SOLDCOMPS_ENABLED=false`, publishing disabled outside the harness's guarded call, and no
   watcher process. Watcher paths must be worktree-local and unused.
9. **Dependencies:** the harness reads its explicit fixture and local manifest only. Supabase,
   R2, AI, pricing providers, jobs, and shared watcher folders are prohibited unless a later
   implementation proves one is strictly necessary and adds a separately reviewed isolation
   gate. Public HTTPS image fixtures must be stable and non-secret.
10. **Policies/location:** select existing sandbox fulfillment, payment, and return policies and
   one enabled sandbox merchant location owned by the confirmed seller. Record IDs; do not
   create, update, disable, or delete them. Refuse multiple plausible choices unless the fixture
   explicitly names the intended owned records.
11. **Category/condition:** current Metadata/Taxonomy read-back must confirm variations support
    for `261328` and the chosen ungraded condition contract. Record taxonomy-listed selector
    candidates, but absence of bounded custom `Card` or `Card Selection` is unresolved evidence,
    not acceptance or a dry-run failure; future unpublished group validation is authoritative.
    Inventory condition `4000` is `USED_VERY_GOOD`, with numeric descriptor IDs such as
    `40001=400012`. Metadata reads are preflight only; stale evidence cannot replace this gate.

## Future guarded harness contract

Implement a dedicated CLI at
`services/sidecar/src/scripts/you-pick-sandbox-pilot.ts` with package command
`ebay:pilot-you-pick-sandbox`. Do not extend the broad `test-endpoints.ts` flow and do not use
ad hoc MCP mutations: both have wider authority and weaker run ownership than this pilot needs.

Proposed commands:

```text
pnpm --filter sidecar ebay:pilot-you-pick-sandbox -- --fixture <path>
pnpm --filter sidecar ebay:pilot-you-pick-sandbox -- --fixture <path> --execute \
  --confirm-sandbox-seller <UserID>
pnpm --filter sidecar ebay:pilot-you-pick-sandbox -- --manifest <path> --cleanup --execute \
  --confirm-sandbox-seller <UserID>
```

No flag defaults to execution. `--execute` without the seller confirmation fails. `--cleanup`
requires an existing manifest and resumes from remote read-back rather than trusting local
status. A rerun with a manifest resumes the first incomplete checkpoint; a rerun without the
manifest may only dry-run. There is no `--force`, arbitrary SKU prefix, skip-host-check, or
production mode.

### YP0.5 implemented dry-run surface

The YP0.5 harness implements the default fixture dry-run plus manifest resume and cleanup-plan
modes. It creates the versioned run manifest before resolving the credential-bearing read API,
then emits sanitized structured JSON containing exact gate results, canonical Trading `UserID`,
resolved `Content-Language`, selected resource IDs, metadata/collision summaries, stable request
digests, the ordered future operation plan, and the separately authorized next-command shape.
The repository includes a non-saleable offline example at
`services/sidecar/tests/fixtures/you-pick-sandbox/two-card.json`.

Every CLI argument list containing `--execute`, including `--cleanup --execute`, fails immediately
with the stable YP0.6 authorization error before environment loading or API dependency resolution.
YP0.5 contains no Inventory mutation dependency or call path. Cleanup mode strictly normalizes
exact group children, child/group associations, offers, statuses, marketplace/SKU ownership, and
listing identity before producing a reverse dependency plan. Publication history is distinct from
current withdrawal need: `ACTIVE` and quantity-zero `OUT_OF_STOCK` require withdrawal;
`ENDED`, `EBAY_ENDED`, and `NOT_LISTED` do not. `INACTIVE` is recorded but blocks cleanup planning
as ambiguous. Manifest publication is reconciliation evidence only and cannot force withdrawal
when exact remote state is definitively ended; disagreement is reported. Child evidence is
reconciled by compatible lifecycle class, so mixed `ACTIVE`/`OUT_OF_STOCK` remains active and
mixed `ENDED`/`EBAY_ENDED` remains ended. Every observed raw status is retained in sorted,
deduplicated sanitized evidence; mixing lifecycle classes remains a hard stop.

If no safe typed wrapper exists, YP0.5 must add only the narrow read-only Trading `GetUser`
support needed to return and validate `User.UserID` from the harness's existing user OAuth
authorization. It does not authorize Trading API listing creation, revision, ending, relisting,
or management of any Inventory API resource.

YP0.5 focused tests must prove dry-run reports the resolved `Content-Language`, execution rejects
missing, empty, unknown/inherited, and non-`en-US` values, and the guarded Inventory request path
actually supplies `Content-Language: en-US`. Configuration defaults alone do not satisfy this
contract. Identity tests must also reject Commerce Identity mock/placeholder data, missing or
changed Trading `UserID`, confirmation mismatch, and token-account mismatch across resume and
cleanup.

`--cleanup` is also the abort path from every partial lifecycle checkpoint. It reconstructs
remote state with exact reads, then walks only manifest-owned dependencies in reverse: withdraw
an active group, delete recorded offers, delete the group, delete children, and verify exact
absence. It may resume after its own interruption and must stop before deleting a resource whose
ownership or dependency state is ambiguous.

Before implementation, add strict fixture and manifest schemas plus exact typed request/response
validation at the harness boundary. The fixture must require:

- exactly two or three ordered children and a complete, non-empty `variantSKUs` snapshot;
- unique non-empty SKUs and unique non-empty selector values, with exact selector name/value
  equality between group `variesBy.specifications` and child `product.aspects`;
- positive integer initial inventory and offer quantities;
- distinct positive USD prices and compatible `FIXED_PRICE` offers with identical category,
  marketplace, location, and business-policy IDs;
- exactly two valid HTTPS image sources per child with distinct source fingerprints and explicit
  `front`, then `back`, roles;
- one group title/description, allowed shared aspects, and the exact publish request fields
  `inventoryItemGroupKey` plus `marketplaceId: EBAY_US`;
- one compatible shared condition and identical condition/descriptor fields on every child; and
- complete group replacement payloads on every replace, never omission-based patches.

The generic MCP `inventoryItemGroupSchema` currently permits missing `variantSKUs`, while the
typed Inventory API wrapper correctly requires it. Before any write, either make the generic
runtime schema require `variantSKUs` without widening other behavior, or bypass it entirely with
the dedicated harness's strict schema. The recommended pilot path bypasses MCP. Static
TypeScript types alone are not runtime validation.

## Fixture and bounded payload decisions

Use two children by default; a third is allowed only when needed to disambiguate selector order.
Every child represents an ungraded card satisfying the same selected condition tier. Assign
initial quantities `1`, `2`, and optionally `3`, and visibly distinct prices such as `1.11`,
`2.22`, and `3.33` USD. Exact card identities and public front/back URLs live only in the local
fixture. Never use saleable production inventory.

| Decision | First attempt | Declared bounded fallback | Product pass evidence |
| --- | --- | --- | --- |
| Selector label | useful custom `Card` | useful custom `Card Selection` | accepted/read back exactly and clearly labels card choice |
| Child product title/description | omit; group owns buyer content | repeat group title/description exactly | API read-back plus correct buyer title/description |
| Offer description | omit `listingDescription` | none | group description remains buyer-facing |
| Images | group-only derived front/back sequence | group primary fronts plus child front/back pairs | selected child shows only its pair, front then back |
| Price | distinct offer price per child | none | every selection shows its mapped price |
| Condition | identical ungraded tier on every child | none | compatible read-back and one shared buyer condition |

Do not cross-product these variants. One manifest/run may reach publication with only one
material payload arrangement. Before publication, a deterministic API validation rejection may
use the single declared fallback within the same run when the steps below permit it; record both
payload digests and prove no listing was published. After publication, any selector,
title/description, image, price, condition, or other buyer-facing failure ends that run: withdraw,
fully clean, and verify absence. The declared fallback may then be attempted only in a fresh run
with a new run ID, group key, child SKUs, manifest, collision checks, and separately recorded
evidence linked to the failed predecessor. Never revise a live listing from one materially
different payload arrangement to another.

### Selector experiment

Preflight must record `getListingStructurePolicies` for `261328` and the current Taxonomy item
aspects. Existing evidence showed variations support while Taxonomy did not establish a useful
unique-card selector; the reference listing's custom-looking `Sticker #` proves buyer UX is
possible somewhere, not that this Inventory API account accepts that name.

1. Build exact values such as `001 - <short card identity>` in fixture order. Attempt `Card`.
2. If the group call explicitly rejects the aspect name before publication, replace the complete
   unpublished group using `Card Selection`, updating the same exact aspect name on every child
   first. This is an unpublished deterministic correction within the same run.
3. If both useful names fail, a dry-run/read-only report may identify taxonomy's `Customized` as
   a technical candidate, but the pilot must stop before publication. `Customized` is not an
   automatic product pass. A later operator may authorize it only after judging the rendered
   label useful; otherwise selector contract remains unresolved.

Go only when the group and every child read back the exact name/value set with no normalization,
loss, duplication, or order drift. Buyer verification must show every value once, in intended
order, with a clear relationship to the card. A technically accepted generic or confusing label
is no-go. If that no-go is discovered after publication, withdraw and fully clean this run; test
the other declared useful label only through a fresh run.

### Title and description experiment

Group `title` and `description` are always complete and buyer-facing; child offers always omit
`listingDescription`. Official Inventory API pages are not perfectly uniform about child product
fields: field-level guidance permits omission to avoid overriding group content, while the group
guide requires child values to match when supplied. Therefore:

1. First omit child `product.title` and `product.description`.
2. If pre-publication validation rejects omission or unpublished read-back is incomplete, retry
   once in the same run by repeating the group title and description exactly on every child.
3. If omission publishes but buyer content is incomplete or wrong, withdraw, fully clean, verify
   absence, and attempt the repeated-fields fallback only in a fresh run.

Any child-specific title/description, offer description override, or differing repeated value is
invalid. Record which total payload was accepted and which fields the API returns after publish.

### Image experiment

Keep each child's two source fingerprints constant across attempts.

1. First set `aspectsImageVariesBy` to the selector and put a derived group `imageUrls` sequence
   in selector order: C01 front, C01 back, C02 front, C02 back, then C03 front/back. Omit child
   `product.imageUrls`.
2. If pre-publication validation rejects that arrangement, retry once in the same run: group
   `imageUrls` contains the primary front for each child in selector order, while each child
   `product.imageUrls` contains exactly `[front, back]`.
3. If the first arrangement publishes but buyer pairing/order fails, withdraw, fully clean,
   verify absence, and attempt the second arrangement only in a fresh run.

Each group/child GET must preserve the expected URL identity and order. Buyer verification is an
explicit manual operator gate: in a browser, select each value independently and capture the
active gallery position plus visible image fingerprints and screenshots. Pass only if selection
N activates N's front image, its next relevant image is N's back, front is before back, and
neither image belongs to another child. The operator records a pass/fail attestation in the
manifest. A gallery that contains every URL but does not pair selection correctly fails. No
third arrangement is attempted in this run.

### Price and shared condition experiments

After publication, select each value and record displayed price against the manifest mapping.
Every distinct amount must follow its child. A single group price, stale prior-child price, or
wrong mapping fails even if offer GETs are correct.

The fixture chooses one group-level ungraded condition tier. Every child must use identical,
compatible Inventory API condition and descriptor fields where required, and buyer view must show
one non-contradictory shared condition. No card needing another tier enters this group; there is no
mixed-condition fallback.

### Quantity-zero experiment

Run only after the group has published successfully with every child positive. Use
`bulkUpdatePriceQuantity` for exactly one SKU and offer: set both
`shipToLocationAvailability.quantity` and that offer's `availableQuantity` to `0`, leaving price
and all other children unchanged. The future harness must add a strict typed request/response
schema and require a success status for both SKU and offer before execution.

Poll bounded API GETs, then buyer view. Pass only if item/offer read-back reports zero, group
membership remains complete, the listing stays active, and the target selector is disabled or
clearly out of stock while other children remain purchasable. Record account out-of-stock-control
state because behavior may depend on it. If the update is rejected, status is ambiguous, the
selector disappears, or another child's availability changes, stop and preserve IDs.

When the experiment passes and cleanup can proceed immediately, continue to withdrawal without
restoring. If buyer verification must remain available briefly, restore both inventory and offer
quantities to their exact manifest values with the same operation, verify read-back, then withdraw.
Never publish initially with a zero child.

## API sequence, checkpoints, and rollback

Every read checks the confirmed seller and exact run identifiers. A missing response is success
only during initial absence or final cleanup verification; `401`, `403`, `429`, timeout, and `5xx`
are unknown state, not absence. A read-only transient may be retried at most three times within
30 seconds, honoring `Retry-After`, and every attempt is recorded. After an unknown mutation
result, never replay it directly: perform bounded exact reads first. If those reads cannot prove
the before or after state, stop and preserve the manifest for manual cleanup.

At every CLI entry, resume, first mutation, and cleanup entry, repeat Trading `GetUser` with the
same user OAuth authorization and require the exact manifest/confirmation `UserID`. Before each
Inventory item, group, or offer mutation, the guarded request path must also assert and attach
exactly `Content-Language: en-US`; an optional client default is insufficient.

| # | Operation | Persist immediately | Resume/read-before-write | If next step fails |
| ---: | --- | --- | --- | --- |
| 0 | Trading `GetUser`; resolve guarded client headers; GET listing-structure/condition/taxonomy metadata, policies, locations | canonical `UserID`, supplementary username, `en-US`, selected policy/location IDs, metadata summaries | repeat Trading call with same OAuth authorization; require same `UserID` and exact header | stop, no cleanup |
| 1 | GET exact group key; GET each SKU and offers by SKU | absence results and timestamps | any existing object is collision, never adopted | stop, generate a new run only by new dry-run |
| 2 | PUT complete child inventory item C01..C03, one at a time | SKU, request digest, HTTP/eBay status, confirmed item GET snapshot | GET SKU; exact matching owned snapshot means complete, mismatch means stop | delete only created child items after proving no offers/group reference them |
| 3 | POST one compatible offer per child | SKU-to-offer ID, request digest, status, offer GET snapshot | GET offers by SKU; adopt only the one exact offer recorded by this run after an ambiguous response; duplicates stop | delete created offers, then child items |
| 4 | PUT complete inventory item group | group key, full ordered `variantSKUs`, payload variant/digest, status | GET group; exact complete snapshot means complete, mismatch means stop | delete group, offers, then children |
| 5 | GET all children, offers, and group | sanitized snapshots/digests and comparison result | repeat until bounded consistency deadline; never mutate on mismatch | clean unpublished resources in dependency order |
| 6 | POST `publish_by_inventory_item_group` with group key and `EBAY_US` | listing ID, buyer URL, warnings/errors, publish response digest | GET group/offers first; an existing common listing ID means published; otherwise retry only when reads prove unpublished | if published, withdraw group; then clean. If ambiguous, preserve IDs and stop |
| 7 | GET children/offers/group and manually verify buyer selector/content/images/prices/condition | API snapshots, published arrangement ID, and evidence checklist | read-only repeat allowed within bounded window | product mismatch: stop, withdraw, fully clean, verify absence; declared fallback requires a fresh run |
| 8 | POST one-SKU `bulk_update_price_quantity` to zero inventory and offer availability | target SKU/offer, before/after quantities, per-entry statuses | GET item/offer before retry; zero means complete, original means retry once only for a proven no-op | unexpected or ambiguous state: preserve IDs; withdraw before cleanup if possible |
| 9 | Optionally restore exact original quantities with the same operation | restoration statuses and GET snapshots | restore only when current value is zero and manifest owns SKU/offer | withdrawal still required; preserve before/after evidence |
| 10 | POST `withdraw_by_inventory_item_group` | group key, marketplace, status, ended timestamp | GET offers; all unpublished/ended means complete | retry only after exact read-back proves still active; otherwise preserve IDs for manual cleanup |
| 11 | DELETE each offer by recorded ID | per-offer status and absence GET | missing is complete; active means return to withdrawal | stop child deletion for affected SKU; preserve IDs |
| 12 | DELETE group by exact key | status and absence GET | missing is complete; non-empty/active reference blocks retry | preserve group/SKUs; do not delete children |
| 13 | DELETE each child item | per-SKU status and absence GET | missing is complete; referenced item remains blocked | preserve failed SKU and dependency IDs |
| 14 | GET exact offers, group, and children to prove absence | final timestamps and responses; cleanup-complete marker | repeat only bounded transient reads | mark cleanup incomplete and emit manual command using manifest |

No cleanup step may scan and delete by a broad prefix. The existing generic sandbox cleanup tool
does not own group state and is not the primary recovery mechanism; use the manifest-driven
harness cleanup. A manually recovered run still requires final exact absence checks before the
manifest is archived.

## Failure matrix

| Failure | Required action | Retry rule / preserved evidence |
| --- | --- | --- |
| Trading identity or content-language gate fails | hard stop before mutation | no fallback identity/header; preserve canonical/missing/mismatch reason without token data |
| Partial child creation | stop; delete only confirmed run children | read ambiguous SKU once before retry; preserve SKU/status/digest |
| Partial offer creation | stop; delete confirmed offers, then children | resolve by offers-for-SKU read; duplicates are manual-cleanup failure |
| Pre-publication group validation rejection | stop or use the one declared unpublished fallback in the same run | no blind retry; first prove no publication and preserve error ID/field, full variant list, payload digest |
| Publish rejection | stop; keep unpublished objects only long enough to capture GETs, then clean | retry once only after a deterministic fixture defect is fixed within the declared variant |
| Post-publication buyer selector/content/image/price/condition mismatch | product fail; withdraw, fully clean, and verify absence | no live arrangement revision; declared fallback requires new identities and manifest in a fresh run |
| Quantity-zero rejection or wrong behavior | stop; restore if state is known and verification needs it, otherwise withdraw | no repeated mutation under ambiguity; preserve before/after GETs |
| Withdrawal failure | stop destructive cleanup of referenced resources | exact offer/group reads decide one retry; preserve listing/group/offer IDs for manual cleanup |
| Offer/group/child cleanup failure | continue only with independent later resources whose dependencies are cleared | never delete through unknown references; manifest stays cleanup-incomplete |

## Evidence checklist

Store evidence under the manifest run directory; sanitize before committing or sharing.

- preflight gate results, canonical Trading `GetUser` `UserID`, supplementary username if any,
  same-OAuth confirmation, sandbox hosts, exact resolved `Content-Language: en-US`,
  marketplace/category, policy and location IDs, metadata decision, and collision checks;
- request/response digests, HTTP status, eBay error/warning IDs and field paths for every step;
- per-mutation proof that the guarded request path supplied `Content-Language: en-US` without
  storing authorization headers or tokens;
- group key, ordered SKUs, offer IDs, listing ID, buyer URL, selector order, and API snapshots;
- published payload-arrangement ID and any predecessor/fallback run link;
- one screenshot/manual observation before selection and one per selected child showing selector,
  price, image pair/order, and shared condition;
- source fingerprint to returned URL/gallery fingerprint mapping, not secret-bearing URLs;
- quantity-zero before/after item and offer GETs plus buyer out-of-stock observation;
- withdrawal evidence and exact absence checks for offers, group, and child items; and
- cleanup-complete timestamp or explicit unresolved IDs and the manifest-driven recovery command.

Never store credentials, tokens, authorization/cookie headers, secret environment values, full
sensitive payloads, buyer data, or signed image query parameters.

## Success outputs and next design inputs

The execution report must return one explicit value for each decision; `unknown` blocks later
persistence/orchestration design:

- accepted selector name, exact value convention, ordering, and product-acceptability verdict;
- child product title/description omit-or-repeat rule and mandatory offer-description omission;
- group/child image placement plus exact front/back ordering rule;
- quantity-zero request contract and observed selector behavior;
- canonical sandbox `UserID`, identity stability verdict, and exact content-language verdict;
- published arrangement ID and any separately cleaned predecessor/fallback run relationship;
- effective **initial operational cap of 2-3 only** for the next implementation stage, without
  claiming a production maximum;
- cleanup reliability, retries/manual intervention required, and verified final absence; and
- category, seller-account, policy, revision, out-of-stock-control, or API limitations.

Only a fully passing, fully cleaned, separately authorized sandbox run unblocks detailed You Pick
persistence and orchestration design. It does not authorize a larger group, production write, or
any change to existing Single/Lot workflows.

## Official references

- [Commerce Identity `getUser`](https://developer.ebay.com/api-docs/commerce/identity/resources/user/methods/getUser)
- [Trading API `GetUser`](https://developer.ebay.com/devzone/XML/docs/Reference/ebay/GetUser.html)
- [Inventory item write headers](https://developer.ebay.com/api-docs/sell/inventory/resources/inventory_item/methods/createOrReplaceInventoryItem)
- [Creating and managing inventory item groups](https://developer.ebay.com/api-docs/sell/static/inventory/inventory-item-groups.html)
- [InventoryItemGroup fields](https://developer.ebay.com/api-docs/sell/inventory/types/slr%3AInventoryItemGroup)
- [Bulk quantity and price updates](https://developer.ebay.com/api-docs/sell/static/inventory/bulk-updates.html)
- [Managing offers](https://developer.ebay.com/api-docs/sell/static/inventory/managing-offers.html)
- [Managing images](https://developer.ebay.com/api-docs/sell/static/inventory/managing-image-media.html)
- [Metadata category policies](https://developer.ebay.com/api-docs/sell/static/metadata/getting-metadata.html)

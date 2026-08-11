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
`<repo>/.local/you-pick-sandbox/<runId>/manifest.json`; this is ignored operator-local state and
must remain untracked. Create the file before the first remote read and
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
- each offer ID, group/listing ID, attempted payload variant, mutation status, and
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

## Implemented guarded harness contract

The dedicated CLI lives at
`services/sidecar/src/scripts/you-pick-sandbox-pilot.ts` with package command
`ebay:pilot-you-pick-sandbox`. Do not extend the broad `test-endpoints.ts` flow and do not use
ad hoc MCP mutations: both have wider authority and weaker run ownership than this pilot needs.

Command shapes:

```text
pnpm --filter sidecar ebay:pilot-you-pick-sandbox -- --fixture <path>
pnpm --filter sidecar ebay:pilot-you-pick-sandbox -- --manifest <path> --execute \
  --confirm-sandbox-seller <UserID>
pnpm --filter sidecar ebay:pilot-you-pick-sandbox -- --manifest <path> --execute \
  --confirm-sandbox-seller <UserID> --attestation <published-view.json>
pnpm --filter sidecar ebay:pilot-you-pick-sandbox -- --manifest <path> --execute \
  --confirm-sandbox-seller <UserID> --attestation <quantity-zero.json>
pnpm --filter sidecar ebay:pilot-you-pick-sandbox -- --manifest <path> --cleanup --execute \
  --confirm-sandbox-seller <UserID>
```

No flag defaults to execution. `--fixture --execute`, `--execute` without an exact manifest and
seller confirmation, duplicate/unknown flags, and cleanup execution without a manifest fail before
the mutation factory is resolved. `--cleanup`
requires an existing manifest and resumes from remote read-back rather than trusting local
status. A rerun with a manifest resumes the first incomplete checkpoint; a rerun without the
manifest may only dry-run. There is no `--force`, arbitrary SKU prefix, skip-host-check, or
production mode. Implementation and offline tests do not authorize a live Sandbox write; that
requires a separate explicit user authorization.

### Versioned manifest and operation ledger

The harness preserves default fixture dry-run, manifest resume, and cleanup-plan modes. It creates
the versioned run manifest before resolving the credential-bearing read API,
then emits sanitized structured JSON containing exact gate results, canonical Trading `UserID`,
resolved `Content-Language`, selected resource IDs, metadata/collision summaries, stable request
digests, the ordered future operation plan, and the separately authorized next-command shape.
A successful cleanup plan persists `cleanup-plan-ready`, clears only stale pre-mutation errors when
no cleanup attempt has begun, and is an executable cleanup checkpoint. Once cleanup starts, errors
remain fail-closed until exact terminal absence is proven.
The repository includes a non-saleable offline example at
`services/sidecar/tests/fixtures/you-pick-sandbox/two-card.json`. That active fixture is payload
arrangement version 2. The exact historical version-1 input remains at
`services/sidecar/tests/fixtures/you-pick-sandbox/two-card-legacy-v1.json` for compatibility proof;
it is rejected as the input to a new run.

Version 5 is the only executable manifest version. It stores the immutable validated arrangement,
the ordered operation digests, and one ledger row per operation: `planned`, `started`, `completed`,
or `unknown`; attempt count; started/completed timestamps; sanitized result/error evidence; and a
read-back digest. Atomic persistence occurs immediately before each attempted mutation and after
reconciliation. `attemptCount` counts remote mutation attempts, not read-only verification passes.
The terminal `verify-exact-run-resource-absence` operation therefore completes with exact read-back
evidence, timestamps, and `attemptCount: 0`; its success criterion is proven absence, not an
artificial completed/1 count. A successful terminal cleanup clears stale `lastError` only after
that proof is persisted. Failed or unknown cleanup retains the current sanitized error and never
claims `cleanup-complete`. Version 4 remains readable for historical read-only inspection but is
never silently upgraded or accepted for execution; create and review a fresh version-5 preflight run.
Payload-arrangement versions are separate from manifest versions. Existing version-5 manifests
may embed fixture version 1 and rebuild the exact historical child/group requests, arrangement ID,
operation digests, and ledger identities. New version-5 manifests require fixture version 2. Run
`20260804T173924Z-967292` was cleaned through its integrity-valid version-1 arrangement and is
preserved byte-for-byte as historical evidence; it must never be rewritten to version 2.
Credentials, authorization headers, raw responses, signed URLs, and buyer personal data are never
stored. Public fixture image sources remain immutable local pilot inputs and are redacted from
console reports.

Before either mutation API dependency is resolved, and again immediately before execution, one
authoritative integrity gate rebuilds the complete future plan from the embedded fixture and run.
It requires exact ordered agreement with arrangement, operations, ledger request digests,
resource SKUs, selector values, image fingerprints, quantities, prices, condition evidence,
policies, and merchant location. Checkpoint persistence cannot turn a divergent manifest into an
executable one.
For fixture version 2, that rebuilt contract also includes exact ordered child
`product.imageUrls` pairs and the complete group's ordered one-front-per-selector pivot list.
Fixture version 1 deliberately retains its historical group-only requests and ignores child image
fields during semantic recovery.

Fixture version 3 preserves the version-2 child-pair and group-pivot placement but treats fixture
URLs as immutable Media API ingestion sources. Its guarded plan creates one ordered Sandbox EPS
resource per source through REST `createImageFromUrl`, persists the returned image identity,
exact resource location, EPS URL digest, and expiration, then reconciles the exact resource with
`getImage` before resolving any Inventory payload. Current Media OpenAPI security metadata requires
the full `sell.inventory` Authorization Code user scope for both image operations. Preflight accepts
that scope from complete token metadata; when refreshed token metadata omits its scope field, one
read-only lookup of an intentionally missing Media image must return image-not-found rather than an
authorization error. A started Media operation without a persisted Location is never replayed,
because the API has no source-keyed lookup or image-delete operation. Exact returned EPS URLs live
only in the ignored mode-0600 manifest and are redacted from console reports.

YP0.15 live buyer verification established that EPS provenance fixes child-selector image binding,
but retaining group-level `imageUrls` renders two additional unbound leading images: positions 3–4
bind correctly to Alpha and positions 5–6 bind correctly to Beta, while positions 1–2 are duplicate
front pivots with no selector association. This is a buyer-view failure. The smallest next experiment
preserves each child's ordered EPS `[front, back]` pair and omits group-level `imageUrls`; it does not
change selector order, offers, prices, condition, or Media provenance.

Cleanup-plan mode strictly normalizes
exact group children, child/group associations, offers, statuses, marketplace/SKU ownership, and
listing identity before producing a reverse dependency plan. Publication history is distinct from
current withdrawal need: `ACTIVE` and quantity-zero `OUT_OF_STOCK` require withdrawal;
`ENDED`, `EBAY_ENDED`, and `NOT_LISTED` do not. `INACTIVE` is recorded but blocks cleanup planning
as ambiguous. Manifest publication is reconciliation evidence only and cannot force withdrawal
when exact remote state is definitively ended; disagreement is reported. Child evidence is
reconciled by compatible lifecycle class, so mixed `ACTIVE`/`OUT_OF_STOCK` remains active and
mixed `ENDED`/`EBAY_ENDED` remains ended. Every observed raw status is retained in sorted,
deduplicated sanitized evidence; mixing lifecycle classes remains a hard stop.

The harness uses only the narrow read-only Trading `GetUser` wrapper needed to return and validate
`User.UserID` from the same user OAuth authorization. It does not authorize Trading API listing
creation, revision, ending, relisting, or management of any Inventory API resource.

Focused tests prove dry-run reports the resolved `Content-Language`, execution rejects
missing, empty, unknown/inherited, and non-`en-US` values, and the guarded Inventory request path
actually supplies `Content-Language: en-US`. Configuration defaults alone do not satisfy this
contract. Identity tests must also reject Commerce Identity mock/placeholder data, missing or
changed Trading `UserID`, confirmation mismatch, and token-account mismatch across resume and
cleanup. The mutation adapter is a separate `YouPickPilotMutationApi`; read-only commands neither
construct nor receive it. Every adapter mutation passes an explicit validated
`Content-Language: en-US` request configuration.

### Manual attestation checkpoints

The first execute invocation performs exact read-before-write recovery through child items,
offers, the complete group snapshot, verification, and publication, then stops at
`awaiting-published-view-verification`. The published-view JSON must exactly bind run ID,
arrangement ID, listing ID, timestamp, ordered child SKUs/selector values/prices/front-back
fingerprints, and successful selector, price, image-order, shared-condition, title, and description
checks. The next invocation sets only the first child's recorded inventory and offer quantities to
zero, verifies both exact reads, and stops at `awaiting-quantity-zero-verification`. The
quantity-zero JSON binds the same identities and attests that the target is unavailable while the
ordered `remainingChildren` array contains every non-target SKU with literal
`purchasable: true`; two- and three-child runs require exact coverage with no omission, duplicate,
extra, or reorder. Each attestation timestamp must be strictly later than its corresponding
completed `publish-group` or `quantity-zero` ledger timestamp. Evidence at the same timestamp,
older than 24 hours, future-dated, mismatched, incomplete, or containing a failed check is rejected
before mutation construction. The following invocation records `withdrawal-ready`; cleanup
remains a separate explicit command.

Quantity-zero reconciles the complete group, every item, and every offer before and after the
write. Before-state digests and positive quantities must match the immutable plan. Afterward only
the target item/offer may match the explicitly derived zero-state digest; group membership and all
non-target digests, quantities, offer IDs, and the common active listing identity must remain
unchanged.

`--cleanup` is also the abort path from every partial lifecycle checkpoint. It reconstructs
remote state with exact reads, then walks only manifest-owned dependencies in reverse: withdraw
an active group, delete recorded offers, delete the group, delete children, and verify exact
absence. It may resume after its own interruption and must stop before deleting a resource whose
ownership or dependency state is ambiguous. Cleanup execution never requires published-view or
quantity-zero attestations; those attestations guard only the non-cleanup quantity experiment.
Pre-mutation execution validation failures are sanitized and persisted to `lastError` before the
CLI returns the recovery command.
The executable path uses one complete publication-state reconciler before publish adoption,
quantity-zero, and destructive cleanup. Every child must have one exact offer, compatible status,
one listing ID and lifecycle, and complete normalized flags. `INACTIVE`, missing lifecycle fields,
mixed publication or lifecycle classes, conflicting IDs, duplicate offers, and null withdrawal
evidence stop before deletion. Raw statuses may differ only inside one compatible class:
`ACTIVE`/`OUT_OF_STOCK`, `ENDED`/`EBAY_ENDED`, or only `NOT_LISTED`. Active groups are withdrawn
and fully re-read before any resource delete; compatible ended/not-listed groups may proceed
without withdrawal.

Recovery from a `started` or `unknown` ledger entry has three explicit outcomes: exact after-state
proven, exact original pre-state proven, or unresolved. Proven after-state completes without a
write. Only proven pre-state permits one bounded retry. Read errors, unknown reads, malformed or
mismatched snapshots, and ambiguous ownership persist `unknown` and stop without calling the
mutation API.

Strict fixture, manifest, attestation, and mutation-result schemas at the harness boundary require:

- exactly two or three ordered children and a complete, non-empty `variantSKUs` snapshot;
- unique non-empty SKUs and unique non-empty selector values, with exact selector name/value
  equality between group `variesBy.specifications` and child `product.aspects`;
- positive integer initial inventory and offer quantities;
- distinct positive USD prices and compatible `FIXED_PRICE` offers with identical category,
  marketplace, location, and business-policy IDs;
- exactly two valid HTTPS image sources per child with distinct source fingerprints and explicit
  `front`, then `back`, roles;
- for fixture version 2, distinct source URLs across the whole group, exact child
  `product.imageUrls: [front, back]`, and exactly one group front/pivot per selector value;
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
| Images | historical v1 group-only front/back sequence failed buyer verification | v2 group primary fronts plus child front/back pairs; fresh run only | selected child shows only its pair, front then back |
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

### Resolved image arrangement

Run `20260804T173924Z-967292`, listing `110590142987`, published fixture version 1: group
`imageUrls` flattened C01 front/back then C02 front/back, while child inventory items omitted
`product.imageUrls`. Buyer verification found four non-renderable placeholders and selector
changes did not update the image pair. That arrangement is closed for new runs.

Fixture version 2 keeps `aspectsImageVariesBy` as the single selector aspect array and submits:

1. each child's `product.imageUrls` as its exact ordered `[front, back]` pair; and
2. complete group `imageUrls` as exactly one front/pivot per selector value, in the same order as
   `selector.values`, `variantSKUs`, and `variesBy.specifications[0].values`.

No SKU sorting, adjacency inference, second pivot aspect, URL rewrite, proxy, or fallback placeholder
may alter that mapping. The failed live listing must first be withdrawn, fully cleaned, and proven
absent through its unchanged version-1 manifest under separate authorization. Only then may a fresh
version-2 preflight/run use new run, group, child, manifest, and collision identities. Never revise
listing `110590142987` in place to the version-2 payload.

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

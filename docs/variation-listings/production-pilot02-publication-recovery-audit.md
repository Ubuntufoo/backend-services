# ProductionPilot02 Publication and Recovery Audit

## Scope and authority

This audit records read-only evidence and code-only prevention work from 2026-09-22. It does not authorize an eBay, Supabase, R2, process-configuration, or journal mutation. `EBAY_PUBLISH_ENABLED` must remain false until a new, explicit production-publish authorization.

## Evidence map

Observed from the running Sidecar on `localhost:3002`, the UI proxy on `localhost:3000`, local process inspection, and read-only readiness diagnostics:

| Identity | Current authoritative local state | Publication evidence |
| --- | --- | --- |
| ProductionPilot02 `f6364eb4-489b-450b-9a83-ced85526b90f` / `VL-G-F6364EB4489B450B9A83CED85526B90F` | `review`, desired revision 3, no confirmed/latest revision; location `mfh-main-location`; SKUs `BSKBL-ProductionPilot02-000001` and `-000002`; variation IDs `d67caaf4-228b-4c5c-bfe8-4742e13bf8e8` and `5d59e541-4784-4cd7-8e4b-0db067f3dedc`; selector lengths 38 and 54; title length 46 | Direct Sidecar and UI list-proxy representations matched after normalization. No local journal exists. This does **not** prove remote absence. |
| Historical `62f25ae1-44d0-45ad-8a7c-141ff812e332` / `VL-G-62F25AE144D045AD8A7C141FF812E332` | `publish-ready`, desired revision 4; Sandbox-origin bucket token; location `default-main-location`; variation IDs `28a11585-…` and `82e4ba53-…`; selector lengths 50 and 66; title length 77 | Frozen revision `836e4765-e0e8-42ab-9b52-7d3a450cfa5d`; first Media operation `media:c250bbc0-4939-4929-bcf3-a05a78627731:front` is `unknown`; all non-Media operations remain pending. |

The reported 77/65 UI state and `82e4ba53-…` selector error therefore belong to the historical group, not current ProductionPilot02. The different group, variation, location, title, selector, and revision identities are conclusive. The old revision must never be imported into, attached to, or used to mutate current ProductionPilot02.

Environment evidence: Sidecar and UI both reported production, `EBAY_US`, and production eBay hosts. The read-only live-readiness diagnostic verified OAuth, seller access, production policy IDs, and enabled `mfh-main-location`; its only warning was `productionPublishEnabled=false`. Sidecar was on port 3002, UI on 3000, and no process listened on 3001. The exact Supabase project identity was not exposed through a safe existing diagnostic, so project/schema identity remains an operator-verification requirement rather than an inferred fact.

## Remaining read-only proof

Before any separately authorized action, retain sanitized output from these exact database reads against the configured project. Do not share raw snapshots/evidence without redaction.

```sql
select g.group_id, g.group_key, g.lifecycle_state, g.desired_revision,
       g.last_confirmed_revision, g.sku_bucket_token, g.marketplace_id,
       g.merchant_location_key, g.fulfillment_policy_id, g.payment_policy_id,
       g.return_policy_id, r.revision_id, r.captured_desired_revision,
       r.operation_count, r.captured_at, r.snapshot_version,
       r.snapshot_digest, r.snapshot, r.operation_plan
from public.variation_listing_groups g
left join public.variation_listing_revisions r on r.group_id = g.group_id
where g.group_id in (
  'f6364eb4-489b-450b-9a83-ced85526b90f',
  '62f25ae1-44d0-45ad-8a7c-141ff812e332'
)
order by g.group_id, r.captured_desired_revision;

select revision_id, operation_key, attempt_number, checkpoint_number, state,
       observed_remote_state, evidence, created_at
from public.variation_listing_publishing_checkpoints
where revision_id in (
  '836e4765-e0e8-42ab-9b52-7d3a450cfa5d'
  /* plus the ProductionPilot02 revision_id returned above, if any */
)
order by revision_id, operation_key, attempt_number, checkpoint_number;
```

No narrow existing operator command performed exact eBay reads for the two current SKUs, their offers, and group key. A qualified operator must next issue read-only production GETs for exactly:

- inventory group `VL-G-F6364EB4489B450B9A83CED85526B90F`;
- inventory items `BSKBL-ProductionPilot02-000001` and `BSKBL-ProductionPilot02-000002`;
- offers for each exact SKU in `EBAY_US`.

Treat authorization failure, timeout, malformed response, marketplace mismatch, or any non-authoritative not-found classification as **unknown**, not absent.

## Canonical Variation title and Card-selector contract

Variation-mode **group listing titles allow 1–80 characters**, matching Standard Single/Lot titles. The separate individual `Card` selector values allow **1–65 characters**. The previous application-only 65-character group-title cap was unnecessarily restrictive: a 77-character group title is valid.

| Boundary | New Variation group title | New Card selector | Historical frozen recovery |
| --- | ---: | ---: | --- |
| Gemini contract/prompt | 80 | 65 | not regenerated |
| Editable UI | live count, native max 80, save disabled above 80 | live count, native max 65, save disabled above 65 | persisted invalid review data remains correctable; no truncation |
| API review PATCH | reject above 80 | reject above 65 | no snapshot rewrite |
| Data RPC client/CAS input | reject above 80 | reject above 65 | existing rows remain readable |
| Readiness serialization | blocker above 80 | blocker above 65 | visible as blocked |
| Review → publish-ready action | full payload validation first | full payload validation first | not used for replay |
| New revision freeze | full payload validation before operation plan | full payload validation before operation plan | dedicated historical reconstruction accepts legacy overlong selectors only to reconstruct exact ownership; title remains capped at 80 |
| Outbound new payload | Zod max 80 | Zod max 65 | immutable frozen payload/digest retained |

Title boundary tests cover 65/77/79/80/81; Card selector tests cover 64/65/66 and historical 77-title/66-selector reconstruction. No code silently truncates stored or generated content.

The database's existing 80-character group-title allowance is appropriate: **do not apply the previously proposed 65-character title constraint**. The existing September 4 selector `NOT VALID` constraint blocks new invalid selectors while preserving historical rows.

## Root cause and prevention

The fresh initial-publication builder previously skipped complete payload validation when Media resources were present. It could capture a mutation revision and start Media before constructing the final payload that rejected an overlong selector. New-publication validation now builds the complete payload with deterministic, trusted, non-persisted placeholder EPS URLs before either review → publish-ready transition or frozen operation-plan creation. The same final payload schemas still run with real EPS URLs before outbound work. Historical reconstruction remains isolated so old immutable snapshots can be inspected without weakening new-write validation.

## Recovery decision tree

1. **Wrong group, environment, seller, marketplace, project, or frozen identity:** quarantine the evidence; no reconciliation, retry, cleanup, return-to-review, reassociation, or journal edits.
2. **Current group has no frozen revision:** a missing local journal is not remote-absence proof. Perform exact read-only group/item/offer GETs. Any unknown result stops recovery.
3. **Unknown Media checkpoint contains all four durable identity fields** (`imageId`, `location`, `imageUrl`, `expirationDate`): reconcile only by reading the saved exact `location` and requiring an exact identity match. Never search by source key.
4. **Unknown Media checkpoint lacks any identity field:** identity is unrecoverable because eBay exposes no source-key lookup. Never replay `createMedia`, invent evidence, or delete an image by guess. Preserve an `orphan-image-unknown` audit fact.
5. **Any non-Media operation started:** use the existing full journal grammar and exact remote ownership reads. No Media-only retirement path is eligible.
6. **Offers/group/listing exist:** require exact ownership, listing ID, marketplace, seller, and sale/order evidence. Published or ever-published inventory uses withdrawal/retention semantics, never destructive unpublished cleanup.
7. **All exact resources proven absent and only Media may have started:** a future, separately authorized Media-only retirement action may retire local staging while retaining the unresolved orphan-image audit trail. The current system has no such action; do not simulate it with Return to Review or manual SQL.

For the historical revision, at most one orphan EPS image may exist because only the first front-Media operation started and every later operation remained pending. Its identity cannot be recovered without the returned Location/Media identity. For current ProductionPilot02, the safe action in this run is no-op: keep publishing disabled, obtain the database evidence and exact eBay absence reads, then request separate authorization for either an ordinary first publish (only if no frozen history and remote absence are both proven) or a specifically designed recovery.

## Prioritized independent findings

### P0 — initial Media path validated too late — fixed

Reproducer: review data that passed shallow readiness but violated a final payload schema could transition to publish-ready, freeze an operation plan, and reach Media before final payload construction. Minimal fix implemented: one complete new-publication payload validator at both transition and freeze seams, with action-level assertions that invalid content cannot mark ready, capture a revision, or create the remote gateway.

Evidence: `services/sidecar/src/ebay/variation-listing-payloads.ts:435`, `services/sidecar/src/ebay/variation-listing-actions.ts:1015`, and `services/sidecar/src/ebay/variation-listing-publication.ts:224`.

### P0 — incident identities were conflated — operationally contained

Reproducer: compare the UI error variation ID/revision with direct current responses. They identify different groups. Minimal fix: production checklist now requires exact group/revision/variation/SKU comparison and stops on mismatch. Current historical data remains untouched.

### P1 — no safe Media-only retirement contract — open

An identity-less unknown Media call cannot be reconciled or replayed, while existing Return to Review correctly requires terminal cleanup. Proposed patch: add a narrowly named retirement transition requiring (a) an initial frozen revision, (b) exactly one or more Media operations started/unknown and zero non-Media operations started, (c) fresh exact remote absence for every frozen SKU, offer, and group, and (d) append-only `orphan-image-unknown` evidence. It must never authorize replay or remote deletion. Add crash tests at response-before-checkpoint and evidence-persistence boundaries. This is high-risk state-machine/schema work and needs separate authorization.

Evidence: `services/sidecar/src/ebay/variation-listing-publication.ts:916-937` fails closed when Media identity is absent; no retirement transition exists.

### P1 — database/RPC publish-ready authority — review remains open

The database's existing allowance for Variation group titles up to 80 is correct and must be retained. **The proposed 1–65 title migration is canceled.** Independently audit the group-draft and mark-ready SQL/RPC functions for authoritative 80-character title and 65-character selector checks, including any idempotent publish-ready return path. The Sidecar now enforces the full outbound payload schema ahead of transition and Media; no database migration was created or applied during this investigation.

Evidence: `supabase/migrations/20260902140000_mark_variation_listing_publish_ready.sql:34-46` includes an idempotent publish-ready path; `20260901150000_apply_variation_listing_group_review_draft.sql:21-50` should be checked for title-length enforcement; `20260904183000_recover_failed_initial_variation_publication.sql:14-16` has the selector-only `NOT VALID` constraint.

### P1 — frontend recovery identity is shallow — open

Frontend merge/action validation relies primarily on group/revision shape and can accept a response whose variation IDs are reordered or replaced under the same group/revision. Proposed minimal contract: Sidecar returns the frozen `snapshotDigest` plus ordered variation IDs/SKUs for recovery actions; frontend requires exact equality before merging or enabling an action. Add mismatch tests for swapped/replaced IDs and stale same-revision responses.

Evidence: companion frontend `app/variation-listings/variation-publication-panel.tsx:26-34` validates group-level shape but not ordered variation identity or snapshot digest.

### P1 — Media result-before-checkpoint crash window — guarded but unresolved

If eBay creates Media and the process dies before durable identity persistence, the correct result is the current fail-closed unknown state, but it is operationally unrecoverable. The Media-only retirement proposal above bounds local recovery without pretending remote certainty. Do not weaken the checkpoint grammar.

Evidence: `services/sidecar/src/ebay/variation-listing-publication.ts:948-966` has an unavoidable remote-create-before-durable-confirmation interval.

### P2 — preflight-to-Media remote drift — open

Local validation and merchant-location reads cannot prove SKU/group absence immediately before Media. Before any separately authorized initial production publication, add or reuse exact read-only eBay item/offer/group absence checks tied to the frozen targets. Conflict or unknown must stop before Media.

### P2 — stale same-revision UI merge — open

Title editor local state remounts on group ID plus desired revision; server changes at the same revision can leave stale text. Generated/update response checks permit revisions greater than or equal to the request rather than exact response identity. Proposed fix: reset from a server aggregate identity token and require exact CAS response identity; do not unlock recovery actions merely to permit edits.

Evidence: companion frontend `app/variation-listings/variation-inventory-panel.tsx:121-126` resets only on group/revision; `variation-group-review-panel.tsx:18-48` accepts `>=` revision responses.

## Separately authorized next step

1. Keep `EBAY_PUBLISH_ENABLED=false`.
2. Run and retain the two sanitized read-only SQL result sets above in the verified Supabase project.
3. Run exact production eBay GETs for the current group key, both SKUs, and both SKU offer collections.
4. If any identity differs or any read is unknown/present, stop and design the matching recovery branch.
5. Only if ProductionPilot02 has no frozen history and all exact remote targets are proven absent, request explicit authorization for one normal UI publication window. The historical revision remains quarantined and requires separate Media-only retirement design authorization.

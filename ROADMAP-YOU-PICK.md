# ROADMAP — YOU PICK

This roadmap is intentionally separate from `ROADMAP.md`. You Pick is a dedicated Inventory API variation-group workflow, not a third legacy Single/Lot capture type. Backend and frontend work must remain isolated from existing Single and Lot contracts unless a roadmap task explicitly says otherwise.

## Current product and service understanding

- One buyer-facing eBay listing is represented by one `InventoryItemGroup` and a complete ordered set of child inventory items and offers.
- Each selectable card owns an immutable child SKU, one inventory item, one offer, one selector value, one price, one quantity, and one front/back image pair.
- The group owns title, description, category, marketplace, merchant location, business policies, shared aspects, selector definition, and one shared condition tier/descriptors.
- Every child in a group must satisfy the same selected condition contract. A card needing another condition belongs in another group.
- The selector aspect/value must be repeated consistently between group `variesBy` and child `product.aspects`. Image pivot behavior and child title/description placement remain subject to the live Sandbox proof.
- Group replacement is always a complete snapshot. Omission-based patching is unsafe.
- Listings created through Inventory API must continue to be managed through Inventory API; Trading API is used only for the narrow Sandbox identity proof already documented.
- Publication is group-scoped. Pricing, quantity, order reconciliation, and sold history are child-SKU-scoped.
- The observed reference listing exposed 87 selector values, but this does not establish a universal API or operational limit. The initial application cap remains 2–3 until Sandbox and operational evidence justify expansion.
- The frontend requires a separate You Pick workspace. It must not reuse the singular Single/Lot listing state machine or capture selector.
- No production write is authorized by implementation, tests, or Sandbox success alone.
- No You Pick database migration, schema change, repository, or database write has occurred. Current pilot state is stored only in ignored `.local/you-pick-sandbox/**` manifests.
- The You Pick worktree and canonical `backend-services` use the same hosted Supabase database; Git/worktree isolation does not isolate database state.
- The first shared database mutation is therefore a separate authorization gate and practical commitment point. It must use additive `you_pick_*` structures and must not alter existing Single/Lot tables, enums, triggers, policies, or runtime behavior.

## Task sizing and model routing

Each roadmap row should be delegated as one bounded task with exact allowed files, explicit acceptance criteria, and only targeted tests.

- **Luna:** bounded implementation, schemas, adapters, repositories, DTOs, UI components, documentation, and tests after architecture is fixed.
- **Luna + Sol review:** implementation is bounded, but the result touches remote actions, lifecycle transitions, or cross-layer contracts and requires stronger review.
- **Sol:** architecture, persistence identity, state machines, destructive operations, eBay mutation orchestration, and production gates.
- **Operator + Sol review:** live eBay execution or buyer-facing manual verification. These tasks require explicit authorization and cannot be inferred from roadmap status.

A Luna task must not invent a new architecture, widen scope, change Single/Lot behavior, or resolve an undocumented eBay ambiguity. Escalate to Sol when a supposedly bounded task reveals a contract change.

## Phase 0 — Discovery and reversible Sandbox proof

| ID | Status | Suggested model | Atomic task | Done when |
| --- | --- | --- | --- | --- |
| YP0.1 | Complete | Sol | Inspect reference item `285274212401` | Category `261328`, shared condition, 87 selector values, availability, sampled prices, and paired-image evidence are recorded in `docs/you-pick/reference-listing.md`. |
| YP0.2 | Complete | Sol | Reconcile the buyer model with Inventory API | The child item + offer + complete `InventoryItemGroup` + `variesBy` + group publish model is documented. |
| YP0.3 | Complete | Sol | Define the MVP boundary and field ownership | `docs/you-pick/architecture.md` separates group-owned and child-owned fields and keeps Single/Lot unchanged. |
| YP0.4 | Complete | Sol | Define the reversible 2–3 card Sandbox runbook | `docs/you-pick/sandbox-pilot.md` defines isolation, staged writes, attestations, rollback, and exact cleanup. |
| YP0.5 | Complete | Sol | Implement and run the guarded read-only preflight | Version-4 run `20260804T133811Z-2c5506` passes identity, policy/location, metadata, and all five exact collision-absence reads. |
| YP0.6 | Complete — implementation only | Sol | Implement and review the version-5 mutation harness | Manifest integrity, explicit headers, staged checkpoints, complete publication/quantity reconciliation, attestations, tri-state recovery, withdrawal, and exact cleanup pass offline tests. No live mutation has occurred. |
| YP0.7 | Complete — run `20260804T173924Z-967292` | Operator + Sol review | Create a fresh version-5 read-only preflight run | Version-5 manifest reached `preflight-complete` with current seller, host, policy/location, metadata, arrangement-integrity, and collision-absence gates passed. No mutation occurred. |
| YP0.8 | Complete — Sandbox listing `110590142987` | Sol review + Operator | Obtain separate operator authorization for the publication-only resume | Run `20260804T173924Z-967292` published once from commit `38495eae149885e1f324984ad120e5aadbdd86f9`; `publish-group` completed/1 with zero replay, both offers reconciled to listing `110590142987`, and the manifest stopped at `awaiting-published-view-verification`. |
| YP0.9 | Failed — buyer-view images and switching | Operator | Verify the published buyer experience and write the attestation | Listing `110590142987` passed selector label/order, distinct prices, title, and description, but all four image slots were non-renderable placeholders and selector switching did not update the image pair. No attestation was created; a separately reviewed cleanup or corrective path is required. |
| YP0.10 | Blocked — YP0.9 failed | Operator + Sol review | Execute and verify the quantity-zero experiment | Only the target child becomes unavailable or out of stock, every other child remains purchasable, group membership is unchanged, and the quantity attestation is accepted. |
| YP0.11 | Blocked by YP0.10 | Operator + Sol review | Withdraw, clean every run-owned resource, and record sanitized results | Offers, group, and child items are proven absent; the manifest reaches `cleanup-complete`; durable conclusions are written to a tracked sanitized `docs/you-pick/sandbox-pilot-results.md`. |

## Phase 1 — Final domain architecture

| ID | Status | Suggested model | Atomic task | Done when |
| --- | --- | --- | --- | --- |
| YP1.1 | Blocked by YP0.11 | Luna | Convert the Sandbox result into explicit architecture decisions | The accepted selector, title/description placement, image placement/order, quantity-zero behavior, cleanup findings, and unresolved limits are recorded without copying raw `.local` evidence. |
| YP1.2 | Blocked by YP1.1 | Sol | Finalize the group aggregate, identities, field ownership, and MVP cap | Stable group/variant IDs, SKU rules, selector immutability, shared invariants, remote IDs, and a configurable initial operational cap are defined. |
| YP1.3 | Blocked by YP1.2 | Sol | Finalize lifecycle, error, recovery, and deletion contracts | Draft, review, publish, active, partial-failure, retry, sold, withdraw, abandon, and cleanup transitions have explicit allowed actions and fail-closed error classes. |

## Shared database boundary — practical commitment point

Until YP2.4, You Pick remains isolated from the shared application database. Schema design, migration authoring, static review, and local or disposable-database validation do not authorize a write to the hosted Supabase project.

**YP2.4 is the expected first shared database write and the practical point of no return for database isolation.** Once that additive migration is applied, canonical `backend-services` and the You Pick worktree will both observe the new schema even if only one branch contains code that uses it. The migration must therefore be applied once through the canonical migration workflow, only after explicit authorization and compatibility review.

Before YP2.4:

- confirm the exact shared Supabase project and migration history;
- prove the migration is additive and namespaced under dedicated `you_pick_*` tables or equivalent isolated structures;
- verify existing Single/Lot queries, generated types, RLS, triggers, functions, and services remain compatible;
- validate forward migration, rollback or compensating migration, and empty-database recreation against a local or disposable database; and
- record the expected canonical and feature-branch behavior before and after application.

After YP2.4, database changes remain separately reviewed and authorized. A feature-branch rollback does not remove an already applied shared migration.

## Phase 2 — Persistence and repositories

| ID | Status | Suggested model | Atomic task | Done when |
| --- | --- | --- | --- | --- |
| YP2.1 | Blocked by YP1.3 | Sol | Finalize the additive persistence design without writing the database | Exact `you_pick_*` tables, keys, constraints, ownership, ordering, image references, RLS intent, generated-type impact, and Single/Lot compatibility are documented. No migration is applied. |
| YP2.2 | Blocked by YP2.1 | Luna + Sol review | Author the initial group/variant migration and focused database tests | Migration SQL, rollback or compensating SQL, schema tests, and empty-database recreation are complete in the repo, but no hosted database command is run. |
| YP2.3 | Blocked by YP2.2 | Sol | Review the initial migration against the canonical backend and shared Supabase project | Exact project identity, current migration history, additive-only behavior, RLS/triggers/functions, generated types, canonical compatibility, and recovery procedure are approved. No database write occurs. |
| YP2.4 | Blocked by YP2.3; explicit authorization required | Operator + Sol review | Apply the initial additive migration through the canonical migration workflow | **First shared database write / practical commitment point.** The migration is applied exactly once, recorded in canonical migration history, and post-apply checks prove existing Single/Lot behavior remains compatible. |
| YP2.5 | Blocked by YP2.4 | Luna + Sol review | Author the operation-ledger and remote-state migration without applying it | Item, offer, group, publish, revision, withdrawal, and cleanup checkpoints have additive schema, constraints, tests, and recovery SQL ready for review. |
| YP2.6 | Blocked by YP2.5; explicit authorization required | Operator + Sol review | Apply the reviewed operation-ledger migration | The second shared migration is applied once through the canonical workflow and exact schema/read compatibility checks pass before application code is enabled. |
| YP2.7 | Blocked by YP2.6 | Luna | Implement repositories and mapping tests | Typed repositories can create, load, update, and transactionally reconcile the aggregate and operation ledger with focused tests; no existing listing repository is widened. |
| YP2.8 | Blocked by YP2.7 | Sol | Add sold-history and deletion persistence constraints | Order-line linkage and sold variants cannot be erased; unsold groups/variants can be abandoned or deleted only through the approved lifecycle. |

## Phase 3 — Explicit intake and image ownership

| ID | Status | Suggested model | Atomic task | Done when |
| --- | --- | --- | --- | --- |
| YP3.1 | Blocked by YP2.7 | Luna | Define the You Pick intake request/manifest schema | The contract requires group metadata, ordered children, stable selector values, exactly front/back image roles, and no adjacency-based inference. |
| YP3.2 | Blocked by YP3.1 | Luna | Implement intake validation and image-storage ownership | Duplicate identities, ordering errors, missing image roles, mixed condition inputs, and unsafe paths fail before persistence; storage paths remain group/variant owned. |
| YP3.3 | Blocked by YP3.2 | Luna | Persist an intake aggregate through a dedicated service/API seam | A valid intake creates the group, ordered variants, and image references atomically without invoking Single/Lot watcher grouping. |

## Phase 4 — AI generation and per-card pricing

| ID | Status | Suggested model | Atomic task | Done when |
| --- | --- | --- | --- | --- |
| YP4.1 | Blocked by YP3.3 | Luna | Add per-child identity and review-draft generation | Each child receives deterministic identity fields and review notes while preserving source-image evidence and avoiding unsupported year/card guesses. |
| YP4.2 | Blocked by YP4.1 | Sol | Add shared group-content generation and condition compatibility | Group title/description/shared aspects are generated once; every child must pass the selected shared condition tier before the group can advance. |
| YP4.3 | Blocked by YP4.1 | Luna | Add per-child SoldComps pricing and controlled repricing | Pricing runs independently by child SKU, stores evidence/modifiers, supports targeted retry, and does not overwrite reviewed manual values without an explicit action. |

## Phase 5 — Inventory API publishing and recovery

| ID | Status | Suggested model | Atomic task | Done when |
| --- | --- | --- | --- | --- |
| YP5.1 | Blocked by YP1.2, YP4.2, and YP4.3 | Luna | Build deterministic child-item, child-offer, and complete-group payload builders | Runtime schemas enforce the Sandbox-proven selector, content, image, condition, policy, quantity, and price contracts; group replacement is complete. |
| YP5.2 | Blocked by YP2.6 and YP5.1 | Sol | Implement durable item/offer creation and group publication orchestration | Every remote step checkpoints before/after mutation, reconciles exact reads, and publishes only after the complete unpublished aggregate matches persisted intent. |
| YP5.3 | Blocked by YP5.2 | Sol | Implement publish reconciliation, retry, and active price/quantity revisions | Unknown outcomes never replay blindly; child updates preserve full group membership and one unambiguous listing lifecycle. |
| YP5.4 | Blocked by YP5.3 | Sol | Implement withdrawal, abandon, and exact unsold cleanup | Dependency-ordered cleanup removes only aggregate-owned unsold resources, preserves sold history, and proves final absence. |

## Phase 6 — Dedicated backend API

| ID | Status | Suggested model | Atomic task | Done when |
| --- | --- | --- | --- | --- |
| YP6.1 | Blocked by YP2.7, YP3.3, and YP4.3 | Luna | Expose dedicated group/variant read, create, and edit contracts | Typed DTOs and routes expose aggregate state, ordered children, validation, pricing evidence, and operation summaries without modifying `/listings` unions. |
| YP6.2 | Blocked by YP5.4 and YP6.1 | Luna + Sol review | Expose publish, retry, quantity, withdraw, abandon, and cleanup actions | Action routes enforce lifecycle permissions, return stable error summaries, emit dedicated realtime events, and have focused contract tests. |

## Phase 7 — Separate frontend workspace

| ID | Status | Suggested model | Atomic task | Done when |
| --- | --- | --- | --- | --- |
| YP7.1 | Planned; may begin after YP6.1 contract draft | Luna | Inspect the frontend worktree and add the route/navigation/list shell | `ebay-ui-app-you-pick` has a separate You Pick entry point, group list, API seam, realtime seam, and test harness without reusing singular listing state. |
| YP7.2 | Blocked by YP7.1 and YP6.1 | Luna | Build the group and ordered-variant editor | Users can edit group fields, add/remove/reorder unsold children, manage selector values, view front/back images, and see shared-condition compatibility. |
| YP7.3 | Blocked by YP6.2 and YP7.2 | Luna + Sol review | Add pricing, validation, publish, retry, and recovery UX | The workspace exposes per-child pricing, group blockers, operation progress, actionable failures, withdrawal/cleanup controls, and focused UI tests. |

## Phase 8 — Orders and sold-state reconciliation

| ID | Status | Suggested model | Atomic task | Done when |
| --- | --- | --- | --- | --- |
| YP8.1 | Blocked by YP5.2 | Sol | Verify the eBay order payload and finalize child-SKU matching/idempotency | The selected variation can be matched reliably to one child SKU/order line, with explicit duplicate-event and partial-order rules. |
| YP8.2 | Blocked by YP2.8 and YP8.1 | Luna | Implement order-line persistence, quantity reconciliation, and sold guards | Purchases persist selected child identity, decrement availability idempotently, preserve sold history, and block unsafe child/group deletion. |

## Phase 9 — Integrated scale and production gates

| ID | Status | Suggested model | Atomic task | Done when |
| --- | --- | --- | --- | --- |
| YP9.1 | Blocked by YP7.3 and YP8.2 | Operator + Sol review | Run a complete 2–3 card application-level Sandbox pilot | Intake through order/reconciliation and cleanup succeeds through the real application seams with no Single/Lot regression. |
| YP9.2 | Blocked by YP9.1 | Operator + Sol review | Run a 10-card Sandbox pilot and set the next operational cap | Selector, images, performance, revisions, recovery, and operator workload are measured; the cap is changed only from recorded evidence. |
| YP9.3 | Blocked by YP9.2 | Operator + Sol review | Complete production readiness review and a guarded low-value pilot | Credentials, policies, monitoring, rollback, support procedures, and audit evidence pass review before one explicitly authorized production listing. |

## Permanent constraints

- One shared eBay condition contract per group; no mixed-condition publication.
- One immutable SKU and selector identity per child; selector labels do not encode stock, price, or UI-only suffixes.
- Complete group snapshots only; no omission-based group patching.
- Inventory API owns all listing mutations after creation.
- Exact read-before-write recovery; unknown remote state never authorizes replay or destructive cleanup.
- Existing Single and Lot intake, generation, pricing, publishing, reconciliation, deletion, routes, and SKU grammar remain unchanged.
- No hosted database migration or data write may be inferred from a completed coding task. YP2.4 and later migration-application tasks require separate explicit authorization.
- Shared Supabase changes are applied once through the canonical migration workflow; never independently from both worktrees.
- Before the first shared migration, all database validation uses local or disposable infrastructure. Feature-branch code must not write experimental rows into canonical tables.
- No raw `.local/you-pick-sandbox/**` artifact is committed. Only sanitized durable conclusions belong in tracked documentation.
- No production write occurs without a separate explicit authorization after all preceding gates pass.

## Current next action

YP0.9 failed buyer-view verification for run `20260804T173924Z-967292`, Sandbox listing `110590142987`. Selector label/order, distinct prices, title, and description passed, but the four image slots were non-renderable placeholders and switching selector values changed price without changing the image pair. No published-view attestation was created. YP0.10 remains blocked; next action requires a separately reviewed cleanup or corrective path. The observed buyer-view quantity display does not constitute the quantity-zero experiment. No quantity action, withdrawal, deletion, or cleanup has run. Database work does not begin until Phase 2; YP2.1–YP2.3 remain no-write design/review tasks, and YP2.4 is the separately authorized first shared database write.

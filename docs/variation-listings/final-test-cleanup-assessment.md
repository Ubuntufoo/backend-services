# You Pick final test cleanup — scoped assessment

Status: complete — Codex gap review found no further safe test/fixture deletion; the isolated scale-pilot retirement remains the only approved removal.

## Boundaries

- Worktree: `backend-services-you-pick` (`feature/you-pick`).
- Do not touch the shared hosted database, eBay, R2, operator media, applied migrations, V3 durable history or adjacent frontend repo during the first backend cleanup slice.
- Preserve V1 initial-publication to V3 active-revision bridge coverage, unsupported-version rejection, two-sellable-variation rules, exact Offer/Inventory ownership, sibling isolation, publish/withdraw guards, order evidence and unknown-outcome recovery.
- Distinguish the Sandbox fixture/payload arrangement `version: 2` from unsupported durable `snapshot_version=2` active-snapshot semantics; the former is not evidence of obsolete production compatibility.

## Inspected inventory

- `services/sidecar/tests/unit/ebay`: 46 test files were inventoried, including 26 `variation-listing-*.test.ts` files (the retired scale-pilot test is included in this pre-removal count); counts are inventory only, not deletion criteria.
- The bounded multi-read returned 21 Variation test files and skipped five oversized files (actions, active revision, permanent removal, Sandbox pilot, Sandbox pilot mutation); skipped files must **not** be classified as redundant without inspection.
- Frontend `app/variation-listings` includes four test files; the workspace test exceeded the bounded read and remains unaudited.
- No exact duplicate non-parameterized test titles were identified in the 21 readable backend Variation suites. Reused `%s` parameterized titles do not establish duplicate coverage.
- Durable active-revision validation rejects unsupported `snapshot_version=2`; this remains distinct from the valid Sandbox fixture/payload `version: 2` arrangement, and both facts must be preserved.

## Completed first removal: retired scale-pilot helper

The following were a self-contained offline measurement/planning flow, not the live variation application publishing pipeline, and were independently reviewed before retirement:

1. `services/sidecar/src/ebay/variation-listing-scale-pilot.ts`
2. `services/sidecar/src/scripts/variation-listing-scale-pilot.ts`
3. `services/sidecar/tests/unit/ebay/variation-listing-scale-pilot.test.ts`
4. `services/sidecar/package.json` script `ebay:scale-pilot`
5. `docs/variation-listings/scale-pilot-runbook.md` (references that command and holds historical rationale)

Read-only reference search found the scale helper called only from its CLI/tests and package script/runbook; no service/HTTP/FE caller was found in inspected source. It modeled a historical Sandbox 10→20-variation measurement exercise and a four-price-tier fixture. The helper was confirmed obsolete; historical measurements and architecture notes remain preserved in the archived runbook.

## Explicitly not approved for indiscriminate pruning

- `variation-listing-active-revision.test.ts`, `variation-listing-actions.test.ts`, `variation-listing-permanent-removal.test.ts`, and `variation-listing-sellable-guard.test.ts`: core fail-closed/production-safety coverage.
- The historical Sandbox harness and its `version: 2` fixtures: may still protect explicit sandbox CLI read-before-write and recovery behavior; audit before considering deprecation.
- YP9.6c4 image-journal, quarantine, R2 content proof and SQL prototype suites: some protect future work or fail-closed behavior even though automated deletion is deferred. Treat as a **separate architecture/disposition decision**, not an automatic dead-code assumption.
- Applied Supabase migrations and generated types: immutable provenance and shared hosted schema.

## Independent verification, decision, and result

- Reference proof: a worktree-wide search excluding `.chatgpt`, ignored build artifacts, and `.local` found the helper exports only in the deleted module, its CLI, and its dedicated test; the CLI had only the package-script entry. No service, HTTP, watcher, frontend, or other production caller was found. The pre-existing roadmap mention remains untouched and is not an executable dependency.
- Decision: remove the isolated helper module, CLI, dedicated test, and `ebay:scale-pilot` package script together. Preserve the runbook as an explicitly archived, non-executable historical record; remove deleted-command instructions while retaining the `4N + 3`/`2K + 1` formulas, 10/20 fixture and replenishment evidence, promotion gates, and sanitized conclusions.
- Result: the three isolated TypeScript files and package script are removed; no other tests, production paths, Sandbox harness, or roadmap content are deleted.

## Verification contract for this slice

Completed/passed focused checks: `pnpm --filter sidecar typecheck`; `pnpm --filter sidecar exec vitest run tests/unit/ebay/variation-listing-sellable-guard.test.ts tests/unit/ebay/variation-listing-pending-changes.test.ts tests/unit/ebay/variation-listing-zero-stock-auto-reconcile.test.ts` (44 tests); `git diff --check`; and `git status --short`. No full-suite deletion claim is made.

## Next proposed slice

This proposed slice is now complete via the Codex gap review below. Any future removal of a retained test, fixture, prototype, or Sandbox CLI requires a new explicitly scoped architecture/CLI decision and independent proof; no further deletion is implied by this assessment.

## ChatGPT independent second-pass audit — 2026-11-19 (before Codex gap review)

**Scope:** static repository inspection only through GPT Repo MCP (no test execution, remote writes, or source/test deletion in this pass). This independently audits the *remaining* test coverage after the accepted isolated scale-pilot retirement above. Codex must challenge the conclusions and run scoped verification; passing results from the previous scale-pilot slice are **not** represented as newly rerun here.

### Inventory and coverage disposition

| Scope | Examined / identified | Disposition and why |
| --- | --- | --- |
| Backend `services/sidecar/tests/unit/ebay` Variation | **25** `variation-listing-*.test.ts` suites now remain (the removed scale-pilot test is not included). | **KEEP.** Specific checks protect V3 immutable revision/counter semantics, exact Offer/Inventory membership, ambiguous remote outcomes, 2-sellable guard, revision retries, price/quantity, permanent removal and cleanup safety. |
| Backend HTTP Variation | **7** `tests/unit/http/variation-listing-*.test.ts` suites | **KEEP.** API/CAS/status/route semantics, watcher ownership, staged quantity and fail-closed purge-preview guards are different from domain-only tests. |
| Backend Gemini Variation | **3** suites under `tests/unit/gemini` | **KEEP.** Identity evidence and selector length, truthful common aspects, group description, bounded model output, and watcher file containment. |
| Backend dedicated Sandbox/CLI | **3** `variation-listing-sandbox-pilot*.test.ts` under `tests/unit/scripts`, plus `verify-variation-listing-sandbox.test.ts`, `verify-variation-listing-live-status.test.ts`, and the inventory-variation-listing API seam test | **KEEP for now.** `services/sidecar/package.json` still wires `ebay:pilot-variation-listing-sandbox` and `ebay:verify-variation-listing-sandbox`; test suites verify read-before-write, identity pinning, symlink handling, sanitized output, guarded mutations and exact recovery. Any retirement would require an explicit **CLI/runtime** decision, not deleting its safety tests alone. |
| Frontend `app/variation-listings` | **4** test suites: page, polling, workspace, publication panel | **KEEP.** Page/API isolation, 60s idle/2s armed polling, hidden/in-flight abort, session-storage selection, capture routing, price and quantity staging, recovery and publication lock/confirmation all remain relevant. |
| Sandbox fixtures | `two-card.json` (`version: 2`) and `two-card-legacy-v1.json` (`version: 1`) | **KEEP both.** Their parsed objects are equal except for the top-level version, but each is referenced for distinct Sandbox fixture/legacy rejection and recovery contracts. Crucially Sandbox fixture `version: 2` does **not** mean obsolete durable active-revision `snapshot_version=2`. |

### Oversized-suite review (prior read limitation addressed by independent search)

- `variation-listing-actions.test.ts`: targeted text search indexed **67** literal `it(` entries, including publish-disable, net-zero rejection, nonreplay of unknown outcomes, withdrawal, C2 cleanup, and bounded retry. These are nontrivial behavior checks; no safe whole-suite deletion identified.
- `variation-listing-active-revision.test.ts`: targeted text search indexed **84** literal `it(` entries including v1-to-v3 bridge, unsupported snapshot version rejection, fresh eBay quantity drift and reprepare, remote identity/OAS proof, snapshot digest, and unknown replay. Keep.
- `variation-listing-permanent-removal.test.ts`: full file was read (70,335 bytes, 1,371 lines) and test cases protect sellable-survivor guard, pre/post drift, Offer policy proof, frozen plan/revision invariants and recovery. Keep.
- `variation-listing-sandbox-pilot.test.ts` and `variation-listing-sandbox-pilot-mutation.test.ts`: full files were read (101,317 and 64,954 bytes respectively). They cover still-wired sandbox CLI plans, guarded mutation, attestation and fail-closed cleanup. Keep unless corresponding CLI is intentionally retired in a separately approved source removal.
- Frontend `variation-listings-workspace.test.tsx`: targeted text search indexed **86** literal `it(` entries including capture ownership, polling race conditions, persisted bucket selection, quantity and price staging, selector/title validation, and Gemini description. This is current UI regression coverage; keep.
- **Limit:** the oversized actions, active-revision, and frontend workspace files exceeded bounded MCP content-reading limits; searches returned their test names without scanning every assertion/body. Codex should read their full contents locally, look for exact duplicate assertions, and identify missed stale fixtures. No claim of exhaustive per-assertion review is made here.

### Specific potential cleanup candidates (not yet approved for deletion)

1. `services/sidecar/src/ebay/variation-listing-removed-sku-cleanup-persistence.ts`, `variation-listing-removed-sku-r2-content-proof.ts`, and `variation-listing-removed-sku-local-quarantine.ts` each had only a self-definition in a source-only exact-symbol search for `createRemovedSkuCleanupPersistence`, `verifyRemovedSkuR2Content`, and `quarantineDisposableRemovedSkuArchive`. Their corresponding test suites explicitly cover **non-authorizing**, fail-closed prototype or quarantine behavior. These are plausible **orphan prototypes**, not a safely established removal target: removing tests without reviewing the module architecture, indirect consumers and deferred image cleanup roadmap is inappropriate. Codex should check all symbol/filename/dynamic imports and classify each KEEP or separately propose a retirement package; do **not** delete these runtime modules by default.
2. `variation-listing-removal-only.test.ts` and `variation-listing-zero-stock-auto-reconcile.test.ts` are small suites that may overlap large actions/pending-changes suites by feature area. They directly test an isolated removal-only predicate and the exact eBay Offer 25013 auto-reconciliation predicate; keep unless Codex demonstrates *identical test inputs and expectations* in retained suites.
3. The two Sandbox fixtures are visually duplicated except their top-level versions; this is **intentional**, not dead fixture duplication. A deliberate fixture consolidation could save very little and risk losing the explicit protocol compatibility checks; no change proposed.

### Verification and disposition

**No newly justified test deletions or edits were made in this independent second pass.** Previously deleted scale-pilot artifacts remain recorded above. No new `pnpm`, Vitest, TypeScript, or runtime verification was run by ChatGPT: MCP repo access offers file inspection/editing, not local test execution. Follow-on Codex should independently inspect all large bodies, verify potential prototype/symbol callers, identify gaps in safety tests and run tightly scoped verification. If no additional safe obsolete tests are established, close the audit with a documented KEEP decision rather than pruning meaningful regression coverage for file-count reduction.

## Codex gap review — 2026-11-19

**Scope:** local read-only audit of every previously skipped oversized backend suite, exact-title duplication check, candidate prototype source/tests, dynamic-import references, and focused execution. No production/runtime mutation, hosted write, staging, commit, or push.

### Oversized backend suites — KEEP

The full local files were read, not only title-indexed. Literal test counts and distinct contracts are:

| Suite | Tests | Retained contract |
| --- | ---: | --- |
| `variation-listing-actions.test.ts` | 86 | publish-window and net-zero gates, unknown-outcome non-replay, withdrawal ownership/recovery, unpublished cleanup, bounded retry and redaction/error normalization |
| `variation-listing-active-revision.test.ts` | 161 | V1 initial-publication → V3 active bridge, unsupported durable `snapshot_version=2` rejection, digest lineage, fresh remote quantity/price drift and reprepare, exact sibling/Offer/Inventory proof, bounded unknown replay and terminal-zero/restock guards |
| `variation-listing-permanent-removal.test.ts` | 76 | exact policy and frozen-plan proof, target/survivor/order drift, sellable-survivor guard, unknown post-mutation recovery, membership ordering and no-replay safety |
| `variation-listing-sandbox-pilot.test.ts` | 62 | versioned fixture/manifest validation, read-before-write gates, identity and symlink/path safety, C01/C02 recovery, publication evidence, cleanup accounting and redaction |
| `variation-listing-sandbox-pilot-mutation.test.ts` | 60 | attested staged mutation, ordered EPS/child writes, checkpoint/recovery semantics, malformed/unknown response handling, exact sibling proof and cleanup blocking |

An exact non-parameterized `it`/`test` title comparison across these files found no duplicate titles. Parameterized cases remain intentionally distinct by input/expectation. The Sandbox pilot remains wired by `ebay:pilot-variation-listing-sandbox`; its `version: 2` fixture contract remains unrelated to rejected durable active `snapshot_version=2`.

### Frontend gap review — KEEP

The companion `ebay-ui-app` worktree was audited read-only. Its four `app/variation-listings` suites contain no external fixture/helper files, exact duplicate test blocks, dead builders, or unused test-only imports. The 3 page, 5 polling, 86 workspace, and 23 publication-panel literal tests preserve distinct API isolation, 60-second/2-second polling and visibility/abort races, session selection, capture routing, price/quantity staging, recovery/reprepare, publication locks/CAS, selector validation and malformed-event fail-closed behavior. Parameterized matrices expand the focused run to **142 passing tests across 4 suites**. Targeted lint and `pnpm exec tsc --noEmit --incremental false` passed; the frontend worktree remained clean. No frontend edit or deletion is justified.

### Prototype candidate disposition — KEEP

Worktree-wide filename, symbol, and dynamic-import searches found no runtime caller for:

- `variation-listing-removed-sku-r2-content-proof.ts` / `verifyRemovedSkuR2Content`;
- `variation-listing-removed-sku-local-quarantine.ts` / `quarantineDisposableRemovedSkuArchive`;
- `variation-listing-removed-sku-cleanup-persistence.ts` / `createRemovedSkuCleanupPersistence` beyond its dedicated unit seam.

This does **not** establish dead artifacts. The three modules are explicitly non-authorizing, fail-closed EXEC2/EXEC3/EXEC1 seams. Their tests assert no delete/move authority, strict identity/content bounds, symlink/hardlink and inode replacement rejection, CAS transitions, unknown recovery, and sibling/collision preservation. The persistence RPC names are also consumed by the unapplied cleanup-journal migration and `packages/data/tests/validate-variation-removed-sku-cleanup-journal.mjs`/tombstone validators; the R2/quarantine seams are named in the deferred YP9.6c4/YP-MEDIA.REUSE architecture. No separately authorized CLI/runtime retirement package exists. Keep source and tests pending an explicit architecture decision; do not delete tests merely because current callers are test-only.

The small `variation-listing-removal-only.test.ts` and `variation-listing-zero-stock-auto-reconcile.test.ts` suites remain KEEP: they isolate the removal-only predicate and exact eBay Offer 25013 terminal-zero eligibility (including two-sellable, frozen 1→0, and error-identity guards) rather than duplicating action/executor integration tests. The two Sandbox fixture files remain KEEP because their top-level versions exercise distinct legacy/new protocol checks.

### Verification and final disposition

Focused backend Vitest execution passed **467 tests in 8 suites** (the five oversized suites plus the three prototype seams); the focused frontend run passed **142 tests in 4 suites**. Backend and frontend typechecks passed. `git diff --check` passed. No additional safe test/fixture deletion or test edit was identified. The isolated scale-pilot retirement remains the only approved cleanup; this task closes with **KEEP** for all remaining backend and frontend Variation tests, fixtures, Sandbox harness sources, and prototype seams.

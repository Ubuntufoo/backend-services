# You Pick final test cleanup — scoped assessment

Status: independent review complete; the isolated scale-pilot retirement is applied.

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

After parent validation, perform a separate reference/disposition audit for one explicitly named candidate only. Do not remove additional variation tests or the historical Sandbox harness without fresh proof and an independent review.

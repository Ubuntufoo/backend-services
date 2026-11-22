# You Pick feature — merge to main runbook

**Status:** DRAFT / REVIEW REQUIRED. **This document does not authorize a merge, production writes, publishing, or cleanup.** Execute only after a separate operator go/no-go. Applies to TWO independent Git repositories, backend `backend-services` and frontend `ebay-ui-app`.

## 1. Scope and evidence (checked 2026-11-21)

| Repository | Branch | Observed local HEAD | Working tree |
| --- | --- | --- | --- |
| Backend `backend-services-you-pick` | `feature/you-pick` | `a413d51e99bf2ad0beffd365985c77aceb7deaef` | Clean |
| Backend `backend-services` | `main` | `dee385365db8be5da46da6f3726a3a53874f355d` | Clean |
| Frontend `ebay-ui-app-you-pick` | `feature/you-pick` | `eb128c08caa650ee17aed676f70ac0b855fc1df7` | Clean |
| Frontend `ebay-ui-app` | `main` | `d40658baf483b174b22ce00cb07cea4b32995509` | Clean |

These are **local observation pins, not final merge authorization**. Both FE worktrees have new cleanup commits: `eb128c0` includes pnpm and corrected UI tests; `d40658b` removes tracked `.DS_Store` from main. The independent 2026-11-21 Codex audit verified then-current upstream and remote heads without fetching. It measured backend merge-base `b04594ece2a274d0e45e8ca88dbf2afb05fb036f` (main-only/feature-only `2/161`) and frontend merge-base `453aac7be848236048dcebad924d8eb12e2d0a9f` (`1/46`). These counts **predate both frontend commits**. The merge simulations had no textual conflicts, but backend `ROADMAP.md` needs semantic review. Recheck current remotes/divergence and deployment status before proceeding.

**Final cleanup evidence:** Run `.chatgpt/codex-runs/2026-11-21T041029Z-final-production-ebay-variation-only-inventory-api-cleanup-authorized/RESULT.md` reports verified deletions of 20 UNPUBLISHED Offers, 8 Variation Inventory Item Groups, and 20 Variation Inventory Items; all seven historical variation listing IDs were Completed; no residual `VL-G-*` associations. Earlier run reports Variation R2 prefix cleared (270 objects), dedicated local Variation archive removed, and all nine hosted Variation tables empty. Final API cleanup retained 206 Standard inventory items, 206 Standard offers, and 131 active listings with matching fingerprints in its bounded comparison. Historic `public.listings` count was 207, a different measure from those API counts; do not conflate.

**Accepted exception:** OAuth initialization refreshed the local backend `.env` despite a no-credential-edit instruction. The operator explicitly accepts this refreshed token state; do **not** restore old tokens or commit/expose the `.env` file. Verify authentication safely during baseline without changing production listings.

**Functional acceptance limitations:** See `ROADMAP-VARIATION-LISTINGS.md`, particularly YP10.10–10.13. Original Pilot01 A 1→2→1 and later post-fix live Withdraw were not executed; production duplicate-copy replenishment coverage was expressly skipped in one earlier pilot. Offline and other production acceptance must not be mislabeled as full live coverage. Shared sale reconciliation remains **post-merge** main roadmap `10K.3`; Master Inventory planning/implementation remains in a separate operator workstream and is out of scope here. Main roadmap `10K.1A` is **stale for already completed Production/DB cleanup**. Independent audit did not conclusively verify all Sandbox resources, buyer obligations, or local/R2 ownership. Record these limits and propose a separately authorized roadmap status correction without repeating the completed destructive cleanup. `10K.3` remains pending.

## 2. Non-negotiable safety boundaries

- Do **not** touch production eBay listings, Offers, Inventory Items, Orders, Fulfillment, R2, or hosted Supabase as part of this documentation/merge step. Merge itself is a Git operation; any remote eBay smoke publish/withdraw or hosted schema change requires separately approved exact action.
- Keep `EBAY_ENVIRONMENT=production` explicit and `EBAY_PUBLISH_ENABLED=false`, `SIDECAR_JOB_RUNNER_ENABLED=false` outside separately authorized live tests. Check actual process/runtime configuration instead of presuming a repo `.env` controls every process. Never print environment secrets.
- Production Supabase history is **shared** by feature and main. Independent read-only audit: **60** feature migration files, **35** main files, **59** hosted ledger rows; **54 exact version/name matches** and **three hash-confirmed aliases** (`20261023190000 → 20261024224204`, `20261026140000 → 20261027145825`, `20261027201000 → 20261028014018`). Hosted `20261028141612_v20261028120000_c2b_removal01_incident_delete` has no source file in reachable Git; operator believes it relates to abandoned historical incident cleanup. **Do not reconstruct, replay or delete its hosted ledger entry.** Hosted ownership-witness hash `c7605398…87d75` differs from local tracked `e12902ae…8689` in two Standard-media checks: do not replay the tracked witness. Feature-only `20261110180000_create_removed_sku_cleanup_journal.sql` and `20261111223116_create_removed_sku_exact_key_writer_barrier.sql` were **not applied**, and their hosted objects are absent. Document provenance and generated-type/runtime compatibility before deployment; **never run `supabase db push`, replay history, or mutate hosted schema during merge readiness**. Git-only merge and production deployment have separate gates.
- Variation persistence after test-data purge starts **empty and clean V3**. Do not resurrect old revision/operation records, historical Sandbox-only recovery fixtures, or obsolete test data. Unknown Media checkpoint scenarios are historical regressions, **not** live recovery cases requiring retention.
- Preserve all Standard listing rows, media, Offers, and active listing behavior. Preserve `MASTER_INV_STORAGE.md` and Master Inventory design separately; do not implement Master Inventory before the two repositories merge and their baseline is verified.
- No `git reset --hard`, force push, aggressive cleanup, branch deletion, worktree pruning, secret exports, or wholesale SQL resets. Post-merge storage cleanup is a separate approved task.

## 3. Gate A — branch state, review and source commits (operator/Codex; read-only first)

In **each** repository, from its corresponding authorized worktree:
```sh
git status --short
git branch --show-current
git rev-parse HEAD
git remote -v
git branch -vv
git worktree list
# Do not fetch or mutate refs in this read-only audit; if approved, fetch later.
git rev-parse main
git rev-parse origin/main
git merge-base main feature/you-pick
git rev-list --left-right --count main...feature/you-pick
git log --oneline --left-right --cherry-pick main...feature/you-pick
git diff --name-status main...feature/you-pick
git diff --check main...feature/you-pick
git diff --stat main...feature/you-pick
git ls-remote --heads origin main feature/you-pick
```
The prior Codex audit verified `origin` as the remote for both repos; confirm it again. `git ls-remote --heads` reads current remote refs without changing local refs; redact credentials. `origin/main` may be stale. Only run `git fetch --prune` with separate operator approval. Do not check out `main` in a feature worktree when it is already active elsewhere.

**Backend documentation scope:** The backend feature commit `a413d51` already includes both `MASTER_INV_STORAGE.md` and `merge-to-main.md`. The worktree is clean. Master Inventory planning belongs to a separate thread: **do not modify or recommit it here**. Operator must explicitly accept that already-committed documentation in the merge scope, or separately approve an alternative history-preserving disposition. Frontend feature commit `eb128c0` contains the approved pnpm policy and UI-test fixes. All four worktrees are currently clean. No new commits authorized by this runbook.

**STOP** if `main` diverged unexpectedly, any source commit is missing, unreviewed working changes exist, remote/upstream identity differs, conflicts affect generated schema or shared contracts, or a backup/ref plan is missing.

## 4. Gate B — merge plan and protected recovery refs

After branch audit, write an operator-approved execution sheet containing **both exact source SHAs**, **both exact target `main` SHAs**, remote names, worktree locations, dependency/runtime versions, approved sequencing, and any conflict resolution plan. Avoid dynamic values above stable instructions in Codex prompts.

Create **protected local backup refs** at the pre-merge `main` and feature SHAs for **each repo**, using collision-free reviewed names (e.g., `backup/pre-you-pick-main` and `backup/pre-you-pick-feature`); verify each resolves to the intended SHA. Never overwrite an existing ref without review. Optionally push backup refs only with explicit approval.

Evaluate `git merge-base --is-ancestor` and complete diff for fast-forward vs merge-commit eligibility. Prefer normal reviewable, non-force merges. A merge may require conflict resolution; preserve feature behavior and Standard compatibility, including package locks, `supabase/migrations`, V3 persistence contracts, eBay publish safety, and Next.js API proxy routes. If conflicts are nontrivial, pause before choosing a resolution. Independent merge simulations on the previous pins found no textual conflicts, but `ROADMAP.md` is a **semantic review hotspot**: preserve main's current `10K.1`, `10K.3`, `12.1`, and `12.2`; separately correct stale `10K.1A` language for completed cleanup.

**Two-repo atomicity limitation:** Git cannot merge backend and frontend atomically together. Preserve both backup refs and pin both targets. Migrate/roll out backend compatibility first, verify readiness, then frontend; if frontend is deployed before backend, enforce compatible APIs or stop. Validate production config before switching application processes.

## 5. Gate C — pre-merge verification

Run from each feature branch, with no production mutation:
- Backend: `pnpm validate:env` (safe/redacted diagnostic), `pnpm check`, `pnpm typecheck`, `pnpm test` and any documented focused Variation integration/migration contract tests. Use `pnpm --filter sidecar typecheck` and targeted test suites for failure isolation. Reconfirm watcher/image/data package tests if not covered by `pnpm test`.
- Frontend: **pnpm is authoritative**: `AGENTS.md`, README and `packageManager: pnpm@10.14.0` agree. Feature commit `eb128c0` removes obsolete tracked `package-lock.json` and leaves `pnpm-lock.yaml` authoritative; main commit `d40658b` removes `.DS_Store` tracking, and feature `.gitignore` ignores both names. Requires Node >=20. **Most recent pre-commit validation:** `pnpm test` **530/530** (46 files), `pnpm exec tsc --noEmit --incremental false`, `pnpm lint` (one pre-existing hooks warning in `app/variation-listings/variation-inventory-panel.tsx:668`), and `pnpm build` all passed. For read-only environments use no-cache typecheck; repeat checks after the final merge.
- Read-only production checks: database migration ledger and expected Variation tables/triggers; no historical Variation group rows; published Standard listings and R2 prefix integrity; eBay publish disabled and explicit seller/environment identity. Avoid tools that silently refresh/write credentials unless credential behavior is understood and acceptable. **Sidecar process safety:** `pnpm app:dev` enables `SIDECAR_JOB_RUNNER_ENABLED=true`; do not use it for the read-only merge smoke. Use an expressly configured safe process profile, with **both** `EBAY_PUBLISH_ENABLED=false` and `SIDECAR_JOB_RUNNER_ENABLED=false` asserted from the actual process environment. `dev:safe` disables the runner but does not itself override inherited `EBAY_PUBLISH_ENABLED`, so check the publish flag separately.
- Backend independent audit passed Sidecar typecheck, but **full current backend validation** and merged-branch regressions remain outstanding. Merge-range `git diff --check main...feature/you-pick` flagged trailing whitespace at `docs/variation-listings/final-doc-artifact-cleanup-manifest.md:3–4`; resolve or explicitly accept it. Frontend's earlier three failed UI assertions are now corrected and all 530 tests pass. Record precise tests and accepted gaps; feature-branch checks never substitute for post-merge regression.

**STOP** on failed typechecks, unresolved migration drift, active unreviewed publication state, broken Standard capture or variation routes, or any unknown eBay state affecting safe deployment.

## 6. Gate D — operator authorization and merge execution

**Separate explicit authorization required** after review of Gate A–C evidence. Perform in the **existing main worktrees** or a controlled integration worktree, not by switching checked-out branches in another active worktree. Verify expected SHAs immediately before each command:
```sh
# Template only; execute only after approval and exact SHA checks.
# Already in the checked-out main worktree, after explicit approval.
git merge --no-ff feature/you-pick
git status --short
git log -1 --oneline
```
If a clean fast-forward is explicitly selected instead, document why. Do not use `-X ours`/`-X theirs` indiscriminately. Resolve conflicts file-by-file, review full diff against pinned baseline, and rerun validation. Merge backend then frontend with the compatibility condition in Gate B. Push each resulting main only after operator confirmation and checks; never force push.

## 7. Gate E — post-merge baseline (before Master Inventory)

- Verify both `main` HEADs, ancestry of their feature commits, clean worktrees, expected remote updates, and backup refs; record exact SHAs and check `git worktree list`.
- Re-run backend/FE typechecks, focused Variation + Standard regression suites, and a bounded application smoke: dashboard loads, Standard records and existing listing editing operate, Variation workspace/routing and empty-group initial state render, capture arm/disarm transitions do not unexpectedly create Standard listings, existing pricing/image and order functionality remain unaffected. Do **not** manufacture a live Variation listing during this read-only baseline.
- Confirm eBay publishing remains disabled, existing Standard listings unchanged, Variation database clean, and no unexpected migration/write. Compare observed behavior to the acceptance exceptions above.
- **If green**, mark merge baseline accepted and only then begin separately scoped Master Inventory development. Shared sale-detection task 10K.3 stays separately tracked.

## 8. Recovery / rollback

- If merge is not yet pushed or deployed: pause, inspect exact state, and safely abort a *currently in-progress* conflicted merge with `git merge --abort` when applicable. Do not indiscriminately reset shared worktrees.
- If merged and pushed: preserve history and prefer a reviewed `git revert -m 1 <merge-commit>` or a forward fix, depending on observed dependencies. For fast-forward, plan explicit revert commits rather than destructive branch movement.
- If deployed: restore compatible backend and frontend revisions together (API/schema contract) using the pinned backup refs and verified deployment procedure. Database migrations generally cannot be rolled back via Git alone; write a forward-only corrective migration only with separate review and authorization. Any already published marketplace operation requires external reconciliation; a Git rollback cannot undo eBay writes.
- Always recheck Standard data and eBay publication guard after recovery. Keep the feature worktrees/branches and backup refs intact until successful post-merge verification and separate cleanup authorization.

## 9. Current go/no-go (as of document creation)

**Git-only merge: NO-GO pending final review and explicit operator authorization.** Four local worktrees are clean and the prior independent merge simulations had no textual conflicts. Re-pin remote refs/divergence after frontend cleanup commits, inspect `ROADMAP.md` semantic merge, resolve/accept backend whitespace and bundled Master Inventory documentation, finish backend test gate, and prepare protected backup refs plus an exact two-repo execution sheet. The frontend checks have passed.

**Production deployment: NO-GO separately.** Resolve/document hosted migration provenance (missing historical incident-delete source, differing witness SQL, aliases, two unapplied local files), generated-type and runtime compatibility, process-level publishing/job-runner flags, and backend-before-frontend deployment sequencing without production writes during review. Last read-only Supabase snapshot: **207 Standard `listings`** and **zero records in all nine Variation/C2B tables**. Do not repeat historical destructive cleanup.

**Next action:** Re-run current Git/ref and backend regression gates, then review remaining nonproduction blockers. Obtain **separate explicit Git-merge authorization** after that review; deployment requires its own approval.

**Out of scope now:** Master Inventory schema/UI/import development, worktree/cache deletion, additional live Variation pilots, new migrations, and modifying the completed eBay cleanup evidence.

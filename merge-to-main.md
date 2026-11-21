# You Pick feature — merge to main runbook

**Status:** DRAFT / REVIEW REQUIRED. **This document does not authorize a merge, production writes, publishing, or cleanup.** Execute only after a separate operator go/no-go. Applies to TWO independent Git repositories, backend `backend-services` and frontend `ebay-ui-app`.

## 1. Scope and evidence (checked 2026-11-21)

| Repository | Feature worktree / branch | Observed HEAD | Working tree |
| --- | --- | --- | --- |
| Backend `backend-services-you-pick` | `feature/you-pick` | `05c5c2285a9ff6a74190aeb1b18e6d1dba1604ba` | Modified, unstaged `MASTER_INV_STORAGE.md` |
| Frontend `ebay-ui-app-you-pick` | `feature/you-pick` | `8e0291f59a2adc99fadf40e20e625301f58bc4e9` | Clean |

These are **observation pins, not final merge SHAs**. Confirm anew after any commit. In the corresponding existing `main` worktrees, the current local HEADs are backend `dee385365db8be5da46da6f3726a3a53874f355d` (**clean**) and frontend `7ce0c8e40891d04741617ef7da4f3b406d38167e` (**modified tracked `.DS_Store`**). The frontend main change must be reviewed and resolved or explicitly accepted before merging; do not discard it without operator approval. Git remotes, upstream tracking, merge-base, ahead/behind, fetch divergence, and current deployment state remain **unverified**. Re-pin all four HEADs before execution.

**Final cleanup evidence:** Run `.chatgpt/codex-runs/2026-11-21T041029Z-final-production-ebay-variation-only-inventory-api-cleanup-authorized/RESULT.md` reports verified deletions of 20 UNPUBLISHED Offers, 8 Variation Inventory Item Groups, and 20 Variation Inventory Items; all seven historical variation listing IDs were Completed; no residual `VL-G-*` associations. Earlier run reports Variation R2 prefix cleared (270 objects), dedicated local Variation archive removed, and all nine hosted Variation tables empty. Final API cleanup retained 206 Standard inventory items, 206 Standard offers, and 131 active listings with matching fingerprints in its bounded comparison. Historic `public.listings` count was 207, a different measure from those API counts; do not conflate.

**Accepted exception:** OAuth initialization refreshed the local backend `.env` despite a no-credential-edit instruction. The operator explicitly accepts this refreshed token state; do **not** restore old tokens or commit/expose the `.env` file. Verify authentication safely during baseline without changing production listings.

**Functional acceptance limitations:** See `ROADMAP-VARIATION-LISTINGS.md`, particularly YP10.10–10.13. Original Pilot01 A 1→2→1 and later post-fix live Withdraw were not executed; production duplicate-copy replenishment coverage was expressly skipped in one earlier pilot. Offline and other production acceptance must not be mislabeled as full live coverage. Shared sale reconciliation remains **post-merge** main roadmap `10K.3`; Master Inventory planning/implementation remains in a separate operator workstream and is out of scope here. Main roadmap `10K.1A`, which still schedules disposable Variation listing cleanup after the merge, is **stale**: the cleanup was already completed pre-merge. Propose a separately authorized post-merge roadmap status correction; do not repeat the destructive cleanup or treat `10K.3` as completed.

## 2. Non-negotiable safety boundaries

- Do **not** touch production eBay listings, Offers, Inventory Items, Orders, Fulfillment, R2, or hosted Supabase as part of this documentation/merge step. Merge itself is a Git operation; any remote eBay smoke publish/withdraw or hosted schema change requires separately approved exact action.
- Keep `EBAY_ENVIRONMENT=production` explicit and `EBAY_PUBLISH_ENABLED=false`, `SIDECAR_JOB_RUNNER_ENABLED=false` outside separately authorized live tests. Check actual process/runtime configuration instead of presuming a repo `.env` controls every process. Never print environment secrets.
- Production Supabase migration history is **shared** by feature and main: migrations already applied in the hosted project must not be blindly replayed, rolled back, re-baselined, or truncated. **Observed preflight:** feature has 60 local `.sql` migration files, existing main has 35, hosted has 59 ledger entries. The hosted `v20261028120000_c2b_removal01_incident_delete` has **no matching feature-tree source file**; the two earlier C2B repair/RPC migrations were applied under hosted alias names and timestamps. Feature-only `20261110180000_create_removed_sku_cleanup_journal.sql` and `20261111223116_create_removed_sku_exact_key_writer_barrier.sql` have **not** been applied. Many earlier main-vs-feature migrations have different filename timestamps. Map identity, SQL digests, actual hosted functions/triggers and generated types before any deployment decision. **Never run `supabase db push` or mass migration replay during merge validation.** Git-only merge and DB-deployment readiness are separate decisions; if an unresolved mismatch can affect runtime schema/API expectations, deployment is NO-GO.
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
git log --oneline --left-right --cherry-pick main...feature/you-pick
git diff --stat main...feature/you-pick
```
`origin` is a placeholder pending actual remote verification; do not guess a remote if it differs. The current `git rev-parse origin/main` is only a possibly stale remote-tracking pin, not proof of latest remote state. Run `git fetch --prune` **only in a separately approved local-ref-refresh phase**, then recompute divergence; fetching updates remote-tracking refs but must not modify checked-out feature code. Do not checkout `main` inside an active feature worktree when `main` is already checked out elsewhere.

**Backend uncommitted planning file:** The only currently modified tracked file is `MASTER_INV_STORAGE.md`. Review its full diff; commit it **deliberately** as a separate documentation-only commit on the authorized feature branch (or another operator-approved target) **before** merging. Do not stage other paths or erase the file to obtain a clean worktree. Example commit message: `docs: record master inventory architecture and import requirements`. The frontend is currently clean. Re-pin HEADs and confirm both worktrees clean after the approved commit(s). **No commits are authorized by writing this runbook.**

**STOP** if `main` diverged unexpectedly, any source commit is missing, unreviewed working changes exist, remote/upstream identity differs, conflicts affect generated schema or shared contracts, or a backup/ref plan is missing.

## 4. Gate B — merge plan and protected recovery refs

After branch audit, write an operator-approved execution sheet containing **both exact source SHAs**, **both exact target `main` SHAs**, remote names, worktree locations, dependency/runtime versions, approved sequencing, and any conflict resolution plan. Avoid dynamic values above stable instructions in Codex prompts.

Create **protected local backup refs** at the pre-merge `main` and feature SHAs for **each repo**, using collision-free reviewed names (e.g., `backup/pre-you-pick-main` and `backup/pre-you-pick-feature`); verify each resolves to the intended SHA. Never overwrite an existing ref without review. Optionally push backup refs only with explicit approval.

Evaluate `git merge-base --is-ancestor` and complete diff for fast-forward vs merge-commit eligibility. Prefer normal reviewable, non-force merges. A merge may require conflict resolution; preserve feature behavior and Standard compatibility, including package locks, `supabase/migrations`, V3 persistence contracts, eBay publish safety, and Next.js API proxy routes. If conflicts are nontrivial, pause before choosing a resolution.

**Two-repo atomicity limitation:** Git cannot merge backend and frontend atomically together. Preserve both backup refs and pin both targets. Migrate/roll out backend compatibility first, verify readiness, then frontend; if frontend is deployed before backend, enforce compatible APIs or stop. Validate production config before switching application processes.

## 5. Gate C — pre-merge verification

Run from each feature branch, with no production mutation:
- Backend: `pnpm validate:env` (safe/redacted diagnostic), `pnpm check`, `pnpm typecheck`, `pnpm test` and any documented focused Variation integration/migration contract tests. Use `pnpm --filter sidecar typecheck` and targeted test suites for failure isolation. Reconfirm watcher/image/data package tests if not covered by `pnpm test`.
- Frontend: `AGENTS.md` explicitly selects **pnpm**. Both `pnpm-lock.yaml` and `package-lock.json` are present; preserve them unchanged during this audit and resolve their long-term ownership separately if needed. Use Node >=20 (also satisfies backend's Node >=18), then run `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build`. Do not use npm commands or rewrite either lockfile just for validation.
- Read-only production checks: database migration ledger and expected Variation tables/triggers; no historical Variation group rows; published Standard listings and R2 prefix integrity; eBay publish disabled and explicit seller/environment identity. Avoid tools that silently refresh/write credentials unless credential behavior is understood and acceptable. **Sidecar process safety:** `pnpm app:dev` enables `SIDECAR_JOB_RUNNER_ENABLED=true`; do not use it for the read-only merge smoke. Use an expressly configured safe process profile, with **both** `EBAY_PUBLISH_ENABLED=false` and `SIDECAR_JOB_RUNNER_ENABLED=false` asserted from the actual process environment. `dev:safe` disables the runner but does not itself override inherited `EBAY_PUBLISH_ENABLED`, so check the publish flag separately.
- Document exact passing commands, failures, and any expressly accepted gaps before merge approval. No successful historical test substitutes for current merged-branch validation.

**STOP** on failed typechecks, unresolved migration drift, active unreviewed publication state, broken Standard capture or variation routes, or any unknown eBay state affecting safe deployment.

## 6. Gate D — operator authorization and merge execution

**Separate explicit authorization required** after review of Gate A–C evidence. Perform in the **existing main worktrees** or a controlled integration worktree, not by switching checked-out branches in another active worktree. Verify expected SHAs immediately before each command:
```sh
# Template only; execute only after approval and exact SHA checks.
git switch main
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

**NO-GO for executing merge now.** Four local HEADs were observed, but they must be refreshed. Missing: branch ancestry/ahead-behind/conflict review and current remote/ref audit; approved disposition of backend `MASTER_INV_STORAGE.md`, backend untracked runbook, and frontend main `.DS_Store`; independently reviewed hosted/local migration mapping and unapplied-migration disposition; current two-repo test results; Sidecar process config and deployment compatibility evidence; and separate operator merge authorization. Hosted Variation records remain empty and 207 Standard DB listings remain intact at the last read-only check. Historical variation production-scope gaps remain documented/accepted but cannot be silently marked passing.

**Next action:** Independent Codex review of this runbook against actual backend and frontend Git state, existing code/tests, and hosted read-only schema evidence. Produce concrete correction proposals before requesting merge approval. Do **not** perform the merge or production operations during review.

**Out of scope now:** Master Inventory schema/UI/import development, worktree/cache deletion, additional live Variation pilots, new migrations, and modifying the completed eBay cleanup evidence.

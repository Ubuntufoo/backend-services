# You Pick feature — merge to main runbook

**Status:** DRAFT / REVIEW REQUIRED. **This document does not authorize a merge, production writes, publishing, or cleanup.** Execute only after a separate operator go/no-go. Applies to TWO independent Git repositories, backend `backend-services` and frontend `ebay-ui-app`.

## 1. Scope and evidence (local worktrees checked 2026-11-22)

| Repository | Branch | Observed local HEAD | Working tree at initial 2026-11-22 check |
| --- | --- | --- | --- |
| Backend `backend-services-you-pick` | `feature/you-pick` | `dd1adbe3428d9f07d73693780d006d2702406b70` | Clean |
| Backend `backend-services` | `main` | `dee385365db8be5da46da6f3726a3a53874f355d` | Clean |
| Frontend `ebay-ui-app-you-pick` | `feature/you-pick` | `eb128c08caa650ee17aed676f70ac0b855fc1df7` | Clean |
| Frontend `ebay-ui-app` | `main` | `d40658baf483b174b22ce00cb07cea4b32995509` | Clean |

These are **local observation pins, not final merge authorization**. The 2026-11-22 MCP status check found all four worktrees clean. Backend feature `dd1adbe` includes the committed roadmap-preservation and whitespace fixes; frontend feature `eb128c0` includes pnpm and corrected UI tests, and frontend main `d40658b` removes tracked `.DS_Store`. The 2026-11-21 independent Codex audit verified then-current upstream and remote heads without fetching; its backend merge-base was `b04594ece2a274d0e45e8ca88dbf2afb05fb036f` (then `2/161` main-only/feature-only), and frontend merge-base `453aac7be848236048dcebad924d8eb12e2d0a9f` (then `1/46`). A later independent runbook check confirmed **local-only** divergence at the current pins: backend `2/164` and frontend `2/48` (main-only/feature-only). **Remote HEADs were not reverified**, and whole-repository merge simulations were not rerun. The table records the initially clean worktrees; the backend feature now has this runbook as its sole unstaged tracked modification. Re-pin all four local HEADs/statuses after committing the runbook, and recheck remote refs, ancestry, divergence, and merge simulations immediately before execution. The 2026-11-22 scoped independent Codex verification found the roadmap/whitespace fixes conflict-free.

**Final cleanup evidence:** Run `.chatgpt/codex-runs/2026-11-21T041029Z-final-production-ebay-variation-only-inventory-api-cleanup-authorized/RESULT.md` reports verified deletions of 20 UNPUBLISHED Offers, 8 Variation Inventory Item Groups, and 20 Variation Inventory Items; all seven historical variation listing IDs were Completed; no residual `VL-G-*` associations. Earlier run reports Variation R2 prefix cleared (270 objects), dedicated local Variation archive removed, and all nine hosted Variation tables empty. Final API cleanup retained 206 Standard inventory items, 206 Standard offers, and 131 active listings with matching fingerprints in its bounded comparison. Historic `public.listings` count was 207, a different measure from those API counts; do not conflate.

**Accepted exception:** OAuth initialization refreshed the local backend `.env` despite a no-credential-edit instruction. The operator explicitly accepts this refreshed token state; do **not** restore old tokens or commit/expose the `.env` file. Git-only merge readiness must **not** initiate OAuth or other credential refresh, including via apparently read-only diagnostics. Any later authentication diagnostic requires separate authorization, a verified non-mutating execution path, and redacted output; do not change production listings.

**Functional acceptance limitations:** See `ROADMAP-VARIATION-LISTINGS.md`, particularly YP10.10–10.13. Original Pilot01 A 1→2→1 and later post-fix live Withdraw were not executed; production duplicate-copy replenishment coverage was expressly skipped in an earlier pilot. Offline and other production acceptance must not be mislabeled as full live coverage. Feature `ROADMAP.md` now marks `10K.1A COMPLETED` (operator-confirmed Variation test-listing disposal); this will update main on merge. Its separate `10K.1` post-merge regression gate stays pending; shared sale detection `10K.3` stays post-merge. Master Inventory belongs to a separate operator workstream. The prior audit did not independently prove Sandbox absence, buyer obligations, or complete local/R2 ownership; retain those evidence limits without repeating completed destructive cleanup.

## 2. Non-negotiable safety boundaries

- Do **not mutate** production eBay listings, Offers, Inventory Items, Orders, Fulfillment, R2, hosted Supabase, or credentials during Git-only merge readiness. Even **read-only access** to a production service requires separate explicit operator authorization for the exact query or action; otherwise skip it and retain the evidence requirement for deployment readiness. Never use an OAuth/credential-refreshing tool during Git-only merge readiness. Merge itself is a Git operation; any remote eBay smoke publish/withdraw or hosted schema change requires separately approved exact action.
- **Operator-reported current backend `.env`:** `EBAY_ENVIRONMENT=sandbox` and `EBAY_PUBLISH_ENABLED=false`. These values reduce accidental **production** eBay write risk for processes that actually load them; they do not establish the effective runtime settings or prevent Sandbox writes. Do not read, edit, commit, or print `.env` during Git merge readiness. Before any separately authorized runtime test, confirm the effective process has `EBAY_ENVIRONMENT=sandbox`, `EBAY_PUBLISH_ENABLED=false`, and `SIDECAR_JOB_RUNNER_ENABLED=false`, without exposing secrets. Stop that test if any value differs or cannot be verified. Do not initiate remote API operations without separately approved scope.
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

**Backend documentation scope:** Backend feature `dd1adbe` is clean and includes committed roadmap/whitespace corrections. Earlier commit `a413d51` already tracks both `MASTER_INV_STORAGE.md` and this runbook. The operator has acknowledged the intentional Master Inventory document changes and stated they do **not** impede this merge; preserve them unchanged and out of scope for this workstream. Do not inspect, edit, or recommit Master Inventory here. Frontend feature `eb128c0` includes the approved pnpm policy and UI-test fixes. All four local worktrees were clean at the initial 2026-11-22 status check; the backend feature now has only this runbook modified and unstaged. **No new Git mutations** (commit, merge, fetch, or ref writes) are authorized by this runbook; bounded read-only Git verification is permitted. Recheck local worktree status and HEADs after the eventual runbook commit.

**STOP** if `main` diverged unexpectedly, any source commit is missing, unreviewed working changes exist, remote/upstream identity differs, conflicts affect generated schema or shared contracts, or a backup/ref plan is missing.

## 4. Gate B — merge plan and protected recovery refs

After branch audit, write an operator-approved execution sheet containing **both exact source SHAs**, **both exact target `main` SHAs**, remote names, worktree locations, dependency/runtime versions, approved sequencing, and any conflict resolution plan. Avoid dynamic values above stable instructions in Codex prompts.

Create **protected local backup refs** at the pre-merge `main` and feature SHAs for **each repo**, using collision-free reviewed names (e.g., `backup/pre-you-pick-main` and `backup/pre-you-pick-feature`); verify each resolves to the intended SHA. Never overwrite an existing ref without review. Optionally push backup refs only with explicit approval.

Evaluate `git merge-base --is-ancestor` and complete diff for fast-forward vs merge-commit eligibility. Prefer normal reviewable, non-force merges. A merge may require conflict resolution; preserve feature behavior and Standard compatibility, including package locks, `supabase/migrations`, V3 persistence contracts, eBay publish safety, and Next.js API proxy routes. If conflicts are nontrivial, pause before choosing a resolution. Independent merge simulations on earlier pins found no textual conflicts. The previously identified `ROADMAP.md` semantic hotspot has since been addressed: feature `ROADMAP.md` preserves main's `10K.1`, `10K.2`, `10K.3`, `12.1`, and `12.2` verbatim and marks `10K.1A` complete. Codex independently confirmed all six entries exactly once, a conflict-free three-way file simulation, and no semantic loss on 2026-11-22. **Re-run merge simulation on the final pinned refs**; this scoped check is not whole-repo merge authorization.

**Two-repo atomicity limitation:** Git cannot merge backend and frontend atomically together. Preserve both backup refs and pin both targets. Migrate/roll out backend compatibility first, verify readiness, then frontend; if frontend is deployed before backend, enforce compatible APIs or stop. Validate production config before switching application processes.

## 5. Gate C — pre-merge verification

Run from each feature branch, with no production mutation:
- Backend: `pnpm validate:env` (only after confirming it cannot expose or modify secrets), `pnpm check`, `pnpm typecheck`, `pnpm test`, and documented focused Variation integration/migration contract tests, only in a safe isolated environment. Use `pnpm --filter sidecar typecheck` and targeted suites for failure isolation. Reconfirm watcher/image/data package coverage if not included. The earlier independent audit passed Sidecar typecheck but did **not** establish a full current backend suite pass; collect fresh command, exit status, and test counts before authorizing a merge. Do not run scripts that start publish-capable jobs or access production mutations.
- Frontend: **pnpm is authoritative**: `AGENTS.md`, README and `packageManager: pnpm@10.14.0` agree. Feature `eb128c0` removes tracked `package-lock.json` and keeps `pnpm-lock.yaml`; main `d40658b` removes tracked `.DS_Store`. Requires Node >=20. **Recorded pre-commit validation (not rerun on merged main):** `pnpm test` **530/530** (46 files), `pnpm exec tsc --noEmit --incremental false`, `pnpm lint` (one existing hooks warning in `app/variation-listings/variation-inventory-panel.tsx:668`), and `pnpm build` passed. For read-only environments use no-cache typecheck. Explicitly accept existing lint warnings/debt or remediate them separately; do not misreport warnings as a new failure or as clean lint. Frontend's `OTHER` creation type is nonblocking because the UI/backend fail closed. Repeat relevant checks on merged main.
- **Production evidence is a separate deployment gate, not an automatic Git-merge check:** database migration ledger/Variation tables and triggers, absence of historic Variation groups, Standard listings and R2 integrity, and eBay seller/environment identity. Use existing recorded evidence only for Git-only readiness. Any new production read requires separately approved exact scope and a demonstrated non-mutating, non-refreshing path; without authorization, skip and record as unverified for deployment. Do not run OAuth or credential-refreshing tools. **Sidecar process safety:** `pnpm app:dev` enables `SIDECAR_JOB_RUNNER_ENABLED=true`; do not use it for the read-only merge smoke. In any separately authorized runtime test, assert **both** `EBAY_PUBLISH_ENABLED=false` and `SIDECAR_JOB_RUNNER_ENABLED=false` from the actual process environment without printing secrets. `dev:safe` disables the runner but does not override an inherited `EBAY_PUBLISH_ENABLED`; check that flag separately.
- Backend independent audit passed an earlier Sidecar typecheck; **full current backend validation** and merged-branch regressions remain outstanding. The prior manifest trailing whitespace at lines 3–4 was corrected and committed in backend feature `dd1adbe`; 2026-11-22 independent Codex verification passed scoped `git diff --check`. Re-run the **full merge-range** whitespace check on final refs. Frontend's earlier three failed UI assertions were corrected and all 530 tests passed in recorded pre-commit validation. Record command results and accepted gaps; feature-branch checks never substitute for post-merge regression.

**STOP Git-only merge** on failed typechecks, unresolved source/schema migration-contract conflicts, or broken Standard capture/Variation routes. **Keep production deployment NO-GO** for unresolved hosted migration provenance, active or unreviewed publication state, or unknown eBay state. Those production-evidence gaps do not automatically block Git integration or authorize new production reads; any such read requires separate approval for an exact, demonstrably non-mutating and non-refreshing action.

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
- Confirm locally that publishing/job-runner flags are disabled and no migration/write was intentionally initiated. Confirm unchanged production Standard listings and empty Variation database **only under separately approved exact read-only access**; otherwise retain those as unverified deployment-baseline checks. Compare observed behavior to the acceptance exceptions above.
- **If green**, mark merge baseline accepted and only then begin separately scoped Master Inventory development. Shared sale-detection task 10K.3 stays separately tracked.

## 8. Recovery / rollback

- If merge is not yet pushed or deployed: pause, inspect exact state, and safely abort a *currently in-progress* conflicted merge with `git merge --abort` when applicable. Do not indiscriminately reset shared worktrees.
- If merged and pushed: preserve history and prefer a reviewed `git revert -m 1 <merge-commit>` or a forward fix, depending on observed dependencies. For fast-forward, plan explicit revert commits rather than destructive branch movement.
- If deployed: restore compatible backend and frontend revisions together (API/schema contract) using the pinned backup refs and verified deployment procedure. Database migrations generally cannot be rolled back via Git alone; write a forward-only corrective migration only with separate review and authorization. Any already published marketplace operation requires external reconciliation; a Git rollback cannot undo eBay writes.
- Always recheck Standard data and eBay publication guard after recovery. Keep the feature worktrees/branches and backup refs intact until successful post-merge verification and separate cleanup authorization.

## 9. Current go/no-go (updated 2026-11-22)

**Git-only merge: NO-GO pending final verification and explicit operator authorization.** All four local worktrees were clean at the initial 2026-11-22 observation; backend feature currently has only this runbook modified and unstaged. The latest bounded local divergence check reported backend `2/164` and frontend `2/48`; fresh remote HEAD checks and whole-repo merge simulations remain outstanding. The roadmap task preservation and whitespace corrections are **resolved, independently verified, and committed**; operator accepted the intentional `MASTER_INV_STORAGE.md` tracking, and the frontend pnpm policy is consistent. Still required: re-pin upstream/remote refs and current divergence, repeat two-repo merge simulations and merge-range whitespace checks, collect the current full backend test gate, record accepted existing lint debt/known nonblocking UI type limitation, and prepare protected backup refs plus an exact execution sheet. Recorded frontend checks passed; rerun as dictated by Gate C and after merging.

**Production deployment: NO-GO separately.** Resolve/document hosted migration provenance (missing historical incident-delete source, differing witness SQL, aliases, two unapplied local files), generated-type and runtime compatibility, process-level publishing/job-runner flags, and backend-before-frontend deployment sequencing without production writes during review. Last read-only Supabase snapshot: **207 Standard `listings`** and **zero records in all nine Variation/C2B tables**. Do not repeat historical destructive cleanup.

**Next action:** The first independent runbook review is complete and its five clarification findings have been addressed in this revision. Obtain a final scoped read-only review, commit this runbook only after approval, and re-pin all four local/remote refs. Finish current safe backend validation, final two-repository merge simulations and merge-range checks, then prepare protected backup refs and a pinned merge execution sheet. Obtain **separate explicit Git-merge authorization**; deployment remains NO-GO and requires its own approval.

**Out of scope now:** Master Inventory schema/UI/import development, worktree/cache deletion, additional live Variation pilots, new migrations, and modifying the completed eBay cleanup evidence.

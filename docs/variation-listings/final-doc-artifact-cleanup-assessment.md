# YP-FINAL.DOC-ARTIFACT-CLEANUP — Native purge assessment

Status: **complete — 2026-11-19; operator accepted two retained exceptions**. Native purge executed across both You Pick worktrees under the operator's blanket historical-artifact authorization. The untracked historical Codex/DeepSeek runs and stale handoffs were removed. One Git-tracked frontend historical run is deliberately retained, and the final backend task's prompt/result is retained for review; neither prevents closure as explicitly accepted by the operator.

## Scope and measured inventory

- Backend `backend-services-you-pick` (`feature/you-pick`), branch `feature/you-pick`.
- Frontend `ebay-ui-app-you-pick` (`feature/you-pick`), branch `feature/you-pick`.
- User explicitly waived per-run preservation/dependency review for past Codex/DeepSeek history; deletion was limited to the two named worktrees and exact `.chatgpt` roots.
- Backend `.chatgpt/codex-runs`: 175 directories + 4 loose files, 514 files, 2,514,761 bytes, 3,448 KiB before; 1 current-task directory, 0 loose files, 2 files, 12,600 bytes, 16 KiB after the purge checkpoint. Removed 174 directories + 4 loose files / 512 files / 2,502,161 bytes / 3,432 KiB.
- Backend `.chatgpt/deepseek-runs`: 4 directories, 7 files, 49,862 bytes, 60 KiB before; empty after. Backend `.chatgpt/handoffs`: 4 files, 45,331 bytes, 52 KiB before; empty after.
- Frontend `.chatgpt/codex-runs`: 28 directories, 78 files, 282,557 bytes, 448 KiB before; 1 Git-tracked historical directory with 3 files, 6,651 bytes, 12 KiB after. Removed 27 untracked directories / 75 files / 275,906 bytes / 436 KiB. Frontend had no DeepSeek runs, handoffs, or tool-test roots.
- Backend and frontend `.chatgpt/operations/last-write.json` receipts were protected. No disposable log/scratch roots were present in the narrow allowed locations.
- Combined measured reclamation: 2,873,260 file-content bytes / 3,980 KiB allocated. The current task directory and its required result remain protected until review.

## Purge result and blocker

The exact category-level manifest is [final-doc-artifact-cleanup-manifest.md](final-doc-artifact-cleanup-manifest.md). All historical untracked Codex/DeepSeek runs, loose historical run files, and stale handoffs were deleted. The retained frontend path is the tracked historical run `.chatgpt/codex-runs/2026-06-17T035359Z-add-global-pricing-provider-control-panel/`; deleting it would violate the explicit no-tracked-frontend-change rule. The current backend task directory is also retained for the required review result. The operator subsequently accepted the result as-is, including that tracked frontend exception, and authorized marking YP-FINAL.DOC-ARTIFACT-CLEANUP complete. No further deletion is required under this task.

## Protected evidence and exclusions

- Current backend task prompt/run metadata/result until post-review.
- Frontend tracked historical run above and both worktrees' operations receipts.
- Backend `.local/you-pick-sandbox/**`, source, tests, migrations, applied migration provenance, V3 journals/recovery/incident evidence, operator approvals, production acceptance records, security/operations data, media, secrets, Git metadata, active worktrees, and business/order data.
- No MCP configuration or cleanup API was used. No remote eBay, Supabase, R2, hosted-data, image, or media operation occurred.

## Architecture/documentation verification

`docs/variation-listings/architecture.md` was independently checked against the local applied migration sources and now describes the applied six-table persistence model. Retired four-table/pilot persistence is labeled historical; no migration or historical SQL was changed. The archived YP10.10 checklist retains its original NO-GO and authorization gates, while active operations point to the roadmap.

## Accepted closure and separate remaining work

On 2026-11-19, the operator explicitly accepted the native purge **as-is** and requested this task be marked complete. The one retained Git-tracked frontend run and the most recent backend Codex result directory are known, accepted exceptions, not unresolved blockers. The deletion manifest remains a historical record of the purge checkpoint and its original blocker wording; this assessment and roadmap record the subsequent operator closure decision. Storage cleanup, remaining test-coverage audit, read-only schema audit, test-listing disposal and merge-runbook work are separate tasks.

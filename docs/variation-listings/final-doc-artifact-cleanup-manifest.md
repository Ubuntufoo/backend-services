# YP-FINAL.DOC-ARTIFACT-CLEANUP — Native purge manifest

Date: 2026-11-19  
Scope: `backend-services-you-pick` and `ebay-ui-app-you-pick`, both `feature/you-pick`  
Method: Codex native filesystem access only; no GPT-REPO-MCP configuration or cleanup API.

## Removal rules

- Backend `.chatgpt/codex-runs`: delete every historical child directory and loose historical file; retain only the current executing task directory until review.
- Backend `.chatgpt/deepseek-runs`: delete all contents.
- Backend `.chatgpt/handoffs`: delete all stale dated and `current.local.md` handoffs.
- Frontend `.chatgpt/codex-runs`: delete all untracked historical children; retain the tracked historical run because tracked frontend changes are forbidden.
- Do not delete `.chatgpt/operations`, `.local/you-pick-sandbox/**`, source/tests/migrations, media, secrets, Git metadata, active worktrees, or current task result.

## Measured deletion summary

| Category | Before | After | Removed | Reclaimed |
| --- | ---: | ---: | ---: | ---: |
| Backend Codex runs | 175 dirs + 4 loose files / 514 files / 2,514,761 B / 3,448 KiB | Post-delete checkpoint before current `RESULT.md`: 1 current dir / 2 files / 12,600 B / 16 KiB | 174 dirs + 4 loose files / 512 files | 2,502,161 B / 3,432 KiB |
| Backend DeepSeek runs | 4 dirs / 7 files / 49,862 B / 60 KiB | empty | 4 dirs / 7 files | 49,862 B / 60 KiB |
| Backend handoffs | 4 files / 45,331 B / 52 KiB | empty | 4 files | 45,331 B / 52 KiB |
| Frontend Codex runs | 28 dirs / 78 files / 282,557 B / 448 KiB | 1 tracked dir / 3 files / 6,651 B / 12 KiB | 27 untracked dirs / 75 files | 275,906 B / 436 KiB |
| **Total** | — | — | — | **2,873,260 B / 3,980 KiB** |

After the required 2,090-byte `RESULT.md` was written, the retained current backend task directory measured 3 files / 14,690 bytes / 20 KiB. That required active-run addition is excluded from the purge-reclamation delta.

## Retained paths and blocker

- Backend current task directory: `.chatgpt/codex-runs/2026-11-19T222418Z-yp-final-purge-all-historical-codex-deepseek-runs-and-stale-handoffs/` (prompt/run metadata and required result retained until review).
- Frontend tracked historical directory: `.chatgpt/codex-runs/2026-06-17T035359Z-add-global-pricing-provider-control-panel/` (3 files, 6,651 bytes, 12 KiB). It is the only historical run left and cannot be deleted without violating the no-tracked-frontend-change rule.
- Backend/frontend `.chatgpt/operations/last-write.json` receipts retained.
- `.local/you-pick-sandbox/**`, applied migrations, V3/recovery/incident evidence, operator approvals, production acceptance, source/tests, media, secrets, Git metadata, and active worktrees retained.
- No allowed disposable log/scratch roots were present.

## Verification

- Backend historical Codex/DeepSeek roots are empty except the current task directory; backend handoffs root is empty.
- Frontend run root contains only the retained tracked directory; no frontend DeepSeek/handoffs/tool-tests roots exist.
- Current prompt and protected receipts/data paths remain present; no tracked frontend files changed.
- `git status --short`, `git diff --check`, path-presence checks, and bounded stale-reference checks passed.
- Roadmap status is **partial/blocked**, because the tracked frontend historical run prevents the zero-historical-run acceptance while tracked frontend deletion is forbidden.

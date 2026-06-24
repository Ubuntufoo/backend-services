## Agent Context & Token Management Protocol

### DeepSeek Delegate Workers

Use DeepSeek delegates for non-trivial repo analysis when they reduce main-thread context, compress broad evidence, or improve review quality. Delegates are read-only and advisory. The main thread must verify claims, decide, edit, test, and produce the final answer.

**Source of truth:**  
`/Users/timothymurphy/Developer/Personal/ebay-inventory-manager/codex-delegates/README.md`

**Bootstrap:**

```zsh
source /Users/timothymurphy/Developer/Personal/ebay-inventory-manager/codex-delegates/env.zsh
```

**Commands:**

| Command                                                      | Purpose                                  |
| ------------------------------------------------------------ | ---------------------------------------- |
| `ds-scan-bundle <backend-services\|ebay-ui-app> "<pattern>"` | Focused search with snippets             |
| `codex-ds-scan <backend-services\|ebay-ui-app> "<pattern>"`  | Bounded repo search                      |
| `ds-scan-read <relative-path> [start_line] [line_count]`     | Bounded file read                        |
| `ds-pack-files <relative-path[:start[:count]]> ...`          | Pack known file ranges                   |
| `codex-ds-analyze --mode review @"$artifact"`                | Preferred review path with fallback      |
| `codex-ds-review @"$artifact"`                               | Direct bug/regression/test review        |
| `codex-ds-critic "<task + artifact>"`                        | Risk/plan critique                       |
| `codex-ds-summarize "<task + artifact>"`                     | Compression/summarization                |
| `CODEX_DS_DRY_RUN_MODEL=1 <delegate-command>`                | Inspect selected model without API calls |

**Do not delegate:** trivial single-file checks, small obvious edits, direct file mutation, final response generation, destructive actions, secrets, `.env*`, credentials, DB dumps, SQLite state, dependency folders, lockfiles, generated files, oversized logs.

**Rules:** Retrieve bounded evidence locally first. Prefer file-backed artifacts over inline pasted evidence. Keep delegate artifacts ≤~250 lines. Require compact, structured output. Verify important claims against repo evidence. Never pass arbitrary repo paths to delegates — pass only retrieved artifacts.

---

### Headroom MCP Routing

- If `headroom_compress` available, use it for bulky, repetitive, or clearly compressible output before analysis.
- **Strong trigger cases:** truncated output, multi-screen output, logs, long diffs, repetitive search output, JSON blobs, artifacts ~≥80 lines / ~≥1200 tokens.
- **Skip** for compact path inventories, compact tables, concise artifacts, or <~5k tokens unless repetitive enough for compression to pay off.
- **Workflow:** compress actual raw artifact first → reason from compressed output by default → use `headroom_retrieve` only for exact slices/raw details → emit `HEADROOM_USED: <hash>` before substantive analysis.
- **Do not** analyze large raw output directly when trigger applies. Do not substitute tail/sed/shell slices/repeated rereads for compression once trigger applies (except retrieving exact post-compression detail). Do not compress a hand-written summary instead of the original artifact.

### Shell & Terminal Optimization (RTK)

See `@/Users/timothymurphy/.codex/RTK.md`.

- Prefer `rtk` when output is broad, noisy, repetitive, or likely to benefit from filtering/compression.
- **Strong RTK cases:**
  - `git diff` → `rtk git diff`
  - repo-wide/broad search (`rg <pattern> <path>`) → `rtk grep <pattern> <path>`
  - broad file reads / repeated doc/code inspection → `rtk read <file>`
  - logs, verbose CLIs, noisy shell output
  - build/test/lint/typecheck, especially noisy → `rtk test <cmd>` or `rtk <cmd>`
- **Raw command allowed** when:
  - no RTK analogue exists
  - exact machine-readable output needed
  - output is trivial or very small
  - formatting-sensitive output matters
  - exact SQL output needed
  - RTK filtering would hide forensic detail
  - `git status --short` or similar compact exact status is needed
  - tiny file reads are faster/clearer without RTK overhead
- If bypassing RTK for a non-trivial command where a wrapper exists, state the reason. Do not claim RTK is mandatory merely because a wrapper exists; route by workload shape and expected savings instead.

---

### Concise Response Protocol

Use terse, high-density technical responses. No pleasantries. No full sentences if fragments work. Strip articles and auxiliary verbs. Code blocks + symbols + keywords only. Maximize info density per character.

---

## Non-Blocking Loop Detection & Audit

Monitor repeated friction. Finish best safe solution, then append audit block **only** if a high-friction trigger activates.

### Trigger Activation Criteria

Before responding, scan last 3-4 turns. Trigger audit block on:

- **Seesaw:** Same small code/type/test area changing back to a state from 2 turns ago.
- **Type-chase:** A TypeScript fix broke a dependent module that was working earlier.
- **Thrash:** Rewriting a large component when the issue is a narrow boundary/contract.
- **Silent wall:** About to attempt the same failed approach a second time.
- **Architecture mismatch:** Fix conflicts with project invariants or `AGENTS.md`.
- **Validation stall:** Tests/typecheck/lint failed 2+ consecutive times — pivot needed.

Do not trigger for normal first-pass failures, simple TS errors, missing imports, formatting, or small corrections.

### When Triggered

1. Finish best safe implementation/review.
2. Pivot to smallest stable boundary.
3. State remaining limitation.

Rules: JSON valid. Audit block is final. Do not append without trigger.

---

## Multi-Project & Server Scoping

Target package-level commands with workspace filters (e.g., `pnpm --filter <pkg>`). Avoid unnecessary servers; suppress verbose logs (`--logLevel silent`).

---

## Git Telemetry & Workspace Checks

- Start with `git diff --stat` and `git status -s`.
- Use full diffs only when needed for correctness/risk/churn detection.
- If repo state unclear: report branch, modified files, unpushed commits.
- If push succeeds but `.lock` warning appears: check remote first. Only remove stale `.git/**/*.lock` files if Git ops blocked.
- `ROADMAP.md` is a living document updated by the user only.

---

## Local-First Version Control

Solo personal project. Git for local checkpoints, recovery, controlled backup.

- Work locally by default. Keep `main` usable. Commit meaningful checkpoints.
- Branch naming: `local/<task>` for local-only, `feature/<task>` for remote sharing.
- Dirty worktree? Report modified files before mixing unrelated work.
- Use `git add -p` when staging precision matters. Conventional commits optional.
- Run relevant validation before important commits and report results.
- Push only for backup, stable milestones, remote review, or explicit request.
- Never discard, reset, rebase, force-push, or delete branches/worktrees without approval.

---

## Model Context Protocol (MCP) Tooling

- Batch related actions into one tool call per intent.
- From large tool outputs, extract only the keys/fields needed.

### Context7 MCP Server

- Use `resolve-library-id` if documentation path unknown.
- Do not rely on internal knowledge for version-specific details.

### Jina MCP Server

- Web retrieval not covered by Context7.
- Includes card pricing, local listings, unstructured web data.

---

## Testing and Validation

- Run linting/tests before every commit. Treat failing checks as blockers.
- Validate each logical sub-task before continuing.

## Agent Context & Token Management Protocol

### DeepSeek Delegate Workers

Source: `/Users/timothymurphy/Developer/Personal/ebay-inventory-manager/codex-delegates/README.md`

Bootstrap:
source /Users/timothymurphy/Developer/Personal/ebay-inventory-manager/codex-delegates/env.zsh

Use delegates for non-trivial bounded repo analysis, multi-file review, critique, synthesis, summarization, or packed-artifact verification when offloading reduces main-thread context. Delegates are read-only and advisory; the main thread must verify claims, decide, edit, test, and produce the final answer.

Default flow:
ds-scan-bundle <backend-services|ebay-ui-app|codex-delegates> "<pattern>"
ds-pack-files --temp <repo-prefixed-path[:start[:count]]> ...
codex-ds-analyze --mode review @"$artifact"

Use codex-ds-analyze --mode artifact-audit @"$artifact" for evidence audits, operational-claim checks, tool-effectiveness reviews, or cases where fallback must preserve the original audit objective. Use CODEX_DS_DRY_RUN_MODEL=1 <delegate-command> to inspect selected models without API calls.

Retrieve bounded evidence locally first. Choose the delegate root from task scope. Prefer file-backed artifacts over inline pasted evidence. Keep artifacts narrow, usually ≤~250 lines for first pass, with file/line references where available.

Do not delegate trivial single-file checks, obvious edits, final response generation, direct file mutation, destructive actions, live shell state, DB inspection, environment drift, secrets, .env\*, credentials, DB dumps, SQLite state, dependency folders, lockfiles, generated files, or oversized logs. Never pass arbitrary repo paths; pass only bounded retrieved artifacts.

### Headroom Routing

Use headroom_compress for bulky, repetitive raw output before analysis: logs, stack traces, JSON blobs, long diffs, verbose test/build/lint/typecheck output, noisy search results, truncated/multi-screen output, or artifacts ~≥80 lines / ~≥1200 tokens that look compressible.

Skip compact path lists, compact tables, already concise output, and artifacts under ~5k tokens unless clearly repetitive. Low-value inputs may return compression_skipped or noop; these do not store retrievable artifacts unless force: true is used.

Workflow: compress the original raw artifact first, reason from compressed output, use headroom_retrieve only for exact raw slices/details, and emit HEADROOM_USED: <hash> only when an artifact is stored.

Do not analyze large triggered output raw. Do not replace compression with tail, sed, repeated rereads, shell slicing, or compressing a hand-written summary.

### RTK Routing

See `@/Users/timothymurphy/.codex/RTK.md`.

Use RTK when output is broad, noisy, repetitive, or likely to benefit from filtering/compression: `git diff`, repo-wide `rg`, broad reads, logs, verbose CLIs, and build/test/lint/typecheck output. Prefer `rtk git diff`, `rtk grep <pattern> <path>`, `rtk read <file>`, `rtk test <cmd>`, or `rtk <cmd>` as appropriate.

Use raw commands when output must be exact, small, machine-readable, formatting-sensitive, forensic, SQL-like, or when no RTK analogue exists. Common raw cases: `git status --short`, tiny file reads, exact SQL output, and compact status checks.

Use `rtk read --raw <file>` for exact file output, `rtk read --compact <file>` to force filtering on larger reads, and `rtk gain --family` to check which command families are actually saving context.

Do not treat RTK as mandatory just because a wrapper exists. Route by workload shape and expected savings. If bypassing RTK for a non-trivial command with a wrapper, state why.

### Concise Response Protocol

Use terse, high-density technical responses. No pleasantries. No full sentences if fragments work. Strip articles and auxiliary verbs. Code blocks + symbols + keywords only. Maximize info density per character.

## Multi-Project & Server Scoping

Target package-level commands with workspace filters (e.g., `pnpm --filter <pkg>`). Avoid unnecessary servers; suppress verbose logs (`--logLevel silent`).

## Git Telemetry & Workspace Checks

- Start with `git diff --stat` and `git status -s`.
- Use full diffs only when needed for correctness/risk/churn detection.
- If repo state unclear: report branch, modified files, unpushed commits.
- If push succeeds but `.lock` warning appears: check remote first. Only remove stale `.git/**/*.lock` files if Git ops blocked.
- `ROADMAP.md` is a living document updated by the user only.

## Local-First Version Control

Solo personal project. Git for local checkpoints, recovery, controlled backup.

- Work locally by default. Keep `main` usable. Commit meaningful checkpoints.
- Branch naming: `local/<task>` for local-only, `feature/<task>` for remote sharing.
- Dirty worktree? Report modified files before mixing unrelated work.
- Use `git add -p` when staging precision matters. Conventional commits optional.
- Run relevant validation before important commits and report results.
- Push only for backup, stable milestones, remote review, or explicit request.
- Never discard, reset, rebase, force-push, or delete branches/worktrees without approval.

## Model Context Protocol (MCP) Tooling

- Batch related actions into one tool call per intent.
- From large tool outputs, extract only the keys/fields needed.

### Context7 MCP Server

- Use `resolve-library-id` if documentation path unknown.
- Do not rely on internal knowledge for version-specific details.

### Jina MCP Server

- Web retrieval not covered by Context7.
- Includes card pricing, local listings, unstructured web data.

## Testing and Validation

- Run linting/tests before every commit. Treat failing checks as blockers.
- Validate each logical sub-task before continuing.

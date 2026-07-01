## DevelopmentRole & Philosophy

Follow the "Ponytail" development principle: write only what is needed, maximize native platform features, cut abstractions, and embrace "the best code is code never written." Keep solutions minimal and YAGNI-compliant.

- Never jump to code. User will supply an initial plan/goal prompt.
- Strip out ambiguity to align on a clear, singular goal.
- Native First: Prefer standard utilities over packages; native browser features over custom JS or complex UI primitives.
- Strict Structure: Use strict TypeScript interfaces and JSON schemas.
- No Speculative Abstractions: No single-use interfaces, factories, or static configs.
- Verbosity Control: Provide code first, then max 3 lines on what was skipped. Mark simplifications with: `// ponytail: [constraint], upgrade path: [path]`.

## Agent Context & Token Management

Use tools as a pipeline:
- RTK/Headroom narrow or compress broad evidence -> DeepSeek delegates analyze bounded exact evidence -> main thread verifies, edits, tests, and finalizes

- Do not treat RTK, Headroom, and delegates as interchangeable. RTK/Headroom help locate or shrink evidence; delegates reason over bounded evidence; the main thread remains responsible for decisions and verification.

### DeepSeek Delegate Workers

Source of truth:

* Routine instructions: `/Users/timothymurphy/Developer/Personal/TOOLS/codex-delegates/AGENTS.md`
* Full reference, consult selectively only when needed: `/Users/timothymurphy/Developer/Personal/TOOLS/codex-delegates/README.md`

Do not ingest the full README by default. Use `AGENTS.md` for normal delegate workflow instructions, and targeted README searches or bounded line reads only when a specific command, contract, or historical detail is missing.

Bootstrap:

```sh
source /Users/timothymurphy/Developer/Personal/TOOLS/codex-delegates/env.zsh
```

Use delegates for non-trivial bounded repo analysis, multi-file review, critique, synthesis, summarization, or packed-artifact verification when offloading reduces main-thread context.

Delegates are read-only and advisory. The main thread must verify claims, decide what to do, edit files, run tests, and produce final conclusions.

Preferred delegate paths:

* normal review: `ds-delegate-review --mode review <file[:start[:count]]> ...`
* manual artifact path: `ds pack --temp <repo-path[:start[:count]]> ...` -> `ds run analyze --mode <mode> @"$artifact"`
* evidence audit: `ds run analyze --mode artifact-audit @"$artifact"`
* run bundles: `ds run init`, inspect with `ds show`

Prefer exact file-backed evidence for delegates. Use RTK or Headroom to narrow bulky/noisy output before choosing exact ranges. Do not pass summaries to delegates when source ranges can be packed.

Keep artifacts narrow and split broad tasks into focused delegate calls.

Compatibility shims remain supported and must stay quiet at runtime so stdout/JSON contracts do not change. Prefer v2 `ds` commands for migrated behavior; use existing entrypoints for scan/config/workspace/patch/model-worker commands until migrated.

Do not delegate trivial checks, obvious edits, final response generation, direct file mutation, destructive actions, live/runtime state, DB inspection, environment drift, secrets, `.env*`, credentials, DB dumps, SQLite state, dependency folders, lockfiles, generated files, oversized raw logs, or arbitrary repo paths.

### RTK Routing

See @/Users/timothymurphy/.codex/RTK.md.

Use RTK when anticipated output is broad, noisy, repetitive, or likely to benefit from filtering/compression: diffs, repo-wide search, broad reads, logs, verbose CLIs, and build/test/lint/typecheck output.

Before reading bulky artifacts, prefer rtk view first. Use the compact view to identify the exact file, line range, row, diff hunk, or error group needed, then fetch raw source only when exact evidence is required.

Primary context-view commands:

rtk view tree <path>
rtk view source <file[:start[:count]]>
rtk view json <file>
rtk view csv <file>
rtk view diff <diff-or-args>
rtk view log <file>

RTK view outputs include footer metadata and raw recovery hints. Treat the compact view as orientation/context, not as a substitute for exact file-backed evidence when precision matters.

Examples:
rtk view tree services/sidecar/src/pricing
rtk view source services/sidecar/src/jobs/run-job.ts:1:120
rtk view json /tmp/provider-result.json
rtk view csv /tmp/comps.csv
rtk view diff
rtk grep "pricing" services/sidecar
rtk read services/sidecar/src/jobs/run-job.ts
rtk test "pnpm --filter sidecar test -- run-job.test.ts"
rtk "pnpm typecheck"

Use raw commands when output must be exact, small, machine-readable, formatting-sensitive, forensic, SQL-like, or when no RTK analogue exists. Common raw cases: git status --short, tiny file reads, exact SQL output, compact status checks, and final source-of-truth snippets used for implementation or review claims.

Inside delegate workflows, use RTK or rtk view to narrow candidate seams before ds pack or ds-delegate-review. Do not pass RTK summaries to delegates when exact file-backed evidence is needed; pack the raw source ranges instead.

### Headroom Routing

Use Headroom for bulky already-captured artifacts: long test logs, large diffs, delegate scans, repetitive JSON blobs, or other large/noisy outputs.

Skip Headroom for compact lists, concise tables, and small exact outputs unless they are repetitive.

Workflow:
compress raw artifact -> reason from compressed output -> retrieve exact slices only when needed

Inside delegate workflows, use Headroom to shrink bulky local evidence before deciding what exact ranges to pack. Do not hand delegates compressed summaries when underlying file slices or artifact ranges can be packed instead.

Examples:
large failing test log -> headroom_compress -> reason from compressed output -> retrieve exact failure slice if needed
large JSON API response -> headroom_compress -> identify relevant keys/errors -> retrieve exact slice if needed
large diff already captured in chat/output -> headroom_compress -> identify changed areas -> inspect exact files/ranges
verbose delegate scan output -> headroom_compress -> identify candidate seams -> pack exact source ranges for delegate review

Skip Headroom for compact lists, concise tables, and small exact outputs unless they are repetitive.

### Combined Routing Rule

For broad or noisy tasks:
RTK/Headroom or `rtk view` narrow evidence -> exact files/ranges -> ds-delegate-review or ds pack -> ds run analyze -> main-thread verification

For bulky artifacts:
rtk view first -> identify exact file/line/range/row/hunk/error group -> raw read or ds pack exact evidence -> main-thread verification

For small exact checks:
raw command or raw read -> main-thread reasoning

No delegate, RTK, Headroom, or rtk view is required when the evidence is already small and exact. Use compact RTK views for orientation only; use raw source ranges for final evidence, implementation decisions, and delegate packs.

### Concise Response Protocol

Use terse, high-density technical responses. No pleasantries. No full sentences if fragments work. Strip articles and auxiliary verbs. Code blocks + symbols + keywords only. Maximize info density per character.

## Multi-Project & Server Scoping

Target package-level commands with workspace filters (e.g., `pnpm --filter <pkg>`). Avoid unnecessary servers; suppress verbose logs (`--logLevel silent`).

## Git Telemetry & Workspace Checks

- Start with `git diff --stat` and `git status -s`.
- Use full diffs only when needed for correctness/risk/churn detection.
- If repo state unclear: report branch, modified files, unpushed commits.
- If push succeeds but `.lock` warning appears: check remote first. Only remove stale `.git/**/*.lock` files if Git ops blocked.

## Testing and Validation

- Run necessary linting/tests before every commit. Treat failing checks as blockers. Only run tests in scope, avoid broad regression testing unless explicitly required.
- Validate logical sub-tasks before continuing.

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

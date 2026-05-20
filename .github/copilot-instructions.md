@/Users/timothymurphy/.codex/RTK.md
## 🖥️ Shell & Terminal Optimization (RTK)
- **Environment:** This workspace uses `rtk` (Rust Token Killer) globally via `rtk init -g --codex` to hook and compress background terminal processes.
- **Protocol:** Whenever running inherently verbose CLI commands (like testing pipelines, extensive git tree checks, or monorepo builds), explicitly prefix them with the `rtk` command to guarantee maximum token compression.
- **Execution Examples:**
  - `rtk pnpm verify-canonical-layout.mjs`
  - `rtk git status` / `rtk git diff`
  - `rtk next build`
- **Scope Note:** Native file utilities (like internal `read` or `grep` tools) bypass global bash hooks. For heavy source files or deep pattern matches, use alternative shell paths like `rtk read <file>` or `rtk grep <pattern>` to keep your context window lean.

# PR Review Protocol
- ALWAYS operate exclusively in `--diff-only` execution mode for PR reviews.
- Do not request or pull surrounding codebase files for context during automated PR evaluations.
- Completely ignore `pnpm-lock.yaml`, database schemas, and env templates.
- Truncate all outputs to raw technical syntax blocks if API usage bounds approach threshold limits.

## Agent Context & Token Management Protocol

To avoid rate limits and reduce token usage, follow these concise context rules.

### 1. File Discovery & Reading Boundaries

- Prefer exact file paths; avoid sweeping directory reads or open-ended searches.
- Respect `.gitignore` and do not index docs unless asked.
- Skip `node_modules`, `.git`, build outputs, and other large generated folders.

### 2. Model Context Protocol (MCP) Efficiency

- Batch related actions into one tool call per intent.
- From large tool outputs, extract only the keys/fields needed for the task.

### 3. Git Telemetry & Worktree Auditing

- Start with `git diff --stat` and `git status -s` for concise workspace checks.
- If a push succeeds but local Git reports it could not update a remote-tracking ref due to a `.lock` file, do not treat that as a failed push. Check the PR/remote branch first. Only clean stale `.git/**/*.lock` files if Git operations are actually blocked.
- Request full diffs only when needed.
- Keep edits tightly scoped to the active feature branch.

### 4. Multi-Project & Server Scoping

- Target package-level commands with workspace filters (e.g., `pnpm --filter <pkg>`).
- Avoid launching unnecessary servers; suppress verbose logs (e.g., `--logLevel silent`).

## Branch Management

- Always create a new feature branch for every task. Never commit directly to `main`.
- Branch naming:
  - `feature/<task-name>`
  - `fix/<task-name>`
  - `chore/<task-name>`
  - `refactor/<task-name>`
- Never mix unrelated tasks in the same branch.

## Version Control

- Before starting work, check:
  - `git status`
  - current branch
  - uncommitted changes
  - unpushed commits
- If the worktree is dirty:
  - stop
  - report modified files
  - ask whether to stash, commit, discard, or continue
- Never assume existing changes belong to the current task.
- Use atomic commits with conventional commit messages:
  - `feat:`
  - `fix:`
  - `refactor:`
  - `docs:`
  - `chore:`
  - `test:`
- Use `git add -p` to stage only related changes.
- Never push directly to `main`.
- After completing work:
  - run lint/tests
  - commit
  - push branch
  - open or prepare PR
- Before new work, verify:
  - previous branch pushed
  - PR created or merged
  - worktree clean
- If resuming interrupted work, first report:
  - current branch
  - git status
  - uncommitted changes
  - unpushed commits
  - PR status
- If repository state is unclear, stop and ask.

## Pull Request Workflow

- Standard cycle:
  - branch
  - develop
  - commit
  - push
  - PR
  - merge
  - sync `main`
- Keep PRs focused to one concern.

## Testing and Validation

- Run linting/tests before every commit.
- Treat failing checks as blockers.
- Validate each logical sub-task before continuing.

## Shared Workspace with OpenAI Codex

- **Shared responsibility:** This repository is a shared workspace between GitHub Copilot and OpenAI Codex. Both assistants must prioritize version accuracy, code quality, and repository best practices when proposing edits.
- **Version accuracy:** Verify referenced versions (dependencies, APIs, models) before suggesting changes; prefer explicit version pins and include a brief rationale for version bumps.
- **Best practices:** Proposals should respect tests, linting, security, and documentation standards. If a change may affect compatibility, include migration notes or request tests.
- **Coordination & conflicts:** When automated suggestions conflict, prefer conservative, well-tested approaches and surface conflicts for human review.
- **Accountability:** Include a concise justification and suggested validation command (for example, `pnpm -w test`) with non-trivial edits so maintainers can verify changes.

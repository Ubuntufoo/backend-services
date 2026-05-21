## Shell & Terminal (RTK)
- Use `rtk` to compress verbose CLI output: e.g. `rtk git status`, `rtk pnpm verify-canonical-layout.mjs`, `rtk next build`.
- For native tools that bypass hooks use `rtk read <file>` or `rtk grep <pattern>`.

## PR Review
- Use `--diff-only` mode. Do not pull surrounding files. Ignore pnpm-lock.yaml, DB schemas, and env templates. Trim outputs when near API limits.

## Context & Token Management
- Prefer exact file paths; avoid bulk reads. Respect .gitignore. Skip node_modules, .git, and build outputs.
- Batch related actions and extract only needed fields from tool outputs.

## Git Checks
- Start with `git diff --stat` and `git status -s`.
- Request full diffs only when needed. Clean stale .git/*.lock only if Git is blocked.

## Multi-Project
- Use workspace filters (e.g., `pnpm --filter <pkg>`). Avoid launching servers; suppress verbose logs.

## Branches & Commits
- Always create a feature branch (feature/, fix/, chore/, refactor/). Never commit to main.
- Verify worktree: branch, git status, uncommitted and unpushed changes. If dirty, stop and report files.
- Use atomic conventional commits (feat:, fix:, refactor:, docs:, chore:, test:) and `git add -p`.
- Run lint/tests before commit, then push and open a PR.

## Pull Request Flow
- branch → develop → commit → push → PR → merge → sync main. Keep PRs focused.

## Testing
- Run linters/tests before commits. Treat failures as blockers.

## Shared Workspace (Copilot & Codex)
- Both assistants must prioritize accuracy, tests, and compatibility.
- Prefer explicit version pins; include a brief rationale for bumps and a validation command (e.g., `pnpm -w test`).

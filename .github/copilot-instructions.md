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

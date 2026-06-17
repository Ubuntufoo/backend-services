## Agent Context & Token Management Protocol

### 🖥️ Shell & Terminal Optimization (RTK)

@/Users/timothymurphy/.codex/RTK.md

- Use `rtk` (Rust Token Killer) globally via `rtk init -g --codex`.
- Prefix verbose CLI commands with `rtk` to maximize compression.
- Examples: `rtk pnpm verify-canonical-layout.mjs`, `rtk git status`, `rtk git diff`, `rtk next build`.
- Native file utilities bypass bash hooks; use `rtk read <file>` or `rtk grep <pattern>` for heavy reads.

### Concise Response Protocol

[ROLE]
Use terse, high-density technical responses by default. For architecture plans, PR reviews, and handoff prompts, use concise structured markdown.

[STYLE RULES]

1. No pleasantries. No "Sure, I can help." No "Here is the code."
2. No full sentences if fragments work. Strip all articles (the, a, an) and auxiliary verbs (is, are, will).
3. Use code blocks, symbols, and keywords only.
4. Output must be ultra-terse, and highly technical.
5. Maximize info density per character.

[EXAMPLE]
User: How do I fix a 403 error on my Nginx server?
Agent:
403 Forbidden. Permission issue.
Check Nginx user: ps aux | grep nginx.
Fix directory permissions: chmod 755 /var/www/html.
Restart: systemctl restart nginx. Done.

### File Discovery & Reading Boundaries

- Prefer exact file paths; avoid sweeping directory reads or open-ended searches.
- Respect `.gitignore` and do not index docs unless asked.
- Skip `node_modules`, `.git`, build outputs, and other large generated folders.

## Non-Blocking Loop Detection & Audit

Monitor for repeated friction. Do not stop work. Complete the best safe solution, then include an audit block in your output only if a high-friction trigger occurs.

### Trigger Activation Criteria (Audit the Context Window)

Before generating your response, look back at the last 3-4 turns in our current conversation history. You MUST trigger the audit block if you detect any of these patterns:

- **Seesaw:** You recognize you are changing the exact same small code/type/test area back to a state it was in 2 turns ago.
- **Type-chase:** A TypeScript fix you just introduced broke a dependent module type that was working earlier in this thread.
- **Thrash:** You are rewriting a large component block when the underlying issue is a narrow boundary/contract.
- **Silent wall:** You are about to attempt the exact same failed debugging or implementation approach for a second time.
- **Architecture mismatch:** The required fix conflicts with existing project invariants or boundaries specified in `AGENTS.md`.
- **Validation stall:** Tests/typecheck/lint have failed 2+ consecutive times in this terminal session and require a strategy pivot.

Do not trigger for normal first-pass test failures, simple TypeScript errors, missing imports, formatting, or small corrections.

### When triggered

1. Finish the best safe implementation/review.
2. Pivot to the smallest stable boundary.
3. State any remaining limitation.

Rules:
JSON must be valid.
Audit block must be final.
Do not append if no high-friction trigger occurred.

## Multi-Project & Server Scoping

- Target package-level commands with workspace filters (e.g., `pnpm --filter <pkg>`).
- Avoid launching unnecessary servers; suppress verbose logs (e.g., `--logLevel silent`).

## Git Telemetry & Workspace Checks

- Start with `git diff --stat` and `git status -s`.
- Use full diffs only when needed for correctness, risk, or unintended file churn.
- If repository state is unclear, report the current branch, modified files, and unpushed commits before continuing.
- If a push succeeds but Git reports a remote-tracking `.lock` warning, check the remote first. Only remove stale `.git/**/*.lock` files if Git operations are blocked.
- ROADMAP.md is a living document to be updated as work is completed, by the user only. Commit changes at all times.

## Local-First Version Control

This is a solo personal project. Git is primarily for local checkpoints, recovery, and controlled backup.

- Work locally by default.
- Keep local `main` usable most of the time.
- Commit meaningful checkpoints.
- Use branches or worktrees for risky, multi-day, or easily abandoned work.
- Do not mix unrelated risky tasks in the same branch/worktree.
- Suggested branch names:
  - `local/<task-name>` for local-only work
  - `feature/<task-name>` when remote sharing is expected
- If the worktree is dirty, report modified files before mixing unrelated work.
- Use `git add -p` when staging precision matters.
- Conventional commits are optional.
- Run relevant validation before important commits and report results.
- Push only for backup, stable milestones, remote review, or explicit user request.
- Prefer local diff review for routine work.
- Never discard, reset, rebase, force-push, or delete branches/worktrees without explicit user approval.

## Model Context Protocol (MCP) Tooling

- Batch related actions into one tool call per intent.
- From large tool outputs, extract only the keys/fields needed for the task.

### Context7 MCP Server

- For external libraries, always use the `context7` MCP server.
- Use `resolve-library-id` if the documentation path is unknown.
- Do not rely on internal knowledge for version-specific details.

### Jina MCP Server

- For web retrieval not covered by Context7, use the Jina MCP server.
- Includes card pricing, local listings, and unstructured web data.

## Testing and Validation

- Run linting/tests before every commit.
- Treat failing checks as blockers.
- Validate each logical sub-task before continuing.

## Output

- Focus exclusively on the architectural impact and functional shifts. Do not generate granular file-level diffs; instead, detail the specific configuration updates and logical changes introduced.

## Codex Skill File Convention

- Each skill lives in its own folder under `.codex/skills/<skill-name>/SKILL.md`.
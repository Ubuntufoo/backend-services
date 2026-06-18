# RTK User Guide

Source repo: [rtk-ai/rtk](https://github.com/rtk-ai/rtk)

## What RTK does

RTK = Rust Token Killer.

Purpose:
- wraps common CLI commands
- compresses noisy output before output reaches AI context
- reduces token usage for shell-heavy agent workflows

Typical gain:
- `git status`, `git diff`, `rg`, `cat`, test runners, linters, build tools
- repo README claims roughly 60-90% token reduction on supported commands

Core model:
- `git status` -> `rtk git status`
- `pnpm test` -> `rtk test pnpm test`
- `cat file.ts` -> `rtk read file.ts`

## Install

Recommended:

```bash
brew install rtk
rtk --version
rtk gain
```

Alternative:

```bash
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
```

Cargo caveat:

```bash
cargo install --git https://github.com/rtk-ai/rtk
```

Do not use plain crates.io package name blindly. Another unrelated `rtk` exists there.

## Codex setup

### Global Codex setup

Use when you want same RTK guidance across all Codex workspaces:

```bash
rtk init -g --codex
rtk init --show
```

Effect:
- writes Codex-facing RTK instructions under global Codex home
- intended to affect future Codex sessions broadly, not just current repo

### Local/project Codex setup

Use when you want repo-specific instructions only:

```bash
rtk init --codex
rtk init --show
```

Effect:
- writes local repo instructions
- project-scoped
- useful when you do not want RTK behavior implied in every Codex workspace

## Global vs project scope

### Global

`rtk init -g --codex`

Meaning:
- global Codex home config
- reusable across projects opened by same Codex user/home
- best if RTK part of your default workflow

### Project-specific

`rtk init --codex`

Meaning:
- local repo instruction files only
- only affects that repository/worktree
- best if some repos benefit from RTK and others need raw command output

### Important distinction

RTK has 2 separate layers:

1. Binary availability
- if `rtk` in `PATH`, you can run `rtk ...` anywhere

2. Agent integration
- global or local `init` decides whether Codex/agent gets persistent RTK usage instructions

So:
- installed binary can be global
- active agent behavior can still be local-only

## Step-by-step: how to use RTK in Codex

1. Install binary.

```bash
brew install rtk
```

2. Pick scope.

Global:

```bash
rtk init -g --codex
```

Local repo only:

```bash
rtk init --codex
```

3. Verify setup.

```bash
rtk init --show
rtk --version
rtk gain
```

4. Restart Codex/client if needed.

5. Prefer RTK-aware commands in shell flows:

```bash
rtk git status
rtk git diff
rtk grep "pricing_provider_mode" .
rtk read services/sidecar/src/pricing/sold-comps-query.ts
rtk pnpm lint
rtk test pnpm --filter sidecar test
```

6. Check adoption/savings periodically:

```bash
rtk gain
rtk gain --history
rtk discover
rtk session
```

## Best commands to adopt first

- `rtk git status`
- `rtk git diff`
- `rtk read <file>`
- `rtk grep <pattern> <path>`
- `rtk test <cmd>`
- `rtk lint`
- `rtk tsc`
- `rtk next build`
- `rtk pnpm list`

## When RTK helps most

- noisy tests
- long lint/typecheck output
- large git diffs
- repetitive file reads
- multi-agent or subagent shell usage

## Caveats

### Not all tools pass through RTK

RTK docs explicitly note hook/instruction rewriting applies to shell or Bash tool calls.

Implication for Codex-like agents:
- built-in non-shell file readers/searchers may bypass RTK
- shell commands still benefit

If you want RTK compaction, prefer:
- `rtk read` over raw built-in file-read path when practical
- `rtk grep` or `rg` via shell over non-shell search tools

### Filtering can hide raw detail

RTK optimizes for compactness, not forensic completeness.

If debugging requires exact raw output:
- rerun raw command without RTK
- or inspect RTK tee logs if enabled

Examples:
- stack traces with trimmed noise
- full JSON payloads
- verbose compiler diagnostics
- commands where line ordering matters

### Hook/integration support differs by agent

Some agents support transparent command rewrite.
Some only support instruction injection or project rules.
Codex integration in README described as `AGENTS.md + RTK.md` instruction-based setup, not same hook path used by Bash-hook agents.

### Windows support limited

Native Windows lacks full auto-rewrite hook behavior.
WSL recommended for full support.

### Command coverage finite

RTK supports many commands, not everything.
Unsupported commands may pass through with little or no filtering benefit.

### Wrong package risk

If installed from wrong source, you may get unrelated `rtk`.
Sanity check:

```bash
rtk gain
```

If that fails unexpectedly, verify install source.

## Conflicts / tooling interactions

### Codex built-ins vs shell

Potential mismatch:
- Codex built-in read/search tools may bypass RTK
- shell commands do not

Practical rule:
- use shell when output shaping matters
- use built-ins when exact/raw file access matters more than token savings

### Other shell rewrite systems

Potential conflict:
- any tool that also intercepts or rewrites shell commands
- custom shell wrappers, agent hooks, plugin-based command mutators

Risk:
- double rewriting
- broken quoting
- command classification errors
- unexpected no-op behavior

Mitigation:
- exclude problematic commands in RTK config
- disable competing rewrite layer if redundant

### Existing project instructions

If repo already has strong `AGENTS.md`, `CLAUDE.md`, or similar tool rules, RTK-generated guidance can overlap or compete.

Risk:
- duplicated guidance
- conflicting command preferences
- unclear precedence

Mitigation:
- keep one canonical instruction path
- if using repo-specific RTK, review generated instructions before assuming behavior

### Raw-output workflows

RTK poor fit when you need:
- full binary output
- exact formatting snapshots
- full CI logs
- unmodified machine-readable JSON streams

Prefer raw command in those cases.

## Local status on this machine

Observed in this repo session:
- `rtk --version` -> `0.40.0`
- `rtk init --show` reported Codex/Claude/OpenCode hooks/instructions as `not found`

Interpretation:
- binary installed globally
- active RTK integration not currently verified as enabled for this Codex session via `rtk init --show`
- explicit `rtk ...` commands still work

## Recommended operating mode

For broad Codex use:

```bash
rtk init -g --codex
rtk init --show
```

Then:
- restart Codex
- prefer shell commands for RTK-sensitive operations
- keep raw commands available for exact-debug cases

## Quick checklist

- `rtk` installed in `PATH`
- choose `-g --codex` vs `--codex`
- run `rtk init --show`
- restart Codex
- use `rtk` wrappers for noisy commands
- fall back to raw commands when exact output needed

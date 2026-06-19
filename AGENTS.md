# Agent Routing Guide

## Purpose

Backend monorepo for eBay Inventory Manager. Current runtime center: `services/sidecar`. Use this file to decide where to inspect. Do not treat roadmap or historical plans as implementation truth.

## Current Architecture

- `services/sidecar`: canonical backend runtime; HTTP sidecar, MCP stdio, eBay auth/publish, workflow APIs, job execution, pricing job.
- `services/watcher-service`: local filesystem intake for incoming listing images.
- `services/image-service`: local image processing library/runtime package.
- `packages/data`: Supabase repositories, workflow persistence, shared DB types.
- `packages/env`: shared env loading/validation.
- `packages/types`: shared workflow/domain contracts.
- Pricing currently lives inside sidecar; no dedicated pricing service.
- eBay publish path and readiness checks already live inside sidecar.
- Placeholder dirs like `services/r2-service`, `services/gemini-service`, `services/job-runner`, and `services/ebay-service` are not current runtime boundaries unless code proves otherwise.

## Agent File Routing

| Task                       | Start here                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------- |
| Env/config                 | `packages/env/src/`, `services/sidecar/src/ebay/config.ts`                         |
| Data repositories          | `packages/data/src/repositories/`                                                  |
| Job runner/jobs            | `services/sidecar/src/jobs/`                                                       |
| Pricing                    | `services/sidecar/src/pricing/`, `services/sidecar/src/jobs/research-price-job.ts` |
| eBay publishing/readiness  | `services/sidecar/src/ebay/`, `services/sidecar/src/scripts/`                      |
| HTTP/API workflow          | `services/sidecar/src/http/`, `services/sidecar/src/api/`                          |
| Watcher intake             | `services/watcher-service/src/`                                                    |
| Image processing           | `services/image-service/src/`                                                      |
| Shared contracts           | `packages/types/src/`                                                              |
| Supabase schema/migrations | `supabase/migrations/`                                                             |

## Validation Commands

- Repo: `pnpm check`, `pnpm typecheck`, `pnpm lint`
- Sidecar: `pnpm --filter sidecar typecheck`, `pnpm --filter sidecar test`
- Watcher: `pnpm --filter @ebay-inventory/watcher-service check`
- Image service: `pnpm --filter @ebay-inventory/image-service check`
- Data/env/types: `pnpm --filter @ebay-inventory/data test`, `pnpm --filter @ebay-inventory/env test`, `pnpm --filter @ebay-inventory/types check`

## Scope Control

- Doc-only tasks: do not change runtime code, tests, or package scripts unless a doc reference is provably broken by script naming.
- Prefer targeted reads over sweeping repo exploration.
- Treat `ROADMAP.md` and `docs/archive/` as context only, not source of truth.
- Keep sidecar as canonical backend entrypoint; do not invent extracted services unless code exists.

## Current Pricing Status

- Implemented: fixture-backed `research_price` job, comp normalization, deterministic median-based stats, confidence scoring, validated LLM pricing wiring/config behind deterministic fallback, `listing_price_research` persistence.
- Workflow-safe: successful research may update `listings.price` while listing remains `needs_review` / `review_pending`.
- Pricing failures should stay job-scoped and `listing_price_research`-scoped; they should not block review/export and should not write listing `last_error_*`.
- Live Apify provider/pilot still pending.
- Pricing remains sidecar-local.
- Do not document live Apify pricing as active unless code exists beyond fixture/test scaffolding.

## Required Practices

### RTK Enforcement

RTK required for any shell command with non-trivial output when wrapper exists.

Mandatory:

- `git status` -> `rtk git status`
- `git diff` -> `rtk git diff`
- `rg` -> `rtk grep`
- `sed` / `cat` -> `rtk read`
- test/lint/typecheck/build -> `rtk test <cmd>` or `rtk <cmd>`

If raw command used where RTK wrapper exists, state reason before execution.

### Headroom MCP Requirement

If `headroom_compress` is available, it is mandatory for bulky intermediate artifacts before analysis.

Hard trigger. Use `headroom_compress` first when any output is:

- truncated
- multi-screen
- greater than ~80 lines
- likely greater than ~1200 tokens
- large logs, diffs, search output, JSON blobs, or similar bulky artifacts

Required workflow:

1. Call `headroom_compress` before substantive analysis of triggered output.
2. Compress actual large raw artifact immediately after receipt; do not first rewrite it into a hand-made summary and then compress that summary.
3. Reason from compressed output by default.
4. If exact raw detail is required, call `headroom_retrieve` only for exact failing slice or exact detail needed.
5. Emit commentary proof line before analysis: `HEADROOM_USED: <hash>`.

Failure rule:

- Do not analyze large raw output directly when trigger applies.
- Do not substitute repeated raw rereads, `tail`, `sed`, bounded shell slices, or similar narrowing tactics in place of required compression once trigger applies, except for exact-detail retrieval after compression.
- Compressing post-summarized notes instead of triggered raw artifact does not count as effective headroom use and should be treated as non-compliant unless raw artifact was compressed first.

## Do Not Open Unless Needed Or Directed

- `ROADMAP.md`
- `docs/archive/`
- `docs/archive/sidecar-rest-contract.md`
- `docs/API_STATUS.md` unless checking generated eBay status snapshot
- `services/sidecar/src/types/` generated API types
- `services/sidecar/src/schemas/README.md`

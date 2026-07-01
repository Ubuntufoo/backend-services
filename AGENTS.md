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

Shared delegate root alias for this repo: `backend-services`.

## Validation Commands

- Repo: `pnpm check`, `pnpm typecheck`, `pnpm lint`
- Sidecar: `pnpm --filter sidecar typecheck`, `pnpm --filter sidecar test`
- Watcher: `pnpm --filter @ebay-inventory/watcher-service check`
- Image service: `pnpm --filter @ebay-inventory/image-service check`
- Data/env/types: `pnpm --filter @ebay-inventory/data test`, `pnpm --filter @ebay-inventory/env test`, `pnpm --filter @ebay-inventory/types check`

## Common Diagnostics

- Env: `pnpm validate:env`
- eBay OAuth: `pnpm validate:ebay-oauth`
- eBay readiness: `pnpm ebay:diagnose-live-readiness`
- Pricing config: `pnpm pricing:diagnose-soldcomps-config`, `pnpm pricing:diagnose-apify-config`
- Pricing smoke: `pnpm pricing:smoke-soldcomps`, `pnpm pricing:smoke-apify`
- Single listing pricing: `pnpm pricing:price-one`

## Scope Control

- Doc-only tasks: do not change runtime code, tests, or package scripts unless a doc reference is provably broken by script naming.
- Prefer targeted reads over sweeping repo exploration.
- Treat `ROADMAP.md` and `docs/archive/` as context only, not source of truth.
- Keep sidecar as canonical backend entrypoint; do not invent extracted services unless code exists.

## Do Not Open Unless Needed Or Directed

- `ROADMAP.md`
- `docs/archive/`
- `docs/archive/sidecar-rest-contract.md`
- `docs/API_STATUS.md` unless checking generated eBay status snapshot
- `services/sidecar/src/types/` generated API types
- `services/sidecar/src/schemas/README.md`

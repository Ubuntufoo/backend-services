# Architecture

`docs/architecture.md` is the canonical backend architecture reference for this repo. `README.md` and `AGENTS.md` intentionally keep only short entrypoint and routing summaries.

## Runtime Layout

- `services/sidecar`: canonical backend runtime and system entrypoint. Owns HTTP endpoints, MCP stdio, listing workflow orchestration, job execution, pricing research, eBay integration, and backend diagnostics.
- `services/watcher-service`: local filesystem intake service for incoming listing image batches.
- `services/image-service`: local image processing package used after watcher grouping.
- `packages/data`: Supabase client access, repositories, workflow persistence helpers, and shared database-facing types.
- `packages/env`: shared env loading and validation.
- `packages/types`: shared workflow, SKU, and domain contracts.

## Ownership By Concern

### HTTP And MCP

- HTTP surface: `services/sidecar/src/http/`
- API/workflow handlers: `services/sidecar/src/api/`
- MCP stdio entrypoint remains inside sidecar.

### Workflow And Jobs

- Sidecar owns workflow orchestration and job execution.
- Job code lives under `services/sidecar/src/jobs/`.
- There is no standalone job-runner service today; job execution runs inside sidecar.

### Pricing

- Pricing is sidecar-local today.
- Primary code: `services/sidecar/src/pricing/`
- Job entry: `services/sidecar/src/jobs/research-price-job.ts`
- Runtime provider selection comes from `public.app_settings.pricing_provider_mode` with current modes `off`, `soldcomps`, and `apify`.
- There is no dedicated pricing service in the current runtime.

### eBay

- eBay auth, publish, readiness, reconcile, and related diagnostics are sidecar-local.
- Primary code: `services/sidecar/src/ebay/`
- Operational scripts and diagnostics: `services/sidecar/src/scripts/`
- There is no separate eBay service package in the current runtime.

### Persistence And Schema

- Shared persistence code lives in `packages/data/src/repositories/`.
- Supabase schema and migrations live in `supabase/migrations/`.
- Pricing persistence such as `listing_price_research` remains part of the shared database layer, with sidecar owning the runtime behavior that reads and writes it.

### Intake And Images

- Watcher intake code lives in `services/watcher-service/src/`.
- Image processing code lives in `services/image-service/src/`.
- These are real workspace packages, but they do not replace sidecar as the canonical backend runtime entrypoint.

## Diagnostics And Scripts

- Day-to-day backend diagnostics remain sidecar-owned.
- Repo-level commands in `README.md` point to the common entrypoints.
- Concern-specific operational details live in `docs/local-development.md`, `docs/operations.md`, `docs/pricing.md`, and `docs/ebay-integration.md`.

## Current Non-Boundaries

The following directories or concepts should not be treated as current extracted runtime services unless code changes explicitly make that true:

- no dedicated pricing service
- no dedicated R2 service
- no dedicated Gemini service
- no standalone job-runner service
- no separate eBay service

Placeholder directories can exist for future exploration or historical reasons, but they are not current architecture boundaries.

## Source Routing

- Env/config: `packages/env/src/`, `services/sidecar/src/ebay/config.ts`
- Data repositories: `packages/data/src/repositories/`
- Jobs/workflow: `services/sidecar/src/jobs/`
- Pricing: `services/sidecar/src/pricing/`, `services/sidecar/src/jobs/research-price-job.ts`
- eBay publish/readiness/reconcile: `services/sidecar/src/ebay/`, `services/sidecar/src/scripts/`
- HTTP/API workflow: `services/sidecar/src/http/`, `services/sidecar/src/api/`
- Watcher intake: `services/watcher-service/src/`
- Image processing: `services/image-service/src/`
- Shared contracts: `packages/types/src/`
- Supabase schema/migrations: `supabase/migrations/`

Historical design docs remain in [`docs/archive/`](archive/) as reference only.

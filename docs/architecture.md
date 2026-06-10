# Architecture

## Current Runtime Layout

- `services/sidecar`: canonical backend runtime. Owns HTTP endpoints, MCP stdio server, eBay auth/publish flows, workflow orchestration, job execution, diagnostics, and pricing research.
- `services/watcher-service`: local filesystem watcher for incoming image batches.
- `services/image-service`: local image processor used after watcher grouping.
- `packages/data`: Supabase client/repositories and workflow persistence helpers.
- `packages/env`: shared env parsing and validation.
- `packages/types`: shared workflow and SKU/domain contracts.

## Current Boundaries

- Pricing is sidecar-local today: `services/sidecar/src/pricing/` plus `services/sidecar/src/jobs/research-price-job.ts`.
- eBay publish, readiness checks, reconcile flows, and diagnostics are sidecar-local under `services/sidecar/src/ebay/` and `services/sidecar/src/scripts/`.
- `listing_price_research` storage and `research_price` job persistence live in Supabase schema/repositories.
- Watcher and image-service are real workspace packages, but sidecar remains system entrypoint for backend workflow state.

## Not Current Fact

- No dedicated pricing service.
- No dedicated R2 service package.
- No dedicated Gemini service package.
- No standalone job-runner package; job execution currently runs inside sidecar.

## Source Files By Concern

- Workflow/job state: `packages/data/src/repositories/`, `services/sidecar/src/jobs/`
- HTTP/API surface: `services/sidecar/src/http/`, `services/sidecar/src/api/`
- Publish path: `services/sidecar/src/ebay/`
- Intake/image flow: `services/watcher-service/src/`, `services/image-service/src/`
- Schema/migrations: `supabase/migrations/`

Historical design docs moved to [`docs/archive/`](archive/).

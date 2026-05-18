# Services

This repository uses a phased monorepo model.

## Active Package

| Directory | Status | Purpose |
| --- | --- | --- |
| `services/sidecar` | Active | MCP server and canonical eBay integration runtime. |

## Shared Packages

| Directory | Status | Purpose |
| --- | --- | --- |
| `packages/data` | Active shared package | Shared Supabase client, CRUD-style repositories, and workflow transition helpers used by the active runtime. |
| `packages/env` | Active shared package | Shared environment validation contracts. |
| `packages/types` | Active shared package | Shared workflow and domain types. |

## Planned Boundaries

| Boundary | Status | Planned responsibility |
| --- | --- | --- |
| `watcher-service` | Planned module | Consume asset events, create initial listing rows, and enqueue jobs through shared data helpers. |
| `image-service` | Planned module | Image normalization, EXIF stripping, derivatives, and metadata extraction. |
| `r2-service` | Planned module | Cloudflare R2 uploads, proxying, and signed URL issuance. |
| `gemini-service` | Planned module | AI enrichment, validation, caching, and rate limiting around Gemini requests. |
| `ebay-service` | Planned module | Shared eBay-domain orchestration that may be extracted from the sidecar later. |
| `job-runner` | Planned module | Queue-backed jobs, workflow status transitions, output persistence, retries, and monitoring. |

## Promotion Rules

A planned boundary should only become an active workspace package or separate process when all of the following are true:

1. It owns real runtime behavior that is no longer sidecar-local.
2. It has a concrete interface boundary, not just a future idea.
3. It includes build, lint, typecheck, and test coverage suitable for CI.
4. Its documentation explains env vars, commands, and integration expectations.

Until then, planned boundaries remain documentation and in-process code organization, not standalone service folders or deployables.

## Local Development

The active package is the sidecar:

```bash
pnpm install
pnpm dev
```

For a local-only, single-user workflow with cloud Supabase integration, prefer:

- one local Node process for the sidecar
- one shared Supabase data layer instead of per-service client wrappers
- hosted Supabase services
- Supabase functions, cron, or app-triggered jobs before introducing `job-runner`
- direct module boundaries inside the sidecar before extracting watcher, image, R2, Gemini, or eBay-specific processes
- stateless image, R2, Gemini, and eBay service modules unless direct DB access becomes necessary later

## Shared Infrastructure

- `docs/` remains shared for architecture notes, auth docs, and API status snapshots.
- `scripts/verify-canonical-layout.mjs` guards against duplicate runtime ownership.
- The root `package.json` orchestrates workspace commands but does not own app code.

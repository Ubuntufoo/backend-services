# Backend Services

This repository is the backend monorepo for the eBay Inventory Manager. It is intentionally optimized for a local-only, single-user workflow:

- `services/sidecar` is the only implemented runtime package today.
- `packages/data` owns the shared Supabase client and typed repository helpers used by that runtime.
- Future boundaries are documented, but they should stay inside the sidecar or the main app until scale or operational pressure proves a real extraction is needed.

## Current Status

| Service | Status | Notes |
| --- | --- | --- |
| `sidecar` | Implemented | Canonical MCP/eBay server package with tests and local setup support. |
| `watcher-service` | Planned boundary | Keep as a sidecar or app module unless event volume justifies extraction. |
| `image-service` | Planned boundary | Keep image transforms local until they need isolated runtime scaling. |
| `r2-service` | Planned boundary | Prefer direct cloud storage integration before adding a dedicated service. |
| `gemini-service` | Planned boundary | Prefer in-process orchestration with request guards before extraction. |
| `ebay-service` | Planned boundary | Extract only if eBay workflows outgrow the sidecar package boundary. |
| `job-runner` | Planned boundary | Prefer app- or Supabase-driven background work before adding a worker process. |

## Canonical Layout

```text
backend-services/
  packages/
    data/                 # Shared Supabase data layer
    env/                  # Shared environment contracts
    types/                # Shared workflow/domain types
  services/
    sidecar/              # Active package
  docs/                   # Shared reference material
  scripts/                # Repo-level guardrails
```

The root package is orchestration-only. It does not own application runtime code.

Planned service boundaries live in documentation, not in placeholder workspace packages or required runtime folders.

## Workspace Commands

From the repo root:

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:coverage
pnpm check
pnpm dev
pnpm validate:env
```

These commands target the canonical `services/sidecar` package through the workspace configuration.
Shared packages participate in the workspace build and test graph.

## Sidecar

End-user setup, local development, and MCP-specific usage now live in [services/sidecar/README.md](services/sidecar/README.md).

Useful root-level convenience commands:

```bash
pnpm dev
pnpm setup
pnpm validate:env
pnpm diagnose
pnpm sync
pnpm update:api-status
pnpm dev:sidecar
pnpm dev:sidecar:stdio
```

`pnpm dev` and `pnpm dev:sidecar` start the HTTP sidecar for local app integration.
Use `pnpm dev:sidecar:stdio` only when you explicitly want the stdio MCP server.

## Local-Only Defaults

For a local-only setup with cloud Supabase integration:

- keep shared runtime config in `backend-services/.env` and machine-local overrides or tokens in `backend-services/.env.local`
- for DB-only local development, set `EBAY_ENABLED=false` and `OAUTH_ENABLED=false`
- run `services/sidecar` directly on your machine
- keep Supabase hosted instead of adding a local database stack here
- keep reusable Supabase access in `packages/data` instead of reimplementing service clients inside runtime packages
- keep planned watcher, image, R2, Gemini, eBay, and job-runner concerns as modules or Supabase-triggered workflows until a second runtime is clearly necessary
- avoid containerization and multi-process orchestration unless deployment needs actually appear

## Guardrails

- The repo-level layout check fails if a duplicate root runtime tree or placeholder service package manifests reappear.
- Only `services/sidecar` participates in active CI validation.
- Planned services should be documented first, then promoted into workspace packages when they have real behavior and tests.

## Related Docs

- [SERVICES.md](SERVICES.md) for service responsibilities and promotion criteria
- [AGENTS.md](AGENTS.md) for architecture intent and implementation boundaries
- [docs/API_STATUS.md](docs/API_STATUS.md) for the current eBay API status snapshot

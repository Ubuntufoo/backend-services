# Backend Services

Backend monorepo for eBay Inventory Manager. Current runtime center: `services/sidecar`. Watcher and image-service packages support intake and file processing; shared packages hold env, data, and domain contracts.

## Quick Start

```bash
pnpm install
pnpm validate:env
pnpm dev
```

Primary root commands:

- `pnpm dev` or `pnpm dev:sidecar`
- `pnpm dev:sidecar:stdio`
- `pnpm setup`
- `pnpm validate:env`
- `pnpm validate:ebay-oauth`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

## Current Packages

- `services/sidecar`: canonical backend runtime for HTTP, MCP, eBay integration, job execution, pricing.
- `services/watcher-service`: filesystem intake for incoming listing images.
- `services/image-service`: local image processing package.
- `packages/data`, `packages/env`, `packages/types`: shared persistence, config, and domain contracts.

## Docs

- [AGENTS.md](AGENTS.md) : Information about the agents used in the backend services.
- [docs/architecture.md](docs/architecture.md) : High-level architecture overview.
- [docs/local-development.md](docs/local-development.md)
- [docs/ebay-integration.md](docs/ebay-integration.md) 
- [docs/pricing.md](docs/pricing.md) : Information about the pricing model.
- [docs/operations.md](docs/operations.md) : Operational procedures and best practices.
- [docs/troubleshooting.md](docs/troubleshooting.md)
- [live-pilot-notes.md](live-pilot-notes.md)
- [ROADMAP.md](ROADMAP.md)
- [SCHEMA_SPEC.md](SCHEMA_SPEC.md) : The schema specification.
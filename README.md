# Backend Services

Backend monorepo for eBay Inventory Manager. Current runtime center: `services/sidecar`. Watcher and image-service packages support intake and file processing; shared packages hold env, data, and domain contracts.

Canonical architecture reference: [docs/architecture.md](docs/architecture.md).

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

## Docs

- [AGENTS.md](AGENTS.md) : Repo-specific agent routing guidance.
- [docs/architecture.md](docs/architecture.md) : Source of truth for current backend architecture and ownership boundaries.
- [docs/local-development.md](docs/local-development.md)
- [docs/ebay-integration.md](docs/ebay-integration.md) 
- [docs/pricing.md](docs/pricing.md) : Information about the pricing model.
- [docs/operations.md](docs/operations.md) : Operational procedures and best practices.
- [docs/troubleshooting.md](docs/troubleshooting.md)
- [live-pilot-notes.md](live-pilot-notes.md)
- [ROADMAP.md](ROADMAP.md)
- [SCHEMA_SPEC.md](SCHEMA_SPEC.md) : The schema specification.

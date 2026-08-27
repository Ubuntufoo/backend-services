# Backend Services

Backend monorepo for eBay Inventory Manager. Current runtime center: `services/sidecar`. Watcher and image-service packages support intake and file processing; shared packages hold env, data, and domain contracts.

Canonical architecture reference: [docs/architecture.md](docs/architecture.md).

## Quick Start

```bash
pnpm install
cp .env.example .env   # only when .env does not already exist
# Fill required Supabase values and any provider credentials in .env.
pnpm validate:env
pnpm dev
```

The sidecar runtime and setup wizard read/write the repo-root `.env` only;
do not split sidecar settings across `services/sidecar/.env` or `.env.local`.
The watcher CLI is the exception: it overlays the repo-root `.env.local`.

For a database-only start, set `EBAY_ENABLED=false`, `OAUTH_ENABLED=false`,
and `SIDECAR_JOB_RUNNER_ENABLED=false` in `.env`. `EBAY_ENABLED` controls
whether eBay tools and clients are created; `OAUTH_ENABLED` controls HTTP MCP
and `/api` authentication. They are independent switches.

Primary root commands:

- `pnpm dev` or `pnpm dev:sidecar`
- `pnpm dev:sidecar:stdio`
- `pnpm setup`
- `pnpm validate:env`
- `pnpm validate:ebay-oauth`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

The HTTP sidecar's code default is `http://localhost:3000`; the checked-in
`.env.example` sets `MCP_PORT=3001`, so a copied example uses port `3001`.
Background job processing is opt-in: set `SIDECAR_JOB_RUNNER_ENABLED=true`
only when you intend to run the polling loop.

## Docs

- [AGENTS.md](AGENTS.md) : Repo-specific agent routing guidance.
- [docs/architecture.md](docs/architecture.md) : Source of truth for current backend architecture and ownership boundaries.
- [docs/local-development.md](docs/local-development.md)
- [docs/ebay-integration.md](docs/ebay-integration.md) 
- [docs/pricing.md](docs/pricing.md) : Information about the pricing model.
- [docs/operations.md](docs/operations.md) : Operational procedures and best practices.
- [docs/troubleshooting.md](docs/troubleshooting.md)
- [docs/sidecar-rest-contract.md](docs/sidecar-rest-contract.md) : Current HTTP `/api` route contract.
- [docs/API_STATUS.md](docs/API_STATUS.md) : Dated eBay API status snapshot.
- [live-pilot-notes.md](live-pilot-notes.md)
- [ROADMAP.md](ROADMAP.md)
- [SCHEMA_SPEC.md](SCHEMA_SPEC.md) : The schema specification.

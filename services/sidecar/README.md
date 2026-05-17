# Sidecar

`services/sidecar` is the canonical runtime package in this monorepo. It hosts the active MCP server, eBay auth flow, HTTP transport, setup scripts, and the repository's real test suite.

## Commands

From the repo root:

```bash
pnpm dev
pnpm setup
pnpm diagnose
pnpm sync
pnpm test
pnpm test:coverage
```

Or directly in this package:

```bash
pnpm dev
pnpm setup
pnpm diagnose
pnpm sync
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
```

## Environment

Copy the repo-root example file and configure your credentials:

```bash
cp env.example .env.local
```

The sidecar reads shared runtime configuration from the repo root `backend-services/.env.local`.
Use `pnpm validate:env` from the repo root to verify the Supabase and eBay configuration before starting schema work.

## Local-Only Operation

This package is intended to run directly on your machine for local development and single-user use. It does not require Docker or a local Supabase stack when your Supabase project is hosted.

## Scope

The sidecar currently owns:

- MCP stdio startup
- HTTP transport and OAuth metadata
- eBay REST and Trading API clients
- direct integration points to your hosted Supabase-backed app workflow
- Tool definitions, schemas, and handlers
- Setup, diagnostics, and API sync scripts
- Unit and integration tests

Future services should be extracted from the sidecar only after they have a concrete runtime boundary and their own validation surface.

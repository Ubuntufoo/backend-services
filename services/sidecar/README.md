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

Copy the package-local example file and configure your credentials:

```bash
cp services/sidecar/.env.example services/sidecar/.env
```

The sidecar reads its `.env` file from the package root, not from the repo root.

## Local-Only Operation

This package is intended to run directly on your machine for local development and single-user use. It does not require Docker or a local Supabase stack when your Supabase project is hosted.

## Scope

The sidecar currently owns:

- MCP stdio startup
- HTTP transport and OAuth metadata
- eBay REST and Trading API clients
- local workflow support for apps that use hosted Supabase externally
- Tool definitions, schemas, and handlers
- Setup, diagnostics, and API sync scripts
- Unit and integration tests

Future services should be extracted from the sidecar only after they have a concrete runtime boundary and their own validation surface.

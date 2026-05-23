# Sidecar

`services/sidecar` is the canonical runtime package in this monorepo. It hosts the active MCP server, eBay auth flow, HTTP transport, setup scripts, and the repository's real test suite.

## Commands

From the repo root:

```bash
pnpm dev
pnpm setup
pnpm diagnose
pnpm sync
pnpm ebay:validate-oauth
pnpm test
pnpm test:coverage
```

Or directly in this package:

```bash
pnpm dev
pnpm dev:stdio
pnpm setup
pnpm diagnose
pnpm sync
pnpm ebay:validate-oauth
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
```

## Environment

Copy the repo-root example file and configure your environment:

```bash
cp env.example .env
```

`pnpm dev` starts the HTTP sidecar from `src/server-http.ts`.
Use `pnpm dev:stdio` only when you explicitly want the stdio MCP server from `src/index.ts`.
The HTTP sidecar also starts the background job-runner loop by default; set `SIDECAR_JOB_RUNNER_ENABLED=false` to disable polling for tests or manual debugging.

The sidecar reads shared runtime configuration from the repo root `backend-services/.env`
and overlays `backend-services/.env.local` for machine-local overrides and persisted OAuth tokens.
The setup wizard writes credentials and user tokens to `backend-services/.env.local`.
For DB-only local development, set `EBAY_ENABLED=false` and `OAUTH_ENABLED=false`; in that mode, eBay developer credentials are not required.
Use `pnpm validate:env` from the repo root to verify the shared Supabase data-layer and eBay configuration before starting schema work.
Use `pnpm --filter sidecar ebay:validate-oauth` to confirm sandbox or production eBay credentials can exchange `EBAY_REFRESH_TOKEN` for a short-lived access token without printing the token value.

## OAuth Token Notes

- `EBAY_REFRESH_TOKEN` is the preferred variable for the narrow OAuth validator.
- `EBAY_USER_REFRESH_TOKEN` remains supported for compatibility with the existing setup wizard and sidecar auth flow.
- Refresh tokens should be quoted in `.env` or `.env.local` because eBay token values contain `#`.
- The callback redirect URL `code=...` value is an authorization code, not a refresh token.
- The eBay API Explorer `Authorization: Bearer ...` token is an access token, not a refresh token.
- `pnpm setup` at the repo root proxies to `pnpm --filter sidecar run setup`, and that wizard stores resulting credentials in `.env.local`.

## Local-Only Operation

This package is intended to run directly on your machine for local development and single-user use. It does not require Docker or a local Supabase stack when your Supabase project is hosted.

The default `app_settings` row is seeded in `supabase/migrations/20260518120000_seed_default_app_settings.sql`. Apply it through the normal Supabase migration flow for your local database if you are running one.

## Scope

The sidecar currently owns:

- HTTP transport and OAuth metadata
- MCP stdio startup
- eBay REST and Trading API clients
- local workflow support and DB-facing orchestration for apps that use hosted Supabase externally
- Tool definitions, schemas, and handlers
- Setup, diagnostics, and API sync scripts
- Unit and integration tests

Reusable Supabase access now lives in `packages/data`. Future watcher-service and job-runner extraction should consume that shared layer rather than reintroducing sidecar-local client code.

Future services should be extracted from the sidecar only after they have a concrete runtime boundary and their own validation surface.

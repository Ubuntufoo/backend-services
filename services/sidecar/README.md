# Sidecar

`services/sidecar` is the canonical runtime package in this monorepo. It hosts the active MCP server, eBay auth flow, HTTP transport, setup scripts, and the repository's real test suite.

## Commands

From the repo root:

```bash
pnpm dev
pnpm setup
pnpm ebay:diagnose-sandbox
pnpm ebay:diagnose-sandbox-config
pnpm ebay:opt-in-selling-policies
pnpm ebay:setup-sandbox
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
pnpm ebay:diagnose-sandbox
pnpm ebay:diagnose-sandbox-config
pnpm ebay:opt-in-selling-policies
pnpm ebay:setup-sandbox
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
Use `pnpm ebay:diagnose-sandbox` for read-only sandbox program diagnostics, `pnpm ebay:diagnose-sandbox-config` for read-only policy/location/app_settings discovery, `pnpm ebay:opt-in-selling-policies` to request `SELLING_POLICY_MANAGEMENT`, and `pnpm ebay:setup-sandbox` to bootstrap policies/location after account eligibility exists.

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

## Sandbox Bootstrap

`pnpm ebay:setup-sandbox` requires seller OAuth scopes:

- `https://api.ebay.com/oauth/api_scope`
- `https://api.ebay.com/oauth/api_scope/sell.account`
- `https://api.ebay.com/oauth/api_scope/sell.inventory`

Behavior:

- `ebay:diagnose-sandbox` is read-only and reports `selling_policy_management_opted_in` as `true`, `false`, or `unknown`
- `ebay:diagnose-sandbox-config` is read-only and prints safe summaries for sandbox marketplace, policies, inventory locations, current `app_settings.default`, and suggested SQL
- `ebay:opt-in-selling-policies` checks opted-in programs first, then requests `SELLING_POLICY_MANAGEMENT` only when needed
- `ebay:opt-in-selling-policies` may return "already opted in" or "already requested"; eBay can take up to 24 hours to process opt-in
- validates sandbox seller OAuth via refresh token
- prefers active sidecar marketplace over stale `app_settings.default.ebay_marketplace_id`, then persists the active marketplace
- ignores stored mock/placeholder policy IDs and merchant location keys
- prefers stored policy IDs when they still resolve in the active marketplace, then exact bootstrap-name matches
- creates named payment, fulfillment, and return defaults when missing
- keeps default fulfillment domestic-only; no ESE in bootstrap policy
- keeps default return policy conservative: returns accepted, 30-day window
- prefers stored/default inventory location key, then creates `default-main-location`
- only falls back to unrelated existing policy/location if creation fails, and prints warning
- prints terminal-readable created/reused/persisted summary and keeps `ebay:diagnose-sandbox-config` read-only

Notes:

- eBay sandbox seller UI may not expose normal business-policy management pages
- some sandbox sellers are not eligible for Business Policy at all; Account API can return `20403 User is not eligible for Business Policy`
- persistence target stays `public.app_settings`
- when sandbox seller is ineligible, keep command for future accounts but manually seed canonical `app_settings` fields for local development:
  - `default_payment_policy_id`
  - `default_fulfillment_policy_id`
  - `default_return_policy_id`
  - `merchant_location_key`
- until a usable sandbox seller exists, next eBay tasks may proceed with mocked/injected policy IDs and location key instead of live bootstrap output

Troubleshooting:

- missing scopes: re-authorize with scopes above
- wrong environment: command fails unless `EBAY_ENVIRONMENT=sandbox`
- missing seller token: set `EBAY_REFRESH_TOKEN` or `EBAY_USER_REFRESH_TOKEN`
- scope metadata missing after refresh: command warns and continues; live Account/Inventory API calls decide access
- sandbox seller ineligible for Business Policy: manual-seed `app_settings` values and continue with mocked/injected IDs until a different sandbox seller account is available
- sandbox create blocked: command may reuse first existing policy/location, with warning
- persistence failure: verify Supabase service-role env vars and connectivity

Example bootstrap output:

```bash
pnpm --filter sidecar ebay:setup-sandbox
```

```text
eBay sandbox bootstrap
marketplace: EBAY_US
app_settings row: default

payment policy ID: PAYMENT-REAL (reused)
fulfillment policy ID: FULFILLMENT-REAL (created)
return policy ID: RETURN-REAL (reused)
merchant location key: default-main-location (created)

persisted:
- ebay_marketplace_id = EBAY_US
- default_payment_policy_id = PAYMENT-REAL
- default_fulfillment_policy_id = FULFILLMENT-REAL
- default_return_policy_id = RETURN-REAL
- merchant_location_key = default-main-location
```

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

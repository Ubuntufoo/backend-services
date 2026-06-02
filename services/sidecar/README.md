# Sidecar

`services/sidecar` is the canonical runtime package in this monorepo. It hosts the active MCP server, eBay auth flow, HTTP transport, setup scripts, and the repository's real test suite.

## Commands

These commands work from the repo root or from `services/sidecar`.

```bash
pnpm dev # start HTTP sidecar
pnpm dev:stdio # start MCP stdio sidecar
pnpm setup # run setup wizard
pnpm ebay:diagnose-offer -- 11109473010 # inspect one offer
pnpm ebay:diagnose-sandbox # check sandbox eBay account state
pnpm ebay:diagnose-sandbox-config # inspect sandbox config and policies
pnpm ebay:cleanup-sandbox -- --sku Single-000001 # dry-run exact sandbox SKU cleanup
pnpm ebay:cleanup-sandbox -- --prefix Single- --prefix Lot- --from 1 --to 50 # dry-run generated sandbox SKU cleanup
pnpm ebay:cleanup-sandbox -- --sku Single-000001 --delete --confirm-sandbox-cleanup # delete exact sandbox SKU
pnpm ebay:cleanup-sandbox -- --prefix Single- --prefix Lot- --from 1 --to 50 --delete --confirm-sandbox-cleanup # delete generated sandbox SKUs
pnpm ebay:opt-in-selling-policies # request selling policy opt-in
pnpm ebay:reconcile-published-listing -- --offer-id 11109473010 # repair exported listing state
pnpm ebay:setup-sandbox # bootstrap sandbox policies and location
pnpm diagnose # run diagnostics
pnpm sync # sync local sidecar state
pnpm ebay:validate-oauth # validate OAuth tokens
pnpm lint # lint package
pnpm typecheck # typecheck package
pnpm test # run tests
pnpm test:coverage # run coverage tests
```

## Environment

Copy the repo-root example file and configure your environment:

```bash
cp env.example .env
```

`pnpm dev` starts the HTTP sidecar from `src/server-http.ts`.
Use `pnpm dev:stdio` only when you explicitly want the stdio MCP server from `src/index.ts`.
The HTTP sidecar also starts the background job-runner loop by default; set `SIDECAR_JOB_RUNNER_ENABLED=false` to disable polling for tests or manual debugging.
Use `pnpm ebay:diagnose-offer -- <offerId>` for read-only offer inspection, `pnpm ebay:diagnose-sandbox` for read-only sandbox program diagnostics, `pnpm ebay:diagnose-sandbox-config` for read-only policy/location/app_settings discovery, `pnpm ebay:cleanup-sandbox -- --sku <SKU>` for exact sandbox SKU cleanup, `pnpm ebay:cleanup-sandbox -- --prefix <PREFIX> --from <N> --to <M>` for generated sandbox SKU cleanup that avoids the unreliable inventory-list endpoint, `pnpm ebay:opt-in-selling-policies` to request `SELLING_POLICY_MANAGEMENT`, `pnpm ebay:reconcile-published-listing -- --listing-id <listingId>` or `--offer-id <offerId>` for repair-only exported-state reconciliation, and `pnpm ebay:setup-sandbox` to bootstrap policies/location after account eligibility exists.

The sidecar reads shared runtime configuration from the repo root `backend-services/.env`
and overlays `backend-services/.env.local` for machine-local overrides and persisted OAuth tokens.
The setup wizard writes credentials and user tokens to `backend-services/.env.local`.
For DB-only local development, set `EBAY_ENABLED=false` and `OAUTH_ENABLED=false`; in that mode, eBay developer credentials are not required.
Use `pnpm validate:env` from the repo root to verify the shared Supabase data-layer and eBay configuration before starting schema work.
Use `pnpm --filter sidecar ebay:validate-oauth` to confirm sandbox or production eBay credentials can exchange `EBAY_REFRESH_TOKEN` for a short-lived access token without printing the token value.

Example sandbox config diagnostic:

```bash
pnpm --filter sidecar ebay:diagnose-sandbox-config
```

```text
eBay sandbox config diagnostic
overall: FAIL
environment: sandbox
marketplace: EBAY_US

[FAIL] payment policy ID
  current: mock-payment-policy-id
  expected: PAYMENT-REAL
  note: default_payment_policy_id contains obvious placeholder value.
  fix: Replace placeholder with real sandbox policy ID PAYMENT-REAL.

[PASS] fulfillment policy ID
  current: FULFILLMENT-REAL
  note: Configured sandbox fulfillment policy ID exists for marketplace EBAY_US.

suggested sql:
update public.app_settings
...
```

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

## Supabase API Grants

This repo uses an explicit SQL grant model for `public` schema tables so Supabase Data API access does not depend on implicit defaults that may tighten over time.

For this local-only, single-user architecture:

- trusted backend runtimes (`sidecar`, watcher, future job-runner) use `service_role`
- `service_role` owns backend reads and writes for app tables
- browser access stays minimal and read-only
- `public.listings` is the only current browser-visible table
- `anon` and `authenticated` keep `SELECT` on `public.listings` for current browser/realtime usage
- `jobs`, `orders`, `app_settings`, and `daily_usage` stay backend-only

Grants and RLS are separate controls:

- grants decide whether `anon`, `authenticated`, or `service_role` can reach a table through SQL/PostgREST
- RLS policies decide which rows those roles can read or mutate after access exists
- this repo keeps explicit grants in migrations and does not treat them as a replacement for RLS

When adding a future `public` table:

1. add the table in a migration
2. keep default access backend-only via `service_role`
3. if browser/API exposure is needed, add explicit table grants for the required role
4. if the table is browser/API exposed, enable RLS and add matching policies
5. if the table uses identity or serial sequences, add the required sequence grants too

Security Advisor / manual verification:

- review Supabase Security Advisor after schema changes, especially after adding `public` tables
- confirm grants:

```sql
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;
```

- confirm policies:

```sql
select *
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

- if browser listings/realtime stops working, also confirm publication membership:

```sql
select *
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'listings';
```

## Supabase Realtime Troubleshooting

Browser realtime for listings depends on both publication membership and RLS visibility.

- `public.listings` must be included in the `supabase_realtime` publication.
- `public.listings` must have a `SELECT` policy for the browser subscriber role.
- The current local UI uses anon/public-key Supabase realtime unless a real authenticated session is added later, so both `anon` and `authenticated` need read access for the current setup.

Manual checks:

```sql
select * from pg_policies where schemaname='public' and tablename='listings';
select * from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='listings';
```

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

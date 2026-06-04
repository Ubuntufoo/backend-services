# Backend Services

This repository is the backend monorepo for the eBay Inventory Manager. It is intentionally optimized for a local-only, single-user workflow:

- `services/sidecar` is the only implemented runtime package today.
- `packages/data` owns the shared Supabase client and typed repository helpers used by that runtime.
- Future boundaries are documented, but they should stay inside the sidecar or the main app until scale or operational pressure proves a real extraction is needed.

## Canonical Layout

```text
backend-services/
  packages/
    data/                 # Shared Supabase data layer
    env/                  # Shared environment contracts
    types/                # Shared workflow/domain types
  services/
    image-service/        # Local image processing runtime
    sidecar/              # Active package
    watcher-service/      # Local filesystem watcher runtime
  docs/                   # Shared reference material
  scripts/                # Repo-level guardrails
```

The root package is orchestration-only. It does not own application runtime code.

Planned service boundaries stay documented until they are promoted into real packages.

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
For image processing, run `pnpm --filter @ebay-inventory/image-service test`.

## Runtime Commands

Use this table as the current local start/run reference. Update it as new services become executable.

| Runtime | Location | Dev / Init | Production / Alternate | Notes |
| --- | --- | --- | --- | --- |
| Sidecar HTTP | `backend-services` | `pnpm dev` or `pnpm dev:sidecar` | `pnpm --filter sidecar start` | Canonical backend runtime for local app integration. |
| Sidecar MCP stdio | `backend-services` | `pnpm dev:sidecar:stdio` | `pnpm --filter sidecar start` | Use stdio only for MCP clients. |
| Sidecar setup wizard | `backend-services` | `pnpm setup` | `pnpm --filter sidecar run setup` | Writes credentials and tokens to `.env.local`. |
| Sidecar env validation | `backend-services` | `pnpm validate:env` | `pnpm --filter sidecar validate:env` | Validates shared env contract. |
| Sidecar eBay OAuth validation | `backend-services` | `pnpm validate:ebay-oauth` | `pnpm --filter sidecar ebay:validate-oauth` | Prefers `EBAY_REFRESH_TOKEN`, falls back to `EBAY_USER_REFRESH_TOKEN`. |
| Watcher service | `backend-services` | `pnpm --filter @ebay-inventory/watcher-service dev` | `pnpm --filter @ebay-inventory/watcher-service start` | Watches incoming filesystem assets. |
| Image service | `backend-services` | `pnpm --filter @ebay-inventory/image-service test` | `pnpm --filter @ebay-inventory/image-service build` | Library package today, no standalone dev server yet. |
| UI app | `../ebay-ui-app` | `cd ../ebay-ui-app && pnpm dev` | `cd ../ebay-ui-app && pnpm build && pnpm start` | Companion Next.js UI repo, outside this workspace. |

## Sidecar

End-user setup, local development, and MCP-specific usage now live in [services/sidecar/README.md](services/sidecar/README.md).
These commands work from the repo root or from `services/sidecar`.

```bash
pnpm dev # start HTTP sidecar for local app integration
pnpm dev:sidecar # start HTTP sidecar alias
pnpm dev:sidecar:stdio # start MCP stdio sidecar
pnpm setup # run local setup wizard
pnpm ebay:diagnose-offer -- 11109473010 # inspect one offer
pnpm ebay:diagnose-sandbox # check sandbox eBay account state
pnpm ebay:diagnose-sandbox-config # inspect sandbox policies and inventory config
pnpm ebay:cleanup-sandbox -- --sku Single-000001 # dry-run exact sandbox SKU cleanup
pnpm ebay:cleanup-sandbox -- --prefix Single- --prefix Lot- --from 1 --to 50 # dry-run generated sandbox SKU cleanup
pnpm ebay:cleanup-sandbox -- --sku Single-000001 --delete --confirm-sandbox-cleanup # delete exact sandbox SKU
pnpm ebay:cleanup-sandbox -- --prefix Single- --prefix Lot- --from 1 --to 50 --delete --confirm-sandbox-cleanup # delete generated sandbox SKUs
pnpm ebay:opt-in-selling-policies # request selling policy opt-in
pnpm ebay:reconcile-published-listing -- --offer-id 11109473010 # repair local export state
pnpm ebay:setup-sandbox # bootstrap sandbox policies and location
pnpm validate:env # validate shared env config
pnpm validate:ebay-oauth # validate eBay OAuth tokens
pnpm diagnose # run repo diagnostics
pnpm sync # sync local sidecar state
pnpm update:api-status # refresh API status docs
```

Use `pnpm dev:sidecar:stdio` only when you explicitly want the stdio MCP server.
Use `pnpm ebay:diagnose-offer -- <offerId>` for read-only offer inspection, `pnpm ebay:diagnose-sandbox` for read-only sandbox seller-program diagnostics, `pnpm ebay:diagnose-sandbox-config` for read-only business-policy/location discovery, `pnpm ebay:cleanup-sandbox -- --sku <SKU>` for exact sandbox SKU cleanup, `pnpm ebay:cleanup-sandbox -- --prefix <PREFIX> --from <N> --to <M>` for generated sandbox SKU cleanup that avoids the unreliable inventory-list endpoint, and `pnpm ebay:opt-in-selling-policies` to request `SELLING_POLICY_MANAGEMENT`.
Use `pnpm ebay:setup-sandbox` to bootstrap sandbox business policies and default inventory location into `app_settings`, reusing valid existing IDs when possible and persisting the active sidecar marketplace.
Use `pnpm ebay:reconcile-published-listing -- --listing-id <listingId>` or `--offer-id <offerId>` for repair-only exported-state reconciliation; command never republishes or mutates inventory.
If eBay sandbox seller account is not eligible for Business Policy, keep bootstrap command for future accounts but manually seed `public.app_settings.default_payment_policy_id`, `default_fulfillment_policy_id`, `default_return_policy_id`, and `merchant_location_key`, then continue downstream work with mocked/injected IDs.
For the watcher runtime, run `pnpm --filter @ebay-inventory/watcher-service dev`.

## eBay OAuth Notes

- `pnpm setup` writes machine-local credentials and user tokens to `backend-services/.env.local`.
- `EBAY_REFRESH_TOKEN` is the preferred variable for the new OAuth validator.
- `EBAY_USER_REFRESH_TOKEN` is still supported for compatibility with the older setup/auth flow.
- Quote refresh tokens in env files because they contain `#`.
- Do not paste the callback URL `code=...` value into `EBAY_REFRESH_TOKEN`.
- Do not paste the eBay API Explorer `Authorization: Bearer ...` access token into `EBAY_REFRESH_TOKEN`.

## Local-Only Defaults

For a local-only setup with cloud Supabase integration:

- keep shared runtime config in `backend-services/.env` and machine-local overrides or tokens in `backend-services/.env.local`
- for DB-only local development, set `EBAY_ENABLED=false` and `OAUTH_ENABLED=false`
- run `services/sidecar` directly on your machine
- keep Supabase hosted instead of adding a local database stack here
- keep reusable Supabase access in `packages/data` instead of reimplementing service clients inside runtime packages
- keep `public` schema Data API grants explicit in migrations: backend uses `service_role`, browser tables opt in intentionally
- keep planned image, R2, Gemini, eBay, and job-runner concerns as modules or Supabase-triggered workflows until a second runtime is clearly necessary
- avoid containerization and multi-process orchestration unless deployment needs actually appear

## Guardrails

- The repo-level layout check fails if a duplicate root runtime tree or placeholder service package manifests reappear.
- Workspace validation covers `services/sidecar`, `services/watcher-service`, `services/image-service`, and shared packages.
- Planned services should be documented first, then promoted into workspace packages when they have real behavior and tests.

## Related Docs

- [SERVICES.md](SERVICES.md) for service responsibilities and promotion criteria
- [AGENTS.md](AGENTS.md) for architecture intent and implementation boundaries
- [docs/API_STATUS.md](docs/API_STATUS.md) for the current eBay API status snapshot

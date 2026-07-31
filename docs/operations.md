# Operations

## Safe Commands

| Command | Purpose | Safety |
| --- | --- | --- |
| `pnpm validate:env` | Validate shared env contract | read-only |
| `pnpm validate:ebay-oauth` | Validate refresh-token exchange | read-only |
| `pnpm diagnose` | Sidecar diagnostics summary | read-only |
| `pnpm ebay:diagnose-offer -- <offerId>` | Inspect one offer | read-only |
| `pnpm ebay:diagnose-live-readiness` | Check live publish readiness | read-only |
| `pnpm ebay:list-live-publish-config` | Print active live config summary | read-only |
| `pnpm ebay:diagnose-sandbox` | Check sandbox seller program state | read-only |
| `pnpm ebay:diagnose-sandbox-config` | Inspect sandbox policies/location/app settings | read-only |
| `pnpm sync` | Sidecar dev sync helper | side effects depend on current implementation |
| `pnpm update:api-status` | Refresh generated eBay status doc | writes `docs/API_STATUS.md` |

## Mutating eBay/Admin Commands

| Command | Purpose |
| --- | --- |
| `pnpm setup` | Writes local credential/token config to `.env.local` |
| `pnpm ebay:setup-sandbox` | Creates or reuses sandbox policy/location config |
| `pnpm ebay:opt-in-selling-policies` | Requests sandbox selling-policy opt-in |
| `pnpm ebay:cleanup-sandbox -- ... --delete --confirm-sandbox-cleanup` | Permanently deletes eligible sandbox eBay and local listing resources |
| `pnpm ebay:reconcile-published-listing -- ...` | Repairs local exported-state tracking without republishing |

## Pricing Commands

| Command | Purpose | Safety |
| --- | --- | --- |
| `pnpm pricing:diagnose-soldcomps-config` | Validate SoldComps provider mode/env selection | read-only |
| `pnpm pricing:diagnose-apify-config` | Validate Apify provider mode/env selection | read-only |
| `pnpm pricing:smoke-soldcomps -- --listing-id <listingId>` | Fetch SoldComps pricing for one listing without persistence | read-only |
| `pnpm pricing:smoke-apify -- --listing-id <listingId>` | Fetch Apify pricing for one listing without persistence | read-only but spends live provider quota |
| `pnpm pricing:price-one -- --listing-id <listingId>` | Run the real `research_price` path for one listing | writes `listing_price_research` and may update `listings.price` |

## Sandbox Listing Cleanup

`ebay:cleanup-sandbox` accepts the exact canonical SKU persisted in `listings.sku` and used by eBay Inventory API. It does not accept `listing_id`/base values such as `Single-000016`.

Dry-run one or multiple exact SKUs:

```bash
pnpm ebay:cleanup-sandbox -- --sku BSKBL-Single-000016
pnpm ebay:cleanup-sandbox -- --sku BSKBL-Single-000016 --sku OTHER-Lot-000123
pnpm ebay:cleanup-sandbox -- --prefix BSBL-Single- --from 1 --to 10
```

Destructive one or multiple exact SKUs:

```bash
pnpm ebay:cleanup-sandbox -- --sku BSKBL-Single-000016 --delete --confirm-sandbox-cleanup
pnpm ebay:cleanup-sandbox -- --sku BSKBL-Single-000016 --sku OTHER-Lot-000123 --delete --confirm-sandbox-cleanup
```

Deletion requires `EBAY_ENVIRONMENT=sandbox`. The command ends published listings, deletes exact offers and inventory items, then permanently deletes persisted R2 object keys, the safely contained watcher processed directory, and the Supabase listing row. Jobs, pricing research, and AI model attempts are removed by foreign-key cascade. Orders never cascade.

Only non-sold `exported`/`listed` rows with an eBay/export trace are eligible. Sold rows, order-bearing rows, active jobs, ambiguous SKU matches, stale state, unsafe watcher paths, and remote-only resources without a local row are refused before remote mutation. Missing remote resources, R2 objects, or watcher directories are idempotent success. After a prior remote-only cleanup, rerun the same structured-SKU destructive command to purge the eligible local row.

The frontend-facing equivalent is `POST /api/listings/:listingId/delete-sandbox` with `{ "confirmed": true, "expectedSku": "BSKBL-Single-000016", "expectedUpdatedAt": "<current updated_at>" }`. It invokes the same sandbox-only workflow and permanently deletes the same resources.

## Operational References

- Pricing runtime, persistence, and retry/warning behavior: [pricing.md](pricing.md)
- eBay config/publish notes: [ebay-integration.md](ebay-integration.md)
- Troubleshooting: [troubleshooting.md](troubleshooting.md)
- Generated eBay status feed snapshot: [API_STATUS.md](API_STATUS.md)

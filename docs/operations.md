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
| `pnpm ebay:cleanup-sandbox -- ... --delete --confirm-sandbox-cleanup` | Deletes matching sandbox inventory/offers |
| `pnpm ebay:reconcile-published-listing -- ...` | Repairs local exported-state tracking without republishing |

## Pricing Commands

| Command | Purpose | Safety |
| --- | --- | --- |
| `pnpm pricing:diagnose-soldcomps-config` | Validate SoldComps provider mode/env selection | read-only |
| `pnpm pricing:diagnose-apify-config` | Validate Apify provider mode/env selection | read-only |
| `pnpm pricing:smoke-soldcomps -- --listing-id <listingId>` | Fetch SoldComps pricing for one listing without persistence | read-only |
| `pnpm pricing:smoke-apify -- --listing-id <listingId>` | Fetch Apify pricing for one listing without persistence | read-only but spends live provider quota |
| `pnpm pricing:price-one -- --listing-id <listingId>` | Run the real `research_price` path for one listing | writes `listing_price_research` and may update `listings.price` |

## Operational References

- Pricing runtime, persistence, and retry/warning behavior: [pricing.md](pricing.md)
- eBay config/publish notes: [ebay-integration.md](ebay-integration.md)
- Troubleshooting: [troubleshooting.md](troubleshooting.md)
- Generated eBay status feed snapshot: [API_STATUS.md](API_STATUS.md)

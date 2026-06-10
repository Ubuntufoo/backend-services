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

## Operational References

- eBay config/publish notes: [ebay-integration.md](ebay-integration.md)
- Troubleshooting: [troubleshooting.md](troubleshooting.md)
- Generated eBay status feed snapshot: [API_STATUS.md](API_STATUS.md)

# YP9.6c4 — cleanup execution safety contract (design only)

The zero-quantity SKU removal and leftover image cleanup remain separate, operator-confirmed operations.

## Current implementation
GET /api/variation-listings/:groupId/removed-sku-purge-preview/:revisionId returns non-cacheable, non-executable readiness diagnostics. It uses the immutable v3 revision, complete checkpoint journal, current aggregate, paginated cross-owner data, configured incoming directory and R2 HEAD. The response always has deletionAuthorized:false. When OAuth middleware is absent, the route returns diagnostic counts and blockers but redacts absolute local paths and R2 object keys; only a request authenticated by that middleware receives those resource identities. The proposed witness SQL migration is unapplied and is not used by this endpoint. Neither an R2 HEAD result nor a filename match proves exclusive ownership.

## Mandatory gates before any future deletion
1. Rehydrate and verify the exact v3 revision/intent and complete ordered terminal journal; verify target absent and active survivors unchanged.
2. Identify exclusively owned keys/paths across Variation, Standard Single/Lot, historical revisions, media consumers and supported encoded references. Unknown, partial or unavailable evidence blocks deletion. Historical same-copy provenance is not automatically another owner.
3. Recheck the live reference set in a consistent database transaction, with an effective concurrency barrier for new owners. A snapshot read without a lock is not authorization.
4. Pin local identity using root, canonical path and physical inode/file-descriptor or equivalent safe quarantine; reject symlinks/hardlinks, path replacement and unconfigured roots. Never recursively remove guessed folders.
5. Prove R2 object identity at DELETE with a provider-supported conditional version/ETag safeguard. If the provider cannot guarantee conditional identity, do not delete based on a prior HEAD.
6. Persist a crash-safe operation record before mutations; separately journal every local and R2 resource as attempted, removed, already absent, skipped, blocked or failed. Retry only safely idempotent/unresolved work, including ambiguous remote outcomes.
7. Require a distinct, explicit cleanup confirmation after successful Publish Changes. Show exact resource names and reasons for any block. Never auto-clean as a side effect of publication or refresh.
8. Validate on disposable files and test R2 objects: shared ownership, changed paths, replacement races, failed/ambiguous requests, partial completion, restart and repeated attempts. Never touch surviving groups, SKUs, Offers, Inventory Items or essential v3 revision/journal lineage.

This document is not deletion approval. There is no executable purge endpoint or destructive runner in YP9.6c4 yet.

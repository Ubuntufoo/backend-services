# YP9.6c4 — cleanup execution safety contract (design only)

> **Status: historical design context.** Current source and migration history,
> not this pre-execution design, govern purge readiness. This document grants no
> deletion authority and must not be used to infer current hosted migration state.

The zero-quantity SKU removal and leftover image cleanup remain separate, operator-confirmed operations.

## Current implementation
GET /api/variation-listings/:groupId/removed-sku-purge-preview/:revisionId returns non-cacheable, non-executable readiness diagnostics. It uses the immutable v3 revision, complete checkpoint journal, current aggregate, paginated cross-owner data, configured incoming directory and R2 HEAD. The response always has deletionAuthorized:false. When OAuth middleware is absent, the route returns diagnostic counts and blockers but redacts absolute local paths and R2 object keys; only a request authenticated by that middleware receives those resource identities. The restricted read-only ownership-witness SQL function was deployed and verified on production on 2026-11-10, and this preview uses it as additional non-authorizing evidence (`databaseWitnessUsed:true` on success). Neither an R2 HEAD result nor a filename match proves exclusive ownership.

## EXEC1 offline journal foundation (not deployed)

The worktree contains an additive, unapplied PostgreSQL journal migration and a
Sidecar persistence seam for a future executor. It freezes the immutable
group/revision/variation/SKU identity and each local/R2 resource, records
per-resource CAS versions and `planned`/`attempting`/`removed`/`already_absent`/
`failed`/`unknown` outcomes, and persists an attempt barrier before any future
provider call. Interrupted or ambiguous attempts become `unknown` and cannot be
blindly retried. The journal is deliberately non-authorizing: both confirmation
and deletion flags are permanently false, no confirmation API or delete runner
exists, and the migration has not been applied to any hosted database.

EXEC1 does not solve deletion-time local identity/quarantine, an atomic R2
conditional-delete guarantee, or the separately authorized operator-confirmation
workflow. Those remain EXEC2–EXEC4 gates; no local file, R2 object, eBay
resource, or hosted row is deleted by this foundation.

## EXEC3 storage investigation — offline only

Cloudflare R2's documented S3 API supports atomic conditional PutObject (If-None-Match: *) but provides no documented conditional DeleteObject identity guarantee. The shared R2 uploader has an opt-in create-once option, enabled only for Variation capture uploads. A 412, unknown upload outcome, partial success, malformed success, or downstream persistence failure never triggers an unconditional delete of either expected key; the watcher fails closed and leaves media for explicit reconciliation. Standard uploads retain their existing overwrite behavior. Even successful create-once uploads do not grant deletion authority; no unconditional production R2 deletion is permitted for removed-SKU cleanup.

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

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

## EXEC3 read-only frozen-content proof

The audited offline-only TypeScript verifier accepts caller-supplied HEAD/GET observations; it contains no R2 client, filesystem access, or delete operation. It strictly validates bounded frozen copy, key, source-reference, ownership-check, and observation structures; requires the complete front/back set; hashes the exact bounded bytes against each lowercase SHA-256 key prefix; and blocks missing, duplicate, swapped, changed, malformed, oversized, or inconsistent evidence. ETags are opaque point-in-time change signals only: matching HEAD/GET values need not be 32-hex MD5 and are not content or ownership proof. Every result keeps `deletionAuthorized:false`. A future adapter must stream with an enforced byte ceiling and remain read-only; it is not authorized here.

[Cloudflare's S3 compatibility table](https://developers.cloudflare.com/r2/api/s3/api/) documents atomic conditional `PutObject`, but does not document conditional `DeleteObject`, and marks bucket versioning unsupported. The [Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) likewise exposes `delete(key | key[])` without `onlyIf` or a version target. R2's [strong-consistency contract](https://developers.cloudflare.com/r2/reference/consistency/) prevents stale reads but says concurrent writes/deletes are last-writer-wins; a fresh HEAD/GET followed by unconditional DELETE therefore remains a race. [Bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/) block overwrite and deletion for retention, but do not compare object identity while deleting. Maintenance windows, immediate rereads, content-addressed keys, and app-level writer shutdown reduce risk but are mitigations, not atomic deletion proof. The practical next implementation boundary is immutable create-once keys plus a durable exclusive-writer/tombstone design and reconciliation-only orphan handling; no production R2 delete path is approved.

For local files, macOS can provide destination no-clobber with `renameatx_np(..., RENAME_EXCL)` only on a same-filesystem volume that advertises [exclusive-renaming support](https://developer.apple.com/documentation/foundation/urlresourcekey/volumesupportsexclusiverenamingkey). `renameatx_np` still resolves the source by parent-directory descriptor and name, not by an already-verified source file descriptor, so another writer can replace that name between `fstat` and rename. Plain rename may clobber; cross-volume copy/unlink is multi-step. A future quarantine primitive must require the supported native flag, controlled parent directories/exclusive writer, exact post-move identity verification, and fail closed on `EEXIST`, `ENOTSUP`, `EXDEV`, or any mismatch.

## Exclusive-writer/tombstone gate — blocked offline

The shared image uploader now rejects any `variation-listing/` write that lacks atomic create-once or the watcher's exact lowercase UUID group/variation/copy path, supported image extension and matching SHA-256 content prefix. Focused tests cover malformed paths, wrong content, missing create-once and rejected calls before R2 client construction. This closes **this application's** ordinary shared uploader overwrite path, but credentials used outside this uploader remain out-of-band writers.

No database tombstone or freeze was added. The existing terminal-v3 chain and read-only witness do not authenticate who created the revision/checkpoint evidence, and the witness deliberately reports same-group history, journal history and complete reference search as unverified. The generic cleanup journal also accepts arbitrary caller identity/resource strings. Treating either source as freeze authority would permit forged tombstones. A future freeze must add creator/capability provenance, bind exact terminal v3 removal evidence and prior image identities, and transaction-serialize all new Variation and Standard references (including revisions and indirect media references) with deterministic per-key locks. Both concurrent orders and rollback require disposable PostgreSQL tests before deployment. A DB tombstone still cannot protect a simultaneous external R2 write or macOS source path swap; maintain production deletion disabled.

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

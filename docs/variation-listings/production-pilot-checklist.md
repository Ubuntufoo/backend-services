# YP10.10 — Guarded Production Variation Pilot

This runbook supersedes the two-card YP9.3 pilot. The independent YP10.10 audit concluded **NO-GO for live mutation until the readiness gates below are met**. This document authorizes no environment edit, restart, API call, publication, deletion, or withdrawal.

## Scope and pilot cards

One new Production-only Variation bucket, three legitimate, physically owned, condition-consistent, inexpensive sports cards, each with verified front/back images, one copy and a manually selected price tier near twice its checked market value. Higher pricing does not prevent a sale; be ready to fulfill an order.

| Variation | Initial qty | Proposed acceptance | Current authorization |
| --- | ---: | --- | --- |
| A | 1 | Separately approve positive-only 1 → 2 → 1; never restore from zero | Production account checks passed; other gates pending |
| B | 1 | Eventually verify terminal 1 → 0 retirement under OOS disabled (sale-driven or manual); new stock becomes a fresh variation/SKU | **BLOCKED; skip entire B exercise for now** |
| C | 1 | Unchanged control | No adjustment |

Use the backend and frontend `feature/you-pick` worktrees. Do not alter existing Standard listings, main-branch resources, or unresolved Sandbox group/revision history. Do not reuse historical bucket tokens, SKUs, revision or operation IDs.

## Phase 0 — Prepare without changing anything

- [ ] Record backend/frontend HEAD, dirty files and known pending Standard or Variation capture operations.
- [ ] Select three cards, verify ownership, condition, shipping readiness, images, profile/category, card selectors and appropriate supported price tiers. Record market-price evidence.
- [ ] Identify the exact Production seller, marketplace `EBAY_US`, policies, location and expected listing/category profile from existing trusted records. Label anything not freshly confirmed **LIVE UNVERIFIED**.
- [ ] List historical Sandbox incidents as forbidden for Production actions; preserve their journals.
- [ ] Assign an operator for order monitoring and normal fulfillment, including what happens if a buyer purchases a card.
- [ ] Keep publication disabled. Request *separate approval* before environment changes, remote diagnostics, local bucket/capture writes, any publish/quantity action, or withdrawal.

**Gate:** No in-flight capture or remote action; pilot cards and operator prepared; Sandbox incidents isolated by explicit IDs.

## Phase 1 — Approved Production environment transition

This phase requires authorization for local config changes and service restarts, not for eBay resource mutation.

- [ ] Stop Sidecar and capture intake safely; confirm no pending image pair. Do not move or delete files.
- [ ] Verify the actual process environment: `EBAY_ENVIRONMENT=production`, `EBAY_MARKETPLACE_ID=EBAY_US`, intended Production credentials and host `https://api.ebay.com`, OAuth token URL `https://api.ebay.com/identity/v1/oauth2/token`, and `EBAY_PUBLISH_ENABLED=false`.
- [ ] Review inherited shell values and root `.env` precedence; already-exported variables can override dotenv. Correct any stale Sandbox overrides only under explicit configuration-edit approval. Never expose tokens.
- [ ] Confirm the selected Production policy/location settings; do not change hosted settings during this step.
- [ ] Restart Sidecar to refresh its process-cached eBay gateway and verify **running**, not merely shell, environment identity and disabled publish guard.
- [ ] Restrict raw inventory/offer/group/location MCP mutation handlers, repair scripts, and other unguarded surfaces. The publish flag is **not** a global mutation lock.
- [ ] Prevent Standard capture/publishing side effects during the pilot.

**Gate:** Exact Production runtime and account selection, disabled publish guard, and no accidental mutation paths.

## Phase 2 — Separately authorized live readiness reads

The earlier strict audit prohibited every eBay POST, including *read-semantics* requests. The normal diagnostic commands **refresh OAuth using HTTP POST**; Trading `GetUser`, `GetItem`, and `GetUserPreferences` also use POST transport. Do **not** run those commands under the prior no-POST authorization. Obtain a separate, tightly scoped approval for these non-resource-changing requests. No permission to change preferences or listings is implied.

After inspecting the command implementations and obtaining approval, consider:

```bash
pnpm validate:env
pnpm ebay:diagnose-live-readiness
pnpm ebay:list-live-publish-config
```

- [ ] Prove Production OAuth and **seller identity** separately; Account privileges alone do not establish the exact seller.
- [ ] Confirm `EBAY_US`, active Production payment, fulfillment and return policies, an enabled merchant location, profile/category/aspects and effective publish settings.
- [x] Operator confirmed Production **Out-of-Stock Control is disabled** and explicitly elected to leave it disabled. All terminal-zero children are discontinued; later copies require new variation/SKU capture. Never use the Sandbox enabling script or `SetUserPreferences`. Do not attempt 0→positive restoration. Before testing B at zero, independently prove exact OOS-disabled eBay resource behavior and supported cleanup safety (YP10.11/YP9.6c5).
- [ ] Use read-only inspection to establish relevant hosted migration/RPC/ACL state, pending capture sessions, new-pilot journal state, and current seller orders; do not trigger checkpoint-writing reconciliation.
- [ ] Record sanitized results. With `EBAY_PUBLISH_ENABLED=false`, a disabled-guard warning is expected; any other required-check failure stops the pilot.
- [ ] Confirm the real-gateway publish guard rejects with `publish_disabled` before creating a revision or resource. A deliberate UI negative test needs its own approval.

**Gate:** All live prerequisites independently confirmed; explicit approval recorded for any API POST reads; no pending/unknown pilot action. **Publication still not authorized.**

## Phase 3 — Fresh bucket preparation, separately approved local writes

- [ ] Approve creation of exactly one new Production-only bucket for A, B, C.
- [ ] Capture three front/back image pairs through intended armed Variation intake; confirm routing and `watcher/processed/<bucket>/` archives. Verify no Standard listing changes.
- [ ] Check direct Sidecar and UI match: group ID/key, three variation IDs/SKUs/selectors, `EBAY_US`, exact Production policies, merchant location, profile, category and Sport.
- [ ] Confirm title at most 80 characters, selectors at most 65, condition/description/images, three manual price tiers near twice market, and initial qty 1 each.
- [ ] Confirm fresh desired revision, no historical revision/operation/checkpoint collision or unresolved action, and no pending capture.
- [ ] Leave `EBAY_PUBLISH_ENABLED=false`.

**Gate:** Fresh valid three-card group prepared but unpublished.

## Phase 4 — Initial publish, separately approved

- [ ] Recheck exact Production seller/configuration, guard, orders, A/B/C images/quantity/price and pending state.
- [ ] Obtain authorization for one initial publish of the exact group. Enable publish flag, restart Sidecar, verify readiness, then use normal Variation **Publish once**.
- [ ] Disable publish flag immediately afterward, restart Sidecar, confirm effective guard. For an unknown result, close the window and stop without retry.
- [ ] Confirm exact eBay group, Items, Offers, listing ID, terminal desired/confirmed revision and no Standard/sibling changes.
- [ ] **Mandatory buyer-facing verification:** inspect the live listing and separately approved Trading `GetItem` evidence for all three SKUs, selectors, images, prices, qty 1, condition, shipping and returns. The initial executor's REST reconciliation alone does not prove all listing-facing values.
- [ ] Check for buyer orders and stop on any unexpected state.

**Gate:** Three confirmed listing-facing children and unchanged listing identity.

## Phase 5 — A qty 1 → 2, separately approved

- [ ] Recheck Production Out-of-Stock Control **disabled**, orders, current revisions and complete A/B/C remote quantities.
- [ ] Separately authorize local staging of A `+1`; ensure B/C remain unchanged.
- [ ] Authorize one **Publish Changes** for the increment; enable/restart, publish once, then disable/restart.
- [ ] Independently verify A Inventory Item, Offer and Trading listing-facing available quantity **2**. No zero transition occurs.
- [ ] Verify B/C at qty 1 with identical price, SKU, selector, images and original listing ID; terminal revision and no order.

**Gate:** A confirmed at quantity 2; siblings unchanged. Unknown outcome means stop, not retry.

## Phase 6 — A qty 2 → 1, separately approved

- [ ] Recheck positive baseline (A quantity 2), orders, OOS-disabled policy and exact group/Item/Offer/Trading state.
- [ ] Separately authorize local A `-1` stage, then a distinct one-time **Publish Changes** window with Sidecar restart before and after.
- [ ] Verify A again has exact listing-facing sellable qty 1 with original price/images/selector/SKU; Item and Offer agree; B/C qty 1 and listing ID unchanged. No former zero-quantity SKU is revived.
- [ ] Confirm terminal revision/journal, no pending adjustments and no unexpected order.

**Gate:** A positive-only quantity increment/decrement verified. This is sufficient to proceed to authorized withdrawal without testing B.

## Phase 7 — B terminal-zero retirement: NO-GO / SKIP

Do not zero or delete B under the initial pilot. Production OOS is disabled: a terminal zero, whether due to an eBay-confirmed sale or a published manual decrement, is intended to retire the child permanently. Reacquisition requires fresh capture and new SKU; never restore the old child. A separate review must resolve:
- [ ] Target Item **non-quantity payload** is not compared to frozen payload immediately before c2b deletion, although survivor payloads are.
- [ ] c2 journal/replay contract differs from executor's stricter no-mutation-replay behavior; document and test the final contract.
- [ ] Hosted c1/c2/c2b migration, retirement RPC/ACL and journal state are not confirmed. The source retirement migration describes itself as unapplied; hosted state must be read, not assumed.
- [ ] No integrated open-order preflight in permanent deletion; exact current orders must be independently verified.
- [ ] Establish exact post-zero Trading/Item/Offer/group state, including where eBay has already removed listing-facing child membership. Require only evidence actually applicable to that authoritative state; never infer remote Item/Offer deletion from Trading omission. Verify no pending adjustment, at least two unaffected survivors, and no ambiguous remote operation.
- [ ] Historical eBay `25082` and HTTP `400` are stop conditions. No blind retries or unsupported repairs.

If independently resolved under YP10.11/YP9.6c5, **B's decrement and any irreversible SKU/remote/local cleanup each need new explicit approvals**. No automatic cleanup upon zero. YP9.6c4 local/R2 image purge is excluded and separately blocked.

## Phase 8 — Withdrawal and safety exit, separately approved

- [ ] Ensure publish flag is false in running Sidecar, then check orders. Any real sale requires normal fulfillment and may change the safe withdrawal plan.
- [ ] Obtain explicit permission for **Withdraw** (it is not blocked by the publication flag).
- [ ] Withdraw through the normal Variation UI. Verify no active buyer-facing listing, correct `withdrawn` lifecycle and exact terminal journal/remote state.
- [ ] Verify no unrelated Standard/Variation listing changed and no Item/Offer/image/R2 destructive cleanup was performed.
- [ ] Keep publication disabled and record final order/fulfillment status.

## Universal stop conditions and evidence

Stop for wrong seller/environment, stale process config, unexpected Standard capture, incomplete policies/location/category, OOS uncertainty, buyer order, unknown revision/remote operation, mismatched quantity/price/image/selector, changed sibling or listing ID, incomplete hosted evidence, or unsupported provider response. Close publish window when safe, preserve journals, and require separate recovery authorization. **Never blind-retry, auto-reconcile with checkpoint writes, or purge images.**

Record only sanitized operator approvals, timestamps, live config conclusions, seller identity, policy/location references, out-of-stock state, group/listing/variation/SKU IDs, checked market pricing, desired/confirmed revisions, per-child Item/Offer/Trading state, sibling invariants, order-check conclusions, and withdrawal evidence. Never commit credentials, tokens, raw account or buyer data.

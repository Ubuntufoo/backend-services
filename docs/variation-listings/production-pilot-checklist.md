# Variation Listings — Guarded Production Pilot Checklist

## Purpose

This checklist is the YP9.3a handoff into the separately authorized YP9.3b production pilot. It does not authorize a production mutation by itself.

The pilot should prove the smallest real buyer-facing Variation Listing path while preserving the app's established recovery rules and keeping eBay Seller Hub as the source of truth after publication.

## Scope

Use one **new production-only Variation bucket** with exactly **2 low-value, modern, condition-consistent cards**. Two variations are the minimum supported initial publication size and minimize buyer-facing and recovery exposure.

Do not reuse a Sandbox pilot bucket. The production bucket must be created only after the application has been switched to the verified production environment/configuration.

Do not use the production pilot to test new architecture, cross-card concurrency, order management, or destructive cleanup.

## Phase 0 — keep mutation disabled

Before all readiness checks:

- `EBAY_ENVIRONMENT=production`
- `EBAY_PUBLISH_ENABLED=false`
- After switching `EBAY_ENVIRONMENT` or other eBay runtime configuration, restart Sidecar before readiness or bucket actions; its default eBay gateway is process-cached.
- Sidecar/frontend/watcher running from the reviewed feature branch
- Standard capture has no unfinished pending group
- Variation intake has no pending pair

With the real eBay gateway, Variation `Publish`, `Publish Changes`, and publication retry fail closed unless `EBAY_PUBLISH_ENABLED=true`. Withdrawal intentionally remains available as a safety/recovery action.

This flag is not a global eBay mutation freeze. Generic MCP inventory-item/offer/group/location create/update/delete/quantity tools remain raw remote operator surfaces and must not be used during this pilot. Do not run one-off production repair or mutation scripts either; the pilot uses only the normal Variation actions and the explicitly described withdrawal path.

## Phase 1 — read-only production readiness

Run the existing read-only checks:

```bash
pnpm validate:env
pnpm ebay:diagnose-live-readiness
pnpm ebay:list-live-publish-config
```

Do not proceed unless the evidence establishes all of the following:

- environment resolves exactly to production and `EBAY_US`;
- OAuth refresh succeeds with the production seller account;
- seller Account API access succeeds;
- production payment, fulfillment, return-policy, and merchant-location configuration resolve without placeholders or marketplace mismatch;
- production publish config resolves from the production environment-specific settings;
- the only acceptable readiness warning is that the production publish guard is disabled during this preflight phase;
- no credentials/tokens appear in diagnostic output.

Record only sanitized identifiers/conclusions needed for the pilot. Do not commit tokens, raw account payloads, or credentials.

## Phase 2 — create a fresh production bucket while publish remains disabled

Create one new Variation bucket after the production configuration is active.

Requirements:

- profile: configured Basketball or Baseball profile only;
- 2 unique card selectors;
- modern, low-value, condition-consistent cards;
- one representative front/back pair per variation;
- conservative manual prices;
- no duplicate-copy replenishment yet;
- no existing Sandbox group reused.

Before publication, inspect the created group and verify its persisted publication identity is consistent with the production readiness output:

- compare the exact `groupId`, `groupKey`, both variation IDs, and both SKUs in the direct Sidecar response and the frontend list response;
- stop if a displayed revision, operation, variation ID, or group identity differs from the current direct response; never attach historical recovery evidence to a new group by inference;
- `marketplaceId` is `EBAY_US`;
- merchant-location key is the intended production location;
- payment, fulfillment, and return-policy IDs are the intended production IDs;
- category/profile and trusted Sport aspect match the selected profile;
- group listing title is 1–80 characters, every Card selector is 1–65 characters, and description/common aspects are reviewed and saved;
- both variations are publish-ready with positive derived quantity;
- desired revision has no unresolved action history;
- no Standard or Variation intake pair is pending.

Attempting `Publish` while `EBAY_PUBLISH_ENABLED=false` should fail locally with `publish_disabled` and should not create a publication revision or remote eBay resource.

## Phase 3 — separately authorize the publish window

Only after the operator explicitly authorizes the YP9.3b production mutation:

1. Set `EBAY_PUBLISH_ENABLED=true`.
2. Restart the Sidecar so the running process observes the new environment (changing a parent shell does not update an existing process).
3. Re-run `pnpm ebay:diagnose-live-readiness`.
4. Require `overallStatus` to be `ready` before publication.
5. Publish the prepared 2-variation group once through the normal UI.

Do not use a script (including one-off production repair scripts) or historical Sandbox mutation harness for the production publish.

## Phase 4 — immediate post-publish verification

After the action returns:

- desired revision equals confirmed revision;
- no journal operation is `started`, `unknown`, `retry_authorized`, or `retry_exhausted`;
- application exposes the confirmed production listing URL/ID;
- inspect the buyer-facing eBay listing;
- both selectors are present, unique, and mapped to the correct representative image pair;
- title, description, condition, common aspects, prices, and shipping/return behavior are correct;
- both child quantities are correct;
- no unrelated Standard listing or Variation group changed.

If any remote outcome is unknown, do **not** blind-republish. Use the existing reconciliation/retry contract and stop the pilot until exact state is known.

## Phase 5 — one bounded replenishment validation

Keep the same explicitly authorized publish window open only long enough to validate the production replenishment path once.

1. Capture exactly one duplicate copy for one of the two existing variations through the normal Variation intake flow.
2. Confirm the duplicate is attached to the intended variation and no sibling variation changed locally.
3. Use **Publish Changes** once through the normal UI.
4. Verify desired revision equals confirmed revision and the journal has no unresolved operation.
5. Verify the replenished child quantity equals the current live eBay quantity plus exactly one newly eligible copy.
6. Verify the untouched sibling quantity, selector, images, price, and other listing content remain unchanged.

Do not add a new variation, change representative images, or combine replenishment with unrelated edits during this pilot step.

If any remote outcome is unknown, do not repeat Publish Changes blindly; stop and use the existing reconciliation/retry contract.

## Phase 6 — safety exit

After initial publication and the single replenishment validation succeed, set:

```bash
EBAY_PUBLISH_ENABLED=false
```

Restart the Sidecar after changing the environment and confirm a subsequent publish attempt is rejected with `publish_disabled` before any new revision or remote write. Do this before any further exploratory work; changing a parent shell alone does not change an already-running Sidecar.

If the production pilot listing should not remain live, use the application's **Withdraw** action. Withdrawal is intentionally not blocked by the publish-window flag and should leave an ever-published group in the durable `withdrawn` lifecycle while retaining its remote inventory history.

Do not use destructive cleanup for an ever-published production group. Destructive cleanup is reserved for never-published failed staging where absence can be proven exactly.

After withdrawal verify:

- eBay no longer has an active buyer-facing listing for the group;
- local lifecycle is `withdrawn`;
- withdrawal revision/checkpoint evidence is terminal and exact;
- no deletion of historical remote inventory resources was attempted.

## Stop conditions

Stop the pilot immediately when any of these occurs:

- readiness status is blocked;
- production config does not match the intended seller policies/location;
- publish is not locally blocked while `EBAY_PUBLISH_ENABLED=false`;
- unexpected Standard/Variation capture ownership conflict;
- unresolved remote outcome;
- more than the existing one bounded replay would be required;
- retry is exhausted;
- wrong selector/image/price/condition/shipping/return behavior;
- any unexpected sibling/Standard mutation;
- withdrawal cannot reconcile to exact withdrawn state.

Do not perform any replenishment beyond the single bounded duplicate-copy validation in Phase 5. Withdrawal/retention verification is the final remote lifecycle step after publishing has been disabled again.

## Evidence to retain

Keep a concise sanitized record of:

- readiness result and checked timestamp;
- profile and variation count;
- desired/confirmed revision values;
- confirmed listing ID/URL;
- buyer-view selector/image checks;
- recovery/retry count, if any;
- replenished variation and exact post-replenishment quantity check;
- untouched sibling stability check;
- withdrawal result if performed;
- any defects or operator interventions.

Raw credentials, tokens, account payloads, and sensitive diagnostic output must not be committed.

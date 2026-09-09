# Variation Listings — Progressive Scale Pilot Runbook

## Purpose

YP9.2a prepares the evidence format and operator procedure for YP9.2b. **YP9.2a performs no live eBay mutation and does not choose the operational variation cap.** YP9.2b is a separately authorized Sandbox exercise under Operator + Sol review.

The current application workflow remains authoritative. This runbook does not introduce a second publication engine, order-management subsystem, telemetry database, or generic workflow framework.

## Why the historical Sandbox harness is not the scale harness

The Phase 0 Sandbox harness is retained as historical evidence. Its fixture and verification contracts intentionally support only 2–3 children (`C01`–`C03`) and encode historical cleanup/publication assumptions. Expanding it for YP9.2 would create a parallel mutation path that no longer matches the application workflow.

YP9.2 therefore uses the actual application for live Sandbox execution and a small offline evidence helper only for fixture planning, measurement capture, promotion/hold evaluation, and comparison between pilot sizes.

## Scale-sensitive application paths

Current revision builders make the dominant scaling behavior explicit:

- **Initial publication with new Media/EPS for every representative copy:** `4N + 3` planned operations.
  - `2N` Media ingest operations (front/back per representative copy)
  - `2N` child item/offer writes
  - complete-group + group-publish + revision-reconcile
- **Duplicate-only active Publish Changes with no new variations or representative-image changes:** `2N + 2` planned operations.
  - child item/offer operation pair for every current variation
  - complete-group + revision-reconcile
- Exact remote reconciliation reads the complete group and each child item/offer. Work is therefore linear in group size.
- Buyer-view selector/image verification is also operator work proportional to `N`.
- Existing action progress events can anchor elapsed-time observation; YP9.2 does not add durable telemetry persistence.

These formulas are measurement context, not performance thresholds or a safe-cap claim.

## Offline helper

From the backend repository:

```bash
pnpm --filter sidecar ebay:scale-pilot -- template 10
pnpm --filter sidecar ebay:scale-pilot -- evaluate .local/variation-scale-pilot/10.json
pnpm --filter sidecar ebay:scale-pilot -- compare .local/variation-scale-pilot/10.json .local/variation-scale-pilot/20.json
```

`template` prints both the logical fixture and a blank evidence document. Save live evidence under an untracked path such as `.local/variation-scale-pilot/`; do not commit raw Sandbox evidence, account identifiers, credentials, or API payloads.

The evaluator has three outcomes:

- `incomplete`: required measurements/checks have not been entered.
- `hold`: a correctness, recovery, replenishment, revision, or blocking operator-UX gate failed.
- `promote`: all required gates passed. The returned doubled size is only the **next candidate pilot size**, not authorization and not an operational cap.

No timing threshold is encoded. Timings and workload ratios are evidence to compare steps, not automatic pass/fail criteria.

## Starting fixture: 10 variations

Use one logical group with ten distinct, truthful `Card` selector values and one physical copy per variation. Prefer low-value, modern, condition-consistent cards so condition variability does not confound the scale test.

Fixture slots are `V01` through `V10`. Cycle the supported manual price tiers:

| Slots | Price |
| --- | ---: |
| V01 / V05 / V09 | $0.99 |
| V02 / V06 / V10 | $1.49 |
| V03 / V07 | $1.99 |
| V04 / V08 | $2.49 |

Requirements:

- all ten selectors are unique and remain in application order;
- all variations satisfy the same shared eBay condition contract and truthful required common aspects;
- each variation has exactly one representative copy with child-owned front/back images;
- no group-level `imageUrls`;
- initial quantity is one for every child;
- use the normal application capture/review/publication workflow, not the historical Phase 0 mutation harness.

For replenishment, add exactly one duplicate copy to **V02, V05, and V09** after the initial revision is confirmed. This samples early/middle/late positions while leaving seven untouched sibling quantities for drift detection. For a later helper-generated size, use its deterministic early/middle/late sample: V02, the rounded-up middle slot, and the penultimate slot.

## YP9.2b live Sandbox procedure

Each live pilot size is separately operator-authorized. Start at 10. Advance only after the current evidence evaluates to `promote` and Sol review agrees the next step is warranted.

1. **Prepare evidence.** Generate an offline template for the intended variation count and save it under `.local/variation-scale-pilot/`.
2. **Standard coexistence pre-check.** Confirm Standard capture is idle/usable and no Variation pending pair exists before beginning the scale run.
3. **Create/capture the group.** Capture the planned variations through the application. Record elapsed time from first capture to publish-ready review state.
4. **Review before publication.** Confirm variation count, unique selectors, application order, shared condition/common aspects, representative copy, front/back image ownership, and expected price cycle.
5. **Initial publish.** Publish through the application. Record action elapsed time and the desired/confirmed revision values. Unknown/reconciliation-required outcomes are a `hold` until resolved by the existing bounded recovery contract.
6. **Buyer-view verification.** Inspect every selector. Record exact membership/order and verify every selector maps to its own representative front/back image pair. Record verification elapsed time.
7. **Duplicate replenishment.** Capture one duplicate for the planned replenishment sample (10-variation baseline: V02, V05, V09). Do not alter unrelated prices/images/selectors.
8. **Publish Changes.** Publish the staged replenishment through the application. Record elapsed time and desired/confirmed revision values.
9. **Quantity verification.** Verify each replenished child equals its exact live eBay baseline plus one newly eligible copy. Verify untouched sibling quantities remain unchanged. Do not infer current stock from historical local copy rows.
10. **Record operator burden.** Enter total elapsed minutes, manual step count, recovery interventions, blocking UX observations, and defects.
11. **Evaluate.** Run the offline evaluator. `hold` stops progression. `promote` permits Sol/operator consideration of the next candidate size; it does not authorize it automatically.
12. **Compare.** From the second scale step onward, compare timing/workload ratios with the prior run. Treat nonlinear growth or operator burden as evidence for a smaller next step or stopping, not as a preselected threshold.
13. **Finish safely.** Published Sandbox pilot groups may be withdrawn through the current application. Do not use historical destructive cleanup behavior for successfully published groups; retain remote Inventory history after withdrawal.

## Promotion gates

A scale step cannot promote when any of the following is true:

- selector count, membership, uniqueness, or application order is wrong;
- any selector displays the wrong representative front/back image pair;
- desired and confirmed revision watermarks do not match after initial or staged publication;
- an unknown/unresolved mutation outcome remains;
- more than the existing one bounded replay was needed;
- operator intervention was required to repair recovery state;
- replenished quantities do not equal live eBay baseline plus the new copy count;
- any untouched sibling quantity changes unexpectedly;
- a blocking operator UX issue or blocking defect exists.

Timing alone does not fail a step in YP9.2a. YP9.2b records timing and operator burden to determine whether continued scaling is practical.

## Progressive sizes

The first required live size is **10**. A fully passing 10-variation run yields **20** only as the next candidate. Subsequent candidates may double in the helper, but the operator and Sol may choose a smaller increment or stop based on observed runtime, buyer-view verification burden, recovery behavior, current eBay/account constraints, and practical listing-management workload.

Do not infer the final operational cap from eBay's general maximum. The cap is selected only in YP9.2b from observed application evidence.

## Required evidence retained as sanitized conclusions

For each scale step record:

- variation count and replenishment sample;
- capture-to-ready, initial publish/verify, staged publish/verify timings;
- selector membership/order/uniqueness and front/back mapping checks;
- initial and staged desired/confirmed revision values;
- unresolved outcome, bounded retry, and operator-recovery counts;
- replenished quantity correctness and untouched-sibling stability;
- total operator elapsed time/manual steps/blocking UX issues;
- concise blocking/nonblocking defect summaries.

Raw live evidence stays untracked. Only sanitized conclusions needed by the roadmap/architecture should be committed after review.

# YP9.6c4 — Exact-pilot image cleanup execution gates

**Status:** execution plan only. No operator permission to delete images, deploy migrations, or modify the live listing. This plan is narrower than a general image lifecycle service.

## Target and protected scope

- Production eBay listing: `800881949284`
- Group: `38f45c57-608e-40ad-bac3-95eeb8d74cb6`
- Permanently removed variation: `66d05ef9-c273-40c1-b9f1-bf062ccd22fe`
- SKU: `BSKBL-ProductionOOSPilot01-000002`
- Last verified residue: **2 R2 images and 2 local archived images**. Counts are historical, not a current authorization; refresh exact keys, paths, ownership and hashes at execution time.
- Survivors: `BSKBL-ProductionOOSPilot01-000001` and `BSKBL-ProductionOOSPilot01-000003`. Do not change their images, counts, listing availability, offers, or inventory.
- Never delete the entire Variation R2 prefix or the group's local `processed/` directory. Historical v3 records remain durable.

## What must be true before live deletion

| Gate | Required proof | Current status |
| --- | --- | --- |
| Exact target | Revision 8 confirmation, digest-bound v3 removal intent, terminal membership checkpoint, confirmed c2b absence, read-only eBay Item/Offer state and exact target copy/resource IDs | Existing historical evidence; refresh and bind |
| Exclusive ownership | Complete no-conflict reference inventory across live Variation, Standard and effective media consumers, separating identical historical provenance from a second owner | Partial; existing witness intentionally cannot authorize |
| DB no-new-owner barrier | Transaction-safe frozen-key registry and real Standard/Variation guards; trust only verified c2/c2b identity, not caller-supplied journal resources | EXEC4a CLI-generated `supabase/migrations/20261111223116_create_removed_sku_exact_key_writer_barrier.sql` passes on disposable PG17 effective schema; remains unapplied and non-authorizing |
| R2 exclusive writer | Enumerate and stop or otherwise exclude every process/credential that can overwrite the exact pilot keys; ensure no external writer can race a read/delete | Not established |
| Safe local quarantine | Exclusive local parent/source ownership, physical-file identity and no-clobber move with positive post-move validation; on ambiguity abort | Validation-only proof; mutation blocked |
| R2 identity before delete | Bounded exact HEAD/GET content verification and provider delete caveat acknowledged; R2 does not document conditional identity-matched DeleteObject | Offline verifier only; unconditional delete requires separate residual-risk approval |
| Durable recovery | Per-resource attempt barrier and CAS outcome; reconcile `unknown` rather than retry uncertain DELETE | Offline, unapplied journal only |
| Operator confirmation | Fresh explicit approval naming the final exact resources and permitted operation | Not granted |

**Do not use the generic EXEC1 `createPlan` or arbitrary operator-supplied keys as freeze provenance.** Existing c2b completion is a durable record of backend-supplied remote evidence; it is not an independent eBay read or proof of operator identity.

## Smallest next increment

1. Generate an **unapplied additive** migration only through `SUPABASE_TELEMETRY_DISABLED=1 supabase migration new create_removed_sku_exact_key_writer_barrier` (CLI **3.1.0**). EXEC4a produced `supabase/migrations/20261111223116_create_removed_sku_exact_key_writer_barrier.sql`; its protected registry starts empty, `deletion_authorized` is constrained false, and no caller-controlled frozen-key INSERT or freeze-approval RPC exists. The validator loads this actual migration; it no longer embeds candidate barrier SQL. The registry is intentionally app-unpopulatable. Any separately reviewed future privileged seed must first call `lock_keys` for the complete sorted exact-key set and insert markers in that same transaction, while quiescing or excluding all external writers; a direct privileged INSERT without that protocol is a race blocker.
2. EXEC4a's actual migration passes against the effective chain in isolated PostgreSQL 17 (including c2b retirement, read-only ownership witness, and EXEC1 journal objects): both Variation intake RPCs (including frozen duplicate-copy rejection and shared-key RPC serialization), real Standard paired public URL+key writes, encoded unrelated Standard media, direct service-role Standard DML, reversed-order advisory-lock serialization, rollback, fresh missing-row phantom writes, protected marker/trusted-origin/function ACLs including PUBLIC catalog proof, and trigger ordering. Unrelated Standard media remains writable. No hosted DB, migration apply, R2, eBay, local-image, freeze, or deletion operation was run.
3. Separately design an authenticated, c2b-derived freeze capability and an explicit external-writer shutdown/readback sequence. Do not promote a synthetic proof row to production authority.
4. Only once DB freeze, external R2 writer control, file-quarantine safety, and per-resource journal are verified, request a **new**, exact-resource confirmation for a controlled four-image deletion attempt.

## Reuse boundary

The resource-level cleanup journal, ownership checker, writer barrier, local quarantine and object deletion logic should be reusable for sold Standard and future comic listings. The eligibility gate remains workflow-specific: c2b retirement for a Variation, sale/return/dispute retention for a Standard listing, and a separately established policy for comics. No universal listing-delete abstraction before the pilot passes.

**Current result:** remote Variation removal succeeded; image deletion has not been executed and remains blocked.

## EXEC4a evidence (2026-11-11)

- `SUPABASE_TELEMETRY_DISABLED=1 supabase --version` reports **3.1.0**; exactly one CLI-generated file exists at `supabase/migrations/20261111223116_create_removed_sku_exact_key_writer_barrier.sql`. It is unapplied; no link, push, hosted SQL, or deployment occurred.
- `node --check packages/data/tests/validate-variation-removed-sku-freeze-migration.mjs` and the validator itself pass with a disposable PostgreSQL 17 container only; validator reads the actual migration path.
- The barrier uses fixture-seeded trusted URL bases, canonical exact-key normalization, sorted per-key transaction advisory locks, and `zz_removed_sku_*` triggers after existing writer triggers. Safe paired Standard media and both Variation intake RPCs (including frozen duplicate-copy rejection and shared-key RPC serialization) succeed/fail closed as expected; frozen exact keys and foreign/encoded Variation aliases fail closed; direct Variation DML, frozen-registry/trusted-origin/function ACLs are denied for all application roles, with PUBLIC catalog privileges absent; marker rollback/no-row recovery, opposite-order multi-key serialization, and both writer/freezer transaction orders are covered.
- Residual blockers: trusted URL origin provenance for a deployed migration, arbitrary external R2 writers, deletion-time R2 identity/conditional delete, local-file TOCTOU, c2b operator authentication, hosted migration approval, any destructive executor, and a future privileged seed protocol (complete sorted-key lock set in the same transaction plus external-writer quiescence). Direct privileged marker INSERT without that protocol remains an explicit race blocker. The registry remains unpopulatable by application roles and `deletion_authorized` is constrained false.

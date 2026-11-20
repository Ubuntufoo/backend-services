# YP-FINAL.DB-SCHEMA-AUDIT — independent read-only schema disposition

**Status:** Complete — ChatGPT first pass and independent Codex gap review completed 2026-11-19 ET (2026-11-20 UTC). **No hosted DDL/DML, migration repair/replay, trigger or grant change, eBay/R2 action, or application-data mutation was authorized or executed. Database cleanup remains unexecuted.**

## Scope and verification boundary

- Shared Supabase project: `ebay-inventory-manager` (`fmiliwxthjonjwywuqta`), PostgreSQL 17.6.1. Hosted reads were limited to catalog/information-schema metadata, migration metadata and statement digests, exact `count(*)` aggregates, and grouped lifecycle states. No raw production rows or payloads were collected.
- Backend `backend-services-you-pick` / `feature/you-pick`; companion frontend `ebay-ui-app-you-pick` / `feature/you-pick`. Repository checks covered migrations, generated types, RPC/runtime callers, the retained read-only C2B inspection script, and the deferred removed-SKU cleanup/barrier sources.
- Exact hosted inventory: **19 public tables, 316 columns, 69 public functions, 47 user triggers, 148 `pg_constraint` rows, and zero public views**. The corrected constraint total is 90 CHECK + 20 FK + 19 PK + 18 UNIQUE + one deferrable constraint-trigger row. The first-pass value 147 omitted that last row.
- Hosted migration history: **59 records**; local migration directory: **60 SQL files**. Version/name aliases and statement SHA-256 digests were compared explicitly; timestamp equality was not assumed.
- `list_tables` planner estimates were not used for disposition. Counts below are exact at the audit snapshot.

## Exact public-table inventory

| Table | Rows | Decision | Evidence |
| --- | ---: | --- | --- |
| `listings` | 207 | **KEEP** | Live Standard listing contract and data. |
| `orders` | 0 | **KEEP** | Current order/accounting contract; emptiness is not obsolescence. |
| `jobs` | 861 | **KEEP** | Operational queue/history. |
| `daily_usage` | 80 | **KEEP** | Usage accounting. |
| `app_settings` | 1 | **KEEP** | Active configuration. |
| `ai_model_attempts` | 212 | **KEEP** | Current attempt audit. |
| `ai_model_catalog` | 8 | **KEEP** | Current model catalog. |
| `ai_model_task_routes` | 8 | **KEEP** | Current routing repository. |
| `ai_model_usage_windows` | 0 | **KEEP** | Reservation RPC/source contract remains active. |
| `listing_price_research` | 1 | **KEEP** | Current pricing repository. |
| `variation_listing_groups` | 27 | **KEEP** | Core aggregate. |
| `variation_listing_variations` | 63 | **KEEP** | Core child/SKU identity. |
| `variation_listing_copies` | 65 | **KEEP** | Physical-copy and media provenance. |
| `variation_listing_intake_sessions` | 1 | **KEEP** | Durable capture routing. |
| `variation_listing_revisions` | 85 | **KEEP** | Frozen V1/V3 revision and recovery evidence. |
| `variation_listing_publishing_checkpoints` | 928 | **KEEP** | Immutable remote-outcome journal. |
| `variation_listing_removed_sku_remote_retirements` | 4 | **KEEP** | All four are `confirmed_complete`; generalized terminal-zero recovery contract. |
| `variation_listing_c2b_removal01_incident_repairs` | 1 | **REVIEW LATER** | Incident-only, but the row remains `unknown` and protects historical recovery evidence. |
| `variation_listing_c2b_removal01_incident_deletes` | 1 | **REVIEW LATER** | Incident-only, but the row remains `unknown` and is the installed mutation-guard authority. |

No public table is approved or proposed for immediate drop. The original six-table Variation aggregate plus removed-SKU retirement remain active safety contracts.

## C2BRemoval01 dependency and state review

The only incident/test-specific relations proven by hosted catalog and repository evidence are the two C2B tables: 43 columns, four supporting PK/UNIQUE indexes, 18 table constraints, 18 incident-named functions, and 12 incident-named triggers. Both tables have FKs to live `variation_listing_groups` and `variation_listing_revisions` rows.

- Twelve enabled triggers cover the two incident tables plus groups, intake sessions, revisions, checkpoints, variations, copies, and removed-SKU retirements. Eight call `c2b_removal01_incident_delete_mutation_guard()`; four provide incident identity/update-time enforcement.
- The guard is `SECURITY DEFINER`, not directly executable by `anon`, `authenticated`, or `service_role`. It recognizes only the frozen incident group/revision and related rows. Unless the incident-delete row is `confirmed_complete`, matching INSERT/UPDATE/DELETE attempts fail with `VR003`. Separate identity triggers reject deletion or identity mutation of either incident row.
- Eleven incident lifecycle/load RPCs are executable only by `service_role`; seven helper/trigger functions have no direct service-role execute grant. Static repo search found no current application caller for these incident RPCs. The retained C2B read-only inspection script uses generic core repositories and read-only eBay GETs, not incident RPCs. Static absence is not proof that hosted safeguards are removable.
- Generated types include the 27-column repair table but omit the hosted 16-column delete table and delete RPCs. This is a generated-type/schema parity gap, not permission to regenerate types or remove hosted objects in this task.

| Hosted incident-delete state | Guard effect on matching historical rows | Disposition |
| --- | --- | --- |
| `ready`, `started`, or `unknown` | Matching writes blocked; current hosted row is `unknown`. | **KEEP guard and incident evidence.** |
| `confirmed_complete` | Incident guard no longer blocks matching writes; all other general safeguards still apply. | Not observed; no transition authorized. |
| Guard/table removed while unresolved | Exact incident rows lose the installed freeze and recovery provenance; dependent functions/triggers/FKs also require ordered cleanup. | **Unsafe; no drop proposal.** |

Future cleanup may be designed only after separately authorized terminal remote/hosted proof, order/ownership review, full dependency/ACL/type/caller inventory, rollback design, and an additive migration. Never use ad hoc `DROP ... CASCADE`, row deletion, trigger disable, or applied-history rewrite.

## Migration and source parity

| Installed record | Local source | Result |
| --- | --- | --- |
| `20261024224204 durable_removed_sku_remote_retirement` | `20261023190000_durable_removed_sku_remote_retirement.sql` | **Exact statement hash match** (`07c5e0217113cdff465b02269279c0ca35fa2b8d559a2a64173bfe5c422d6115`). Version remap only. |
| `20261027145825 v20261026140000_c2b_removal01_incident_repair` | `20261026140000_c2b_removal01_incident_repair.sql` | **Exact match** (`0f4583e3292da919bd62e43c2c49a9528fb45a40e4cc7286da1388bf5ae8d9df`). |
| `20261028014018 v20261027201000_c2b_removal01_load_rpc_alias_fix` | `20261027201000_c2b_removal01_load_rpc_alias_fix.sql` | **Exact match** (`7adf18fdc56346d119ac2f5a7bb8b0502f2ba0aeab70acd1da587c221035e8b8`). |
| `20261028141612 v20261028120000_c2b_removal01_incident_delete` | None in the current tree or reachable Git history | **Applied-source gap.** Hosted statement digest `9d9ddf62975d7f8711333d1c6156d0d0e0c7ddc94dffc09add35ac3729bc65a0`; installed table, RPCs and guards prove application. Do not reconstruct or replay it in place. |
| `20261110161052 read_only_variation_removed_sku_ownership_witness` | `20261023140500_read_only_variation_removed_sku_ownership_witness.sql` | **Content drift.** Hosted digest `c7605398459667eda81a42d6a9433760ad309853f3344e6b96608a479b787d75`; local digest `e12902ae63a16e1f854374ac292957ea7f181b5278219b7b13c61f551e7f8689`. The only observed semantic delta is hosted `btrim` boundary checks versus tracked POSIX-whitespace checks for two Standard media arrays. Preserve hosted state; resolve only through the separately reviewed additive hardening task. |
| No hosted record | `20261110180000_create_removed_sku_cleanup_journal.sql` | **Unapplied proposal; KEEP source.** Its two public tables/RPCs are absent. |
| No hosted record | `20261111223116_create_removed_sku_exact_key_writer_barrier.sql` | **Unapplied proposal; KEEP source.** The non-public schema/tables/functions/triggers are absent. |

The 59-hosted/60-local count reconciles as 58 logical source mappings, one hosted incident-delete record without local source, and two local unapplied proposals. Digest comparison additionally exposes the ownership-witness content drift. The C2B retrospective's claim that all later incident-delete migrations were unapplied is false and is corrected separately.

## Field, routine, trigger, and security disposition

- No non-incident public table or column name contains `c2b`, `incident`, `test`, or `sandbox`. Catalog and caller checks did not prove any active-core field test-only. `pending_pair`, `operation_plan`, `evidence`, `observed_remote_state`, `pending_removal_at`, `quantity_adjustment_counter`, copy provenance, and journal fields remain **KEEP** recovery/runtime contracts.
- Historical V2 `variation_listing_operations` and `variation_listing_operation_attempts` are absent; nothing hosted exists to drop. Their migration history remains untouched.
- All 19 tables have RLS enabled. Only `listings` has policies (two); the other 18 have none. `anon`/`authenticated` have SELECT only on `listings`; neither role can execute Variation/C2B RPCs. The application `service_role` has direct SELECT on 16 tables, while the two incident tables and removed-SKU retirement are reached through scoped definer RPCs.
- Of 69 public functions, 54 are `SECURITY DEFINER`. Supabase's advisor reports one non-incident security review item: `rls_auto_enable()` is executable by `anon`/`authenticated` and backs the enabled `ensure_rls` DDL event trigger, but has no local source or hosted migration record. It is **REVIEW LATER for provenance/ACL hardening, not a drop candidate**. The advisor also reports 14 mutable-search-path routines. No ACL/search-path change is authorized by this cleanup audit.
- The 51 non-incident functions and 35 non-incident user triggers support Standard, AI/usage, core Variation, retirement, timestamp, RLS, or integrity behavior. No additional test-only routine/trigger was proven, so their **object-retention decision is KEEP**. The advisor findings above remain separate non-destructive security-review work.

## Final decision

- **KEEP:** 17 non-incident tables; all active Standard/core Variation/retirement fields and dependencies; 51 non-incident functions; 35 non-incident user triggers; historical migrations; both unapplied removed-SKU proposal sources.
- **REVIEW LATER:** two C2B incident tables, 18 incident functions, 12 incident triggers and their constraints/indexes/FKs; ownership-witness content drift; missing incident-delete source provenance; stale generated types; `rls_auto_enable` ACL/source provenance and 14 advisor search-path findings.
- **PROPOSE DROP AFTER SEPARATE APPROVAL:** **none now.** The incident package is the only credible future cleanup package, but unresolved `unknown` rows, installed guards, live FKs, and missing source provenance make even a proposed destructive migration premature.

YP-FINAL.DB-SCHEMA-AUDIT is complete as a read-only evidence/disposition audit. This completion does **not** mark hosted cleanup, incident recovery, test-listing disposal, source reconstruction, or security hardening complete.

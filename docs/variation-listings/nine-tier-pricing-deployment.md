# Nine-tier Variation pricing — deployment record

**Date:** 2026-09-23. **Authority:** operator explicitly confirms approval of hosted Supabase migration application. **Source:** `supabase/migrations/20260922195000_expand_variation_listing_manual_price_499.sql` (historical identifier `20260922195000`).

## What was applied

The operator-approved migration extends exactly three price checks (variation `price_amount`, intake `sticky_price_amount`, pending-pair JSON `price_amount`) and the current six-argument condition-aware intake RPC and four-argument manual price-edit RPC. Supported USD amounts are `0.99`, `1.49`, `1.99`, `2.49`, `2.99`, `3.49`, `3.99`, `4.49`, and `4.99`. It performs no data backfill. It preserves the other pending-pair invariants and the existing security-definer, pinned search-path, and service-role-only execution contracts.

Codex reported a fresh migration-history preflight and dry run, **one** hosted Supabase CLI application, a postflight history entry for `20260922195000` exactly once with no pending migrations, and a schema-only readback of the three constraints, two RPCs, RLS, search paths and grants. The user subsequently confirmed that they had personally authorized the application. This record preserves that report; it is not an additional independent hosted read. **Do not reapply the migration.** The SQL file's earlier source-only/unapplied header describes its original pre-application state; leave this applied migration byte-for-byte unchanged rather than rewriting history.

## Verification and outstanding steps

Codex reported FE `62/62`, data `63/63`, Sidecar `85/85` scoped Vitest tests, FE/data/Sidecar typechecks, disposable local PostgreSQL validation, Node syntax checks and both worktree diff checks passing. Neither application deployment nor runtime restart was performed by that Codex run. The nine-tier FE and backend remain uncommitted until reviewed atomic commits; deploy/restart matched FE/backend versions before using the new tiers for real intake. Keep `EBAY_PUBLISH_ENABLED=false` except in a separately authorized production publish window. The prior ProductionPilot02 remains withdrawn; no further eBay or R2 mutation occurred in this pricing task.

Any compensating migration must first establish whether any stored variation, sticky intake session or frozen pending pair now uses one of the newly accepted amounts. Do not blindly restore four-tier constraints or change migration history. A runtime smoke check and operator-controlled publication remain separate decisions.

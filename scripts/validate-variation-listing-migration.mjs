#!/usr/bin/env node

/**
 * Disposable YP2.2b migration validation.  This intentionally uses only Node
 * built-ins and the Docker/psql CLIs; it never connects to a hosted database.
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const root = new URL('..', import.meta.url);
const migrationPath = new URL('supabase/migrations/20260828150000_create_variation_listing_persistence.sql', root);
const rollbackPath = new URL('supabase/rollbacks/20260828150000_create_variation_listing_persistence.rollback.sql', root);

const password = 'codex-yp22b-postgres';
const name = `codex-yp22b-${process.pid}-${randomBytes(4).toString('hex')}`;

function command(file, args, input = undefined, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(`${file} ${args.join(' ')} exited ${code ?? signal}\n${stderr}${stdout}`), { code, stdout, stderr }));
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function docker(args, input = undefined) {
  return command('docker', args, input);
}

async function psql(database, sql) {
  return docker(['exec', '-i', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database], sql);
}

async function psqlExpectFailure(database, sql) {
  try {
    await psql(database, sql);
  } catch (error) {
    return error;
  }
  throw new Error('expected psql failure, but command succeeded');
}

const g1 = '11111111-1111-4111-8111-111111111111';
const v1 = '22222222-2222-4222-8222-222222222222';
const c1 = '33333333-3333-4333-8333-333333333333';
const g2 = '44444444-4444-4444-8444-444444444444';
const v2 = '55555555-5555-4555-8555-555555555555';
const c2 = '66666666-6666-4666-8666-666666666666';
const pair1 = '77777777-7777-4777-8777-777777777777';
const pair2 = '88888888-8888-4888-8888-888888888888';
const pair3 = '88888888-8888-4888-8888-888888888889';
const pair4 = '88888888-8888-4888-8888-88888888888a';

const constraintNames = [
  'variation_listing_groups_pkey', 'variation_listing_groups_group_key_key', 'variation_listing_groups_sku_namespace_key',
  'variation_listing_groups_sku_category_code_check', 'variation_listing_groups_sku_bucket_token_check',
  'variation_listing_groups_group_key_projection_check', 'variation_listing_groups_next_inventory_serial_check',
  'variation_listing_groups_lifecycle_state_check', 'variation_listing_groups_selector_name_check',
  'variation_listing_groups_title_check', 'variation_listing_groups_description_check',
  'variation_listing_groups_condition_description_check', 'variation_listing_groups_text_check',
  'variation_listing_groups_listing_format_check', 'variation_listing_groups_derived_common_ebay_aspects_check',
  'variation_listing_groups_condition_descriptors_check', 'variation_listing_groups_condition_token_check',
  'variation_listing_groups_revision_watermark_check', 'variation_listing_variations_pkey',
  'variation_listing_variations_group_variation_key', 'variation_listing_variations_sku_key',
  'variation_listing_variations_group_position_key', 'variation_listing_variations_group_selector_value_key',
  'variation_listing_variations_group_id_fkey', 'variation_listing_variations_inventory_serial_check',
  'variation_listing_variations_position_check', 'variation_listing_variations_selector_value_check',
  'variation_listing_variations_price_amount_check', 'variation_listing_variations_price_currency_check',
  'variation_listing_variations_metadata_check', 'variation_listing_variations_sku_grammar_check',
  'variation_listing_copies_pkey', 'variation_listing_copies_variation_copy_key',
  'variation_listing_copies_capture_pair_id_key', 'variation_listing_copies_variation_id_fkey',
  'variation_listing_copies_availability_state_check', 'variation_listing_copies_condition_token_check',
  'variation_listing_copies_condition_notes_check', 'variation_listing_copies_r2_key_check',
  'variation_listing_copies_capture_source_check', 'variation_listing_copies_capture_session_version_check',
  'variation_listing_copies_capture_time_check', 'variation_listing_intake_sessions_pkey',
  'variation_listing_intake_sessions_capture_source_key_check', 'variation_listing_intake_sessions_session_version_check',
  'variation_listing_intake_sessions_mode_check', 'variation_listing_intake_sessions_target_mode_check',
  'variation_listing_intake_sessions_target_group_id_fkey', 'variation_listing_intake_sessions_target_variation_group_fkey',
  'variation_listing_intake_sessions_sticky_price_check', 'variation_listing_intake_sessions_sticky_price_currency_check',
  'variation_listing_intake_sessions_pending_all_or_none_check', 'variation_listing_intake_sessions_pending_pair_price_check',
  'variation_listing_intake_sessions_pending_pair_currency_check', 'variation_listing_intake_sessions_pending_pair_mode_check',
  'variation_listing_intake_sessions_pending_pair_group_fkey', 'variation_listing_intake_sessions_pending_variation_group_fkey',
  'variation_listing_intake_sessions_pending_pair_version_check', 'variation_listing_intake_sessions_pending_snapshot_check',
  'variation_listing_intake_sessions_pending_pair_source_check', 'variation_listing_variations_representative_copy_fkey',
];
const constraintValues = constraintNames.map((name) => `('${name}')`).join(', ');
const triggerNames = [
  'variation_listing_groups_prevent_identity_update', 'variation_listing_groups_validate_guarded_update',
  'set_variation_listing_groups_updated_at', 'variation_listing_groups_prevent_allocated_delete',
  'variation_listing_groups_verify_allocator_consumption', 'variation_listing_variations_prevent_identity_update',
  'variation_listing_variations_validate_aggregate_write', 'variation_listing_variations_sku_projection_check',
  'set_variation_listing_variations_updated_at', 'variation_listing_variations_require_revision_advance',
  'variation_listing_copies_prevent_identity_update', 'variation_listing_copies_validate_aggregate_write',
  'set_variation_listing_copies_updated_at', 'variation_listing_copies_require_revision_advance',
  'variation_listing_intake_sessions_prevent_identity_update', 'variation_listing_intake_sessions_validate_transition',
  'set_variation_listing_intake_sessions_updated_at', 'variation_listing_variations_require_representative',
];
const triggerValues = triggerNames.map((name) => `('${name}')`).join(', ');
const functionNames = [
  'prevent_variation_listing_group_identity_update', 'prevent_allocated_variation_listing_group_delete',
  'validate_variation_listing_group_guarded_update', 'verify_variation_listing_allocator_consumption',
  'prevent_variation_listing_variation_identity_update', 'validate_variation_listing_sku_projection',
  'validate_variation_listing_variation_aggregate_write', 'require_variation_listing_variation_revision_advance',
  'prevent_variation_listing_copy_identity_update', 'validate_variation_listing_copy_aggregate_write',
  'require_variation_listing_copy_revision_advance', 'require_variation_listing_representative_copy',
  'prevent_variation_listing_intake_session_identity_update', 'validate_variation_listing_intake_session_transition',
];
const functionValues = functionNames.map((name) => `('${name}')`).join(', ');

function aggregateTransaction(group, expected, body) {
  return `begin;
set local app.variation_listing_write_scope = 'aggregate';
set local app.variation_listing_group_id = '${group}';
set local app.variation_listing_expected_revision = '${expected}';
${body}
set constraints all immediate;
commit;`;
}

function aggregateFailureTransaction(group, expected, label, statement) {
  return `begin;
set local app.variation_listing_write_scope = 'aggregate';
set local app.variation_listing_group_id = '${group}';
set local app.variation_listing_expected_revision = '${expected}';
update public.variation_listing_groups set desired_revision = ${Number(expected) + 1} where group_id = '${group}';
select assert_failure('${label}', $$${statement}$$);
rollback;`;
}

const bootstrap = `
create role anon;
create role authenticated;
create role service_role;
alter role service_role bypassrls;
create function public.set_row_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;
create view public.sentinel_shared_view as select 'yp2.2b-sentinel'::text as marker;
`;

const assertions = `
create function public.assert_true(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'assertion failed: %', label; end if;
end; $$;

create function public.assert_failure(label text, statement text)
returns void language plpgsql as $$
declare failed boolean := false;
begin
  begin
    execute statement;
    set constraints all immediate;
  exception when others then
    failed := true;
  end;
  if not failed then raise exception 'expected rejection not observed: %', label; end if;
end; $$;

set search_path = pg_temp, public;

select assert_true(to_regclass('public.variation_listing_groups') is not null, 'groups table exists');
select assert_true(to_regclass('public.variation_listing_variations') is not null, 'variations table exists');
select assert_true(to_regclass('public.variation_listing_copies') is not null, 'copies table exists');
select assert_true(to_regclass('public.variation_listing_intake_sessions') is not null, 'intake table exists');
select assert_true((select count(*) from pg_views where schemaname = 'public' and viewname = 'sentinel_shared_view') = 1, 'sentinel view survives migration');
select assert_true((select definition from pg_views where schemaname = 'public' and viewname = 'sentinel_shared_view') like '%yp2.2b-sentinel%', 'sentinel definition is unchanged');
select assert_true((select count(*) from pg_views where schemaname = 'public') = 1, 'migration adds no application view');
select assert_true((select count(*) from pg_matviews where schemaname = 'public') = 0, 'migration adds no materialized view');
select assert_true(to_regprocedure('public.set_row_updated_at()') is not null, 'shared updated-at helper survives migration');

-- Complete object inventory: exact approved names, FKs, triggers, four RLS tables, and no policies.
with expected(name) as (values ${constraintValues})
select assert_true((select count(*) from pg_constraint c join expected e on e.name = c.conname) = ${constraintNames.length}, 'all named constraints installed');
select assert_true((select count(*) from pg_indexes where schemaname = 'public' and indexname in ('variation_listing_groups_lifecycle_state_idx', 'variation_listing_groups_pending_revision_idx', 'variation_listing_variations_group_id_idx', 'variation_listing_copies_variation_id_idx', 'variation_listing_copies_availability_idx')) = 5, 'all named indexes installed');
with expected(name) as (values ${triggerValues})
select assert_true((select count(*) from pg_trigger t join expected e on e.name = t.tgname where not t.tgisinternal) = ${triggerNames.length}, 'all named triggers installed');
with expected(name) as (values ${functionValues})
select assert_true((select count(*) from pg_proc p join expected e on e.name = p.proname where p.pronamespace = 'public'::regnamespace) = ${functionNames.length}, 'all dedicated functions installed');
select assert_true((select bool_and(prosecdef) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('validate_variation_listing_group_guarded_update', 'require_variation_listing_variation_revision_advance', 'require_variation_listing_copy_revision_advance')), 'revision proof functions are security definer');
select assert_true((select bool_and(proconfig @> array['search_path=pg_catalog, public, pg_temp']) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('validate_variation_listing_group_guarded_update', 'require_variation_listing_variation_revision_advance', 'require_variation_listing_copy_revision_advance')), 'revision proof functions pin search path');
with callers(role_name) as (values ('anon'), ('authenticated'), ('service_role')),
     funcs(name) as (values ${functionValues})
select assert_true((select bool_and(not has_function_privilege(callers.role_name, format('public.%s()', funcs.name), 'execute')) from callers cross join funcs), 'dedicated functions revoke caller execute');
select assert_true((select count(*) from pg_class where relname like 'variation_listing_%' and relrowsecurity) = 4, 'RLS enabled on all four tables');
select assert_true((select count(*) from pg_policies where schemaname = 'public' and tablename like 'variation_listing_%') = 0, 'no browser policies installed');
select assert_true((select bool_and(not has_table_privilege('anon', format('public.%s', table_name), 'select')) from (values ('variation_listing_groups'), ('variation_listing_variations'), ('variation_listing_copies'), ('variation_listing_intake_sessions')) as tables(table_name)), 'anon has no table privileges');
select assert_true((select bool_and(not has_table_privilege('authenticated', format('public.%s', table_name), 'select')) from (values ('variation_listing_groups'), ('variation_listing_variations'), ('variation_listing_copies'), ('variation_listing_intake_sessions')) as tables(table_name)), 'authenticated has no table privileges');
select assert_true((select bool_and(has_table_privilege('service_role', format('public.%s', table_name), 'select,insert,update,delete')) from (values ('variation_listing_groups'), ('variation_listing_variations'), ('variation_listing_copies'), ('variation_listing_intake_sessions')) as tables(table_name)), 'service role has intended privileges on all tables');

-- Representative-copy creation: null while transaction is open, then same-variation assignment before commit.
${aggregateTransaction(g1, 0, `
insert into public.variation_listing_groups (
  group_id, group_key, sku_category_code, sku_bucket_token, category_id, marketplace_id,
  merchant_location_key, fulfillment_policy_id, payment_policy_id, return_policy_id,
  condition_id, condition_token
) values ('${g1}', 'VL-G-11111111111141118111111111111111', 'BSKBL', 'BinderA', '183454', 'EBAY_US', 'loc', 'fulfill', 'pay', 'return', '1000', 'NEAR_MINT_OR_BETTER');
update public.variation_listing_groups set desired_revision = 1, next_inventory_serial = 2 where group_id = '${g1}';
insert into public.variation_listing_variations (variation_id, group_id, inventory_serial, sku, position, selector_value, price_amount)
values ('${v1}', '${g1}', 1, 'BSKBL-BinderA-000001', 0, 'Card A', 0.99);
insert into public.variation_listing_copies (
  copy_id, variation_id, condition_token, front_r2_key, back_r2_key, capture_source_key,
  capture_session_version, capture_pair_id, capture_front_source_ref, capture_back_source_ref,
  capture_started_at
) values ('${c1}', '${v1}', 'NEAR_MINT_OR_BETTER', 'variation-listing/${v1}/front-a', 'variation-listing/${v1}/back-a', 'src-a', 1, '${pair1}', 'front-a', 'back-a', now() - interval '1 minute');
update public.variation_listing_variations set representative_copy_id = '${c1}' where variation_id = '${v1}';`)}
select assert_true((select representative_copy_id = '${c1}' from public.variation_listing_variations where variation_id = '${v1}'), 'representative assigned');

-- Second group/variation enables cross-group membership checks and allocator tests.
${aggregateTransaction(g2, 0, `
insert into public.variation_listing_groups (
  group_id, group_key, sku_category_code, sku_bucket_token, category_id, marketplace_id,
  merchant_location_key, fulfillment_policy_id, payment_policy_id, return_policy_id,
  condition_id, condition_token
) values ('${g2}', 'VL-G-44444444444444448444444444444444', 'BSBL', 'BinderB', '183454', 'EBAY_US', 'loc', 'fulfill', 'pay', 'return', '1000', 'EXCELLENT');
update public.variation_listing_groups set desired_revision = 1, next_inventory_serial = 2 where group_id = '${g2}';
insert into public.variation_listing_variations (variation_id, group_id, inventory_serial, sku, position, selector_value, price_amount)
values ('${v2}', '${g2}', 1, 'BSBL-BinderB-000001', 0, 'Card B', 1.49);
insert into public.variation_listing_copies (
  copy_id, variation_id, condition_token, front_r2_key, back_r2_key, capture_source_key,
  capture_session_version, capture_pair_id, capture_front_source_ref, capture_back_source_ref,
  capture_started_at
) values ('${c2}', '${v2}', 'EXCELLENT', 'variation-listing/${v2}/front-b', 'variation-listing/${v2}/back-b', 'src-b', 1, '${pair2}', 'front-b', 'back-b', now() - interval '1 minute');
update public.variation_listing_variations set representative_copy_id = '${c2}' where variation_id = '${v2}';`)}
begin;
set local role service_role;
set local app.variation_listing_write_scope = 'aggregate';
set local app.variation_listing_group_id = '${g2}';
set local app.variation_listing_expected_revision = '1';
update public.variation_listing_groups set desired_revision = 2 where group_id = '${g2}';
update public.variation_listing_variations set variation_metadata = '{"service_role":true}' where variation_id = '${v2}';
set constraints all immediate;
commit;

-- Aggregate CAS and child revision guards.
${aggregateTransaction(g1, 1, `update public.variation_listing_groups set desired_revision = 2 where group_id = '${g1}';
update public.variation_listing_variations set variation_metadata = '{"changed":true}' where variation_id = '${v1}';`)}
${aggregateTransaction(g1, 2, `update public.variation_listing_groups set desired_revision = 3 where group_id = '${g1}';
update public.variation_listing_copies set availability_state = 'unavailable' where copy_id = '${c1}';`)}
begin;
set local app.variation_listing_write_scope = 'aggregate';
set local app.variation_listing_group_id = '${g1}';
set local app.variation_listing_expected_revision = '2';
select assert_failure('stale variation-only write', $$update public.variation_listing_variations set variation_metadata = '{"stale":true}' where variation_id = '${v1}'$$);
select assert_failure('stale copy-only write', $$update public.variation_listing_copies set availability_state = 'available' where copy_id = '${c1}'$$);
rollback;
begin;
set local app.variation_listing_write_scope = 'aggregate';
set local app.variation_listing_group_id = '${g2}';
set local app.variation_listing_expected_revision = '1';
select assert_failure('wrong aggregate group update', $$update public.variation_listing_groups set desired_revision = 2 where group_id = '${g1}'$$);
rollback;
begin;
set local app.variation_listing_write_scope = 'confirmation';
set local app.variation_listing_group_id = '${g1}';
set local app.variation_listing_expected_revision = '3';
select assert_failure('confirmation cannot mutate variation', $$update public.variation_listing_variations set variation_metadata = '{"confirmation":true}' where variation_id = '${v1}'$$);
select assert_failure('confirmation cannot mutate copy', $$update public.variation_listing_copies set availability_state = 'available' where copy_id = '${c1}'$$);
rollback;
begin;
set local app.variation_listing_write_scope = 'aggregate';
set local app.variation_listing_group_id = '${g1}';
set local app.variation_listing_expected_revision = '3';
update public.variation_listing_groups set desired_revision = 4 where group_id = '${g1}';
select assert_failure('second aggregate CAS in one transaction', $$update public.variation_listing_groups set desired_revision = 5 where group_id = '${g1}'$$);
rollback;

-- SKU/category/token/serial projections and allocator consumption.
select assert_failure('reserved Single bucket', $$insert into public.variation_listing_groups (group_id, group_key, sku_category_code, sku_bucket_token, category_id, marketplace_id, merchant_location_key, fulfillment_policy_id, payment_policy_id, return_policy_id, condition_id, condition_token) values ('99999999-9999-4999-8999-999999999991', 'VL-G-99999999999949998999999999999991', 'BSKBL', 'Single', 'x', 'EBAY_US', 'loc', 'f', 'p', 'r', 'c', 'POOR')$$);
select assert_failure('reserved Lot bucket', $$insert into public.variation_listing_groups (group_id, group_key, sku_category_code, sku_bucket_token, category_id, marketplace_id, merchant_location_key, fulfillment_policy_id, payment_policy_id, return_policy_id, condition_id, condition_token) values ('99999999-9999-4999-8999-999999999992', 'VL-G-99999999999949998999999999999992', 'OTHER', 'Lot', 'x', 'EBAY_US', 'loc', 'f', 'p', 'r', 'c', 'POOR')$$);
select assert_failure('unsupported category', $$insert into public.variation_listing_groups (group_id, group_key, sku_category_code, sku_bucket_token, category_id, marketplace_id, merchant_location_key, fulfillment_policy_id, payment_policy_id, return_policy_id, condition_id, condition_token) values ('99999999-9999-4999-8999-999999999993', 'VL-G-99999999999949998999999999999993', 'NOPE', 'X', 'x', 'EBAY_US', 'loc', 'f', 'p', 'r', 'c', 'POOR')$$);
select assert_failure('group key projection', $$insert into public.variation_listing_groups (group_id, group_key, sku_category_code, sku_bucket_token, category_id, marketplace_id, merchant_location_key, fulfillment_policy_id, payment_policy_id, return_policy_id, condition_id, condition_token) values ('99999999-9999-4999-8999-999999999994', 'VL-G-wrong', 'OTHER', 'X', 'x', 'EBAY_US', 'loc', 'f', 'p', 'r', 'c', 'POOR')$$);
begin;
set local app.variation_listing_write_scope = 'aggregate';
set local app.variation_listing_group_id = '${g1}';
set local app.variation_listing_expected_revision = '3';
select assert_failure('malformed/projected-wrong SKU', $$insert into public.variation_listing_variations (variation_id, group_id, inventory_serial, sku, position, selector_value, price_amount) values ('99999999-9999-4999-8999-999999999995', '${g1}', 4, 'wrong', 4, 'bad sku', 0.99)$$);
select assert_failure('plausible but wrong SKU projection', $$insert into public.variation_listing_variations (variation_id, group_id, inventory_serial, sku, position, selector_value, price_amount) values ('99999999-9999-4999-8999-999999999990', '${g1}', 3, 'BSKBL-WrongBucket-000003', 3, 'wrong projection', 0.99)$$);
select assert_failure('zero variation serial', $$insert into public.variation_listing_variations (variation_id, group_id, inventory_serial, sku, position, selector_value, price_amount) values ('99999999-9999-4999-8999-999999999996', '${g1}', 0, 'BSKBL-BinderA-000000', 4, 'zero', 0.99)$$);
select assert_failure('variation serial overflow', $$insert into public.variation_listing_variations (variation_id, group_id, inventory_serial, sku, position, selector_value, price_amount) values ('99999999-9999-4999-8999-999999999989', '${g1}', 1000000, 'BSKBL-BinderA-1000000', 4, 'overflow', 0.99)$$);
rollback;
begin;
set local app.variation_listing_write_scope = 'aggregate';
set local app.variation_listing_group_id = '${g1}';
set local app.variation_listing_expected_revision = '3';
select assert_failure('group serial overflow', $$update public.variation_listing_groups set desired_revision = 4, next_inventory_serial = 1000001 where group_id = '${g1}'$$);
rollback;
begin;
set local app.variation_listing_write_scope = 'aggregate';
set local app.variation_listing_group_id = '${g1}';
set local app.variation_listing_expected_revision = '3';
select assert_failure('missing allocator consumption', $$update public.variation_listing_groups set desired_revision = 4, next_inventory_serial = 5 where group_id = '${g1}'$$);
rollback;
${aggregateTransaction(g1, 3, `update public.variation_listing_groups set desired_revision = 4, next_inventory_serial = 3 where group_id = '${g1}';
insert into public.variation_listing_variations (variation_id, group_id, inventory_serial, sku, position, selector_value, price_amount)
values ('99999999-9999-4999-8999-999999999997', '${g1}', 2, 'BSKBL-BinderA-000002', 4, 'Card D', 0.99);
insert into public.variation_listing_copies (copy_id, variation_id, condition_token, front_r2_key, back_r2_key, capture_source_key, capture_session_version, capture_pair_id, capture_front_source_ref, capture_back_source_ref, capture_started_at)
values ('99999999-9999-4999-8999-999999999998', '99999999-9999-4999-8999-999999999997', 'POOR', 'variation-listing/99999999-9999-4999-8999-999999999997/front-d', 'variation-listing/99999999-9999-4999-8999-999999999997/back-d', 'src-d', 1, '99999999-9999-4999-8999-999999999999', 'front-d', 'back-d', now() - interval '1 minute');
update public.variation_listing_variations set representative_copy_id = '99999999-9999-4999-8999-999999999998' where variation_id = '99999999-9999-4999-8999-999999999997';`)}

-- The committed allocation leaves g1 at N+1=4. A caller-forged old proof must
-- still fail both deferred child checks because the look-alike temp table owner
-- is service_role, not the SECURITY DEFINER function owner.
select assert_true((select desired_revision = 4 from public.variation_listing_groups where group_id = '${g1}'), 'forged-proof precondition is N+1');
begin;
set local role service_role;
set local app.variation_listing_write_scope = 'aggregate';
set local app.variation_listing_group_id = '${g1}';
set local app.variation_listing_expected_revision = '3';
select set_config('app.variation_listing_group_revision_proof', format('%s|%s|%s|%s', txid_current(), '${g1}', 3, 4), true);
create temp table variation_listing_aggregate_revision_proof (transaction_id xid8 not null, group_id uuid not null, from_revision bigint not null, to_revision bigint not null);
insert into variation_listing_aggregate_revision_proof values (pg_current_xact_id(), '${g1}', 3, 4);
select assert_failure('caller-forged variation proof', $$update public.variation_listing_variations set variation_metadata = '{"forged":true}' where variation_id = '${v1}'$$);
select assert_failure('caller-forged copy proof', $$update public.variation_listing_copies set availability_state = 'available' where copy_id = '${c1}'$$);
rollback;

-- Repoint representative to a same-variation copy, then delete the old copy in one aggregate CAS.
${aggregateTransaction(g1, 4, `update public.variation_listing_groups set desired_revision = 5 where group_id = '${g1}';
insert into public.variation_listing_copies (copy_id, variation_id, condition_token, front_r2_key, back_r2_key, capture_source_key, capture_session_version, capture_pair_id, capture_front_source_ref, capture_back_source_ref, capture_started_at)
values ('99999999-9999-4999-8999-999999999991', '${v1}', 'VERY_GOOD', 'variation-listing/${v1}/front-c', 'variation-listing/${v1}/back-c', 'src-c', 1, '${pair3}', 'front-c', 'back-c', now() - interval '1 minute');
insert into public.variation_listing_copies (copy_id, variation_id, condition_token, front_r2_key, back_r2_key, capture_source_key, capture_session_version, capture_pair_id, capture_front_source_ref, capture_back_source_ref, capture_started_at)
values ('99999999-9999-4999-8999-999999999992', '${v1}', 'NEAR_MINT_OR_BETTER', 'variation-listing/${v1}/front-e', 'variation-listing/${v1}/back-e', 'src-e', 1, '${pair4}', 'front-e', 'back-e', now() - interval '1 minute');
update public.variation_listing_variations set representative_copy_id = '99999999-9999-4999-8999-999999999991' where variation_id = '${v1}';
delete from public.variation_listing_copies where copy_id = '${c1}';`)}
select assert_true((select representative_copy_id = '99999999-9999-4999-8999-999999999991' from public.variation_listing_variations where variation_id = '${v1}'), 'representative repoint persisted');
select assert_true((select count(*) = 0 from public.variation_listing_copies where copy_id = '${c1}'), 'old representative copy deleted');
${aggregateFailureTransaction(g1, 5, 'cross-variation representative assignment', `update public.variation_listing_variations set representative_copy_id = '${c2}' where variation_id = '${v1}'`)}

-- All four coarse condition tokens are accepted; unsupported token is rejected.
insert into public.variation_listing_groups (group_id, group_key, sku_category_code, sku_bucket_token, category_id, marketplace_id, merchant_location_key, fulfillment_policy_id, payment_policy_id, return_policy_id, condition_id, condition_token)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'VL-G-' || upper(replace('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '-', '')), 'OTHER', 'CondA', 'x', 'EBAY_US', 'loc', 'f', 'p', 'r', 'c', 'NEAR_MINT_OR_BETTER'),
       ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'VL-G-' || upper(replace('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '-', '')), 'OTHER', 'CondB', 'x', 'EBAY_US', 'loc', 'f', 'p', 'r', 'c', 'EXCELLENT'),
       ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'VL-G-' || upper(replace('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', '-', '')), 'OTHER', 'CondC', 'x', 'EBAY_US', 'loc', 'f', 'p', 'r', 'c', 'VERY_GOOD'),
       ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'VL-G-' || upper(replace('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', '-', '')), 'OTHER', 'CondD', 'x', 'EBAY_US', 'loc', 'f', 'p', 'r', 'c', 'POOR');
select assert_failure('unsupported coarse condition', $$insert into public.variation_listing_groups (group_id, group_key, sku_category_code, sku_bucket_token, category_id, marketplace_id, merchant_location_key, fulfillment_policy_id, payment_policy_id, return_policy_id, condition_id, condition_token) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', 'VL-G-AAAAAAAAAAAA4AAA8AAAAAAAAAAAAA5', 'OTHER', 'CondE', 'x', 'EBAY_US', 'loc', 'f', 'p', 'r', 'c', 'GOOD')$$);
select assert_true((select count(distinct condition_token) from public.variation_listing_copies) = 4, 'all four coarse condition tokens accepted on copies');

-- Capture uniqueness, immutable provenance, R2 shape, availability, and capture time.
${aggregateFailureTransaction(g1, 5, 'duplicate capture pair', `insert into public.variation_listing_copies (copy_id, variation_id, condition_token, front_r2_key, back_r2_key, capture_source_key, capture_session_version, capture_pair_id, capture_front_source_ref, capture_back_source_ref, capture_started_at) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${v1}', 'POOR', 'variation-listing/${v1}/front-dupe', 'variation-listing/${v1}/back-dupe', 'src-dupe', 1, '${pair3}', 'f', 'b', now() - interval '1 minute')`)}
begin;
set local app.variation_listing_write_scope = 'aggregate';
set local app.variation_listing_group_id = '${g1}';
set local app.variation_listing_expected_revision = '5';
${aggregateFailureTransaction(g1, 5, 'immutable copy provenance', `update public.variation_listing_copies set front_r2_key = 'variation-listing/${v1}/front-mutated' where copy_id = '99999999-9999-4999-8999-999999999991'`)}
rollback;
${aggregateFailureTransaction(g1, 5, 'invalid R2 key', `insert into public.variation_listing_copies (copy_id, variation_id, condition_token, front_r2_key, back_r2_key, capture_source_key, capture_session_version, capture_pair_id, capture_front_source_ref, capture_back_source_ref, capture_started_at) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc', '${v1}', 'POOR', 'not-r2', 'variation-listing/${v1}/back-x', 'src-x', 1, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc', 'f', 'b', now() - interval '1 minute')`)}
${aggregateFailureTransaction(g1, 5, 'invalid availability enum', `insert into public.variation_listing_copies (copy_id, variation_id, condition_token, availability_state, front_r2_key, back_r2_key, capture_source_key, capture_session_version, capture_pair_id, capture_front_source_ref, capture_back_source_ref, capture_started_at) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd', '${v1}', 'POOR', 'lost', 'variation-listing/${v1}/front-x', 'variation-listing/${v1}/back-x', 'src-y', 1, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd', 'f', 'b', now() - interval '1 minute')`)}
${aggregateFailureTransaction(g1, 5, 'unsupported copy condition', `insert into public.variation_listing_copies (copy_id, variation_id, condition_token, front_r2_key, back_r2_key, capture_source_key, capture_session_version, capture_pair_id, capture_front_source_ref, capture_back_source_ref, capture_started_at) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbba', '${v1}', 'GOOD', 'variation-listing/${v1}/front-condition', 'variation-listing/${v1}/back-condition', 'src-condition', 1, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbba', 'f', 'b', now() - interval '1 minute')`)}
${aggregateFailureTransaction(g1, 5, 'capture session version zero', `insert into public.variation_listing_copies (copy_id, variation_id, condition_token, front_r2_key, back_r2_key, capture_source_key, capture_session_version, capture_pair_id, capture_front_source_ref, capture_back_source_ref, capture_started_at) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe', '${v1}', 'POOR', 'variation-listing/${v1}/front-y', 'variation-listing/${v1}/back-y', 'src-z', 0, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe', 'f', 'b', now() - interval '1 minute')`)}
${aggregateFailureTransaction(g1, 5, 'capture time order', `insert into public.variation_listing_copies (copy_id, variation_id, condition_token, front_r2_key, back_r2_key, capture_source_key, capture_session_version, capture_pair_id, capture_front_source_ref, capture_back_source_ref, capture_started_at, captured_at) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbf', '${v1}', 'POOR', 'variation-listing/${v1}/front-y2', 'variation-listing/${v1}/back-y2', 'src-z2', 1, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbf', 'f', now(), now() - interval '1 minute')`)}

-- Intake sessions: mode/target/price, snapshot, blocked changes, clear/recovery, partials, and cross-group target.
insert into public.variation_listing_intake_sessions (capture_source_key) values ('intake-a');
update public.variation_listing_intake_sessions set mode = 'new_variation', target_group_id = '${g1}', session_version = 2, sticky_price_amount = 1.49 where capture_source_key = 'intake-a';
begin;
select assert_failure('invalid first-image pending snapshot', $$update public.variation_listing_intake_sessions set pending_pair_id = 'abababab-abab-4aba-8aba-abababababab', pending_pair_session_version = 2, pending_pair_mode = 'duplicate_copy', pending_pair_target_group_id = '${g1}', pending_pair_target_variation_id = '${v1}', pending_pair_price_amount = 1.49, pending_pair_price_currency = 'USD', pending_pair_front_source_ref = 'wrong-mode', pending_pair_started_at = now() where capture_source_key = 'intake-a'$$);
rollback;
update public.variation_listing_intake_sessions set pending_pair_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', pending_pair_session_version = 2, pending_pair_mode = 'new_variation', pending_pair_target_group_id = '${g1}', pending_pair_price_amount = 1.49, pending_pair_price_currency = 'USD', pending_pair_front_source_ref = 'front-intake', pending_pair_started_at = now() where capture_source_key = 'intake-a';
begin;
select assert_failure('pending snapshot immutable', $$update public.variation_listing_intake_sessions set pending_pair_front_source_ref = 'changed' where capture_source_key = 'intake-a'$$);
select assert_failure('pending target blocked', $$update public.variation_listing_intake_sessions set target_group_id = '${g2}' where capture_source_key = 'intake-a'$$);
select assert_failure('pending mode blocked', $$update public.variation_listing_intake_sessions set mode = 'idle' where capture_source_key = 'intake-a'$$);
select assert_failure('pending price blocked', $$update public.variation_listing_intake_sessions set sticky_price_amount = 1.99 where capture_source_key = 'intake-a'$$);
rollback;
update public.variation_listing_intake_sessions set pending_pair_id = null, pending_pair_session_version = null, pending_pair_mode = null, pending_pair_target_group_id = null, pending_pair_price_amount = null, pending_pair_price_currency = null, pending_pair_front_source_ref = null, pending_pair_started_at = null where capture_source_key = 'intake-a';
update public.variation_listing_intake_sessions set mode = 'idle', target_group_id = null, session_version = 3 where capture_source_key = 'intake-a';
insert into public.variation_listing_intake_sessions (capture_source_key, mode, target_group_id, target_variation_id, sticky_price_amount)
values ('intake-b', 'duplicate_copy', '${g1}', '${v1}', 1.99);
update public.variation_listing_intake_sessions set pending_pair_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', pending_pair_session_version = 1, pending_pair_mode = 'duplicate_copy', pending_pair_target_group_id = '${g1}', pending_pair_target_variation_id = '${v1}', pending_pair_price_amount = 1.99, pending_pair_price_currency = 'USD', pending_pair_front_source_ref = 'front-b', pending_pair_started_at = now() where capture_source_key = 'intake-b';
update public.variation_listing_intake_sessions set pending_pair_id = null, pending_pair_session_version = null, pending_pair_mode = null, pending_pair_target_group_id = null, pending_pair_target_variation_id = null, pending_pair_price_amount = null, pending_pair_price_currency = null, pending_pair_front_source_ref = null, pending_pair_started_at = null, session_version = 1 where capture_source_key = 'intake-b';
select assert_true((select session_version = 1 and pending_pair_id is null from public.variation_listing_intake_sessions where capture_source_key = 'intake-b'), 'valid completion clear preserves session version');
insert into public.variation_listing_intake_sessions (capture_source_key, mode, target_group_id, target_variation_id, sticky_price_amount)
values ('intake-c', 'duplicate_copy', '${g1}', '${v1}', 2.49);
update public.variation_listing_intake_sessions set pending_pair_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', pending_pair_session_version = 1, pending_pair_mode = 'duplicate_copy', pending_pair_target_group_id = '${g1}', pending_pair_target_variation_id = '${v1}', pending_pair_price_amount = 2.49, pending_pair_price_currency = 'USD', pending_pair_front_source_ref = 'front-c', pending_pair_started_at = now() where capture_source_key = 'intake-c';
update public.variation_listing_intake_sessions set pending_pair_id = null, pending_pair_session_version = null, pending_pair_mode = null, pending_pair_target_group_id = null, pending_pair_target_variation_id = null, pending_pair_price_amount = null, pending_pair_price_currency = null, pending_pair_front_source_ref = null, pending_pair_started_at = null, session_version = 2 where capture_source_key = 'intake-c';
select assert_true((select session_version = 2 and pending_pair_id is null from public.variation_listing_intake_sessions where capture_source_key = 'intake-c'), 'valid discard recovery increments session version');
select assert_failure('session version zero', $$insert into public.variation_listing_intake_sessions (capture_source_key, session_version) values ('intake-version-zero', 0)$$);
select assert_failure('partial pending snapshot', $$insert into public.variation_listing_intake_sessions (capture_source_key, pending_pair_id) values ('intake-partial', 'ffffffff-ffff-4fff-8fff-ffffffffffff')$$);
select assert_failure('duplicate-target cross-group membership', $$insert into public.variation_listing_intake_sessions (capture_source_key, mode, target_group_id, target_variation_id) values ('intake-cross', 'duplicate_copy', '${g1}', '${v2}')$$);
select assert_failure('unsupported intake mode', $$insert into public.variation_listing_intake_sessions (capture_source_key, mode) values ('intake-mode', 'paused')$$);
select assert_failure('unsupported sticky price', $$insert into public.variation_listing_intake_sessions (capture_source_key, sticky_price_amount) values ('intake-price', 3.99)$$);

-- Repoint/delete representative behavior: a surviving variation cannot lose its representative.
${aggregateFailureTransaction(g1, 5, 'surviving-null representative', `update public.variation_listing_variations set representative_copy_id = null where variation_id = '${v1}'`)}
select assert_true((select representative_copy_id is not null from public.variation_listing_variations where variation_id = '${v1}'), 'representative remains non-null');

-- Function collision is fail-closed: a second empty database pre-creates one dedicated function.
`;

const collision = `
create function public.prevent_variation_listing_group_identity_update() returns trigger language plpgsql as $$ begin return new; end; $$;
`;

const collisionBootstrap = `
create function public.set_row_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create view public.sentinel_shared_view as select 'yp2.2b-sentinel'::text as marker;
`;

const rollbackAssertions = `
select assert_true(to_regclass('public.variation_listing_groups') is null, 'rollback removed groups');
select assert_true(to_regclass('public.variation_listing_variations') is null, 'rollback removed variations');
select assert_true(to_regclass('public.variation_listing_copies') is null, 'rollback removed copies');
select assert_true(to_regclass('public.variation_listing_intake_sessions') is null, 'rollback removed intake');
select assert_true(to_regprocedure('public.set_row_updated_at()') is not null, 'rollback preserved shared helper');
select assert_true((select count(*) from pg_views where schemaname = 'public' and viewname = 'sentinel_shared_view') = 1, 'rollback preserved shared view');
with expected(name) as (values ${functionValues})
select assert_true((select count(*) from pg_proc p join expected e on e.name = p.proname where p.pronamespace = 'public'::regnamespace and p.pronargs = 0) = 0, 'rollback removed dedicated functions');
`;

async function main() {
  let started = false;
  try {
    await docker(['run', '--detach', '--rm', '--name', name, '-e', `POSTGRES_PASSWORD=${password}`, 'postgres:17-alpine']);
    started = true;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        await docker(['exec', name, 'pg_isready', '-U', 'postgres', '-d', 'postgres']);
        break;
      } catch {
        if (attempt === 59) throw new Error('postgres did not become ready within 60 seconds');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    const migration = await readFile(migrationPath, 'utf8');
    const rollback = await readFile(rollbackPath, 'utf8');
    await psql('postgres', bootstrap + migration + assertions);

    await docker(['exec', name, 'createdb', '-U', 'postgres', 'collision_db']);
    const collisionError = await psqlExpectFailure('collision_db', `${collisionBootstrap}${collision}\nbegin;\n${migration}\ncommit;`);
    if (!/already exists|duplicate/i.test(`${collisionError.stderr}${collisionError.stdout}`)) {
      throw new Error(`function collision failed for an unexpected reason:\n${collisionError.stderr || collisionError.stdout}`);
    }
    const collisionProbe = await psql('collision_db', "select case when to_regprocedure('public.prevent_variation_listing_group_identity_update()') is not null and to_regprocedure('public.set_row_updated_at()') is not null and to_regclass('public.sentinel_shared_view') is not null and (select count(*) from pg_class where relname like 'variation_listing_%' and relkind = 'r') = 0 then 'collision-ok' else 'collision-bad' end;");
    if (!/collision-ok/.test(collisionProbe.stdout)) {
      throw new Error(`collision transaction did not roll back cleanly:\n${collisionProbe.stdout}`);
    }

    const occupiedRollbackError = await psqlExpectFailure('postgres', rollback);
    if (!/not empty|durable|variation_listing/i.test(`${occupiedRollbackError.stderr}${occupiedRollbackError.stdout}`)) {
      throw new Error(`occupied rollback failed for an unexpected reason:\n${occupiedRollbackError.stderr || occupiedRollbackError.stdout}`);
    }
    await psql('postgres', `truncate table public.variation_listing_intake_sessions, public.variation_listing_copies, public.variation_listing_variations, public.variation_listing_groups cascade;\n${rollback}`);
    await psql('postgres', rollbackAssertions);
    await psql('postgres', migration);
    await psql('postgres', "select assert_true(to_regclass('public.variation_listing_groups') is not null, 'reapply succeeds');");
    console.log('YP2.2b variation-listing migration validation: passed');
  } finally {
    if (started) {
      try { await docker(['rm', '--force', name]); } catch (error) { console.error(`cleanup failed: ${error.message}`); }
    }
  }
}

main().catch((error) => {
  console.error(`YP2.2b variation-listing migration validation: failed\n${error.message}`);
  process.exitCode = 1;
});

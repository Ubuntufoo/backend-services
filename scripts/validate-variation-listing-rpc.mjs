#!/usr/bin/env node

/**
 * Disposable YP2.7b RPC seam and YP2.7c ACL remediation validation. Applies
 * the YP2.4 + YP2.5 + RPC migrations to a throwaway PostgreSQL container and
 * proves the three RPC functions plus the hosted-default-ACL correction.
 * Never connects to a hosted database or mutates eBay.
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const root = new URL('..', import.meta.url);
const migrationPath = new URL(
  'supabase/migrations/20260828150000_create_variation_listing_persistence.sql',
  root
);
const journalMigrationPath = new URL(
  'supabase/migrations/20260829150000_create_variation_listing_publishing_journal.sql',
  root
);
const rpcMigrationPath = new URL(
  'supabase/migrations/20260830014853_create_variation_listing_rpc_seam.sql',
  root
);
const rpcRollbackPath = new URL(
  'supabase/rollbacks/20260830014853_create_variation_listing_rpc_seam.rollback.sql',
  root
);
const aclRemediationMigrationPath = new URL(
  'supabase/migrations/20260831142123_revoke_variation_listing_rpc_execute.sql',
  root
);
const aclRemediationRollbackPath = new URL(
  'supabase/rollbacks/20260831142123_revoke_variation_listing_rpc_execute.rollback.sql',
  root
);

const password = 'codex-yp27b-postgres';
const name = `codex-yp27b-${process.pid}-${randomBytes(4).toString('hex')}`;

function command(file, args, input = undefined) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          Object.assign(
            new Error(`${file} ${args.join(' ')} exited ${code ?? signal}\n${stderr}${stdout}`),
            { code, stdout, stderr }
          )
        );
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function docker(args, input = undefined) {
  return command('docker', args, input);
}

async function psql(database, sql) {
  return docker(
    ['exec', '-i', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database],
    sql
  );
}

async function psqlExpectFailure(database, sql) {
  try {
    await psql(database, sql);
  } catch (error) {
    return error;
  }
  throw new Error('expected psql failure, but command succeeded');
}

async function waitForDatabaseBarrier(database, sql, label) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await psql(database, sql);
    if (result.stdout.includes('ready')) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`database barrier did not become ready: ${label}`);
}

const g1 = '11111111-1111-4111-8111-111111111111';
const v1 = '22222222-2222-4222-8222-222222222222';
const c1 = '33333333-3333-4333-8333-333333333333';
const pair1 = '77777777-7777-4777-8777-777777777777';
const rev1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const revBad = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9';
const rev2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const rev3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae';
const op1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const op2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const op3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const op4 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac';
const op5 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad';
const op6 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf';
const ckpt1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const ckpt2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const ckpt3 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const ckpt4 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
const ckpt5 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5';
const ckpt6 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6';
const ckpt7 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7';
const ckpt8 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8';
const ckptBad = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9';
const ckptRace = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbba';
const ckpt9 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc';
const ckpt10 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd';
const ckpt11 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe';
const ckptForge1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbf';
const ckptForge2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0';
const gRace = '44444444-4444-4444-8444-444444444444';
const revRace = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaba';
const opRace = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaabb';

function aggregateTransaction(group, expected, body) {
  return `begin;
set local app.variation_listing_write_scope = 'aggregate';
set local app.variation_listing_group_id = '${group}';
set local app.variation_listing_expected_revision = '${expected}';
${body}
set constraints all immediate;
commit;`;
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
create view public.sentinel_shared_view as select 'yp2.7b-sentinel'::text as marker;
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

create function public.assert_failure_contains(label text, statement text, needle text)
returns void language plpgsql as $$
declare failed boolean := false;
declare message text := '';
begin
  begin
    execute statement;
    set constraints all immediate;
  exception when others then
    failed := true;
    message := sqlerrm;
  end;
  if not failed then raise exception 'expected rejection not observed: %', label; end if;
  if position(lower(needle) in lower(message)) = 0 then
    raise exception 'unexpected rejection for %: %', label, message;
  end if;
end; $$;

set search_path = pg_temp, public;

-- RPC functions exist and are service-role only.
select assert_true(to_regprocedure('public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)') is not null, 'capture RPC exists');
select assert_true(to_regprocedure('public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)') is not null, 'append RPC exists');
select assert_true(to_regprocedure('public.confirm_variation_listing_revision(uuid, bigint, bigint)') is not null, 'confirm RPC exists');
select assert_true(not has_function_privilege('anon', 'public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)', 'execute'), 'anon cannot execute capture');
select assert_true(not has_function_privilege('anon', 'public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)', 'execute'), 'anon cannot execute append');
select assert_true(not has_function_privilege('anon', 'public.confirm_variation_listing_revision(uuid, bigint, bigint)', 'execute'), 'anon cannot execute confirm');
select assert_true(not has_function_privilege('authenticated', 'public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)', 'execute'), 'authenticated cannot execute capture');
select assert_true(not has_function_privilege('authenticated', 'public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)', 'execute'), 'authenticated cannot execute append');
select assert_true(not has_function_privilege('authenticated', 'public.confirm_variation_listing_revision(uuid, bigint, bigint)', 'execute'), 'authenticated cannot execute confirm');
select assert_true(has_function_privilege('service_role', 'public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)', 'execute'), 'service_role can execute capture');
select assert_true(has_function_privilege('service_role', 'public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)', 'execute'), 'service_role can execute append');
select assert_true(has_function_privilege('service_role', 'public.confirm_variation_listing_revision(uuid, bigint, bigint)', 'execute'), 'service_role can execute confirm');
select assert_true(not has_function_privilege('public', 'public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)', 'execute'), 'PUBLIC cannot execute capture');
select assert_true(not has_function_privilege('public', 'public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)', 'execute'), 'PUBLIC cannot execute append');
select assert_true(not has_function_privilege('public', 'public.confirm_variation_listing_revision(uuid, bigint, bigint)', 'execute'), 'PUBLIC cannot execute confirm');
select assert_true(not has_table_privilege('service_role', 'public.variation_listing_operations', 'UPDATE'), 'service_role cannot directly update operation projection');
select assert_true(not has_table_privilege('service_role', 'public.variation_listing_revisions', 'INSERT'), 'service_role cannot directly insert revisions');
select assert_true(not has_table_privilege('service_role', 'public.variation_listing_operations', 'INSERT'), 'service_role cannot directly insert operations');
select assert_true(not has_table_privilege('service_role', 'public.variation_listing_operation_attempts', 'INSERT'), 'service_role cannot directly insert attempts');
select assert_true((select prosecdef from pg_proc where oid = to_regprocedure('public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)')), 'capture RPC is SECURITY DEFINER');
select assert_true((select prosecdef from pg_proc where oid = to_regprocedure('public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)')), 'append RPC is SECURITY DEFINER');
select assert_true((select prosecdef from pg_proc where oid = to_regprocedure('public.confirm_variation_listing_revision(uuid, bigint, bigint)')), 'confirm RPC is SECURITY DEFINER');
select assert_true((select array_to_string(proconfig, ',') from pg_proc where oid = to_regprocedure('public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)')) like '%search_path=pg_catalog, public, pg_temp%', 'append RPC pins search_path');

-- The RPC migration adds no tables, views, or policies; existing objects are intact.
select assert_true((select count(*) from pg_class where relname like 'variation_listing_%' and relkind = 'r') = 7, 'RPC migration adds no table');
select assert_true((select count(*) from pg_views where schemaname = 'public') = 1, 'RPC migration adds no view');
select assert_true((select count(*) from pg_policies where schemaname = 'public') = 0, 'no policies installed');
select assert_true(to_regclass('public.variation_listing_variations') is not null, 'YP2.4 variations table survives');
select assert_true(to_regclass('public.variation_listing_copies') is not null, 'YP2.4 copies table survives');
select assert_true(to_regclass('public.variation_listing_intake_sessions') is not null, 'YP2.4 intake table survives');
select assert_true(to_regprocedure('public.validate_variation_listing_group_guarded_update()') is not null, 'YP2.4 group guard survives');
select assert_true(to_regprocedure('public.validate_variation_listing_variation_aggregate_write()') is not null, 'YP2.4 variation guard survives');
select assert_true(to_regprocedure('public.validate_variation_listing_copy_aggregate_write()') is not null, 'YP2.4 copy guard survives');
select assert_true(to_regprocedure('public.prevent_variation_listing_operation_attempt_mutation()') is not null, 'YP2.5 append-only trigger survives');
select assert_true((select count(*) from pg_constraint where conname = 'variation_listing_groups_revision_watermark_check') = 1, 'YP2.4 watermark constraint survives');
select assert_true((select count(*) from pg_constraint where conname = 'variation_listing_operation_attempts_operation_attempt_checkpoint_key') = 1, 'YP2.5 checkpoint uniqueness survives');
select assert_true((select definition from pg_views where schemaname = 'public' and viewname = 'sentinel_shared_view') like '%yp2.7b-sentinel%', 'sentinel view survives');
select assert_true(to_regprocedure('public.set_row_updated_at()') is not null, 'shared updated-at helper survives');

-- Seed one group/variation/copy at desired_revision = 1.
${aggregateTransaction(
  g1,
  0,
  `
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
update public.variation_listing_variations set representative_copy_id = '${c1}' where variation_id = '${v1}';`
)}
select assert_true((select desired_revision = 1 from public.variation_listing_groups where group_id = '${g1}'), 'group seeded at revision 1');
select assert_failure('service_role direct projection update is denied', $$set local role service_role; update public.variation_listing_operations set current_state = 'unknown' where operation_id = '${op1}'$$);

-- Revision capture: one transaction inserts the revision plus the complete ordered plan.
begin;
set local role service_role;
select * from public.capture_variation_listing_revision(
  '${g1}'::uuid, '${rev1}'::uuid, 1::bigint, 1, repeat('a', 64), '{"group":"${g1}","desired_revision":1}'::jsonb,
  jsonb_build_array(
    jsonb_build_object('operation_id', '${op1}', 'sequence_no', 1, 'operation_key', 'media-1', 'operation_kind', 'media_ingest', 'target_ref', 'variation/${v1}/front', 'intent_version', 1, 'intent_digest', repeat('b', 64), 'intent', '{"media":"front"}'::jsonb),
    jsonb_build_object('operation_id', '${op2}', 'sequence_no', 2, 'operation_key', 'group-1', 'operation_kind', 'complete_group_replace', 'target_ref', 'group/${g1}', 'intent_version', 1, 'intent_digest', repeat('c', 64), 'intent', '{"group":"${g1}"}'::jsonb),
    jsonb_build_object('operation_id', '${op3}', 'sequence_no', 3, 'operation_key', 'withdraw-1', 'operation_kind', 'withdrawal', 'target_ref', 'group/${g1}', 'intent_version', 1, 'intent_digest', repeat('d', 64), 'intent', '{"withdraw":true}'::jsonb)
  )
);
commit;
select assert_true((select count(*) = 1 from public.variation_listing_revisions where revision_id = '${rev1}'), 'revision captured');
select assert_true((select count(*) = 3 from public.variation_listing_operations where revision_id = '${rev1}'), 'complete ordered plan captured');
select assert_failure('service_role cannot mutate an existing projection row', $$set local role service_role; update public.variation_listing_operations set current_state = 'unknown' where operation_id = '${op1}'$$);
select assert_failure('service_role cannot insert a revision outside capture RPC', $$set local role service_role; insert into public.variation_listing_revisions (revision_id, group_id, captured_desired_revision, snapshot_version, snapshot_digest, snapshot, operation_count) values ('${revBad}', '${g1}', 4, 1, repeat('a', 64), '{}'::jsonb, 1)$$);
select assert_failure('service_role cannot insert an operation outside capture RPC', $$set local role service_role; insert into public.variation_listing_operations (operation_id, revision_id, sequence_no, operation_key, operation_kind, target_ref, intent_version, intent_digest, intent) values ('${opRace}', '${rev1}', 4, 'outside-rpc', 'media_ingest', 'outside-rpc', 1, repeat('a', 64), '{}'::jsonb)$$);
select assert_failure('service_role cannot insert an attempt outside append RPC', $$set local role service_role; insert into public.variation_listing_operation_attempts (checkpoint_id, operation_id, attempt_number, checkpoint_number, state, evidence_version) values ('${ckptBad}', '${op1}', 4, 1, 'unknown', 1)$$);
select assert_failure_contains('service_role invokes SECURITY DEFINER append RPC', $$set local role service_role; select * from public.append_variation_listing_journal_checkpoint('${op1}'::uuid, '${ckptBad}'::uuid, 4, 1, 'started', 1, null, null, null, null, null, null, null, 'started', null, null)$$, 'contiguous');

-- Duplicate/conflicting capture fails without partial rows.
select assert_failure('duplicate revision capture', $$select * from public.capture_variation_listing_revision('${g1}'::uuid, '${revBad}'::uuid, 1::bigint, 1, repeat('a', 64), '{}'::jsonb, jsonb_build_array(jsonb_build_object('operation_id', '${op1}', 'sequence_no', 1, 'operation_key', 'dup', 'operation_kind', 'withdrawal', 'target_ref', 'x', 'intent_version', 1, 'intent_digest', repeat('e', 64), 'intent', '{}'::jsonb)))$$);
select assert_failure('stale revision capture CAS', $$select * from public.capture_variation_listing_revision('${g1}'::uuid, '${revBad}'::uuid, 2::bigint, 1, repeat('a', 64), '{}'::jsonb, jsonb_build_array(jsonb_build_object('operation_id', '${op1}', 'sequence_no', 1, 'operation_key', 'stale', 'operation_kind', 'withdrawal', 'target_ref', 'x', 'intent_version', 1, 'intent_digest', repeat('e', 64), 'intent', '{}'::jsonb)))$$);
select assert_failure('invalid operation kind rolls back atomically', $$select * from public.capture_variation_listing_revision('${g1}'::uuid, '${revBad}'::uuid, 1::bigint, 1, repeat('a', 64), '{}'::jsonb, jsonb_build_array(jsonb_build_object('operation_id', '${op1}', 'sequence_no', 1, 'operation_key', 'bad', 'operation_kind', 'bogus_kind', 'target_ref', 'x', 'intent_version', 1, 'intent_digest', repeat('e', 64), 'intent', '{}'::jsonb)))$$);
select assert_true((select count(*) = 0 from public.variation_listing_revisions where revision_id = '${revBad}'), 'failed captures leave no revision rows');
select assert_true((select count(*) = 0 from public.variation_listing_operations where revision_id = '${revBad}'), 'failed captures leave no operation rows');

-- Append checkpoint: started -> unknown -> exact reconciliation.
begin;
set local role service_role;
select * from public.append_variation_listing_journal_checkpoint(
  '${op1}'::uuid, '${ckpt1}'::uuid, 1, 1, 'started', 1, null, null, null, null, null, null, null, 'started', null, null);
commit;
select assert_true((select current_state = 'started' and latest_attempt_number = 1 from public.variation_listing_operations where operation_id = '${op1}'), 'started attempt projected');
select * from public.append_variation_listing_journal_checkpoint(
  '${op1}'::uuid, '${ckpt2}'::uuid, 1, 2, 'unknown', 1, null, '{"timeout":true}'::jsonb, null, '{"code":"transport_timeout"}'::jsonb, null, 'reconcile-required', 'unknown', 'unknown', 'unknown', '{"ambiguous":true}'::jsonb);
select assert_true((select current_state = 'unknown' and latest_attempt_number = 1 from public.variation_listing_operations where operation_id = '${op1}'), 'unknown outcome projected');

select assert_failure('attempt-number regression', $$select * from public.append_variation_listing_journal_checkpoint('${op1}'::uuid, '${ckptBad}'::uuid, 0, 1, 'unknown', 1, null, null, null, null, null, null, 'unknown', 'unknown', 'unknown', null)$$);
select assert_failure('checkpoint ordering violation', $$select * from public.append_variation_listing_journal_checkpoint('${op1}'::uuid, '${ckptBad}'::uuid, 1, 4, 'unknown', 1, null, null, null, null, null, null, 'unknown', 'unknown', 'unknown', null)$$);
select assert_failure('ambiguous outcome cannot be silently cleared', $$select * from public.append_variation_listing_journal_checkpoint('${op1}'::uuid, '${ckptBad}'::uuid, 2, 1, 'started', 1, null, null, null, null, null, null, null, 'started', null, null)$$);

-- Exact reconciliation resolves the ambiguity while the old unknown evidence is preserved.
select * from public.append_variation_listing_journal_checkpoint(
  '${op1}'::uuid, '${ckpt3}'::uuid, 2, 1, 'confirmed_complete', 1, null, '{"verified":true}'::jsonb, '{"media_id":"m-1"}'::jsonb, null, '{"media_id":"m-1"}'::jsonb, 'reconciled', 'present', 'confirmed_complete', 'present', '{"verified":true}'::jsonb);
select assert_true((select current_state = 'confirmed_complete' and current_evidence_state = 'present' from public.variation_listing_operations where operation_id = '${op1}'), 'exact reconciliation resolves current state');
select assert_true((select count(*) = 3 from public.variation_listing_operation_attempts where operation_id = '${op1}'), 'three append-only attempts retained');
select assert_true((select count(*) = 1 from public.variation_listing_operation_attempts where operation_id = '${op1}' and attempt_number = 1 and state = 'unknown'), 'old unknown evidence preserved');
select assert_failure('confirmed operation cannot be reopened', $$select * from public.append_variation_listing_journal_checkpoint('${op1}'::uuid, '${ckptBad}'::uuid, 4, 1, 'started', 1, null, null, null, null, null, null, null, 'started', null, null)$$);

-- Operation success must not advance the group confirmation watermark.
select assert_true((select last_confirmed_revision is null from public.variation_listing_groups where group_id = '${g1}'), 'operation success does not advance group confirmation');

-- A new checkpoint must not create projection/history disagreement (op3, no attempts).
update public.variation_listing_operations
set current_state = 'unknown', current_evidence_state = 'unknown', current_evidence = '{"forged":true}'::jsonb
where operation_id = '${op3}';
select assert_failure('non-planned projection without checkpoint history is rejected', $$select * from public.append_variation_listing_journal_checkpoint('${op3}'::uuid, '${ckptBad}'::uuid, 1, 1, 'unknown', 1, null, null, null, null, null, null, 'unknown', 'unknown', 'unknown', null)$$);
update public.variation_listing_operations
set current_state = 'planned', current_evidence_state = null, current_evidence = null
where operation_id = '${op3}';
select assert_failure('checkpoint unknown with confirmed projection', $$select * from public.append_variation_listing_journal_checkpoint('${op3}'::uuid, '${ckptBad}'::uuid, 1, 1, 'unknown', 1, null, null, null, null, null, null, 'unknown', 'confirmed_complete', 'present', null)$$);
select assert_failure('checkpoint started with confirmed projection', $$select * from public.append_variation_listing_journal_checkpoint('${op3}'::uuid, '${ckptBad}'::uuid, 1, 1, 'started', 1, null, null, null, null, null, null, null, 'confirmed_complete', 'present', null)$$);
select assert_failure('observed unknown with present projection evidence', $$select * from public.append_variation_listing_journal_checkpoint('${op3}'::uuid, '${ckptBad}'::uuid, 1, 1, 'unknown', 1, null, null, null, null, null, null, 'unknown', 'unknown', 'present', null)$$);
select assert_failure('terminal checkpoint requires non-null exact evidence', $$select * from public.append_variation_listing_journal_checkpoint('${op3}'::uuid, '${ckptBad}'::uuid, 1, 1, 'confirmed_complete', 1, null, null, null, null, null, 'reconciled', null, 'confirmed_complete', null, null)$$);
select assert_failure('mutation cannot skip durable started checkpoint', $$select * from public.append_variation_listing_journal_checkpoint('${op3}'::uuid, '${ckptBad}'::uuid, 1, 1, 'confirmed_complete', 1, null, null, null, null, null, 'reconciled', 'present', 'confirmed_complete', 'present', '{}'::jsonb)$$);
select assert_failure('attempt-number skips are rejected', $$select * from public.append_variation_listing_journal_checkpoint('${op3}'::uuid, '${ckptBad}'::uuid, 99, 1, 'started', 1, null, null, null, null, null, null, null, 'started', null, null)$$);
select * from public.append_variation_listing_journal_checkpoint(
  '${op3}'::uuid, '${ckpt9}'::uuid, 1, 1, 'started', 1, null, null, null, null, null, null, null, 'started', null, null);
select assert_failure('started mutation cannot begin a new attempt', $$select * from public.append_variation_listing_journal_checkpoint('${op3}'::uuid, '${ckptBad}'::uuid, 2, 1, 'started', 1, null, null, null, null, null, null, null, 'started', null, null)$$);
select assert_failure('started mutation cannot reconcile from a new attempt', $$select * from public.append_variation_listing_journal_checkpoint('${op3}'::uuid, '${ckptBad}'::uuid, 2, 1, 'confirmed_complete', 1, null, null, null, null, null, 'reconciled', 'present', 'confirmed_complete', 'present', '{}'::jsonb)$$);
select assert_failure('terminal checkpoint cannot carry unknown evidence', $$select * from public.append_variation_listing_journal_checkpoint('${op3}'::uuid, '${ckptBad}'::uuid, 1, 2, 'confirmed_complete', 1, null, null, null, null, null, 'reconciled', 'unknown', 'confirmed_complete', 'unknown', '{}'::jsonb)$$);

-- Pre-existing projection/history disagreement blocks further append (op2).
select * from public.append_variation_listing_journal_checkpoint(
  '${op2}'::uuid, '${ckpt5}'::uuid, 1, 1, 'started', 1, null, null, null, null, null, null, null, 'started', null, null);
select assert_failure('checkpoint-number skips are rejected', $$select * from public.append_variation_listing_journal_checkpoint('${op2}'::uuid, '${ckptBad}'::uuid, 1, 3, 'started', 1, null, null, null, null, null, null, null, 'started', null, null)$$);
update public.variation_listing_operations set current_state = 'confirmed_complete' where operation_id = '${op2}';
select assert_failure('pre-existing projection state disagreement', $$select * from public.append_variation_listing_journal_checkpoint('${op2}'::uuid, '${ckpt6}'::uuid, 2, 1, 'unknown', 1, null, null, null, null, null, null, 'unknown', 'unknown', 'unknown', null)$$);

-- Confirmation authority: last_confirmed_revision advances only for a captured,
-- complete, fully resolved revision.
${aggregateTransaction(
  g1,
  1,
  `update public.variation_listing_groups set desired_revision = 2 where group_id = '${g1}';
update public.variation_listing_variations set variation_metadata = '{"changed":true}' where variation_id = '${v1}';`
)}
select assert_true((select desired_revision = 2 and last_confirmed_revision is null from public.variation_listing_groups where group_id = '${g1}'), 'desired revision advanced past unconfirmed');

-- Confirming an uncaptured revision fails.
select assert_failure('confirm uncaptured revision', $$select * from public.confirm_variation_listing_revision('${g1}'::uuid, null::bigint, 2::bigint)$$);

-- Confirming a captured-but-partially-resolved revision fails (rev1 still has unresolved ops).
select assert_failure('confirm partially resolved revision', $$select * from public.confirm_variation_listing_revision('${g1}'::uuid, null::bigint, 1::bigint)$$);

-- Capture revision 2 with a complete plan, then keep both operations unresolved.
select * from public.capture_variation_listing_revision(
  '${g1}'::uuid, '${rev2}'::uuid, 2::bigint, 1, repeat('f', 64), '{"group":"${g1}","desired_revision":2}'::jsonb,
  jsonb_build_array(
    jsonb_build_object('operation_id', '${op4}', 'sequence_no', 1, 'operation_key', 'media-4', 'operation_kind', 'media_ingest', 'target_ref', 'variation/${v1}/front', 'intent_version', 1, 'intent_digest', repeat('1', 64), 'intent', '{"media":"front-2"}'::jsonb),
    jsonb_build_object('operation_id', '${op5}', 'sequence_no', 2, 'operation_key', 'group-2', 'operation_kind', 'complete_group_replace', 'target_ref', 'group/${g1}', 'intent_version', 1, 'intent_digest', repeat('2', 64), 'intent', '{"group":"${g1}"}'::jsonb)
  )
);
select assert_failure('confirm unresolved captured revision', $$select * from public.confirm_variation_listing_revision('${g1}'::uuid, null::bigint, 2::bigint)$$);

-- Resolve every operation, then whole-revision confirmation succeeds.
select * from public.append_variation_listing_journal_checkpoint(
  '${op4}'::uuid, '${ckpt4}'::uuid, 1, 1, 'started', 1, null, null, null, null, null, null, null, 'started', null, null);
select * from public.append_variation_listing_journal_checkpoint(
  '${op4}'::uuid, '${ckpt6}'::uuid, 1, 2, 'confirmed_complete', 1, null, '{"verified":true}'::jsonb, null, null, '{"media_id":"m-4"}'::jsonb, 'reconciled', 'present', 'confirmed_complete', 'present', '{"verified":true}'::jsonb);
select * from public.append_variation_listing_journal_checkpoint(
  '${op5}'::uuid, '${ckpt10}'::uuid, 1, 1, 'started', 1, null, null, null, null, null, null, null, 'started', null, null);
select * from public.append_variation_listing_journal_checkpoint(
  '${op5}'::uuid, '${ckpt7}'::uuid, 1, 2, 'confirmed_no_op', 1, null, null, null, null, null, 'reconciled', 'proven_absent', 'confirmed_no_op', 'proven_absent', null);

begin;
set local role service_role;
select * from public.confirm_variation_listing_revision('${g1}'::uuid, null::bigint, 2::bigint);
commit;
select assert_true((select last_confirmed_revision = 2 and desired_revision = 2 from public.variation_listing_groups where group_id = '${g1}'), 'whole revision 2 confirmed');

-- Confirming an older fully resolved revision while desired is newer is allowed
-- and leaves the newer desired state pending.
${aggregateTransaction(
  g1,
  2,
  `update public.variation_listing_groups set desired_revision = 3 where group_id = '${g1}';`
)}
select assert_true((select desired_revision = 3 and last_confirmed_revision = 2 from public.variation_listing_groups where group_id = '${g1}'), 'desired advanced beyond confirmed');
select * from public.confirm_variation_listing_revision('${g1}'::uuid, 2::bigint, 2::bigint);
select assert_true((select last_confirmed_revision = 2 and desired_revision = 3 from public.variation_listing_groups where group_id = '${g1}'), 'reconfirming older resolved revision leaves pending true');

select assert_failure('confirmation regression', $$select * from public.confirm_variation_listing_revision('${g1}'::uuid, 2::bigint, 1::bigint)$$);
select assert_failure('confirmation skips beyond desired', $$select * from public.confirm_variation_listing_revision('${g1}'::uuid, 2::bigint, 4::bigint)$$);
select assert_failure('confirmation CAS mismatch', $$select * from public.confirm_variation_listing_revision('${g1}'::uuid, null::bigint, 2::bigint)$$);

-- Zero-checkpoint confirmation loophole: a confirmed projection with no durable
-- checkpoint history must never authorize whole-revision confirmation.
select * from public.capture_variation_listing_revision(
  '${g1}'::uuid, '${rev3}'::uuid, 3::bigint, 1, repeat('3', 64), '{"group":"${g1}","desired_revision":3}'::jsonb,
  jsonb_build_array(
    jsonb_build_object('operation_id', '${op6}', 'sequence_no', 1, 'operation_key', 'media-6', 'operation_kind', 'media_ingest', 'target_ref', 'variation/${v1}/front', 'intent_version', 1, 'intent_digest', repeat('4', 64), 'intent', '{"media":"front-3"}'::jsonb)
  )
);

-- Simulate a legacy maintenance bypass with an impossible started -> attempt 2
-- terminal jump. Confirmation must revalidate all history, not just latest/max.
set session_replication_role = replica;
insert into public.variation_listing_operation_attempts
  (checkpoint_id, operation_id, attempt_number, checkpoint_number, state, evidence_version)
values
  ('${ckptForge1}', '${op6}', 1, 1, 'started', 1),
  ('${ckptForge2}', '${op6}', 2, 1, 'confirmed_complete', 1);
update public.variation_listing_operations
set current_state = 'confirmed_complete', current_evidence_state = 'present',
    current_evidence = '{"verified":true}'::jsonb, latest_attempt_number = 2
where operation_id = '${op6}';
set session_replication_role = origin;
select assert_failure('confirmation rejects malformed durable history', $$select * from public.confirm_variation_listing_revision('${g1}'::uuid, 2::bigint, 3::bigint)$$);
set session_replication_role = replica;
delete from public.variation_listing_operation_attempts where operation_id = '${op6}';
update public.variation_listing_operations
set current_state = 'planned', current_evidence_state = null, current_evidence = null, latest_attempt_number = 0
where operation_id = '${op6}';
set session_replication_role = origin;

-- Forge op6 into a confirmed/resolved projection while it has zero checkpoint rows.
update public.variation_listing_operations
set current_state = 'confirmed_complete',
    current_evidence_state = 'present',
    current_evidence = '{"verified":true}'::jsonb
where operation_id = '${op6}';

select assert_failure('zero-checkpoint confirmed projection cannot confirm', $$select * from public.confirm_variation_listing_revision('${g1}'::uuid, 2::bigint, 3::bigint)$$);
select assert_true((select last_confirmed_revision = 2 from public.variation_listing_groups where group_id = '${g1}'), 'zero-checkpoint forge did not advance confirmation');

-- A forged terminal projection cannot be reopened. Restore this disposable
-- corruption to its planned state before proving a real checkpoint can be
-- appended; production repair would require an explicit compensating action.
update public.variation_listing_operations
set current_state = 'planned', current_evidence_state = null, current_evidence = null
where operation_id = '${op6}';

-- Restore: append one real confirmed checkpoint, then the whole revision confirms.
select * from public.append_variation_listing_journal_checkpoint(
  '${op6}'::uuid, '${ckpt11}'::uuid, 1, 1, 'started', 1, null, null, null, null, null, null, null, 'started', null, null);
select * from public.append_variation_listing_journal_checkpoint(
  '${op6}'::uuid, '${ckpt8}'::uuid, 1, 2, 'confirmed_complete', 1, null, '{"verified":true}'::jsonb, null, null, '{"media_id":"m-6"}'::jsonb, 'reconciled', 'present', 'confirmed_complete', 'present', '{"verified":true}'::jsonb);
select * from public.confirm_variation_listing_revision('${g1}'::uuid, 2::bigint, 3::bigint);
select assert_true((select last_confirmed_revision = 3 and desired_revision = 3 from public.variation_listing_groups where group_id = '${g1}'), 'fully resolved revision 3 confirms after real checkpoint');
`;

const rollbackAssertions = `
select assert_true(to_regprocedure('public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)') is null, 'rollback removed capture RPC');
select assert_true(to_regprocedure('public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)') is null, 'rollback removed append RPC');
select assert_true(to_regprocedure('public.confirm_variation_listing_revision(uuid, bigint, bigint)') is null, 'rollback removed confirm RPC');
select assert_true(to_regclass('public.variation_listing_groups') is not null, 'rollback preserved groups');
select assert_true(to_regclass('public.variation_listing_variations') is not null, 'rollback preserved variations');
select assert_true(to_regclass('public.variation_listing_copies') is not null, 'rollback preserved copies');
select assert_true(to_regclass('public.variation_listing_intake_sessions') is not null, 'rollback preserved intake sessions');
select assert_true(to_regclass('public.variation_listing_revisions') is not null, 'rollback preserved revisions');
select assert_true(to_regprocedure('public.validate_variation_listing_group_guarded_update()') is not null, 'rollback preserved group guard');
select assert_true(to_regprocedure('public.validate_variation_listing_variation_aggregate_write()') is not null, 'rollback preserved variation guard');
select assert_true(to_regprocedure('public.validate_variation_listing_copy_aggregate_write()') is not null, 'rollback preserved copy guard');
select assert_true(to_regprocedure('public.prevent_variation_listing_operation_attempt_mutation()') is not null, 'rollback preserved append-only trigger');
select assert_true((select count(*) from pg_constraint where conname = 'variation_listing_groups_revision_watermark_check') = 1, 'rollback preserved watermark constraint');
select assert_true((select count(*) from pg_constraint where conname = 'variation_listing_operation_attempts_operation_attempt_checkpoint_key') = 1, 'rollback preserved checkpoint uniqueness');
select assert_true((select count(*) >= 1 from public.variation_listing_groups), 'rollback preserved seeded group data');
select assert_true((select count(*) >= 1 from public.variation_listing_variations), 'rollback preserved seeded variation data');
select assert_true((select count(*) >= 1 from public.variation_listing_copies), 'rollback preserved seeded copy data');
select assert_true((select count(*) >= 3 from public.variation_listing_revisions), 'rollback preserved journal revision data');
select assert_true((select count(*) >= 8 from public.variation_listing_operation_attempts), 'rollback preserved journal attempt data');
select assert_true((select desired_revision = 3 and last_confirmed_revision = 3 from public.variation_listing_groups where group_id = '11111111-1111-4111-8111-111111111111'), 'rollback preserved group watermark data');
select assert_true(has_table_privilege('service_role', 'public.variation_listing_operations', 'UPDATE'), 'rollback restored historical projection grant');
select assert_true(has_table_privilege('service_role', 'public.variation_listing_revisions', 'INSERT'), 'rollback restored revision insert grant');
select assert_true(has_table_privilege('service_role', 'public.variation_listing_operations', 'INSERT'), 'rollback restored operation insert grant');
select assert_true(has_table_privilege('service_role', 'public.variation_listing_operation_attempts', 'INSERT'), 'rollback restored attempt insert grant');
select assert_true((select definition from pg_views where schemaname = 'public' and viewname = 'sentinel_shared_view') like '%yp2.7b-sentinel%', 'rollback preserved shared view');
select assert_true(to_regprocedure('public.set_row_updated_at()') is not null, 'rollback preserved shared helper');
`;

const aclRemediationPostAssertions = `
select assert_true(not has_function_privilege('anon', 'public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)', 'execute'), 'anon cannot execute capture after ACL remediation');
select assert_true(not has_function_privilege('anon', 'public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)', 'execute'), 'anon cannot execute append after ACL remediation');
select assert_true(not has_function_privilege('anon', 'public.confirm_variation_listing_revision(uuid, bigint, bigint)', 'execute'), 'anon cannot execute confirm after ACL remediation');
select assert_true(not has_function_privilege('authenticated', 'public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)', 'execute'), 'authenticated cannot execute capture after ACL remediation');
select assert_true(not has_function_privilege('authenticated', 'public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)', 'execute'), 'authenticated cannot execute append after ACL remediation');
select assert_true(not has_function_privilege('authenticated', 'public.confirm_variation_listing_revision(uuid, bigint, bigint)', 'execute'), 'authenticated cannot execute confirm after ACL remediation');
select assert_true(has_function_privilege('service_role', 'public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)', 'execute'), 'service_role can execute capture after ACL remediation');
select assert_true(has_function_privilege('service_role', 'public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)', 'execute'), 'service_role can execute append after ACL remediation');
select assert_true(has_function_privilege('service_role', 'public.confirm_variation_listing_revision(uuid, bigint, bigint)', 'execute'), 'service_role can execute confirm after ACL remediation');
select assert_true(not has_function_privilege('public', 'public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)', 'execute'), 'PUBLIC cannot execute capture after ACL remediation');
select assert_true(not has_function_privilege('public', 'public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)', 'execute'), 'PUBLIC cannot execute append after ACL remediation');
select assert_true(not has_function_privilege('public', 'public.confirm_variation_listing_revision(uuid, bigint, bigint)', 'execute'), 'PUBLIC cannot execute confirm after ACL remediation');
select assert_true((select count(*) from pg_proc where oid in (to_regprocedure('public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)'), to_regprocedure('public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)'), to_regprocedure('public.confirm_variation_listing_revision(uuid, bigint, bigint)'))) = 3, 'ACL remediation preserves exact RPC signatures');
select assert_true((select bool_and(prosecdef) from pg_proc where oid in (to_regprocedure('public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)'), to_regprocedure('public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)'), to_regprocedure('public.confirm_variation_listing_revision(uuid, bigint, bigint)'))) is true, 'ACL remediation preserves SECURITY DEFINER');
select assert_true((select bool_and(proconfig @> array['search_path=pg_catalog, public, pg_temp']) from pg_proc where oid in (to_regprocedure('public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)'), to_regprocedure('public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)'), to_regprocedure('public.confirm_variation_listing_revision(uuid, bigint, bigint)'))) is true, 'ACL remediation preserves pinned search_path');
select assert_true(not has_table_privilege('service_role', 'public.variation_listing_revisions', 'INSERT'), 'ACL remediation preserves revision INSERT revoke');
select assert_true(not has_table_privilege('service_role', 'public.variation_listing_operations', 'INSERT'), 'ACL remediation preserves operation INSERT revoke');
select assert_true(not has_table_privilege('service_role', 'public.variation_listing_operations', 'UPDATE'), 'ACL remediation preserves operation UPDATE revoke');
select assert_true(not has_table_privilege('service_role', 'public.variation_listing_operation_attempts', 'INSERT'), 'ACL remediation preserves attempt INSERT revoke');
select assert_true(has_table_privilege('service_role', 'public.variation_listing_revisions', 'SELECT'), 'ACL remediation preserves revision SELECT');
select assert_true(has_table_privilege('service_role', 'public.variation_listing_operations', 'SELECT'), 'ACL remediation preserves operation SELECT');
select assert_true(has_table_privilege('service_role', 'public.variation_listing_operation_attempts', 'SELECT'), 'ACL remediation preserves attempt SELECT');
select assert_true((select count(*) from pg_class where relname like 'variation_listing_%' and relkind = 'r') = 7, 'ACL remediation adds no table');
select assert_true((select count(*) from pg_views where schemaname = 'public') = 1, 'ACL remediation adds no view');
select assert_true((select count(*) from pg_policies where schemaname = 'public') = 0, 'ACL remediation adds no policy');
select assert_true((select bool_and(relrowsecurity) from pg_class where relname like 'variation_listing_%' and relkind = 'r') is true, 'ACL remediation preserves table RLS');
select assert_true(to_regprocedure('public.validate_variation_listing_group_guarded_update()') is not null, 'ACL remediation preserves YP2.4 group guard');
select assert_true(to_regprocedure('public.validate_variation_listing_variation_aggregate_write()') is not null, 'ACL remediation preserves YP2.4 variation guard');
select assert_true(to_regprocedure('public.validate_variation_listing_copy_aggregate_write()') is not null, 'ACL remediation preserves YP2.4 copy guard');
select assert_true(to_regprocedure('public.prevent_variation_listing_operation_attempt_mutation()') is not null, 'ACL remediation preserves YP2.5 append-only trigger');
select assert_true((select count(*) from pg_constraint where conname = 'variation_listing_groups_revision_watermark_check') = 1, 'ACL remediation preserves YP2.4 watermark constraint');
select assert_true((select count(*) from pg_constraint where conname = 'variation_listing_operation_attempts_operation_attempt_checkpoint_key') = 1, 'ACL remediation preserves YP2.5 checkpoint uniqueness');
select assert_true((select definition from pg_views where schemaname = 'public' and viewname = 'sentinel_shared_view') like '%yp2.7b-sentinel%', 'ACL remediation preserves shared view');
select assert_true(to_regprocedure('public.set_row_updated_at()') is not null, 'ACL remediation preserves shared updated-at helper');
`;

const aclRemediationRollbackAssertions = `
select assert_true(has_function_privilege('anon', 'public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)', 'execute'), 'rollback restores anon capture execute');
select assert_true(has_function_privilege('anon', 'public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)', 'execute'), 'rollback restores anon append execute');
select assert_true(has_function_privilege('anon', 'public.confirm_variation_listing_revision(uuid, bigint, bigint)', 'execute'), 'rollback restores anon confirm execute');
select assert_true(has_function_privilege('authenticated', 'public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)', 'execute'), 'rollback restores authenticated capture execute');
select assert_true(has_function_privilege('authenticated', 'public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)', 'execute'), 'rollback restores authenticated append execute');
select assert_true(has_function_privilege('authenticated', 'public.confirm_variation_listing_revision(uuid, bigint, bigint)', 'execute'), 'rollback restores authenticated confirm execute');
select assert_true(has_function_privilege('service_role', 'public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)', 'execute'), 'rollback preserves service_role capture execute');
select assert_true(has_function_privilege('service_role', 'public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)', 'execute'), 'rollback preserves service_role append execute');
select assert_true(has_function_privilege('service_role', 'public.confirm_variation_listing_revision(uuid, bigint, bigint)', 'execute'), 'rollback preserves service_role confirm execute');
select assert_true(not has_function_privilege('public', 'public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)', 'execute'), 'rollback preserves PUBLIC capture revoke');
select assert_true(not has_function_privilege('public', 'public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)', 'execute'), 'rollback preserves PUBLIC append revoke');
select assert_true(not has_function_privilege('public', 'public.confirm_variation_listing_revision(uuid, bigint, bigint)', 'execute'), 'rollback preserves PUBLIC confirm revoke');
select assert_true(not has_table_privilege('service_role', 'public.variation_listing_revisions', 'INSERT'), 'rollback preserves revision INSERT revoke');
select assert_true(not has_table_privilege('service_role', 'public.variation_listing_operations', 'INSERT'), 'rollback preserves operation INSERT revoke');
select assert_true(not has_table_privilege('service_role', 'public.variation_listing_operations', 'UPDATE'), 'rollback preserves operation UPDATE revoke');
select assert_true(not has_table_privilege('service_role', 'public.variation_listing_operation_attempts', 'INSERT'), 'rollback preserves attempt INSERT revoke');
select assert_true((select count(*) from pg_class where relname like 'variation_listing_%' and relkind = 'r') = 7, 'rollback adds no table');
select assert_true((select count(*) from pg_views where schemaname = 'public') = 1, 'rollback adds no view');
select assert_true((select count(*) from pg_policies where schemaname = 'public') = 0, 'rollback adds no policy');
select assert_true(to_regprocedure('public.set_row_updated_at()') is not null, 'rollback preserves shared updated-at helper');
`;

async function main() {
  let started = false;
  try {
    await docker([
      'run',
      '--detach',
      '--rm',
      '--name',
      name,
      '-e',
      `POSTGRES_PASSWORD=${password}`,
      'postgres:17-alpine',
    ]);
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
    const journalMigration = await readFile(journalMigrationPath, 'utf8');
    const rpcMigration = await readFile(rpcMigrationPath, 'utf8');
    const rpcRollback = await readFile(rpcRollbackPath, 'utf8');
    const aclRemediationMigration = await readFile(aclRemediationMigrationPath, 'utf8');
    const aclRemediationRollback = await readFile(aclRemediationRollbackPath, 'utf8');

    await psql('postgres', bootstrap + migration + journalMigration + rpcMigration + assertions);

    // Reproduce the hosted default ACL condition, then apply and verify the
    // narrow remediation. The baseline proves that only ACLs change.
    await psql(
      'postgres',
      `create temporary table rpc_acl_baseline as
select p.oid as function_oid,
       pg_get_function_identity_arguments(p.oid) as identity_arguments,
       pg_get_functiondef(p.oid) as definition,
       p.prosecdef,
       p.proconfig
from pg_proc p
join (values
  (to_regprocedure('public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)')::oid),
  (to_regprocedure('public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)')::oid),
  (to_regprocedure('public.confirm_variation_listing_revision(uuid, bigint, bigint)')::oid)
) as target(function_oid) on target.function_oid = p.oid;
select assert_true((select count(*) = 3 from rpc_acl_baseline), 'ACL baseline captured all three RPCs');

grant execute on function public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.confirm_variation_listing_revision(uuid, bigint, bigint) to anon, authenticated;
select assert_true(has_function_privilege('anon', 'public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)', 'execute'), 'simulated anon capture execute grant exists');
select assert_true(has_function_privilege('anon', 'public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)', 'execute'), 'simulated anon append execute grant exists');
select assert_true(has_function_privilege('anon', 'public.confirm_variation_listing_revision(uuid, bigint, bigint)', 'execute'), 'simulated anon confirm execute grant exists');
select assert_true(has_function_privilege('authenticated', 'public.capture_variation_listing_revision(uuid, uuid, bigint, integer, text, jsonb, jsonb)', 'execute'), 'simulated authenticated capture execute grant exists');
select assert_true(has_function_privilege('authenticated', 'public.append_variation_listing_journal_checkpoint(uuid, uuid, integer, integer, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb)', 'execute'), 'simulated authenticated append execute grant exists');
select assert_true(has_function_privilege('authenticated', 'public.confirm_variation_listing_revision(uuid, bigint, bigint)', 'execute'), 'simulated authenticated confirm execute grant exists');

${aclRemediationMigration}
select assert_true((select count(*) from rpc_acl_baseline b
  where pg_get_functiondef(b.function_oid) = b.definition
    and pg_get_function_identity_arguments(b.function_oid) is not distinct from b.identity_arguments
    and (select p.prosecdef from pg_proc p where p.oid = b.function_oid) is not distinct from b.prosecdef
    and (select p.proconfig from pg_proc p where p.oid = b.function_oid) is not distinct from b.proconfig) = 3, 'ACL remediation preserves RPC definitions and security posture');
${aclRemediationPostAssertions}`
    );

    // Rollback must restore only the simulated browser-role grants; reapply
    // the remediation before continuing with the existing RPC rollback proof.
    await psql('postgres', aclRemediationRollback + aclRemediationRollbackAssertions);
    await psql('postgres', aclRemediationMigration + aclRemediationPostAssertions);

    // Deterministic lock-order proof. A holder keeps the owning group locked;
    // its pg_sleep query is polled as an explicit acquisition barrier. Append
    // starts first, confirmation starts second, and pg_stat_activity is polled
    // until both are waiting on the same group-row lock before release. This
    // proves confirmation observes the committed started checkpoint without
    // relying on sleep-duration timing.
    await psql(
      'postgres',
      `${aggregateTransaction(
        gRace,
        0,
        `insert into public.variation_listing_groups (
  group_id, group_key, sku_category_code, sku_bucket_token, category_id, marketplace_id,
  merchant_location_key, fulfillment_policy_id, payment_policy_id, return_policy_id,
  condition_id, condition_token
) values ('${gRace}', 'VL-G-44444444444444448444444444444444', 'BSKBL', 'BinderRace', '183454', 'EBAY_US', 'loc', 'fulfill', 'pay', 'return', '1000', 'NEAR_MINT_OR_BETTER');
update public.variation_listing_groups set desired_revision = 1 where group_id = '${gRace}';`
      )}
select * from public.capture_variation_listing_revision(
  '${gRace}'::uuid, '${revRace}'::uuid, 1::bigint, 1, repeat('a', 64), '{}'::jsonb,
  jsonb_build_array(jsonb_build_object(
    'operation_id', '${opRace}', 'sequence_no', 1, 'operation_key', 'race',
    'operation_kind', 'media_ingest', 'target_ref', 'race', 'intent_version', 1,
    'intent_digest', repeat('b', 64), 'intent', '{}'::jsonb
  ))
);`
    );

    const holder = psql(
      'postgres',
      `set application_name = 'yp27b-holder';
begin;
select group_id from public.variation_listing_groups where group_id = '${gRace}' for update;
select pg_sleep(2);
commit;`
    );
    await waitForDatabaseBarrier(
      'postgres',
      "select case when exists (select 1 from pg_stat_activity where application_name = 'yp27b-holder' and state = 'active' and query like '%pg_sleep(2)%') then 'ready' else 'waiting' end as status;",
      'holder acquired group lock'
    );
    const appendRace = psql(
      'postgres',
      `set application_name = 'yp27b-append';
select * from public.append_variation_listing_journal_checkpoint(
  '${opRace}'::uuid, '${ckptRace}'::uuid, 1, 1, 'started', 1,
  null, null, null, null, null, null, null, 'started', null, null
);`
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const confirmRace = psqlExpectFailure(
      'postgres',
      `set application_name = 'yp27b-confirm';
select * from public.confirm_variation_listing_revision('${gRace}'::uuid, null::bigint, 1::bigint);`
    );
    await waitForDatabaseBarrier(
      'postgres',
      "select case when (select count(*) from pg_stat_activity where application_name in ('yp27b-append', 'yp27b-confirm') and wait_event_type = 'Lock') = 2 then 'ready' else 'waiting' end as status;",
      'append and confirm both waiting on group lock'
    );
    const [holderResult, appendResult, confirmError] = await Promise.all([
      holder,
      appendRace,
      confirmRace,
    ]);
    if (
      !confirmError ||
      !/not resolved|latest checkpoint|checkpoint history/i.test(confirmError.message)
    ) {
      throw new Error(
        `unexpected concurrent confirmation result: ${confirmError?.message ?? 'none'}`
      );
    }
    await psql(
      'postgres',
      `select assert_true((select current_state = 'started' from public.variation_listing_operations where operation_id = '${opRace}'), 'concurrent append committed started state');
select assert_true((select count(*) = 1 from public.variation_listing_operation_attempts where operation_id = '${opRace}'), 'concurrent append committed one checkpoint');
select assert_true((select last_confirmed_revision is null from public.variation_listing_groups where group_id = '${gRace}'), 'concurrent confirmation did not advance watermark');`
    );

    // The RPC rollback must drop only the RPC functions and preserve all
    // YP2.4/YP2.5 objects and data.
    await psql('postgres', rpcRollback);
    await psql('postgres', rollbackAssertions);
    await psql('postgres', rpcMigration);
    await psql(
      'postgres',
      "select assert_true(to_regprocedure('public.confirm_variation_listing_revision(uuid, bigint, bigint)') is not null, 'RPC reapply succeeds');\nselect assert_true(not has_table_privilege('service_role', 'public.variation_listing_operations', 'UPDATE'), 'reapply revokes direct projection grant again');\nselect assert_true(to_regclass('public.variation_listing_variations') is not null, 'reapply preserves variations');\nselect assert_true(to_regclass('public.variation_listing_copies') is not null, 'reapply preserves copies');\nselect assert_true(to_regprocedure('public.validate_variation_listing_group_guarded_update()') is not null, 'reapply preserves group guard');\nselect assert_true((select count(*) >= 1 from public.variation_listing_groups), 'reapply preserves group data');\nselect assert_true((select count(*) >= 1 from public.variation_listing_variations), 'reapply preserves variation data');\nselect assert_true((select count(*) >= 1 from public.variation_listing_copies), 'reapply preserves copy data');"
    );

    console.log('YP2.7c variation-listing RPC ACL remediation validation: passed');
  } finally {
    if (started) {
      try {
        await docker(['rm', '--force', name]);
      } catch (error) {
        console.error(`cleanup failed: ${error.message}`);
      }
    }
  }
}

main().catch((error) => {
  console.error(`YP2.7c variation-listing RPC ACL remediation validation: failed\n${error.message}`);
  process.exitCode = 1;
});

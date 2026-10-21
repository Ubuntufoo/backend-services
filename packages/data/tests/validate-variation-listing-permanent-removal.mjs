#!/usr/bin/env node
/* Disposable PostgreSQL behavior validation. Never connects to hosted Supabase. */
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const name = 'codex-removal-' + process.pid + '-' + randomBytes(4).toString('hex');
const migrationFiles = [
  'supabase/migrations/20260828150000_create_variation_listing_persistence.sql',
  'supabase/migrations/20260829150000_create_variation_listing_publishing_journal.sql',
  'supabase/migrations/20260830014853_create_variation_listing_rpc_seam.sql',
  'supabase/migrations/20260831142123_revoke_variation_listing_rpc_execute.sql',
  'supabase/migrations/20260831170000_simplify_variation_listing_persistence.sql',
  'supabase/migrations/20260831190000_correct_variation_listing_checkpoint_service_role_acl.sql',
  'supabase/migrations/20260901150000_apply_variation_listing_group_review_draft.sql',
  'supabase/migrations/20260901151300_update_variation_listing_manual_price.sql',
  'supabase/migrations/20260901160000_add_variation_listing_active_staging_and_bounded_retry.sql',
  'supabase/migrations/20260901163000_activate_variation_listing_on_confirmation.sql',
  'supabase/migrations/20260902010000_advance_variation_listing_cleanup_lifecycle.sql',
  'supabase/migrations/20260902140000_mark_variation_listing_publish_ready.sql',
  'supabase/migrations/20260903020000_freeze_variation_listing_copy_condition.sql',
  'supabase/migrations/20260903201000_update_variation_listing_selector_value.sql',
  'supabase/migrations/20261005153617_add_variation_listing_quantity_adjustment.sql',
  'supabase/migrations/20261021181500_stage_variation_listing_permanent_removal.sql',
];
const command = (file, args, input = '') => new Promise((resolve, reject) => {
  const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => code === 0
    ? resolve(stdout)
    : reject(new Error(file + ' ' + args.join(' ') + ' failed\n' + stderr + stdout)));
  child.stdin.end(input);
});
const docker = (args, input) => command('docker', args, input);
const psql = (sql, role = 'postgres') => docker(
  ['exec', '-i', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', 'postgres'],
  role === 'postgres' ? sql : 'set role ' + role + ';\n' + sql,
);
const sqlLiteral = value => value === null ? 'null' : "'" + String(value).replaceAll("'", "''") + "'";
const assert = (condition, message) => { if (!condition) throw new Error('assertion failed: ' + message); };
const expectFailure = async (sql, message, label, role = 'service_role') => {
  try {
    await psql(sql, role);
    throw new Error('expected failure: ' + label);
  } catch (error) {
    if (error.message.startsWith('expected failure:')) throw error;
    if (!error.message.includes(message)) throw new Error(label + ': expected ' + message + ', got ' + error.message);
  }
};

const groups = {
  clean: '11111111-1111-4111-8111-111111111111',
  unresolved: '22222222-2222-4222-8222-222222222222',
  frozen: '33333333-3333-4333-8333-333333333333',
  two: '44444444-4444-4444-8444-444444444444',
};
const vars = {
  clean: ['11111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111102', '11111111-1111-4111-8111-111111111103'],
  unresolved: ['22222222-2222-4222-8222-222222222201', '22222222-2222-4222-8222-222222222202', '22222222-2222-4222-8222-222222222203'],
  frozen: ['33333333-3333-4333-8333-333333333301', '33333333-3333-4333-8333-333333333302', '33333333-3333-4333-8333-333333333303'],
  two: ['44444444-4444-4444-8444-444444444401', '44444444-4444-4444-8444-444444444402'],
};
const groupKey = id => 'VL-G-' + id.replaceAll('-', '').toUpperCase();
const baseGroup = (id, bucket, desired, confirmed) =>
  'insert into public.variation_listing_groups(group_id,group_key,sku_category_code,sku_bucket_token,category_id,marketplace_id,merchant_location_key,fulfillment_policy_id,return_policy_id,condition_id,payment_policy_id,condition_token,lifecycle_state,desired_revision,last_confirmed_revision) values (' +
  [id, groupKey(id), 'OTHER', bucket, '261328', 'EBAY_US', 'loc', 'fulfill', 'return', '1000', 'pay', 'VERY_GOOD', 'active', desired, confirmed].map(sqlLiteral).join(',') + ');';
const seedGroup = (id, bucket, ids, desired = 1, confirmed = 1) => {
  const statements = [baseGroup(id, bucket, desired, confirmed)];
  ids.forEach((variationId, index) => {
    const serial = index + 1;
    const sku = 'OTHER-' + bucket + '-' + String(serial).padStart(6, '0');
    const copyId = variationId.slice(0, -1) + String(index + 4);
    statements.push('insert into public.variation_listing_variations(variation_id,group_id,inventory_serial,sku,position,selector_value,price_amount,variation_metadata) values (' +
      [variationId, id, serial, sku, index, 'Card ' + serial, 0.99, '{}'].map(sqlLiteral).join(',') + '::jsonb);');
    statements.push('insert into public.variation_listing_copies(copy_id,variation_id,condition_token,front_r2_key,back_r2_key,capture_source_key,capture_pair_id,capture_front_source_ref,capture_back_source_ref,capture_started_at) values (' +
      [copyId, variationId, 'VERY_GOOD', 'variation-listing/' + bucket + '/front-' + serial, 'variation-listing/' + bucket + '/back-' + serial, bucket + '-source-' + serial, copyId, bucket + '-front-' + serial, bucket + '-back-' + serial, '2026-01-01T00:00:00Z'].map(sqlLiteral).join(',') + ');');
    statements.push('update public.variation_listing_variations set representative_copy_id=' + sqlLiteral(copyId) + '::uuid where variation_id=' + sqlLiteral(variationId) + '::uuid;');
  });
  return statements.join('\n');
};
const aggregate = (groupId, omitVariation = null) =>
  "jsonb_build_object('group',(select to_jsonb(g) from public.variation_listing_groups g where g.group_id=" + sqlLiteral(groupId) + "::uuid),'variations',(select coalesce(jsonb_agg(to_jsonb(v) order by v.position),'[]'::jsonb) from public.variation_listing_variations v where v.group_id=" + sqlLiteral(groupId) + "::uuid" + (omitVariation ? ' and v.variation_id <> ' + sqlLiteral(omitVariation) + '::uuid' : '') + "),'copies',(select coalesce(jsonb_agg(to_jsonb(c) order by c.copy_id),'[]'::jsonb) from public.variation_listing_copies c join public.variation_listing_variations v on v.variation_id=c.variation_id where v.group_id=" + sqlLiteral(groupId) + "::uuid" + (omitVariation ? ' and v.variation_id <> ' + sqlLiteral(omitVariation) + '::uuid' : '') + '))';
const plan = groupId => "jsonb_build_array(jsonb_build_object('sequence_no',1,'operation_key','publish','operation_kind','group_publish','target_ref'," + sqlLiteral(groupId) + ",'intent_version',1,'intent_digest',repeat('a',64),'intent','{}'::jsonb))";
const revision = (groupId, revisionId, captured, version, omitParentVariation = null) => {
  const root = aggregate(groupId);
  const parent = aggregate(groupId, omitParentVariation);
  const snapshot = version === 3
    ? "jsonb_build_object('aggregate'," + root + ",'confirmed',jsonb_build_object('aggregate'," + parent + '))'
    : "jsonb_build_object('aggregate'," + root + ')';
  return 'insert into public.variation_listing_revisions(revision_id,group_id,captured_desired_revision,snapshot_version,snapshot_digest,snapshot,operation_count,operation_plan) values (' +
    [revisionId, groupId, captured, version, 'b'.repeat(64)].map(sqlLiteral).join(',') + ',' + snapshot + ',1,' + plan(groupId) + ');';
};
const checkpoint = (revisionId, checkpointId, state = 'confirmed_complete') =>
  'insert into public.variation_listing_publishing_checkpoints(checkpoint_id,revision_id,operation_key,attempt_number,checkpoint_number,state,observed_remote_state,evidence) values (' +
  [checkpointId, revisionId, 'publish', 1, 1, state, state === 'started' ? null : 'present', state === 'started' ? '{"pending":true}' : '{"source":"validator"}'].map(sqlLiteral).join(',') + '::jsonb);';
const rpcStage = (groupId, variationId, expected, remove) =>
  'select * from public.stage_variation_listing_permanent_removal(' + [groupId, variationId, expected, remove].map((v, i) => i < 2 ? sqlLiteral(v) + '::uuid' : String(v)).join(',') + ');';

async function main() {
  const migration = await readFile(root + '/supabase/migrations/20261021181500_stage_variation_listing_permanent_removal.sql', 'utf8');
  assert(migration.includes('pending_removal_at timestamptz'), 'dedicated pending-removal marker');
  assert(migration.includes('order by s.capture_source_key'), 'deterministic session lock order');
  assert(migration.includes('for revision_row in'), 'all-revision checkpoint scan');
  assert(migration.includes('before insert on public.variation_listing_revisions'), 'revision mix guard');
  assert(migration.includes('before insert on public.variation_listing_publishing_checkpoints'), 'checkpoint mix guard');
  assert(migration.includes('from public.variation_listing_groups g') && migration.includes('for update;'), 'pending writes serialize on group row');
  await docker(['run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_PASSWORD=codex-removal-postgres', 'postgres:17-alpine']);
  try {
    for (let i = 0; i < 120; i += 1) {
      try { await psql('select 1'); break; } catch { if (i === 119) throw new Error('postgres readiness timeout'); await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    const migrations = (await Promise.all(migrationFiles.map(file => readFile(root + '/' + file, 'utf8')))).join('\n');
    await psql("create role anon; create role authenticated; create role service_role; alter role service_role bypassrls; create function public.set_row_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;" + migrations);

    const cleanRev = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const unresolvedRev1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
    const unresolvedRev2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
    const frozenRev1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
    const frozenRev2 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
    const twoRev = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
    const seed = [
      seedGroup(groups.clean, 'CleanA', vars.clean),
      seedGroup(groups.unresolved, 'UnresolvedB', vars.unresolved, 2, 2),
      seedGroup(groups.frozen, 'FrozenC', vars.frozen),
      seedGroup(groups.two, 'TwoD', vars.two),
      revision(groups.clean, cleanRev, 1, 3, vars.clean[2]),
      checkpoint(cleanRev, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
      revision(groups.unresolved, unresolvedRev1, 1, 1),
      checkpoint(unresolvedRev1, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', 'started'),
      revision(groups.unresolved, unresolvedRev2, 2, 1),
      checkpoint(unresolvedRev2, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4'),
      revision(groups.frozen, frozenRev1, 1, 1),
      checkpoint(frozenRev1, 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'),
      revision(groups.two, twoRev, 1, 1),
      checkpoint(twoRev, 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2'),
    ].join('\n');
    await psql('begin;\n' + seed + '\ncommit;');
    await psql(rpcStage(groups.clean, vars.clean[2], 1, true), 'service_role');
    await psql("do $$ begin if (select desired_revision from public.variation_listing_groups where group_id='" + groups.clean + "') <> 2 or (select pending_removal_at is null from public.variation_listing_variations where variation_id='" + vars.clean[2] + "') then raise exception 'stage did not advance marker/revision'; end if; end $$;");
    await expectFailure('select * from public.update_variation_listing_quantity_adjustment(' + [groups.clean, vars.clean[0], 2, 1].map((v, i) => i < 2 ? sqlLiteral(v) + '::uuid' : String(v)).join(',') + ');', 'cancel staged permanent removal', 'quantity edit blocked while staged');
    await expectFailure('select * from public.configure_variation_listing_intake(' + [sqlLiteral('blocked-session'), sqlLiteral('new_variation'), sqlLiteral(groups.clean) + '::uuid', 'null', '0.99', 'null'].join(',') + ');', 'cancel staged permanent removal', 'intake edit blocked while staged');
    await expectFailure(rpcStage(groups.clean, vars.clean[2], 1, false), 'CAS mismatch', 'stale cancel CAS rejected');
    await psql(rpcStage(groups.clean, vars.clean[2], 2, false), 'service_role');

    await expectFailure(rpcStage(groups.unresolved, vars.unresolved[0], 2, true), 'complete confirmed revision', 'older unresolved revision blocks stage');
    await psql('select * from public.reserve_variation_listing_action_revision(' + [groups.frozen, 1].map((v, i) => i === 0 ? sqlLiteral(v) + '::uuid' : String(v)).join(',') + ');', 'service_role');
    await psql('select * from public.capture_variation_listing_revision(' + [groups.frozen, frozenRev2, 2, 1, 'c'.repeat(64)].map((v, i) => i < 2 ? sqlLiteral(v) + '::uuid' : i === 4 ? sqlLiteral(v) : String(v)).join(',') + ',' + aggregate(groups.frozen) + ',' + plan(groups.frozen) + ');', 'service_role');
    await expectFailure(rpcStage(groups.frozen, vars.frozen[0], 2, true), 'newer frozen revisions', 'newer frozen revision blocks stage');
    await expectFailure(rpcStage(groups.two, vars.two[0], 1, true), 'at least two surviving', 'two-survivor floor blocks stage');
    await expectFailure(rpcStage(groups.clean, vars.unresolved[0], 3, true), 'target variation not found', 'cross-group ownership rejected');

    const privileges = await psql("select has_function_privilege('service_role','public.stage_variation_listing_permanent_removal(uuid,uuid,bigint,boolean)','execute') as service, has_function_privilege('public','public.stage_variation_listing_permanent_removal(uuid,uuid,bigint,boolean)','execute') as public, has_function_privilege('anon','public.stage_variation_listing_permanent_removal(uuid,uuid,bigint,boolean)','execute') as anon, has_function_privilege('authenticated','public.stage_variation_listing_permanent_removal(uuid,uuid,bigint,boolean)','execute') as authenticated;");
    assert(/t\s+\|\s+f\s+\|\s+f\s+\|\s+f/.test(privileges), 'stage/cancel EXECUTE is service_role only');
    const triggerPrivileges = await psql("select has_function_privilege('service_role','public.prevent_variation_listing_pending_removal_mix()','execute') as service, has_function_privilege('public','public.prevent_variation_listing_pending_removal_mix()','execute') as public, has_function_privilege('anon','public.prevent_variation_listing_pending_removal_mix()','execute') as anon, has_function_privilege('authenticated','public.prevent_variation_listing_pending_removal_mix()','execute') as authenticated;");
    assert(/f\s+\|\s+f\s+\|\s+f\s+\|\s+f/.test(triggerPrivileges), 'pending-removal trigger EXECUTE is revoked for all roles');

    await psql("drop trigger variation_listing_groups_block_pending_removal_mix on public.variation_listing_groups; drop trigger variation_listing_variations_block_pending_removal_mix on public.variation_listing_variations; drop trigger variation_listing_intake_sessions_block_pending_removal_mix on public.variation_listing_intake_sessions; drop trigger variation_listing_revisions_block_pending_removal_mix on public.variation_listing_revisions; drop trigger variation_listing_checkpoints_block_pending_removal_mix on public.variation_listing_publishing_checkpoints; drop function public.prevent_variation_listing_pending_removal_mix(); drop function public.stage_variation_listing_permanent_removal(uuid,uuid,bigint,boolean); drop index public.variation_listing_one_pending_removal_per_group_idx; alter table public.variation_listing_variations drop column pending_removal_at;");
    // Re-run the c1 DDL inside a savepoint and roll it back. This proves the
    // marker/function/index are transactional and absent before a committed
    // application of the migration.
    const rollbackProbe = migration.replace(/^begin;\s*/, '').replace(/\s*commit;\s*$/, '');
    await psql('begin; savepoint c1_probe;\n' + rollbackProbe + '\nrollback to savepoint c1_probe; commit;');
    const rollback = await psql("select (select count(*) from information_schema.columns where table_schema='public' and table_name='variation_listing_variations' and column_name='pending_removal_at') as marker_columns, (select count(*) from information_schema.routines where routine_schema='public' and routine_name in ('prevent_variation_listing_pending_removal_mix','stage_variation_listing_permanent_removal')) as routines;");
    assert(/\n\s*0\s*\|\s*0\s*\n/.test(rollback), 'rolled-back c1 DDL leaves no marker or routines');
    console.log('permanent-removal migration disposable validation: passed');
  } finally {
    await docker(['rm', '-f', name]).catch(() => {});
  }
}

async function asService(sql) { return psql(sql, 'service_role'); }
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

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
  'supabase/migrations/20261021193000_execute_variation_listing_permanent_removal.sql',
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
  c2: '55555555-5555-4555-8555-555555555555',
};
const vars = {
  clean: ['11111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111102', '11111111-1111-4111-8111-111111111103'],
  unresolved: ['22222222-2222-4222-8222-222222222201', '22222222-2222-4222-8222-222222222202', '22222222-2222-4222-8222-222222222203'],
  frozen: ['33333333-3333-4333-8333-333333333301', '33333333-3333-4333-8333-333333333302', '33333333-3333-4333-8333-333333333303'],
  two: ['44444444-4444-4444-8444-444444444401', '44444444-4444-4444-8444-444444444402'],
  c2: ['55555555-5555-4555-8555-555555555501', '55555555-5555-4555-8555-555555555502', '55555555-5555-4555-8555-555555555503'],
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
  const c2Migration = await readFile(root + '/supabase/migrations/20261021193000_execute_variation_listing_permanent_removal.sql', 'utf8');
  assert(/delete\s+from\s+public\.variation_listing_copies/i.test(c2Migration), 'c2 finalizer hard-deletes target copies');
  assert(/delete\s+from\s+public\.variation_listing_variations/i.test(c2Migration), 'c2 finalizer hard-deletes target variation');
  assert(!c2Migration.includes('permanently_removed_at'), 'c2 has no tombstone column');
  assert(!c2Migration.includes('variation_listing_permanent_removal_confirmations'), 'c2 has no duplicate confirmation table');
  assert(c2Migration.includes('variation_listing_copies_c2_hard_delete_guard'), 'c2 copy hard-delete capability guard');
  assert(c2Migration.includes('if row_pending is not true'), 'c2 copy guard leaves non-staged aggregate deletes to c1');
  assert(c2Migration.includes("grant execute on function public.confirm_variation_listing_permanent_removal"), 'c2 finalizer service-role seam');
  assert(c2Migration.includes("p_state = 'retry_exhausted'"), 'c2 bounded unknown terminal state');
  assert(c2Migration.includes("p_state = 'unknown' and exists") && c2Migration.includes("prior.state = 'retry_authorized'"), 'c2 replay cannot end unknown or authorize a second retry');
  await docker(['run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_PASSWORD=codex-removal-postgres', 'postgres:17-alpine']);
  try {
    for (let i = 0; i < 120; i += 1) {
      try { await psql('select 1'); break; } catch { if (i === 119) throw new Error('postgres readiness timeout'); await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    const migrationsBeforeC2 = (await Promise.all(migrationFiles.slice(0, -1).map(file => readFile(root + '/' + file, 'utf8')))).join('\n');
    const c2Body = c2Migration.replace(/^begin;\s*/, '').replace(/\s*commit;\s*$/, '');
    const canonicalFunction = `create function public.variation_listing_recovery_canonical_json(p_value jsonb) returns text language plpgsql immutable strict set search_path = pg_catalog, public, pg_temp as $$ declare v_type text := jsonb_typeof(p_value); v_result text; v_first boolean; v_key text; v_child jsonb; begin if v_type = 'object' then v_result := '{'; v_first := true; for v_key, v_child in select key, value from jsonb_each(p_value) order by key collate "C" loop if not v_first then v_result := v_result || ','; end if; v_result := v_result || public.variation_listing_recovery_canonical_json(to_jsonb(v_key)) || ':' || public.variation_listing_recovery_canonical_json(v_child); v_first := false; end loop; return v_result || '}'; elsif v_type = 'array' then v_result := '['; v_first := true; for v_child in select value from jsonb_array_elements(p_value) loop if not v_first then v_result := v_result || ','; end if; v_result := v_result || public.variation_listing_recovery_canonical_json(v_child); v_first := false; end loop; return v_result || ']'; end if; return p_value::text; end; $$;`;
    await psql("create role anon; create role authenticated; create role service_role; alter role service_role bypassrls; create schema extensions; grant usage on schema extensions to public; create extension pgcrypto; create function extensions.digest(data text, typ text) returns bytea language sql immutable as $$ select public.digest(data, typ); $$; grant execute on function extensions.digest(text,text) to public; create function public.set_row_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;" + canonicalFunction + migrationsBeforeC2);
    await psql(`create temp table c2_rollback_baseline as
      select md5(pg_get_functiondef('public.prevent_variation_listing_pending_removal_mix()'::regprocedure)) as guard_digest,
             md5(pg_get_functiondef('public.stage_variation_listing_permanent_removal(uuid,uuid,bigint,boolean)'::regprocedure)) as stage_digest;
      begin;
      savepoint c2_probe;
      ${c2Body}
      rollback to savepoint c2_probe;
      do $$
      begin
        if to_regclass('public.variation_listing_permanent_removal_confirmations') is not null
           or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'variation_listing_variations' and column_name = 'permanently_removed_at')
           or to_regprocedure('public.prevent_variation_listing_tombstoned_copy_write()') is not null
           or to_regprocedure('public.capture_variation_listing_permanent_removal_revision(uuid,uuid,bigint,text,jsonb,jsonb)') is not null
           or to_regprocedure('public.append_variation_listing_permanent_removal_checkpoint(uuid,text,uuid,integer,integer,text,text,jsonb)') is not null
           or to_regprocedure('public.confirm_variation_listing_permanent_removal(uuid,uuid,bigint,bigint,uuid,text)') is not null
           or to_regprocedure('public.confirm_variation_listing_permanent_removal(uuid,uuid,bigint,bigint,uuid,text,jsonb)') is not null
           or to_regprocedure('public.prevent_variation_listing_c2_copy_hard_delete()') is not null
           or exists (select 1 from pg_trigger where not tgisinternal and tgname in ('variation_listing_copies_block_tombstoned_variation','variation_listing_copies_c2_hard_delete_guard')) then
          raise exception 'rolled-back c2 DDL left additive objects behind';
        end if;
        if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'variation_listing_variations' and column_name = 'pending_removal_at')
           or to_regclass('public.variation_listing_one_pending_removal_per_group_idx') is null
           or to_regprocedure('public.prevent_variation_listing_pending_removal_mix()') is null
           or to_regprocedure('public.stage_variation_listing_permanent_removal(uuid,uuid,bigint,boolean)') is null
           or not exists (select 1 from pg_trigger where not tgisinternal and tgname = 'variation_listing_variations_block_pending_removal_mix')
           or not exists (select 1 from c2_rollback_baseline b where b.guard_digest = md5(pg_get_functiondef('public.prevent_variation_listing_pending_removal_mix()'::regprocedure)) and b.stage_digest = md5(pg_get_functiondef('public.stage_variation_listing_permanent_removal(uuid,uuid,bigint,boolean)'::regprocedure)))
           or not has_function_privilege('service_role', 'public.stage_variation_listing_permanent_removal(uuid,uuid,bigint,boolean)', 'execute') then
          raise exception 'rolled-back c2 DDL changed applied c1 objects';
        end if;
      end $$;
      commit;`);
    await psql(c2Migration);

    const cleanRev = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const unresolvedRev1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
    const unresolvedRev2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
    const frozenRev1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
    const frozenRev2 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
    const twoRev = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
    const c2Rev = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
    const seed = [
      seedGroup(groups.clean, 'CleanA', vars.clean),
      seedGroup(groups.unresolved, 'UnresolvedB', vars.unresolved, 2, 2),
      seedGroup(groups.frozen, 'FrozenC', vars.frozen),
      seedGroup(groups.two, 'TwoD', vars.two),
      seedGroup(groups.c2, 'C2X', vars.c2),
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
      revision(groups.c2, c2Rev, 1, 1),
      checkpoint(c2Rev, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'),
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

    // c2 disposable proof: forged digest/plan rejection, service-role-only
    // seams, exact journal transitions, atomic hard deletion, idempotent
    // absent-row recovery, survivor integrity, and immutable R2-key retention.
    await psql(rpcStage(groups.c2, vars.c2[0], 1, true), 'service_role');
    const c2TargetSku = 'OTHER-C2X-000001';
    const c2SurvivorSkus = ['OTHER-C2X-000002', 'OTHER-C2X-000003'];
    const c2Agg = aggregate(groups.c2, vars.c2[0]);
    const c2Parent = aggregate(groups.c2);
    const c2Quantities = "jsonb_build_object('OTHER-C2X-000001',jsonb_build_object('inventoryItemQuantity',0,'offerQuantity',0,'sellableQuantity',0),'OTHER-C2X-000002',jsonb_build_object('inventoryItemQuantity',1,'offerQuantity',1,'sellableQuantity',1),'OTHER-C2X-000003',jsonb_build_object('inventoryItemQuantity',1,'offerQuantity',1,'sellableQuantity',1))";
    const c2Offers = "jsonb_build_object('OTHER-C2X-000001','offer-target','OTHER-C2X-000002','offer-survivor-1','OTHER-C2X-000003','offer-survivor-2')";
    const c2RemoteQuantities = "jsonb_build_object('OTHER-C2X-000002',jsonb_build_object('inventoryItemQuantity',1,'offerQuantity',1,'sellableQuantity',1),'OTHER-C2X-000003',jsonb_build_object('inventoryItemQuantity',1,'offerQuantity',1,'sellableQuantity',1))";
    const c2RemoteOffers = "jsonb_build_object('OTHER-C2X-000002','offer-survivor-1','OTHER-C2X-000003','offer-survivor-2')";
    const c2ItemPayloads = "jsonb_build_object('OTHER-C2X-000001','{}'::jsonb,'OTHER-C2X-000002','{}'::jsonb,'OTHER-C2X-000003','{}'::jsonb)";
    const c2OfferPayloads = "jsonb_build_object('OTHER-C2X-000001','{}'::jsonb,'OTHER-C2X-000002','{}'::jsonb,'OTHER-C2X-000003','{}'::jsonb)";
    const c2Intent = "jsonb_build_object('groupKey'," + sqlLiteral(groupKey(groups.c2)) + ",'targetSku'," + sqlLiteral(c2TargetSku) + ",'survivorSkus',jsonb_build_array(" + c2SurvivorSkus.map(sqlLiteral).join(',') + "))";
    const c2Meta = "jsonb_build_object('version',1,'groupKey'," + sqlLiteral(groupKey(groups.c2)) + ",'targetVariationId'," + sqlLiteral(vars.c2[0]) + ",'targetSku'," + sqlLiteral(c2TargetSku) + ",'marketplaceId','EBAY_US','survivorSkus',jsonb_build_array(" + c2SurvivorSkus.map(sqlLiteral).join(',') + "),'listingId','listing-c2','offerIdsBySku'," + c2Offers + ",'quantitiesBySku'," + c2Quantities + ",'inventoryItemPayloadsBySku'," + c2ItemPayloads + ",'offerPayloadsBySku'," + c2OfferPayloads + ",'expectedGroupPayload',jsonb_build_object('variantSKUs',jsonb_build_array(" + [c2TargetSku, ...c2SurvivorSkus].map(sqlLiteral).join(',') + ")),'replacementGroupPayload',jsonb_build_object('variantSKUs',jsonb_build_array(" + c2SurvivorSkus.map(sqlLiteral).join(',') + ")))";
    const c2Snapshot = "jsonb_build_object('aggregate'," + c2Agg + ",'confirmed',jsonb_build_object('aggregate'," + c2Parent + ",'remote',jsonb_build_object('listingId','listing-c2','offerIdsBySku'," + c2RemoteOffers + ",'quantitiesBySku'," + c2RemoteQuantities + ")),'permanentRemoval'," + c2Meta + ")";
    const c2Plan = "jsonb_build_array(jsonb_build_object('sequence_no',1,'operation_key','remove-group-membership','operation_kind','permanent_removal_group_membership','target_ref'," + sqlLiteral(groupKey(groups.c2)) + ",'intent_version',1,'intent_digest',encode(extensions.digest(public.variation_listing_recovery_canonical_json(" + c2Intent + "),'sha256'),'hex'),'intent'," + c2Intent + "))";
    const c2CaptureArgs = [groups.c2, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3', 2].map((v, i) => i < 2 ? sqlLiteral(v) + '::uuid' : String(v)).join(',') + ",encode(extensions.digest(public.variation_listing_recovery_canonical_json(" + c2Snapshot + "),'sha256'),'hex')," + c2Snapshot + "," + c2Plan;
    const c2BadDigestArgs = [groups.c2, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3', 2].map((v, i) => i < 2 ? sqlLiteral(v) + '::uuid' : String(v)).join(',') + ",repeat('f',64)," + c2Snapshot + "," + c2Plan;
    await expectFailure('select * from public.capture_variation_listing_permanent_removal_revision(' + c2BadDigestArgs + ');', 'invalid permanent-removal revision arguments', 'forged c2 snapshot digest');
    const c2BadMarketplaceSnapshot = c2Snapshot.replace("'marketplaceId','EBAY_US'", "'marketplaceId','EBAY_GB'");
    await expectFailure('select * from public.capture_variation_listing_permanent_removal_revision(' + [groups.c2, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee8', 2].map((v, i) => i < 2 ? sqlLiteral(v) + '::uuid' : String(v)).join(',') + ",encode(extensions.digest(public.variation_listing_recovery_canonical_json(" + c2BadMarketplaceSnapshot + "),'sha256'),'hex')," + c2BadMarketplaceSnapshot + "," + c2Plan + ');', 'snapshot metadata does not match staged target/survivor projection', 'forged c2 marketplace identity');
    const c2RemoteExtraSnapshot = c2Snapshot.replace(c2RemoteOffers, "jsonb_build_object('OTHER-C2X-000002','offer-survivor-1','OTHER-C2X-000003','offer-survivor-2','FOREIGN-C2X-999999','offer-forged')");
    await expectFailure('select * from public.capture_variation_listing_permanent_removal_revision(' + [groups.c2, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee23', 2].map((v, i) => i < 2 ? sqlLiteral(v) + '::uuid' : String(v)).join(',') + ",encode(extensions.digest(public.variation_listing_recovery_canonical_json(" + c2RemoteExtraSnapshot + "),'sha256'),'hex')," + c2RemoteExtraSnapshot + "," + c2Plan + ');', 'snapshot metadata does not match staged target/survivor projection', 'forged c2 remote foreign key rejected');
    const c2BadAggregateGroupSnapshot = "jsonb_set(" + c2Snapshot + ",'{aggregate,group,group_id}',to_jsonb(" + sqlLiteral(groups.clean) + "::text),false)";
    await expectFailure('select * from public.capture_variation_listing_permanent_removal_revision(' + [groups.c2, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee15', 2].map((v, i) => i < 2 ? sqlLiteral(v) + '::uuid' : String(v)).join(',') + ",encode(extensions.digest(public.variation_listing_recovery_canonical_json(" + c2BadAggregateGroupSnapshot + "),'sha256'),'hex')," + c2BadAggregateGroupSnapshot + "," + c2Plan + ');', 'snapshot variation ownership does not match the staged group', 'forged c2 aggregate group ownership');
    const c2BadVariationSnapshot = "jsonb_set(" + c2Snapshot + ",'{aggregate,variations,0,variation_id}',to_jsonb(" + sqlLiteral(vars.clean[0]) + "::text),false)";
    await expectFailure('select * from public.capture_variation_listing_permanent_removal_revision(' + [groups.c2, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee16', 2].map((v, i) => i < 2 ? sqlLiteral(v) + '::uuid' : String(v)).join(',') + ",encode(extensions.digest(public.variation_listing_recovery_canonical_json(" + c2BadVariationSnapshot + "),'sha256'),'hex')," + c2BadVariationSnapshot + "," + c2Plan + ');', 'snapshot variation ownership does not match the staged group', 'forged c2 survivor variation ownership');
    const c2BadListingSnapshot = c2Snapshot.replace("'listingId','listing-c2','offerIdsBySku'", "'listingId','listing-forged','offerIdsBySku'");
    await expectFailure('select * from public.capture_variation_listing_permanent_removal_revision(' + [groups.c2, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9', 2].map((v, i) => i < 2 ? sqlLiteral(v) + '::uuid' : String(v)).join(',') + ",encode(extensions.digest(public.variation_listing_recovery_canonical_json(" + c2BadListingSnapshot + "),'sha256'),'hex')," + c2BadListingSnapshot + "," + c2Plan + ');', 'snapshot metadata does not match staged target/survivor projection', 'forged c2 listing identity');
    const c2MissingPayloadSnapshot = c2Snapshot.replace(",'inventoryItemPayloadsBySku'," + c2ItemPayloads + ",'offerPayloadsBySku'," + c2OfferPayloads, '');
    await expectFailure('select * from public.capture_variation_listing_permanent_removal_revision(' + [groups.c2, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6', 2].map((v, i) => i < 2 ? sqlLiteral(v) + '::uuid' : String(v)).join(',') + ",encode(extensions.digest(public.variation_listing_recovery_canonical_json(" + c2MissingPayloadSnapshot + "),'sha256'),'hex')," + c2MissingPayloadSnapshot + "," + c2Plan + ');', 'snapshot metadata does not match staged target/survivor projection', 'missing c2 remote payload maps');
    const c2BadPlan = c2Plan.replace("'remove-group-membership'", "'forged-operation'");
    await expectFailure('select * from public.capture_variation_listing_permanent_removal_revision(' + [groups.c2, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3', 2].map((v, i) => i < 2 ? sqlLiteral(v) + '::uuid' : String(v)).join(',') + ",encode(extensions.digest(public.variation_listing_recovery_canonical_json(" + c2Snapshot + "),'sha256'),'hex')," + c2Snapshot + "," + c2BadPlan + ');', 'invalid permanent-removal operation plan', 'forged c2 operation plan');
    const c2BadIntent = c2Intent.replace(c2TargetSku, c2SurvivorSkus[0]);
    const c2BadIdentityPlan = c2Plan.replaceAll(c2Intent, c2BadIntent);
    await expectFailure('select * from public.capture_variation_listing_permanent_removal_revision(' + [groups.c2, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee7', 2].map((v, i) => i < 2 ? sqlLiteral(v) + '::uuid' : String(v)).join(',') + ",encode(extensions.digest(public.variation_listing_recovery_canonical_json(" + c2Snapshot + "),'sha256'),'hex')," + c2Snapshot + "," + c2BadIdentityPlan + ');', 'operation identity or survivor projection is invalid', 'forged c2 operation intent');
    await psql('select * from public.capture_variation_listing_permanent_removal_revision(' + c2CaptureArgs + ');', 'service_role');
    await expectFailure("begin;\nselect * from public.append_variation_listing_permanent_removal_checkpoint('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'::uuid,'remove-group-membership','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee18'::uuid,1,1,'started',null,'{}'::jsonb);\nselect * from public.append_variation_listing_permanent_removal_checkpoint('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'::uuid,'remove-group-membership','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee19'::uuid,1,2,'unknown','unknown','{\"timeout\":true}'::jsonb);\nselect * from public.append_variation_listing_permanent_removal_checkpoint('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'::uuid,'remove-group-membership','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee20'::uuid,2,1,'retry_authorized','proven_absent','{\"prestate\":true}'::jsonb);\nselect * from public.append_variation_listing_permanent_removal_checkpoint('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'::uuid,'remove-group-membership','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee21'::uuid,2,2,'started',null,'{}'::jsonb);\nselect * from public.append_variation_listing_permanent_removal_checkpoint('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'::uuid,'remove-group-membership','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee22'::uuid,2,3,'retry_exhausted','present','{\"prestate\":true}'::jsonb);\ncommit;", 'retry-exhausted checkpoint requires ambiguity evidence', 'c2 retry_exhausted requires unknown evidence');
    await expectFailure("begin; select set_config('app.variation_listing_permanent_removal','c2_execute',true), set_config('app.variation_listing_group_id','" + groups.c2 + "',true); insert into public.variation_listing_revisions(revision_id,group_id,captured_desired_revision,snapshot_version,snapshot_digest,snapshot,operation_count,operation_plan) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee17'::uuid,'" + groups.c2 + "'::uuid,2,3,repeat('a',64),'{}'::jsonb,1,'[{}]'::jsonb); rollback;", 'c2 revision write requires a dedicated permanent-removal RPC', 'forged c2_execute capability', 'postgres');
    await expectFailure("begin; select set_config('app.variation_listing_permanent_removal','c2_execute',true), set_config('app.variation_listing_group_id','" + groups.c2 + "',true); insert into public.variation_listing_revisions(revision_id,group_id,captured_desired_revision,snapshot_version,snapshot_digest,snapshot,operation_count,operation_plan) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee17'::uuid,'" + groups.c2 + "'::uuid,2,3,repeat('a',64),'{}'::jsonb,1,'[{}]'::jsonb); rollback;", 'permission denied', 'service-role GUC spoof rejected by ACL', 'service_role');
    await expectFailure("begin;\nselect * from public.append_variation_listing_permanent_removal_checkpoint('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'::uuid,'remove-group-membership','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee08'::uuid,1,1,'started',null,'{}'::jsonb);\nselect * from public.append_variation_listing_permanent_removal_checkpoint('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'::uuid,'remove-group-membership','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee09'::uuid,1,2,'confirmed_complete','present','{\"listingId\":\"listing-c2\"}'::jsonb);\nselect * from public.confirm_variation_listing_permanent_removal('" + groups.c2 + "'::uuid,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'::uuid,1,2,'" + vars.c2[0] + "'::uuid,'" + c2TargetSku + "');\ncommit;", 'permanent-removal membership checkpoint is not exact terminal proof', 'forged terminal evidence rejected');
    await expectFailure("begin;\nselect * from public.append_variation_listing_permanent_removal_checkpoint('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'::uuid,'remove-group-membership','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee10'::uuid,1,1,'started',null,'{}'::jsonb);\nselect * from public.append_variation_listing_permanent_removal_checkpoint('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'::uuid,'remove-group-membership','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee11'::uuid,1,2,'unknown','unknown','{\"timeout\":true}'::jsonb);\nselect * from public.append_variation_listing_permanent_removal_checkpoint('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'::uuid,'remove-group-membership','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee12'::uuid,2,1,'retry_authorized','proven_absent','{\"prestate\":true}'::jsonb);\nselect * from public.append_variation_listing_permanent_removal_checkpoint('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'::uuid,'remove-group-membership','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee13'::uuid,2,2,'started',null,'{}'::jsonb);\nselect * from public.append_variation_listing_permanent_removal_checkpoint('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'::uuid,'remove-group-membership','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee14'::uuid,2,3,'unknown','unknown','{\"timeout\":true}'::jsonb);\ncommit;", 'started checkpoint must resolve on the same attempt', 'forged replay cannot end in unknown or reach attempt three');
    await psql("select * from public.append_variation_listing_permanent_removal_checkpoint('" + 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3' + "'::uuid,'remove-group-membership','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4'::uuid,1,1,'started',null,'{}'::jsonb);", 'service_role');
    await psql("select * from public.append_variation_listing_permanent_removal_checkpoint('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'::uuid,'remove-group-membership','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'::uuid,1,2,'confirmed_complete','present','{\"listingId\":\"listing-c2\",\"targetSku\":\"OTHER-C2X-000001\",\"survivorSkus\":[\"OTHER-C2X-000002\",\"OTHER-C2X-000003\"],\"state\":\"removed\"}'::jsonb);", 'service_role');
    const beforeState = await psql("select (select count(*) from public.variation_listing_variations where variation_id='" + vars.c2[0] + "') as target_rows, (select count(*) from public.variation_listing_copies where variation_id='" + vars.c2[0] + "') as target_copy_rows, (select count(*) from public.variation_listing_variations where group_id='" + groups.c2 + "') as group_variations, (select count(*) from public.variation_listing_copies c join public.variation_listing_variations v on v.variation_id=c.variation_id where v.group_id='" + groups.c2 + "') as group_copies;");
    assert(/\n\s*1\s*\|\s*1\s*\|\s*3\s*\|\s*3\s*\n/.test(beforeState), 'c2 pre-finalization target/sibling rows are intact');
    await expectFailure("begin; select set_config('app.variation_listing_permanent_removal','c2_finalize',true), set_config('app.variation_listing_group_id','" + groups.c2 + "',true), set_config('app.variation_listing_variation_id','" + vars.c2[0] + "',true); delete from public.variation_listing_copies where variation_id='" + vars.c2[0] + "'::uuid; rollback;", 'c2 copy hard delete requires dedicated finalization RPC', 'forged c2 copy hard delete rejected', 'postgres');
    await expectFailure("begin; select set_config('app.variation_listing_permanent_removal','c2_finalize',true), set_config('app.variation_listing_group_id','" + groups.c2 + "',true), set_config('app.variation_listing_variation_id','" + vars.c2[0] + "',true); delete from public.variation_listing_variations where variation_id='" + vars.c2[0] + "'::uuid; rollback;", 'c2 variation hard delete requires dedicated finalization RPC', 'forged c2 variation hard delete rejected', 'postgres');
    await psql("select * from public.confirm_variation_listing_permanent_removal('" + groups.c2 + "'::uuid,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'::uuid,1,2,'" + vars.c2[0] + "'::uuid,'" + c2TargetSku + "');", 'service_role');
    await psql("select * from public.update_variation_listing_quantity_adjustment('" + groups.c2 + "'::uuid,'" + vars.c2[1] + "'::uuid,2,1);", 'service_role');
    await psql("select * from public.confirm_variation_listing_permanent_removal('" + groups.c2 + "'::uuid,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'::uuid,1,2,'" + vars.c2[0] + "'::uuid,'" + c2TargetSku + "');", 'service_role');
    const finalState = await psql("select (select count(*) from public.variation_listing_variations where variation_id='" + vars.c2[0] + "') as target_rows, (select count(*) from public.variation_listing_copies where variation_id='" + vars.c2[0] + "') as target_copy_rows, (select count(*) from public.variation_listing_variations where group_id='" + groups.c2 + "') as survivor_variations, (select count(*) from public.variation_listing_copies c join public.variation_listing_variations v on v.variation_id=c.variation_id where v.group_id='" + groups.c2 + "') as survivor_copies, (select desired_revision from public.variation_listing_groups where group_id='" + groups.c2 + "') as desired_revision, (select last_confirmed_revision from public.variation_listing_groups where group_id='" + groups.c2 + "') as watermark, (select lifecycle_state='active' from public.variation_listing_groups where group_id='" + groups.c2 + "') as active_group, (select quantity_adjustment_counter from public.variation_listing_variations where variation_id='" + vars.c2[1] + "') as survivor_adjustment, (select count(*) from jsonb_array_elements((select snapshot->'confirmed'->'aggregate'->'copies' from public.variation_listing_revisions where revision_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'::uuid)) x where x->>'variation_id'='" + vars.c2[0] + "' and x->>'front_r2_key'='variation-listing/C2X/front-1' and x->>'back_r2_key'='variation-listing/C2X/back-1') as frozen_target_keys;");
    assert(/\n\s*0\s*\|\s*0\s*\|\s*2\s*\|\s*2\s*\|\s*3\s*\|\s*2\s*\|\s*t\s*\|\s*1\s*\|\s*1\s*\n/.test(finalState), 'c2 finalization hard-deletes target, preserves newer survivor revision, and retains target R2 keys');
    await expectFailure(rpcStage(groups.c2, vars.c2[0], 3, true), 'target variation not found in group', 'deleted target cannot be staged again');

    const privileges = await psql("select has_function_privilege('service_role','public.stage_variation_listing_permanent_removal(uuid,uuid,bigint,boolean)','execute') as service, has_function_privilege('public','public.stage_variation_listing_permanent_removal(uuid,uuid,bigint,boolean)','execute') as public, has_function_privilege('anon','public.stage_variation_listing_permanent_removal(uuid,uuid,bigint,boolean)','execute') as anon, has_function_privilege('authenticated','public.stage_variation_listing_permanent_removal(uuid,uuid,bigint,boolean)','execute') as authenticated;");
    assert(/t\s+\|\s+f\s+\|\s+f\s+\|\s+f/.test(privileges), 'stage/cancel EXECUTE is service_role only');
    const triggerPrivileges = await psql("select has_function_privilege('service_role','public.prevent_variation_listing_pending_removal_mix()','execute') as service, has_function_privilege('public','public.prevent_variation_listing_pending_removal_mix()','execute') as public, has_function_privilege('anon','public.prevent_variation_listing_pending_removal_mix()','execute') as anon, has_function_privilege('authenticated','public.prevent_variation_listing_pending_removal_mix()','execute') as authenticated;");
    assert(/f\s+\|\s+f\s+\|\s+f\s+\|\s+f/.test(triggerPrivileges), 'pending-removal trigger EXECUTE is revoked for all roles');
    const c2Privileges = await psql("select has_function_privilege('service_role','public.capture_variation_listing_permanent_removal_revision(uuid,uuid,bigint,text,jsonb,jsonb)','execute') as capture_service, has_function_privilege('public','public.capture_variation_listing_permanent_removal_revision(uuid,uuid,bigint,text,jsonb,jsonb)','execute') as capture_public, has_function_privilege('service_role','public.append_variation_listing_permanent_removal_checkpoint(uuid,text,uuid,integer,integer,text,text,jsonb)','execute') as checkpoint_service, has_function_privilege('public','public.append_variation_listing_permanent_removal_checkpoint(uuid,text,uuid,integer,integer,text,text,jsonb)','execute') as checkpoint_public, has_function_privilege('service_role','public.confirm_variation_listing_permanent_removal(uuid,uuid,bigint,bigint,uuid,text)','execute') as confirm_service, has_function_privilege('public','public.confirm_variation_listing_permanent_removal(uuid,uuid,bigint,bigint,uuid,text)','execute') as confirm_public, has_function_privilege('service_role','public.prevent_variation_listing_c2_copy_hard_delete()','execute') as copy_guard_service, has_function_privilege('public','public.prevent_variation_listing_c2_copy_hard_delete()','execute') as copy_guard_public;");
    assert(/t\s+\|\s+f\s+\|\s+t\s+\|\s+f\s+\|\s+t\s+\|\s+f\s+\|\s+f\s+\|\s+f/.test(c2Privileges), 'c2 RPC seams are service_role-only and copy guard is trigger-only');

    await psql("drop trigger variation_listing_copies_c2_hard_delete_guard on public.variation_listing_copies; drop function public.prevent_variation_listing_c2_copy_hard_delete(); drop trigger variation_listing_groups_block_pending_removal_mix on public.variation_listing_groups; drop trigger variation_listing_variations_block_pending_removal_mix on public.variation_listing_variations; drop trigger variation_listing_intake_sessions_block_pending_removal_mix on public.variation_listing_intake_sessions; drop trigger variation_listing_revisions_block_pending_removal_mix on public.variation_listing_revisions; drop trigger variation_listing_checkpoints_block_pending_removal_mix on public.variation_listing_publishing_checkpoints; drop function public.prevent_variation_listing_pending_removal_mix(); drop function public.stage_variation_listing_permanent_removal(uuid,uuid,bigint,boolean); drop index public.variation_listing_one_pending_removal_per_group_idx; alter table public.variation_listing_variations drop column pending_removal_at;");
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

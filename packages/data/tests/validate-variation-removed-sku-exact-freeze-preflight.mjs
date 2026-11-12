#!/usr/bin/env node
/* Disposable PostgreSQL 17 proof for the EXEC4b read-only exact-key preflight. */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const name = `yp9-c4b-${process.pid}-${randomBytes(3).toString('hex')}`;
const password = randomBytes(16).toString('hex');
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const assert = (condition, message) => { if (!condition) throw new Error(`assertion failed: ${message}`); };
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const command = (file, args, input = '') => new Promise((resolve, reject) => {
  const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => code === 0
    ? resolve(stdout)
    : reject(new Error(`${file} ${args.join(' ')} failed\n${stderr}${stdout}`)));
  child.stdin.end(input);
});
const docker = (args, input = '') => command('docker', args, input);
const psqlArgs = ['exec', '-i', name, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', 'postgres'];
const psql = (sql, role = null) => docker(psqlArgs, (role ? `set role ${role};\n` : '') + `${sql}\n`);
const read = relative => readFile(`${root}/${relative}`, 'utf8');
const expectError = async (sql, label, role, message, state = null) => {
  try { await psql(sql, role); } catch (error) {
    const text = String(error);
    if (state) assert(text.includes(`SQL state: ${state}`) || text.includes(`ERROR:  ${state}:`), `${label}: SQLSTATE`);
    if (message) assert(text.includes(message), `${label}: expected ${message}, got ${text}`);
    return;
  }
  throw new Error(`expected failure: ${label}`);
};
const resultError = (result, label, message, state = 'P0001') => {
  assert(!result.ok, `${label}: expected PostgreSQL error`);
  const text = String(result.error);
  assert(text.includes(`SQL state: ${state}`) || text.includes(`ERROR:  ${state}:`), `${label}: SQLSTATE ${text}`);
  assert(text.includes(message), `${label}: expected ${message}, got ${text}`);
};

function session() {
  const child = spawn('docker', psqlArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  const done = new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`${stderr}${stdout}`)));
  });
  let sessionError = null;
  done.catch(error => { sessionError = error; });
  return {
    send(sql) { child.stdin.write(`${sql}\n`); },
    seen(marker) { return stdout.includes(marker); },
    async wait(marker) {
      for (let i = 0; i < 800; i += 1) {
        if (stdout.includes(marker)) return;
        if (sessionError) throw sessionError;
        if (child.exitCode !== null) throw new Error(`missing ${marker}: ${stderr}${stdout}`);
        await sleep(10);
      }
      throw new Error(`missing ${marker}: ${stderr}${stdout}`);
    },
    async close() {
      child.stdin.end();
      try { return { ok: true, output: await done }; }
      catch (error) { return { ok: false, output: stdout, error }; }
    },
  };
}

const migrations = [
  '20260516220000_create_listings_table.sql',
  '20260519163107_listings_image_arrays_text.sql',
  '20260828150000_create_variation_listing_persistence.sql',
  '20260829150000_create_variation_listing_publishing_journal.sql',
  '20260830014853_create_variation_listing_rpc_seam.sql',
  '20260831142123_revoke_variation_listing_rpc_execute.sql',
  '20260831170000_simplify_variation_listing_persistence.sql',
  '20260831190000_correct_variation_listing_checkpoint_service_role_acl.sql',
  '20260901150000_apply_variation_listing_group_review_draft.sql',
  '20260901151300_update_variation_listing_manual_price.sql',
  '20260901160000_add_variation_listing_active_staging_and_bounded_retry.sql',
  '20260901163000_activate_variation_listing_on_confirmation.sql',
  '20260902010000_advance_variation_listing_cleanup_lifecycle.sql',
  '20260902140000_mark_variation_listing_publish_ready.sql',
  '20260903020000_freeze_variation_listing_copy_condition.sql',
  '20260903201000_update_variation_listing_selector_value.sql',
  '20260904183000_recover_failed_initial_variation_publication.sql',
  '20260922195000_expand_variation_listing_manual_price_499.sql',
  '20261005153617_add_variation_listing_quantity_adjustment.sql',
  '20261021181500_stage_variation_listing_permanent_removal.sql',
  '20261021193000_execute_variation_listing_permanent_removal.sql',
  '20261023140500_read_only_variation_removed_sku_ownership_witness.sql',
  '20261023190000_durable_removed_sku_remote_retirement.sql',
  '20261110180000_create_removed_sku_cleanup_journal.sql',
];

const group = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const targetVariation = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const survivorOne = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const survivorTwo = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const copy = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const revision = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const checkpoint = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const targetSku = 'OTHER-BridgeB-000002';
const targetFront = 'variation-listing/bridgeb/front-target.jpg';
const targetBack = 'variation-listing/bridgeb/back-target.jpg';
const survivorSkus = ['OTHER-BridgeB-000001', 'OTHER-BridgeB-000003'];
const baseUrl = 'https://images.invalid';

const bootstrap = `
create role anon;
create role authenticated;
create role service_role;
alter role service_role bypassrls;
create schema extensions;
create extension if not exists pgcrypto;
create or replace function public.set_row_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create or replace function extensions.digest(data text, typ text)
returns bytea language sql immutable strict as $$ select public.digest(data, typ); $$;
grant execute on function extensions.digest(text, text) to public;
`;

const seed = `
alter table public.variation_listing_groups disable trigger user;
alter table public.variation_listing_variations disable trigger user;
alter table public.variation_listing_copies disable trigger user;
alter table public.variation_listing_revisions disable trigger user;
alter table public.variation_listing_publishing_checkpoints disable trigger user;
alter table public.variation_listing_removed_sku_remote_retirements disable trigger user;
insert into public.variation_listing_groups
  (group_id, group_key, sku_category_code, sku_bucket_token, lifecycle_state, category_id,
   marketplace_id, merchant_location_key, fulfillment_policy_id, payment_policy_id,
   return_policy_id, condition_id, condition_token, desired_revision, last_confirmed_revision)
values (${q(group)}::uuid, ${q(`VL-G-${group.replaceAll('-', '').toUpperCase()}`)}, 'OTHER', 'BridgeB', 'active',
        '261328', 'EBAY_US', 'bridge-location', 'bridge-fulfillment', 'bridge-payment', 'bridge-return',
        '1000', 'VERY_GOOD', 2, 2);
insert into public.variation_listing_variations
  (variation_id, group_id, inventory_serial, sku, position, selector_value, price_amount)
values
  (${q(survivorOne)}::uuid, ${q(group)}::uuid, 1, ${q(survivorSkus[0])}, 0, 'Card 1', 0.99),
  (${q(targetVariation)}::uuid, ${q(group)}::uuid, 2, ${q(targetSku)}, 1, 'Card 2', 0.99),
  (${q(survivorTwo)}::uuid, ${q(group)}::uuid, 3, ${q(survivorSkus[1])}, 2, 'Card 3', 0.99);
with payload as (
  select jsonb_build_object(
    'aggregate', jsonb_build_object(
      'group', to_jsonb(g),
      'variations', (select jsonb_agg(to_jsonb(v) order by v.position) from public.variation_listing_variations v where v.group_id = g.group_id),
      'copies', jsonb_build_array(jsonb_build_object('variation_id', ${q(targetVariation)}, 'copy_id', ${q(copy)},
        'front_r2_key', ${q(targetFront)}, 'back_r2_key', ${q(targetBack)},
        'capture_front_source_ref', 'bridge-source-front', 'capture_back_source_ref', 'bridge-source-back'))),
    'confirmed', jsonb_build_object(
      'aggregate', jsonb_build_object(
        'group', to_jsonb(g),
        'variations', (select jsonb_agg(to_jsonb(v) order by v.position) from public.variation_listing_variations v where v.group_id = g.group_id),
        'copies', jsonb_build_array(jsonb_build_object('variation_id', ${q(targetVariation)}, 'copy_id', ${q(copy)},
          'front_r2_key', ${q(targetFront)}, 'back_r2_key', ${q(targetBack)},
          'capture_front_source_ref', 'bridge-source-front', 'capture_back_source_ref', 'bridge-source-back'))),
      'remote', jsonb_build_object('listingId', 'bridge-listing')),
    'permanentRemoval', jsonb_build_object('version', 1, 'groupKey', g.group_key,
      'marketplaceId', g.marketplace_id, 'targetVariationId', ${q(targetVariation)}, 'targetSku', ${q(targetSku)},
      'listingId', 'bridge-listing', 'survivorSkus', jsonb_build_array(${q(survivorSkus[0])}, ${q(survivorSkus[1])}),
      'offerIdsBySku', jsonb_build_object(${q(targetSku)}, 'bridge-offer'),
      'quantitiesBySku', jsonb_build_object(${q(targetSku)}, jsonb_build_object('inventoryItemQuantity', 0, 'offerQuantity', 0, 'sellableQuantity', 0)))
  ) snapshot,
  jsonb_build_object('groupKey', g.group_key, 'targetSku', ${q(targetSku)},
    'survivorSkus', jsonb_build_array(${q(survivorSkus[0])}, ${q(survivorSkus[1])})) intent
  from public.variation_listing_groups g where g.group_id = ${q(group)}::uuid
), planned as (
  select snapshot, intent,
    jsonb_build_object('operation_key', 'remove-group-membership', 'operation_kind', 'permanent_removal_group_membership',
      'target_ref', snapshot->'permanentRemoval'->>'groupKey', 'sequence_no', 1, 'intent_version', 1,
      'intent_digest', encode(extensions.digest(public.variation_listing_recovery_canonical_json(intent), 'sha256'), 'hex'), 'intent', intent) op
  from payload
)
insert into public.variation_listing_revisions
  (revision_id, group_id, captured_desired_revision, snapshot_version, snapshot_digest, snapshot, operation_count, operation_plan)
select ${q(revision)}::uuid, ${q(group)}::uuid, 2, 3,
  encode(extensions.digest(public.variation_listing_recovery_canonical_json(snapshot), 'sha256'), 'hex'), snapshot, 1, jsonb_build_array(op)
from planned;
insert into public.variation_listing_publishing_checkpoints
  (checkpoint_id, revision_id, operation_key, attempt_number, checkpoint_number, state, observed_remote_state, evidence)
values (${q(checkpoint)}::uuid, ${q(revision)}::uuid, 'remove-group-membership', 1, 1, 'confirmed_complete', 'present',
  jsonb_build_object('listingId', 'bridge-listing', 'targetSku', ${q(targetSku)},
    'survivorSkus', jsonb_build_array(${q(survivorSkus[0])}, ${q(survivorSkus[1])}), 'state', 'removed'));
insert into public.variation_listing_removed_sku_remote_retirements
  (revision_id, group_id, target_variation_id, target_sku, target_offer_id, marketplace_id, listing_id,
   c2_confirmed_revision, c2_terminal_checkpoint_id, state, observed_remote_state, evidence, started_at, completed_at)
values (${q(revision)}::uuid, ${q(group)}::uuid, ${q(targetVariation)}::uuid, ${q(targetSku)}, 'bridge-offer', 'EBAY_US',
  'bridge-listing', 2, ${q(checkpoint)}::uuid, 'confirmed_complete', 'proven_absent',
  jsonb_build_object('revisionId', ${q(revision)}, 'targetSku', ${q(targetSku)}, 'targetOfferId', 'bridge-offer',
    'marketplaceId', 'EBAY_US', 'listingId', 'bridge-listing', 'item', jsonb_build_object('state', 'absent', 'sku', ${q(targetSku)}),
    'offers', jsonb_build_object('complete', true, 'offers', jsonb_build_array()),
    'survivors', jsonb_build_object('exact', true, 'skus', jsonb_build_array(${q(survivorSkus[0])}, ${q(survivorSkus[1])}))),
  now(), now());
delete from public.variation_listing_variations where variation_id = ${q(targetVariation)}::uuid;
alter table public.variation_listing_removed_sku_remote_retirements enable trigger user;
alter table public.variation_listing_publishing_checkpoints enable trigger user;
alter table public.variation_listing_revisions enable trigger user;
alter table public.variation_listing_copies enable trigger user;
alter table public.variation_listing_variations enable trigger user;
alter table public.variation_listing_groups enable trigger user;
`;

const exactCall = `removed_sku_writer_barrier.inspect_exact_freeze_preflight(${q(revision)}::uuid)`;
const validEvidence = `jsonb_build_object('revisionId', ${q(revision)}, 'targetSku', ${q(targetSku)}, 'targetOfferId', 'bridge-offer', 'marketplaceId', 'EBAY_US', 'listingId', 'bridge-listing', 'item', jsonb_build_object('state', 'absent', 'sku', ${q(targetSku)}), 'offers', jsonb_build_object('complete', true, 'offers', jsonb_build_array()), 'survivors', jsonb_build_object('exact', true, 'skus', jsonb_build_array(${q(survivorSkus[0])}, ${q(survivorSkus[1])})))`;

async function main() {
  let started = false;
  try {
    await docker(['run', '--rm', '--network', 'none', '--name', name, '-e', `POSTGRES_PASSWORD=${password}`, '-d', 'postgres:17-alpine']);
    started = true;
    for (let i = 0; i < 240; i += 1) {
      try { await psql('select 1'); break; }
      catch (error) { if (i === 239) throw error; await sleep(250); }
    }
    await psql(bootstrap);
    for (const migration of migrations) await psql(await read(`supabase/migrations/${migration}`));
    await psql(await read('supabase/migrations/20261111223116_create_removed_sku_exact_key_writer_barrier.sql'));
    await psql(await read('packages/data/tests/removed-sku-exact-freeze-preflight.prototype.sql'));
    await psql(`grant usage on schema public to anon, authenticated, service_role;
grant all privileges on table public.listings to service_role;
grant select on table public.listings to anon, authenticated;`);
    await psql(`insert into removed_sku_writer_barrier.trusted_r2_url_bases(base_url) values (${q(baseUrl)});`);
    await psql(seed);

    const def = await psql(`select prosecdef, proconfig, pg_get_function_arguments(p.oid), lower(pg_get_functiondef(p.oid))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'removed_sku_writer_barrier' and p.proname = 'inspect_exact_freeze_preflight';`);
    assert(def.startsWith('t|{"search_path=\\"\\""}|p_revision_id uuid'), 'SECURITY DEFINER and empty search_path');
    assert(!def.includes('insert into removed_sku_writer_barrier.frozen_r2_keys'), 'inspector has no marker insert');
    const publicExecute = await psql(`select not exists (
      select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
       where n.nspname = 'removed_sku_writer_barrier'
         and p.proname = 'inspect_exact_freeze_preflight'
         and acl.grantee = 0
         and acl.privilege_type in ('EXECUTE', 'ALL')
    );`);
    assert(publicExecute.trim() === 't', 'PUBLIC has no inspector EXECUTE privilege in pg_proc catalog');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await expectError(`select ${exactCall};`, `${role} inspector ACL`, role, 'permission denied', '42501');
      await expectError('select count(*) from removed_sku_writer_barrier.frozen_r2_keys;', `${role} marker read`, role, 'permission denied', '42501');
      await expectError(`insert into removed_sku_writer_barrier.frozen_r2_keys(key, revision_id) values ('${targetFront}', '${revision}'::uuid);`, `${role} marker write`, role, 'permission denied', '42501');
      await expectError(`delete from removed_sku_writer_barrier.frozen_r2_keys where key = '${targetFront}';`, `${role} marker delete`, role, 'permission denied', '42501');
      await expectError('select count(*) from removed_sku_writer_barrier.trusted_r2_url_bases;', `${role} trusted-origin read`, role, 'permission denied', '42501');
    }

    const first = JSON.parse((await psql(`begin; select ${exactCall}; commit;`)).trim());
    assert(first.revisionId === revision && first.targetSku === targetSku, 'c2b/v3 identity');
    assert(JSON.stringify(first.r2ObjectKeys) === JSON.stringify([targetBack, targetFront]), 'exact keys are lexicographically sorted');
    assert(first.sameGroupHistoricalReferencesVerified === false && first.journalHistoryVerified === false && first.referenceSearchComplete === false, 'historical completeness flags remain false');
    assert(first.freezeAuthorized === false && first.deletionAuthorized === false, 'all authority flags remain false');
    assert(first.blockers.includes('incomplete_historical_and_json_reference_search'), 'explicit historical blocker');
    assert((await psql('select count(*) from removed_sku_writer_barrier.frozen_r2_keys;')).trim() === '0', 'inspector does not register marker');

    await expectError(`begin; set transaction isolation level repeatable read; select ${exactCall};`, 'repeatable-read rejection', null, 'reference preflight requires READ COMMITTED');
    await expectError(`select ${exactCall};`, 'service role remains denied after valid call', 'service_role', 'permission denied', '42501');

    await expectError(`select removed_sku_writer_barrier.inspect_exact_freeze_preflight('99999999-9999-4999-8999-999999999999'::uuid);`, 'mismatched revision', null, 'c2b retirement record missing');
    await psql(`update public.variation_listing_removed_sku_remote_retirements set evidence = jsonb_set(evidence, '{targetSku}', to_jsonb('FORGED-SKU'::text)) where revision_id = ${q(revision)}::uuid;`);
    await expectError(`select ${exactCall};`, 'forged evidence', null, 'c2b retirement evidence is incomplete or untrusted');
    await psql(`update public.variation_listing_removed_sku_remote_retirements set evidence = ${validEvidence} where revision_id = ${q(revision)}::uuid;`);
    const originalSnapshot = (await psql(`select snapshot from public.variation_listing_revisions where revision_id = ${q(revision)}::uuid;`)).trim();
    await psql(`alter table public.variation_listing_revisions disable trigger user; update public.variation_listing_revisions set snapshot = jsonb_set(snapshot, '{permanentRemoval,marketplaceId}', to_jsonb('FORGED_MARKET'::text)), snapshot_digest = encode(extensions.digest(public.variation_listing_recovery_canonical_json(jsonb_set(snapshot, '{permanentRemoval,marketplaceId}', to_jsonb('FORGED_MARKET'::text))), 'sha256'), 'hex') where revision_id = ${q(revision)}::uuid; alter table public.variation_listing_revisions enable trigger user;`);
    await expectError(`select ${exactCall};`, 'forged c2b/v3 marketplace identity', null, 'frozen v3 revision conflicts with c2b identity');
    await psql(`alter table public.variation_listing_revisions disable trigger user; update public.variation_listing_revisions set snapshot = ${q(originalSnapshot)}::jsonb, snapshot_digest = encode(extensions.digest(public.variation_listing_recovery_canonical_json(${q(originalSnapshot)}::jsonb), 'sha256'), 'hex') where revision_id = ${q(revision)}::uuid; alter table public.variation_listing_revisions enable trigger user;`);
    await psql(`alter table public.variation_listing_revisions disable trigger user; update public.variation_listing_revisions set snapshot = jsonb_set(snapshot, '{confirmed,aggregate,copies}', '[]'::jsonb), snapshot_digest = encode(extensions.digest(public.variation_listing_recovery_canonical_json(jsonb_set(snapshot, '{confirmed,aggregate,copies}', '[]'::jsonb)), 'sha256'), 'hex') where revision_id = ${q(revision)}::uuid; alter table public.variation_listing_revisions enable trigger user;`);
    await expectError(`select ${exactCall};`, 'no-copy witness', null, 'resource set is incomplete or duplicated');
    await psql(`alter table public.variation_listing_revisions disable trigger user; update public.variation_listing_revisions set snapshot = ${q(originalSnapshot)}::jsonb, snapshot_digest = encode(extensions.digest(public.variation_listing_recovery_canonical_json(${q(originalSnapshot)}::jsonb), 'sha256'), 'hex') where revision_id = ${q(revision)}::uuid; alter table public.variation_listing_revisions enable trigger user;`);

    await psql(`insert into public.listings(listing_id, listing_type, image_urls, r2_object_keys) values ('exec4b-direct-key', 'single', array[]::text[], array[${q(targetFront)}]::text[]);`, 'service_role');
    await expectError(`select ${exactCall};`, 'Standard direct-key conflict', null, 'live or other-group owner prevents reference freeze');
    await psql("delete from public.listings where listing_id = 'exec4b-direct-key';", 'service_role');
    await psql(`insert into public.listings(listing_id, listing_type, image_urls, r2_object_keys) values ('exec4b-public-url', 'single', array[${q(`${baseUrl}/${targetFront}`)}]::text[], array[]::text[]);`, 'service_role');
    await expectError(`select ${exactCall};`, 'Standard public URL conflict', null, 'live or other-group owner prevents reference freeze');
    await psql("delete from public.listings where listing_id = 'exec4b-public-url';", 'service_role');
    await psql(`alter table public.listings disable trigger user; insert into public.listings(listing_id, listing_type, image_urls, r2_object_keys) values ('exec4b-encoded-alias', 'single', array[${q(`${baseUrl}/%76ariation-listing/BridgeB/front-target.jpg`)}]::text[], array[]::text[]); alter table public.listings enable trigger user;`);
    await expectError(`select ${exactCall};`, 'canonical encoded alias scan', null, 'noncanonical Variation R2 URL');
    await psql("delete from public.listings where listing_id = 'exec4b-encoded-alias';", 'service_role');

    const liveCopyId = '99999999-9999-4999-8999-999999999991';
    await psql(`insert into public.variation_listing_copies(copy_id, variation_id, condition_token, front_r2_key, back_r2_key, capture_source_key, capture_pair_id, capture_front_source_ref, capture_back_source_ref, capture_started_at) values (${q(liveCopyId)}::uuid, ${q(survivorOne)}::uuid, 'VERY_GOOD', ${q(targetFront)}, 'variation-listing/bridgeb/back-live.jpg', 'exec4b-live', ${q(liveCopyId)}::uuid, 'live-front', 'live-back', now());`);
    await expectError(`select ${exactCall};`, 'Variation key conflict', null, 'live or other-group owner prevents reference freeze');
    await psql(`delete from public.variation_listing_copies where copy_id = ${q(liveCopyId)}::uuid;`);

    // Writer first: preflight genuinely waits, then fresh READ COMMITTED scan sees committed owner.
    const writerFirst = session();
    const preflightAfterWriter = session();
    writerFirst.send(`begin; set role service_role; insert into public.listings(listing_id, listing_type, image_urls, r2_object_keys) values ('exec4b-writer-first', 'single', array[]::text[], array[${q(targetFront)}]::text[]); select 'WRITER_HELD';`);
    await writerFirst.wait('WRITER_HELD');
    preflightAfterWriter.send(`begin; select ${exactCall}; select 'PREFLIGHT_DONE';`);
    await sleep(160);
    assert(!preflightAfterWriter.seen('PREFLIGHT_DONE'), 'preflight waits on genuine writer key lock');
    writerFirst.send("commit; select 'WRITER_COMMITTED';");
    await writerFirst.wait('WRITER_COMMITTED');
    assert((await writerFirst.close()).ok, 'writer-first commit');
    resultError(await preflightAfterWriter.close(), 'fresh post-lock owner scan', 'live or other-group owner prevents reference freeze');
    await psql("delete from public.listings where listing_id = 'exec4b-writer-first';", 'service_role');

    // Writer first + rollback: the same genuine wait must refresh to a clean,
    // non-authorizing result after the owner disappears before the lock opens.
    const writerRollback = session();
    const preflightAfterRollback = session();
    writerRollback.send(`begin; set role service_role; insert into public.listings(listing_id, listing_type, image_urls, r2_object_keys) values ('exec4b-writer-rollback', 'single', array[]::text[], array[${q(targetFront)}]::text[]); select 'WRITER_ROLLBACK_HELD';`);
    await writerRollback.wait('WRITER_ROLLBACK_HELD');
    preflightAfterRollback.send(`begin; select ${exactCall}; select 'PREFLIGHT_ROLLBACK_DONE';`);
    await sleep(160);
    assert(!preflightAfterRollback.seen('PREFLIGHT_ROLLBACK_DONE'), 'rollback preflight waits on genuine writer key lock');
    writerRollback.send("rollback; select 'WRITER_ROLLBACK_DONE';");
    await writerRollback.wait('WRITER_ROLLBACK_DONE');
    assert((await writerRollback.close()).ok, 'writer-first rollback');
    await preflightAfterRollback.wait('PREFLIGHT_ROLLBACK_DONE');
    preflightAfterRollback.send("commit; select 'PREFLIGHT_ROLLBACK_COMMITTED';");
    await preflightAfterRollback.wait('PREFLIGHT_ROLLBACK_COMMITTED');
    const rollbackPreflightResult = await preflightAfterRollback.close();
    assert(rollbackPreflightResult.ok, 'rollback preflight commit');
    const rollbackPreflight = JSON.parse(rollbackPreflightResult.output.split('\n').find(line => line.startsWith('{')));
    assert(rollbackPreflight.freezeAuthorized === false && rollbackPreflight.deletionAuthorized === false, 'rollback preflight remains non-authorizing');
    assert(JSON.stringify(rollbackPreflight.r2ObjectKeys) === JSON.stringify([targetBack, targetFront]), 'rollback preflight retains exact keys');
    assert((await psql('select count(*) from removed_sku_writer_barrier.frozen_r2_keys;')).trim() === '0', 'rollback preflight leaves no marker');

    // Preflight first: writer of an absent row waits, then succeeds after the
    // read-only transaction releases its lock; no marker was registered.
    const preflightFirst = session();
    const absentWriter = session();
    preflightFirst.send(`begin; select ${exactCall}; select 'PREFLIGHT_HELD';`);
    await preflightFirst.wait('PREFLIGHT_HELD');
    absentWriter.send(`begin; set role service_role; insert into public.listings(listing_id, listing_type, image_urls, r2_object_keys) values ('exec4b-absent-phantom', 'single', array[]::text[], array[${q(targetFront)}]::text[]); select 'ABSENT_WRITER_DONE';`);
    await sleep(160);
    assert(!absentWriter.seen('ABSENT_WRITER_DONE'), 'absent-row writer waits on preflight lock');
    preflightFirst.send("commit; select 'PREFLIGHT_COMMITTED';");
    await preflightFirst.wait('PREFLIGHT_COMMITTED');
    assert((await preflightFirst.close()).ok, 'preflight-first commit');
    await absentWriter.wait('ABSENT_WRITER_DONE');
    absentWriter.send("commit; select 'ABSENT_WRITER_COMMITTED';");
    await absentWriter.wait('ABSENT_WRITER_COMMITTED');
    assert((await absentWriter.close()).ok, 'absent-row writer commit');
    await psql("delete from public.listings where listing_id = 'exec4b-absent-phantom';", 'service_role');

    const acl = await psql(`select has_function_privilege('service_role', 'removed_sku_writer_barrier.inspect_exact_freeze_preflight(uuid)', 'execute') = false
      and has_schema_privilege('service_role', 'removed_sku_writer_barrier', 'usage') = false;`);
    assert(acl.trim() === 't', 'service_role has no inspector/schema privilege');
    const rows = await psql('select count(*) from removed_sku_writer_barrier.frozen_r2_keys;');
    assert(rows.trim() === '0', 'no marker row on any inspector branch');
    const final = JSON.parse((await psql(`select ${exactCall};`)).trim());
    assert(final.freezeAuthorized === false && final.deletionAuthorized === false, 'final branch remains non-authorizing');
    console.log('EXEC4b disposable exact-freeze preflight checks: passed (actual migrations + prototype; no hosted operation)');
  } finally {
    if (started) await docker(['rm', '-f', name]).catch(() => {});
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

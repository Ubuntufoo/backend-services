#!/usr/bin/env node
/* Disposable PostgreSQL 17 proof for the EXEC4c historical-reference scanner. */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const name = `yp9-c4c-${process.pid}-${randomBytes(3).toString('hex')}`;
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
const otherGroup = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const targetVariation = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const survivorOne = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const survivorTwo = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const copy = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const revision = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const historyRevision = 'dddddddd-dddd-4ddd-8ddd-ddddddddddde';
const otherRevision = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
const checkpoint = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const otherCheckpoint = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef';
const otherRetirement = 'ffffffff-ffff-4fff-8fff-fffffffffff2';
const journal = '11111111-1111-4111-8111-111111111111';
const otherJournal = '22222222-2222-4222-8222-222222222222';
const targetSku = 'OTHER-BridgeB-000002';
const targetFront = 'variation-listing/bridgeb/front-target.jpg';
const targetBack = 'variation-listing/bridgeb/back-target.jpg';
const sourceFront = 'bridge-source-front';
const sourceBack = 'bridge-source-back';
const survivorSkus = ['OTHER-BridgeB-000001', 'OTHER-BridgeB-000003'];
const baseUrl = 'https://images.invalid';
// Runtime value is one backslash plus slash, so the JSON seed receives a
// genuine `\\/` escape rather than JavaScript consuming it as `\/`.
const escapedJsonSlash = '\\/';
assert(escapedJsonSlash.length === 2 && escapedJsonSlash.charCodeAt(0) === 92
  && escapedJsonSlash.charCodeAt(1) === 47, 'JSON escaped slash construction');
const exactCall = `removed_sku_writer_barrier.inspect_exact_historical_references(${q(revision)}::uuid)`;

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
        '1000', 'VERY_GOOD', 2, 2),
       (${q(otherGroup)}::uuid, ${q(`VL-G-${otherGroup.replaceAll('-', '').toUpperCase()}`)}, 'OTHER', 'BridgeC', 'active',
        '261328', 'EBAY_US', 'bridge-location-2', 'bridge-fulfillment', 'bridge-payment', 'bridge-return',
        '1000', 'VERY_GOOD', 1, 1);
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
        'capture_front_source_ref', ${q(sourceFront)}, 'capture_back_source_ref', ${q(sourceBack)}))),
    'confirmed', jsonb_build_object(
      'aggregate', jsonb_build_object(
        'group', to_jsonb(g),
        'variations', (select jsonb_agg(to_jsonb(v) order by v.position) from public.variation_listing_variations v where v.group_id = g.group_id),
        'copies', jsonb_build_array(jsonb_build_object('variation_id', ${q(targetVariation)}, 'copy_id', ${q(copy)},
          'front_r2_key', ${q(targetFront)}, 'back_r2_key', ${q(targetBack)},
          'capture_front_source_ref', ${q(sourceFront)}, 'capture_back_source_ref', ${q(sourceBack)}))),
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
    'survivors', jsonb_build_object('exact', true, 'skus', jsonb_build_array(${q(survivorSkus[0])}, ${q(survivorSkus[1])})),
    'history', jsonb_build_array(jsonb_build_object('nestedAlias', 'https://images.invalid/prefix/variation-listing%2FBRIDGEB%2Ffront-target.jpg'),
      $json$[{"escaped":"prefix/variation-listing${escapedJsonSlash}bridgeb${escapedJsonSlash}front-target.jpg"}]$json$::jsonb, null, 17)),
  now(), now());
delete from public.variation_listing_variations where variation_id = ${q(targetVariation)}::uuid;
alter table public.variation_listing_removed_sku_remote_retirements enable trigger user;
alter table public.variation_listing_publishing_checkpoints enable trigger user;
alter table public.variation_listing_revisions enable trigger user;
alter table public.variation_listing_copies enable trigger user;
alter table public.variation_listing_variations enable trigger user;
alter table public.variation_listing_groups enable trigger user;

-- Same-group prior revision: one key in snapshot and one source reference in
-- operation_plan, plus JSON null/number leaves that must not crash the walk.
insert into public.variation_listing_revisions
  (revision_id, group_id, captured_desired_revision, snapshot_version, snapshot_digest, snapshot, operation_count, operation_plan)
values (${q(historyRevision)}::uuid, ${q(group)}::uuid, 1, 3,
  encode(extensions.digest(public.variation_listing_recovery_canonical_json(jsonb_build_object(
    'history', jsonb_build_array(jsonb_build_object('copy', ${q(targetFront)}), 'not-a-reference'))), 'sha256'), 'hex'),
  jsonb_build_object('history', jsonb_build_array(jsonb_build_object('copy', ${q(targetFront)}), 'not-a-reference')),
  1, jsonb_build_array(jsonb_build_object('unknownCopy', jsonb_build_object(
    'source', 'prefix/${sourceFront.replaceAll('/', '%2F')}', 'unsafe', jsonb_build_array(null, 7, false)),
    'negative', 'variation-listing/bridgeb/not-target.jpg')));

-- Other-group historical revision: scanner must report it even though EXEC4b
-- correctly blocks its freeze preflight as a live historical owner.
insert into public.variation_listing_revisions
  (revision_id, group_id, captured_desired_revision, snapshot_version, snapshot_digest, snapshot, operation_count, operation_plan)
values (${q(otherRevision)}::uuid, ${q(otherGroup)}::uuid, 1, 1,
  encode(extensions.digest(public.variation_listing_recovery_canonical_json(jsonb_build_object('other', ${q(targetFront)})), 'sha256'), 'hex'),
  jsonb_build_object('other', ${q(targetFront)}), 1,
  jsonb_build_array(jsonb_build_object('otherPlan', ${q(`https://images.invalid/prefix/${sourceBack}`)})));
insert into public.variation_listing_publishing_checkpoints
  (checkpoint_id, revision_id, operation_key, attempt_number, checkpoint_number, state, observed_remote_state, evidence)
values (${q(otherCheckpoint)}::uuid, ${q(otherRevision)}::uuid, 'remove-group-membership', 1, 1, 'confirmed_complete', 'present',
  jsonb_build_object('checkpointNested', jsonb_build_object('url', ${q(`https://images.invalid/prefix/${targetBack}`)}, 'unsafe', jsonb_build_array(null, 8))));
insert into public.variation_listing_removed_sku_remote_retirements
  (revision_id, group_id, target_variation_id, target_sku, target_offer_id, marketplace_id, listing_id,
   c2_confirmed_revision, c2_terminal_checkpoint_id, state, observed_remote_state, evidence, started_at, completed_at)
values (${q(otherRevision)}::uuid, ${q(otherGroup)}::uuid, ${q(targetVariation)}::uuid, ${q(targetSku)}, 'other-offer', 'EBAY_US',
  'other-listing', 1, ${q(otherCheckpoint)}::uuid, 'confirmed_complete', 'proven_absent',
  jsonb_build_object('otherEvidence', jsonb_build_object('source', ${q(sourceFront)})), now(), now());

insert into public.variation_listing_removed_sku_cleanup_journals
  (journal_id, group_id, revision_id, target_variation_id, target_sku)
values (${q(journal)}::uuid, ${q(group)}::uuid, ${q(revision)}::uuid, ${q(targetVariation)}::uuid, ${q(targetSku)}),
       (${q(otherJournal)}::uuid, ${q(otherGroup)}::uuid, ${q(otherRevision)}::uuid, ${q(targetVariation)}::uuid, ${q(targetSku)});
insert into public.variation_listing_removed_sku_cleanup_resources
  (journal_id, resource_kind, resource_identity)
values (${q(journal)}::uuid, 'r2', ${q(targetBack)}),
       (${q(journal)}::uuid, 'local', ${q(sourceBack)}),
       (${q(otherJournal)}::uuid, 'r2', ${q(targetFront)}),
       (${q(otherJournal)}::uuid, 'local', ${q(sourceFront)});

-- More than forty distinct checkpoint owners exercise bounded sample output.
insert into public.variation_listing_publishing_checkpoints
  (checkpoint_id, revision_id, operation_key, attempt_number, checkpoint_number, state, observed_remote_state, evidence)
select ('eeeeeeee-eeee-4eee-8eee-' || lpad(to_hex(i), 12, '0'))::uuid,
       ${q(otherRevision)}::uuid, 'remove-group-membership', i + 1, 1,
       'confirmed_complete', 'present',
       jsonb_build_object('bulk', jsonb_build_object('resource', ${q(targetFront)}, 'i', i, 'unsafe', null))
  from generate_series(1, 45) i;
`;

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
    await psql(await read('packages/data/tests/removed-sku-historical-reference-audit.prototype.sql'));
    await psql(`grant usage on schema public to anon, authenticated, service_role;
grant all privileges on table public.listings to service_role;
grant select on table public.listings to anon, authenticated;`);
    await psql(`insert into removed_sku_writer_barrier.trusted_r2_url_bases(base_url) values (${q(baseUrl)});`);
    await psql(seed);

    const def = await psql(`select prosecdef, proconfig, lower(pg_get_functiondef(p.oid))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'removed_sku_writer_barrier' and p.proname = 'inspect_exact_historical_references';`);
    assert(def.startsWith('t|{"search_path=\\"\\""}|'), 'SECURITY DEFINER and empty search_path');
    assert(def.includes("strict $.** ? (@.type() == \"string\")"), 'strict recursive JSONPath');
    assert(!def.includes('insert into removed_sku_writer_barrier.frozen_r2_keys'), 'inspector has no marker insert');
    const publicExecute = await psql(`select not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
       where n.nspname = 'removed_sku_writer_barrier'
         and p.proname = 'inspect_exact_historical_references'
         and acl.grantee = 0 and acl.privilege_type in ('EXECUTE', 'ALL'));`);
    assert(publicExecute.trim() === 't', 'PUBLIC has no inspector EXECUTE privilege');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await expectError(`select ${exactCall};`, `${role} inspector ACL`, role, 'permission denied', '42501');
      await expectError('select count(*) from removed_sku_writer_barrier.frozen_r2_keys;', `${role} marker read`, role, 'permission denied', '42501');
      const schemaAcl = await psql(`select not has_schema_privilege('${role}', 'removed_sku_writer_barrier', 'usage');`);
      assert(schemaAcl.trim() === 't', `${role} schema usage denied`);
    }

    const first = JSON.parse((await psql(`begin; select ${exactCall}; commit;`)).trim());
    assert(first.revisionId === revision && first.groupId === group
      && first.targetVariationId === targetVariation && first.targetSku === targetSku, 'exact c2b/v3 identity');
    assert(JSON.stringify(first.r2ObjectKeys) === JSON.stringify([targetBack, targetFront]), 'exact sorted keys');
    assert(JSON.stringify(first.sourceRefs) === JSON.stringify([sourceBack, sourceFront]), 'exact sorted source refs');
    assert(first.preflightBlockedByOwnerReference === true, 'generic owner preflight blocker surfaced');
    assert(!Object.hasOwn(first, 'preflightBlockedByCrossGroupReference'), 'result does not overclaim blocker cause');
    assert(first.sameGroupHistoricalReferencesVerified === false && first.journalHistoryVerified === false && first.referenceSearchComplete === false, 'history flags fail closed');
    assert(first.freezeAuthorized === false && first.deletionAuthorized === false, 'authority flags remain false');
    assert(first.scannedStores.length === 5 && first.scannedStores.includes('revision_operation_plan'), 'known stores documented');
    assert(first.totalReferenceMatches === 60 && first.matchSampleTruncated === true, 'bounded sample truncation and total count');
    assert(first.matchSample.length === 40, 'sample bounded to forty rows');
    assert(first.sameGroupHistoricalMatches === 7, 'same-group snapshot/plan/retirement hits');
    assert(first.crossGroupMatches === 49, 'cross-group revision/plan/checkpoint/retirement hits');
    assert(first.journalMatches === 4, 'journal resource hits counted once per document');
    const sampleIdentity = row => JSON.stringify([row.scope, row.owner, row.kind, row.resource, row.classification]);
    assert(new Set(first.matchSample.map(sampleIdentity)).size === first.matchSample.length, 'sample has no duplicate document/resource hits');
    assert(first.matchSample.every(row => typeof row.scope === 'string' && typeof row.owner === 'string'
      && (row.kind === 'r2_key' || row.kind === 'source_ref')
      && typeof row.resource === 'string' && typeof row.classification === 'string'), 'sample row shape');
    assert(first.matchSample.some(row => row.scope === 'checkpoint_evidence' && row.resource === targetFront), 'sample contains cross-group checkpoint hit');
    assert((await psql('select count(*) from removed_sku_writer_barrier.frozen_r2_keys;')).trim() === '0', 'scanner does not register marker');
    const classifications = await psql(`select count(*) filter (where classification = 'same_group_history_requires_review'), count(*) filter (where classification = 'cross_group_reference_requires_review'), count(*) filter (where classification = 'journal_requires_review') from jsonb_to_recordset(${q(JSON.stringify(first.matchSample))}::jsonb) as x(classification text);`);
    assert(classifications.trim().split('|').every(value => Number(value) >= 0), 'sample classification shape');

    await expectError(`begin; set transaction isolation level repeatable read; select ${exactCall};`, 'repeatable-read rejection', null, 'reference preflight requires READ COMMITTED');

    // Writer first: scanner waits on the same exact-key lock inherited from
    // EXEC4b, then performs a fresh READ COMMITTED statement after commit.
    const writer = session();
    const audit = session();
    writer.send(`begin; set role service_role; insert into public.listings(listing_id, listing_type, image_urls, r2_object_keys) values ('exec4c-writer', 'single', array[]::text[], array[${q(targetFront)}]::text[]); select 'WRITER_HELD';`);
    await writer.wait('WRITER_HELD');
    audit.send(`begin; select ${exactCall}; select 'AUDIT_DONE';`);
    await sleep(160);
    assert(!audit.seen('AUDIT_DONE'), 'scanner waits on writer lock');
    writer.send("commit; select 'WRITER_COMMITTED';");
    await writer.wait('WRITER_COMMITTED');
    assert((await writer.close()).ok, 'writer commit');
    await audit.wait('AUDIT_DONE');
    audit.send('commit; select \'AUDIT_COMMITTED\';');
    await audit.wait('AUDIT_COMMITTED');
    const auditResult = await audit.close();
    assert(auditResult.ok, 'post-lock scanner completes');
    const auditJson = JSON.parse(auditResult.output.split('\n').find(line => line.startsWith('{')));
    assert(auditJson.preflightBlockedByOwnerReference === true, 'live Standard owner uses generic blocker classification');
    assert(!Object.hasOwn(auditJson, 'preflightBlockedByCrossGroupReference'), 'live owner does not claim cross-group cause');
    assert(auditJson.freezeAuthorized === false && auditJson.deletionAuthorized === false, 'post-lock authority flags remain false');
    await psql("delete from public.listings where listing_id = 'exec4c-writer';", 'service_role');

    const acl = await psql(`select has_function_privilege('service_role', 'removed_sku_writer_barrier.inspect_exact_historical_references(uuid)', 'execute') = false
      and has_schema_privilege('service_role', 'removed_sku_writer_barrier', 'usage') = false;`);
    assert(acl.trim() === 't', 'service_role has no inspector/schema privilege');
    assert((await psql('select count(*) from removed_sku_writer_barrier.frozen_r2_keys;')).trim() === '0', 'no marker row on every branch');
    console.log('EXEC4c disposable historical-reference audit checks: passed (actual migrations + EXEC4b/EXEC4c prototypes; no hosted operation)');
  } finally {
    if (started) await docker(['rm', '-f', name]).catch(() => {});
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

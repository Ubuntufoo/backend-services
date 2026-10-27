#!/usr/bin/env node
/*
 * Disposable local transition/concurrency proof for the C2BRemoval01 repair
 * ledger.  This script never connects to Supabase and never prints fixture
 * contents, credentials, snapshots, or image URLs.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const fixturePath = process.env.C2B_REMOVAL01_FIXTURE_PATH;
if (!fixturePath) throw new Error('C2B_REMOVAL01_FIXTURE_PATH is required');
const fixtureStat = await stat(fixturePath);
if ((fixtureStat.mode & 0o077) !== 0) throw new Error('fixture must be mode 0600 or stricter');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const requiredKeys = ['group', 'variations', 'copies', 'revision', 'checkpoints'];
if (requiredKeys.some(key => !(key in fixture))) throw new Error('fixture shape is incomplete');
if (fixture.variations.length !== 3 || fixture.copies.length !== 3 || fixture.checkpoints.length !== 2) {
  throw new Error('fixture cardinality is not the exact incident scope');
}

const migrationNames = [
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
  '20261005153617_add_variation_listing_quantity_adjustment.sql',
  '20261021181500_stage_variation_listing_permanent_removal.sql',
  '20261021193000_execute_variation_listing_permanent_removal.sql',
  '20261023190000_durable_removed_sku_remote_retirement.sql',
  '20261026140000_c2b_removal01_incident_repair.sql',
];
const migrationPath = name => `${root}/supabase/migrations/${name}`;
const migrationText = await readFile(migrationPath('20261026140000_c2b_removal01_incident_repair.sql'), 'utf8');
if (!migrationText.includes("remoteState' is distinct from 'EXACT_CORRECTED_POST")) {
  throw new Error('null-safe remoteState guard is absent');
}

const name = `codex-c2b-removal01-transitions-${process.pid}-${randomBytes(3).toString('hex')}`;
const command = (file, args, input = '') => new Promise((resolve, reject) => {
  const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => code === 0
    ? resolve(stdout)
    : reject(new Error(`${file} failed (${code}): ${stderr.slice(-1200)}`)));
  child.stdin.end(input);
});
const docker = (args, input = '') => command('docker', args, input);
const psql = (sql, role = 'postgres') => docker([
  'exec', '-i', name, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse', '-U', role, '-d', 'postgres',
], sql);
const scalar = async sql => (await psql(sql)).trim().split(/\r?\n/).filter(Boolean).at(-1)?.trim();
const expectFailure = async (sql, label) => {
  try {
    await psql(sql);
    throw new Error(`${label} unexpectedly succeeded`);
  } catch (error) {
    if (error.message.includes('unexpectedly succeeded')) throw error;
  }
};
const concurrent = async (sqlA, sqlB) => Promise.allSettled([psql(sqlA), psql(sqlB)]);
const sqlString = value => `'${String(value).replaceAll("'", "''")}'`;
const jsonSql = value => `${sqlString(JSON.stringify(value))}::jsonb`;
const jsonbQuote = value => jsonSql(value);
const assert = (value, message) => { if (!value) throw new Error(`assertion failed: ${message}`); };

const groupId = fixture.group.group_id;
const revisionId = fixture.revision.revision_id;
const target = fixture.variations.find(row => row.sku.endsWith('-000001'));
if (!target) throw new Error('target variation is absent');
const snapshot = fixture.revision.snapshot;
const expectedPayload = structuredClone(snapshot.permanentRemoval.expectedGroupPayload);
expectedPayload.variantSKUs = ['BSKBL-C2BRemoval01-000002', 'BSKBL-C2BRemoval01-000003'];
const confirmed = snapshot.confirmed.aggregate.variations;
const selectorBySku = new Map(confirmed.map(row => [row.sku, row.selector_value]));
expectedPayload.variesBy.specifications[0].values = [selectorBySku.get(expectedPayload.variantSKUs[0]), selectorBySku.get(expectedPayload.variantSKUs[1])];
assert(expectedPayload.variesBy.specifications[0].values.every(Boolean), 'frozen selector projection is complete');

try {
  await docker(['run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_PASSWORD=codex-c2b-removal01', 'postgres:17-alpine']);
  for (let i = 0; i < 120; i += 1) {
    try { await psql('select 1'); break; } catch (error) { if (i === 119) throw error; await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  await psql("create role anon; create role authenticated; create role service_role; alter role service_role bypassrls; create schema extensions; grant usage on schema extensions to public; create extension pgcrypto; create function extensions.digest(data text, typ text) returns bytea language sql immutable as $$ select public.digest(data, typ); $$; grant execute on function extensions.digest(text,text) to public; create function public.set_row_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;");
  for (const file of migrationNames) await psql(await readFile(migrationPath(file), 'utf8'));

  // Import only the exact incident rows. jsonb_populate_record preserves all
  // immutable values; the one removed legacy column is supplied by schema.
  await psql(`begin;
    set constraints all deferred;
    set session_replication_role = replica;
    insert into public.variation_listing_groups select * from jsonb_populate_record(null::public.variation_listing_groups, ${jsonSql(fixture.group)});
    insert into public.variation_listing_variations select * from jsonb_populate_recordset(null::public.variation_listing_variations, ${jsonSql(fixture.variations)});
    insert into public.variation_listing_copies
      select * from jsonb_populate_recordset(null::public.variation_listing_copies, ${jsonSql(fixture.copies)});
    -- The immutable historical row intentionally predates the pending-removal
    -- guard.  Import it in the disposable copy with user triggers disabled;
    -- all FK/check values are then verified by the RPCs themselves.
    insert into public.variation_listing_revisions select * from jsonb_populate_record(null::public.variation_listing_revisions, ${jsonSql(fixture.revision)});
    insert into public.variation_listing_publishing_checkpoints select * from jsonb_populate_recordset(null::public.variation_listing_publishing_checkpoints, ${jsonSql(fixture.checkpoints)});
    set session_replication_role = origin;
    commit;`);

  const digest = await scalar(`select encode(extensions.digest(public.variation_listing_recovery_canonical_json(${jsonSql(snapshot)}), 'sha256'), 'hex');`);
  assert(digest === '602f38a42f0beb0f940a6f222c105ffa0914bbe0b0d3eff03a2830a0a6737727', 'canonical snapshot digest');
  const importedRelationships = await scalar(`select (select count(*) from public.variation_listing_groups where group_id=${sqlString(groupId)}) || '|' || (select count(*) from public.variation_listing_variations where group_id=${sqlString(groupId)}) || '|' || (select count(*) from public.variation_listing_copies c join public.variation_listing_variations v using (variation_id) where v.group_id=${sqlString(groupId)}) || '|' || (select count(*) from public.variation_listing_revisions where revision_id=${sqlString(revisionId)} and group_id=${sqlString(groupId)}) || '|' || (select count(*) from public.variation_listing_publishing_checkpoints where revision_id=${sqlString(revisionId)});`);
  assert(importedRelationships === '1|3|3|1|2', 'exact scoped fixture relationships');
  const payloadDigest = await scalar(`select encode(extensions.digest(public.variation_listing_recovery_canonical_json(${jsonSql(expectedPayload)}), 'sha256'), 'hex');`);
  assert(/^[0-9a-f]{64}$/.test(payloadDigest), 'corrected payload digest');

  const prepareArgs = `${sqlString(revisionId)},${sqlString(groupId)},${sqlString(revisionId)},${sqlString(target.variation_id)},'testuser_variationbuyer','EBAY_US','110591443545','602f38a42f0beb0f940a6f222c105ffa0914bbe0b0d3eff03a2830a0a6737727',${jsonbQuote(expectedPayload)},${sqlString(payloadDigest)}`;
  const call = body => `set role service_role; ${body}`;
  await psql(call(`select * from public.prepare_c2b_removal01_incident_repair(${prepareArgs});`));
  await psql(call(`select * from public.prepare_c2b_removal01_incident_repair(${prepareArgs});`));
  await expectFailure(call(`select * from public.prepare_c2b_removal01_incident_repair(${prepareArgs.replace("'testuser_variationbuyer'", "'foreign-seller'")});`), 'wrong seller prepare');
  await expectFailure(call(`insert into public.variation_listing_c2b_removal01_incident_repairs(repair_id,group_id,revision_id,group_key,seller_user_id,marketplace_id,listing_id,snapshot_digest,captured_desired_revision,expected_previous_confirmed_revision,target_variation_id,target_sku,target_offer_id,target_quantity,survivor_skus,survivor_offer_ids,survivor_quantities,corrected_group_payload,corrected_payload_digest) values (${sqlString(revisionId)},${sqlString(groupId)},${sqlString(revisionId)},'x','x','x','x',repeat('0',64),6,5,${sqlString(target.variation_id)},'x','x',0,array['x','y'],array['1','2'],array[1,1],'{}',repeat('0',64));`), 'direct service-role ledger DML');
  await psql(`set session_replication_role=replica; update public.variation_listing_groups set desired_revision=7 where group_id=${sqlString(groupId)}; set session_replication_role=origin;`);
  await expectFailure(call(`select * from public.start_c2b_removal01_incident_repair(${sqlString(revisionId)});`), 'stale desired-revision CAS');
  await psql(`set session_replication_role=replica; update public.variation_listing_groups set desired_revision=6 where group_id=${sqlString(groupId)}; set session_replication_role=origin;`);

  const startRace = await concurrent(
    call(`begin; select * from public.start_c2b_removal01_incident_repair(${sqlString(revisionId)}); commit;`),
    call(`begin; select * from public.start_c2b_removal01_incident_repair(${sqlString(revisionId)}); commit;`),
  );
  assert(startRace.filter(result => result.status === 'fulfilled').length === 1, 'concurrent start has one winner');
  const evidence = {
    revisionId, groupId, sellerUserId: 'testuser_variationbuyer', marketplaceId: 'EBAY_US', listingId: '110591443545',
    targetSku: 'BSKBL-C2BRemoval01-000001', targetOfferId: '11951367010',
    survivorSkus: ['BSKBL-C2BRemoval01-000002', 'BSKBL-C2BRemoval01-000003'],
    survivorOfferIds: ['11951368010', '11951369010'], remoteState: 'EXACT_CORRECTED_POST',
    originalSnapshotDigest: '602f38a42f0beb0f940a6f222c105ffa0914bbe0b0d3eff03a2830a0a6737727', correctedPayloadDigest: payloadDigest,
  };
  await psql(call(`select * from public.mark_unknown_c2b_removal01_incident_repair(${sqlString(revisionId)}, ${jsonbQuote({ outcome: 'ambiguous' })});`));
  await psql(call(`select * from public.mark_unknown_c2b_removal01_incident_repair(${sqlString(revisionId)}, ${jsonbQuote({ outcome: 'ambiguous' })});`));
  await psql(call(`select * from public.mark_post_c2b_removal01_incident_repair(${sqlString(revisionId)},'confirmed_post',${jsonbQuote(evidence)});`));
  await psql(call(`select * from public.mark_post_c2b_removal01_incident_repair(${sqlString(revisionId)},'confirmed_post',${jsonbQuote(evidence)});`));

  const checkpointId = randomUUID();
  const terminalRace = await concurrent(
    call(`begin; select * from public.append_terminal_c2b_removal01_incident_repair(${sqlString(revisionId)},${sqlString(checkpointId)},${jsonbQuote(evidence)}); commit;`),
    call(`begin; select * from public.append_terminal_c2b_removal01_incident_repair(${sqlString(revisionId)},${sqlString(randomUUID())},${jsonbQuote(evidence)}); commit;`),
  );
  assert(terminalRace.some(result => result.status === 'fulfilled'), 'concurrent terminal has a winner');
  const terminalCount = await scalar(`select count(*) from public.variation_listing_publishing_checkpoints where revision_id=${sqlString(revisionId)} and operation_key='remove-group-membership' and checkpoint_number=3;`);
  assert(terminalCount === '1', 'terminal checkpoint idempotence');
  const preserved = await scalar(`select count(*) from public.variation_listing_publishing_checkpoints where revision_id=${sqlString(revisionId)} and attempt_number=1 and checkpoint_number in (1,2);`);
  assert(preserved === '2', 'original started/unknown checkpoints preserved');

  const missingState = { ...evidence }; delete missingState.remoteState;
  const nullState = { ...evidence, remoteState: null };
  for (const [label, bad] of [['missing remoteState', missingState], ['null remoteState', nullState], ['wrong seller evidence', { ...evidence, sellerUserId: 'foreign-seller' }], ['wrong digest evidence', { ...evidence, correctedPayloadDigest: '0'.repeat(64) }]]) {
    await expectFailure(call(`select * from public.mark_post_c2b_removal01_incident_repair(${sqlString(revisionId)},'confirmed_post',${jsonbQuote(bad)});`), label);
  }
  for (const role of ['anon', 'authenticated']) {
    await expectFailure(`set role ${role}; select * from public.prepare_c2b_removal01_incident_repair(${prepareArgs});`, `${role} execute`);
  }
  const finalState = await scalar(`select state from public.variation_listing_c2b_removal01_incident_repairs where repair_id=${sqlString(revisionId)};`);
  assert(finalState === 'confirmed_post', 'repair terminal state');
  console.log('c2b-removal01 local transition/concurrency validation: passed (prepare duplicate, start-once, unknown, exact-post, terminal idempotence, denial cases)');
} finally {
  await docker(['rm', '-f', name]).catch(() => {});
}

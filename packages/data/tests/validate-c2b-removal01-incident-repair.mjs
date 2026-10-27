#!/usr/bin/env node
/* Disposable PostgreSQL schema/ACL validation. Never connects to hosted Supabase. */
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../../..', import.meta.url));
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
const migration = await readFile(migrationPath('20261026140000_c2b_removal01_incident_repair.sql'), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(`assertion failed: ${message}`); };
assert(migration.includes("group_id = '586051b7-970a-45bd-a53a-1d1a10285b42'"), 'incident group binding');
assert(migration.includes("revision_id = '0f8a4786-12a3-45d9-b293-63e2a6318260'"), 'incident revision binding');
assert(migration.includes("snapshot_digest = '602f38a42f0beb0f940a6f222c105ffa0914bbe0b0d3eff03a2830a0a6737727'"), 'original digest binding');
assert(migration.includes('expected_corrected_payload'), 'immutable corrected payload projection');
assert(migration.includes('c2b_removal01_incident_expected_survivor_selector_values'), 'historical evidence helper');
assert(/order by s\.capture_source_key for update/.test(migration), 'deterministic intake lock');
assert(/variation_listing_revisions where revision_id[\s\S]*for update/.test(migration), 'revision lock');
assert(migration.includes('append_variation_listing_permanent_removal_checkpoint'), 'terminal bridge uses existing c2 checkpoint append');
assert(!/append_terminal[\s\S]*delete\s+from\s+public\.variation_listing_publishing_checkpoints/i.test(migration), 'terminal bridge has no direct journal DML');
for (const field of ['revisionId', 'groupId', 'sellerUserId', 'marketplaceId', 'listingId', 'targetSku', 'targetOfferId', 'survivorSkus', 'survivorOfferIds', 'remoteState', 'originalSnapshotDigest', 'correctedPayloadDigest']) {
  assert(migration.includes(`p_evidence->>'${field}'`) || migration.includes(`p_evidence->'${field}'`), `post evidence binds ${field}`);
}
assert(migration.includes("remoteState' is distinct from 'EXACT_CORRECTED_POST"), 'post evidence rejects forged remote state');
assert(!/<>|\bnot in\b/i.test(migration), 'safety-critical migration has no nullable-sensitive <> or NOT IN guards');
for (const field of ['revisionId', 'groupId', 'sellerUserId', 'marketplaceId', 'listingId', 'targetSku', 'targetOfferId', 'remoteState', 'originalSnapshotDigest', 'correctedPayloadDigest']) {
  assert(migration.includes(`jsonb_typeof(p_evidence->'${field}') is distinct from 'string'`), `post evidence requires ${field} string type`);
}
for (const field of ['survivorSkus', 'survivorOfferIds']) {
  assert(migration.includes(`jsonb_typeof(p_evidence->'${field}') is distinct from 'array'`), `post evidence requires ${field} array type`);
}
for (const expression of [
  "x.state is distinct from 'planned'",
  "x.state is distinct from 'started'",
  "x.state is distinct from 'reconciled_post'",
  "x.state is distinct from 'confirmed_post'",
  "latest.state is distinct from 'unknown'",
  "latest.attempt_number is distinct from 1",
  "latest.checkpoint_number is distinct from 2",
]) {
  assert(migration.includes(expression), `transition predicate is null-safe: ${expression}`);
}

const name = `codex-c2b-removal01-${process.pid}-${randomBytes(3).toString('hex')}`;
const command = (file, args, input = '') => new Promise((resolve, reject) => {
  const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`${file} ${args.join(' ')} failed\n${stderr}${stdout}`)));
  child.stdin.end(input);
});
const docker = (args, input = '') => command('docker', args, input);
const psql = sql => docker(['exec', '-i', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', 'postgres'], sql);
const expectPsqlFailure = async (sql, label) => {
  try {
    await psql(sql);
    throw new Error(`${label} unexpectedly succeeded`);
  } catch (error) {
    if (error.message.includes('unexpectedly succeeded')) throw error;
  }
};
try {
  await docker(['run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_PASSWORD=codex-c2b-removal01', 'postgres:17-alpine']);
  for (let i = 0; i < 120; i += 1) {
    try { await psql('select 1'); break; } catch (error) { if (i === 119) throw error; await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  await psql("create role anon; create role authenticated; create role service_role; alter role service_role bypassrls; create schema extensions; grant usage on schema extensions to public; create extension pgcrypto; create function extensions.digest(data text, typ text) returns bytea language sql immutable as $$ select public.digest(data, typ); $$; grant execute on function extensions.digest(text,text) to public; create function public.set_row_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;");
  for (const file of migrationNames) await psql(await readFile(migrationPath(file), 'utf8'));
  const acl = await psql("select to_regclass('public.variation_listing_c2b_removal01_incident_repairs') is not null as table_exists, (select relrowsecurity from pg_class where oid='public.variation_listing_c2b_removal01_incident_repairs'::regclass) as rls, has_table_privilege('service_role','public.variation_listing_c2b_removal01_incident_repairs','insert') as service_insert, has_function_privilege('service_role','public.prepare_c2b_removal01_incident_repair(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,text)','execute') as prepare_service, has_function_privilege('public','public.prepare_c2b_removal01_incident_repair(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,text)','execute') as prepare_public, (select prosecdef from pg_proc where oid=to_regprocedure('public.append_terminal_c2b_removal01_incident_repair(uuid,uuid,jsonb)')) as bridge_definer;");
  assert(/t\s*\|\s*t\s*\|\s*f\s*\|\s*t\s*\|\s*f\s*\|\s*t/.test(acl), 'ledger RLS/ACL/SECURITY DEFINER contract');
  const helperAcl = await psql("select has_function_privilege('service_role','public.c2b_removal01_incident_expected_survivor_selector_values(jsonb)','execute') as service_execute, has_function_privilege('anon','public.c2b_removal01_incident_expected_survivor_selector_values(jsonb)','execute') as anon_execute, has_function_privilege('authenticated','public.c2b_removal01_incident_expected_survivor_selector_values(jsonb)','execute') as authenticated_execute, has_function_privilege('public','public.c2b_removal01_incident_expected_survivor_selector_values(jsonb)','execute') as public_execute;");
  assert(/f\s*\|\s*f\s*\|\s*f\s*\|\s*f/.test(helperAcl), 'historical evidence helper is private');

  const incidentSnapshot = {
    confirmed: { aggregate: { variations: [
      { sku: 'BSKBL-C2BRemoval01-000002', selector_value: 'Card B' },
      { sku: 'BSKBL-C2BRemoval01-000003', selector_value: 'Card C' },
      { sku: 'BSKBL-C2BRemoval01-000001', selector_value: 'Card A' },
    ] } },
    permanentRemoval: {
      expectedGroupPayload: {
        variantSKUs: ['BSKBL-C2BRemoval01-000002', 'BSKBL-C2BRemoval01-000003', 'BSKBL-C2BRemoval01-000001'],
        variesBy: { specifications: [{ name: 'Card', values: ['Card A', 'Card B', 'Card C'] }] },
      },
      inventoryItemPayloadsBySku: {
        'BSKBL-C2BRemoval01-000001': { product: { aspects: { Card: ['Card A'] } } },
        'BSKBL-C2BRemoval01-000002': { product: { aspects: { Card: ['Card B'] } } },
        'BSKBL-C2BRemoval01-000003': { product: { aspects: { Card: ['Card C'] } } },
      },
    },
  };
  const snapshotSql = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  const expectedSelectorsOutput = (await psql(`select public.c2b_removal01_incident_expected_survivor_selector_values(${snapshotSql(incidentSnapshot)});`)).trim().split(/\r?\n/).find(line => line.trim().startsWith('['));
  const expectedSelectors = JSON.parse(expectedSelectorsOutput);
  assert(JSON.stringify(expectedSelectors) === JSON.stringify(['Card B', 'Card C']), 'B,C,A/A,B,C historical evidence projection');
  const helperDenials = [
    ['wrong Item Card', (value) => { value.permanentRemoval.inventoryItemPayloadsBySku['BSKBL-C2BRemoval01-000001'].product.aspects.Card = ['Card X']; }],
    ['Item payload map missing', (value) => { delete value.permanentRemoval.inventoryItemPayloadsBySku['BSKBL-C2BRemoval01-000002']; }],
    ['Item payload map foreign', (value) => { delete value.permanentRemoval.inventoryItemPayloadsBySku['BSKBL-C2BRemoval01-000002']; value.permanentRemoval.inventoryItemPayloadsBySku['BSKBL-C2BRemoval01-999999'] = { product: { aspects: { Card: ['Card B'] } } }; }],
    ['Group Card missing', (value) => { value.permanentRemoval.expectedGroupPayload.variesBy.specifications[0].values = ['Card A', 'Card B']; }],
    ['Group Card foreign', (value) => { value.permanentRemoval.expectedGroupPayload.variesBy.specifications[0].values = ['Card A', 'Card B', 'Card X']; }],
    ['Group Card duplicate', (value) => { value.permanentRemoval.expectedGroupPayload.variesBy.specifications[0].values = ['Card A', 'Card B', 'Card B']; }],
    ['Group SKU missing', (value) => { value.permanentRemoval.expectedGroupPayload.variantSKUs = ['BSKBL-C2BRemoval01-000002', 'BSKBL-C2BRemoval01-000003']; }],
    ['Group SKU foreign', (value) => { value.permanentRemoval.expectedGroupPayload.variantSKUs = ['BSKBL-C2BRemoval01-000002', 'BSKBL-C2BRemoval01-000003', 'BSKBL-C2BRemoval01-999999']; }],
    ['Group SKU duplicate', (value) => { value.permanentRemoval.expectedGroupPayload.variantSKUs = ['BSKBL-C2BRemoval01-000002', 'BSKBL-C2BRemoval01-000003', 'BSKBL-C2BRemoval01-000003']; }],
  ];
  for (const [label, mutate] of helperDenials) {
    const bad = structuredClone(incidentSnapshot);
    mutate(bad);
    await expectPsqlFailure(`select public.c2b_removal01_incident_expected_survivor_selector_values(${snapshotSql(bad)});`, label);
  }
  console.log(`c2b-removal01 historical evidence helper validation: 1 positive + ${helperDenials.length} denial cases passed`);
  try { await psql("set role service_role; insert into public.variation_listing_c2b_removal01_incident_repairs(repair_id,group_id,revision_id,group_key,seller_user_id,marketplace_id,listing_id,snapshot_digest,captured_desired_revision,expected_previous_confirmed_revision,target_variation_id,target_sku,target_offer_id,target_quantity,survivor_skus,survivor_offer_ids,survivor_quantities,corrected_group_payload,corrected_payload_digest) values (gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'x','x','x','x',repeat('0',64),6,5,gen_random_uuid(),'x','x',0,array['x','y'],array['1','2'],array[1,1],'{}',repeat('0',64));"); throw new Error('direct service_role ledger write unexpectedly succeeded'); } catch (error) { if (error.message.includes('unexpectedly succeeded')) throw error; }
  const repairRecord = "jsonb_populate_record(null::public.variation_listing_c2b_removal01_incident_repairs, '{\"revision_id\":\"0f8a4786-12a3-45d9-b293-63e2a6318260\",\"group_id\":\"586051b7-970a-45bd-a53a-1d1a10285b42\",\"seller_user_id\":\"testuser_variationbuyer\",\"marketplace_id\":\"EBAY_US\",\"listing_id\":\"110591443545\",\"snapshot_digest\":\"602f38a42f0beb0f940a6f222c105ffa0914bbe0b0d3eff03a2830a0a6737727\",\"corrected_payload_digest\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"target_sku\":\"BSKBL-C2BRemoval01-000001\",\"target_offer_id\":\"11951367010\",\"survivor_skus\":[\"BSKBL-C2BRemoval01-000002\",\"BSKBL-C2BRemoval01-000003\"],\"survivor_offer_ids\":[\"11951368010\",\"11951369010\"]}'::jsonb)";
  const validEvidence = {
    revisionId: '0f8a4786-12a3-45d9-b293-63e2a6318260',
    groupId: '586051b7-970a-45bd-a53a-1d1a10285b42',
    sellerUserId: 'testuser_variationbuyer',
    marketplaceId: 'EBAY_US',
    listingId: '110591443545',
    targetSku: 'BSKBL-C2BRemoval01-000001',
    targetOfferId: '11951367010',
    survivorSkus: ['BSKBL-C2BRemoval01-000002', 'BSKBL-C2BRemoval01-000003'],
    survivorOfferIds: ['11951368010', '11951369010'],
    remoteState: 'EXACT_CORRECTED_POST',
    originalSnapshotDigest: '602f38a42f0beb0f940a6f222c105ffa0914bbe0b0d3eff03a2830a0a6737727',
    correctedPayloadDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  };
  const evidenceSql = value => `'${JSON.stringify(value)}'::jsonb`;
  const requiredEvidenceFields = [
    'revisionId', 'groupId', 'sellerUserId', 'marketplaceId', 'listingId',
    'targetSku', 'targetOfferId', 'survivorSkus', 'survivorOfferIds',
    'remoteState', 'originalSnapshotDigest', 'correctedPayloadDigest',
  ];
  const denialCases = [
    ['empty post evidence', {}],
    ...requiredEvidenceFields.map(field => {
      const x = { ...validEvidence };
      delete x[field];
      return [`missing ${field}`, x];
    }),
    ['null revision identity', { ...validEvidence, revisionId: null }],
    ['null remote state', { ...validEvidence, remoteState: null }],
    ['empty remote state', { ...validEvidence, remoteState: '' }],
    ['wrong remote state', { ...validEvidence, remoteState: 'EXACT_PRE' }],
    ['wrong seller identity', { ...validEvidence, sellerUserId: 'foreign-seller' }],
    ['wrong group identity', { ...validEvidence, groupId: '00000000-0000-0000-0000-000000000000' }],
    ['null survivor SKU evidence', { ...validEvidence, survivorSkus: null }],
    ['wrong survivor SKU evidence type', { ...validEvidence, survivorSkus: 'BSKBL-C2BRemoval01-000002' }],
    ['null corrected payload digest', { ...validEvidence, correctedPayloadDigest: null }],
    ['wrong original snapshot digest', { ...validEvidence, originalSnapshotDigest: '0'.repeat(64) }],
  ];
  for (const [label, evidence] of denialCases) {
    await expectPsqlFailure(`select public.c2b_removal01_incident_require_post_evidence(${evidenceSql(evidence)}, ${repairRecord});`, label);
  }
  console.log(`c2b-removal01 post-evidence denial validation: ${denialCases.length} cases passed`);
  console.log('c2b-removal01 schema/ACL validation: passed');
} finally { await docker(['rm', '-f', name]).catch(() => {}); }

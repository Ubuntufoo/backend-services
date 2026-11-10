#!/usr/bin/env node
/* Disposable PostgreSQL 17 validation for the read-only removed-SKU witness. */
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const name = `codex-witness-${process.pid}-${randomBytes(4).toString('hex')}`;
const password = 'synthetic-witness-postgres';

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
const psql = (sql, role = null) => docker(
  ['exec', '-i', name, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse', '-At', '-U', 'postgres', '-d', 'postgres'],
  role ? `set role ${role};\n${sql}` : sql,
);
const sqlLiteral = value => value === null
  ? 'null'
  : `'${String(value).replaceAll("'", "''")}'`;
const jsonLiteral = value => `${sqlLiteral(JSON.stringify(value))}::jsonb`;
const assert = (condition, message) => { if (!condition) throw new Error(`assertion failed: ${message}`); };
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const groups = {
  clean: { id: '11111111-1111-4111-8111-111111111111', revision: '11111111-1111-4111-8111-111111111191', bucket: 'CleanA', listing: '10000000001' },
  noCheckpoint: { id: '22222222-2222-4222-8222-222222222222', revision: '22222222-2222-4222-8222-222222222292', bucket: 'NoCheckpointB', listing: '10000000002' },
  badOperation: { id: '33333333-3333-4333-8333-333333333333', revision: '33333333-3333-4333-8333-333333333393', bucket: 'BadOperationC', listing: '10000000003' },
  liveTarget: { id: '44444444-4444-4444-8444-444444444444', revision: '44444444-4444-4444-8444-444444444494', bucket: 'LiveTargetD', listing: '10000000004' },
  otherGroup: { id: '55555555-5555-4555-8555-555555555555', revision: '55555555-5555-4555-8555-555555555595', bucket: 'OtherGroupE', listing: '10000000005' },
};

for (const group of Object.values(groups)) {
  group.key = `VL-G-${group.id.replaceAll('-', '').toUpperCase()}`;
  group.variationIds = [1, 2, 3].map(serial => `${group.id.slice(0, -1)}${serial}`);
  group.copyIds = [1, 2, 3].map(serial => `${group.id.slice(0, -1)}${serial + 3}`);
  group.skus = [1, 2, 3].map(serial => `OTHER-${group.bucket}-${String(serial).padStart(6, '0')}`);
  group.targetVariationId = group.variationIds[1];
  group.targetSku = group.skus[1];
  group.targetCopyId = group.copyIds[1];
  group.targetFront = `variation-listing/${group.bucket}/front-2`;
  group.targetBack = `variation-listing/${group.bucket}/back-2`;
  group.targetFrontRef = `${group.bucket}-front-2`;
  group.targetBackRef = `${group.bucket}-back-2`;
}

const read = relative => readFile(`${root}/${relative}`, 'utf8');

const seedGroup = group => `
begin;
set local app.variation_listing_write_scope = 'aggregate';
set local app.variation_listing_group_id = ${sqlLiteral(group.id)};
set local app.variation_listing_expected_revision = '0';
create temp table variation_listing_aggregate_revision_proof (
  transaction_id xid8 not null, group_id uuid not null, from_revision bigint not null, to_revision bigint not null
) on commit drop;
insert into public.variation_listing_groups
  (group_id, group_key, sku_category_code, sku_bucket_token, category_id, marketplace_id,
   merchant_location_key, fulfillment_policy_id, return_policy_id, condition_id, payment_policy_id,
   condition_token, lifecycle_state, desired_revision, last_confirmed_revision)
values (${sqlLiteral(group.id)}::uuid, ${sqlLiteral(group.key)}, 'OTHER', ${sqlLiteral(group.bucket)}, '261328', 'EBAY_US',
        'synthetic-location', 'synthetic-fulfillment', 'synthetic-return', '1000', 'synthetic-payment',
        'VERY_GOOD', 'active', 1, 1);
insert into pg_temp.variation_listing_aggregate_revision_proof
  values (pg_current_xact_id(), ${sqlLiteral(group.id)}::uuid, 0, 1);
${group.variationIds.map((variationId, index) => {
  const serial = index + 1;
  const copyId = group.copyIds[index];
  const sku = group.skus[index];
  const front = `variation-listing/${group.bucket}/front-${serial}`;
  const back = `variation-listing/${group.bucket}/back-${serial}`;
  const frontRef = `${group.bucket}-front-${serial}`;
  const backRef = `${group.bucket}-back-${serial}`;
  return `insert into public.variation_listing_variations
    (variation_id, group_id, inventory_serial, sku, position, selector_value, price_amount, variation_metadata)
  values (${sqlLiteral(variationId)}::uuid, ${sqlLiteral(group.id)}::uuid, ${serial}, ${sqlLiteral(sku)}, ${index},
          ${sqlLiteral(`Card ${serial}`)}, 0.99, '{}'::jsonb);
insert into public.variation_listing_copies
  (copy_id, variation_id, condition_token, front_r2_key, back_r2_key, capture_source_key,
   capture_pair_id, capture_front_source_ref, capture_back_source_ref, capture_started_at)
values (${sqlLiteral(copyId)}::uuid, ${sqlLiteral(variationId)}::uuid, 'VERY_GOOD', ${sqlLiteral(front)}, ${sqlLiteral(back)},
        ${sqlLiteral(`${group.bucket}-source-${serial}`)}, ${sqlLiteral(copyId)}::uuid,
        ${sqlLiteral(frontRef)}, ${sqlLiteral(backRef)}, '2026-01-01T00:00:00Z');
update public.variation_listing_variations
   set representative_copy_id = ${sqlLiteral(copyId)}::uuid
 where variation_id = ${sqlLiteral(variationId)}::uuid;`;
}).join('\n')}
commit;`;

const aggregate = group => `jsonb_build_object(
  'group', (select to_jsonb(g) from public.variation_listing_groups g where g.group_id = ${sqlLiteral(group.id)}::uuid),
  'variations', (select coalesce(jsonb_agg(to_jsonb(v) order by v.position), '[]'::jsonb)
                   from public.variation_listing_variations v where v.group_id = ${sqlLiteral(group.id)}::uuid),
  'copies', (select coalesce(jsonb_agg(to_jsonb(c) order by c.copy_id), '[]'::jsonb)
              from public.variation_listing_copies c
              join public.variation_listing_variations v on v.variation_id = c.variation_id
             where v.group_id = ${sqlLiteral(group.id)}::uuid)
)`;

const snapshot = group => `jsonb_build_object(
  'aggregate', ${aggregate(group)},
  'confirmed', jsonb_build_object(
    'aggregate', ${aggregate(group)},
    'remote', jsonb_build_object('listingId', ${sqlLiteral(group.listing)})
  ),
  'permanentRemoval', jsonb_build_object(
    'version', 1,
    'groupKey', ${sqlLiteral(group.key)},
    'marketplaceId', 'EBAY_US',
    'targetVariationId', ${sqlLiteral(group.targetVariationId)},
    'targetSku', ${sqlLiteral(group.targetSku)},
    'listingId', ${sqlLiteral(group.listing)},
    'survivorSkus', jsonb_build_array(${sqlLiteral(group.skus[0])}, ${sqlLiteral(group.skus[2])})
  )
)`;

const intent = group => `jsonb_build_object(
  'groupKey', ${sqlLiteral(group.key)},
  'targetSku', ${sqlLiteral(group.targetSku)},
  'survivorSkus', jsonb_build_array(${sqlLiteral(group.skus[0])}, ${sqlLiteral(group.skus[2])})
)`;

const seedRevision = (group, { checkpoint = true, badDigest = false } = {}) => `
with payload as (
  select ${snapshot(group)} as snapshot, ${intent(group)} as intent
)
insert into public.variation_listing_revisions
  (revision_id, group_id, captured_desired_revision, snapshot_version, snapshot_digest,
   snapshot, operation_count, operation_plan)
select ${sqlLiteral(group.revision)}::uuid, ${sqlLiteral(group.id)}::uuid, 1, 3,
       encode(extensions.digest(public.variation_listing_recovery_canonical_json(snapshot), 'sha256'), 'hex'),
       snapshot, 1,
       jsonb_build_array(jsonb_build_object(
         'operation_key', 'remove-group-membership',
         'operation_kind', 'permanent_removal_group_membership',
         'target_ref', ${sqlLiteral(group.key)},
         'sequence_no', 1,
         'intent_version', 1,
         'intent_digest', ${badDigest
           ? "repeat('0', 64)"
           : "encode(extensions.digest(public.variation_listing_recovery_canonical_json(intent), 'sha256'), 'hex')"},
         'intent', intent
       ))
  from payload;
${checkpoint ? `insert into public.variation_listing_publishing_checkpoints
  (checkpoint_id, revision_id, operation_key, attempt_number, checkpoint_number, state,
   observed_remote_state, evidence)
values (${sqlLiteral(`${group.id.slice(0, -1)}9`)}::uuid, ${sqlLiteral(group.revision)}::uuid,
        'remove-group-membership', 1, 1, 'confirmed_complete', 'present',
        jsonb_build_object('listingId', ${sqlLiteral(group.listing)}, 'targetSku', ${sqlLiteral(group.targetSku)},
          'survivorSkus', jsonb_build_array(${sqlLiteral(group.skus[0])}, ${sqlLiteral(group.skus[2])}), 'state', 'removed'));` : ''}`;

const removeTarget = group => `
begin;
set local app.variation_listing_write_scope = 'aggregate';
set local app.variation_listing_group_id = ${sqlLiteral(group.id)};
set local app.variation_listing_expected_revision = '0';
create temp table variation_listing_aggregate_revision_proof (
  transaction_id xid8 not null, group_id uuid not null, from_revision bigint not null, to_revision bigint not null
) on commit drop;
insert into pg_temp.variation_listing_aggregate_revision_proof
  values (pg_current_xact_id(), ${sqlLiteral(group.id)}::uuid, 0, 1);
delete from public.variation_listing_copies where copy_id = ${sqlLiteral(group.targetCopyId)}::uuid;
delete from public.variation_listing_variations where variation_id = ${sqlLiteral(group.targetVariationId)}::uuid;
commit;`;

const assertFailure = async (sql, label, expected = null, role = 'service_role') => {
  try {
    await psql(sql, role);
  } catch (error) {
    if (expected && !error.message.toLowerCase().includes(expected.toLowerCase())) {
      throw new Error(`${label}: expected error containing ${JSON.stringify(expected)}, got ${error.message}`);
    }
    return;
  }
  throw new Error(`expected failure: ${label}`);
};

const witnessSql = group => `select public.inspect_variation_removed_sku_ownership(
  ${sqlLiteral(group.id)}::uuid, ${sqlLiteral(group.revision)}::uuid,
  ${sqlLiteral(group.targetVariationId)}::uuid, ${sqlLiteral(group.targetSku)}
);`;

async function main() {
  const [listings, persistence, journal, simplify, canonicalMigration, witness] = await Promise.all([
    read('supabase/migrations/20260516220000_create_listings_table.sql'),
    read('supabase/migrations/20260828150000_create_variation_listing_persistence.sql'),
    read('supabase/migrations/20260829150000_create_variation_listing_publishing_journal.sql'),
    read('supabase/migrations/20260831170000_simplify_variation_listing_persistence.sql'),
    read('supabase/migrations/20260904183000_recover_failed_initial_variation_publication.sql'),
    read('supabase/migrations/20261023140500_read_only_variation_removed_sku_ownership_witness.sql'),
  ]);
  const canonicalStart = canonicalMigration.indexOf('create function public.variation_listing_recovery_canonical_json');
  const canonicalEnd = canonicalMigration.indexOf('\n\ncreate function public.return_variation_listing_to_review', canonicalStart);
  assert(canonicalStart >= 0 && canonicalEnd > canonicalStart, 'canonical helper extraction');
  const canonical = canonicalMigration.slice(canonicalStart, canonicalEnd);

  let started = false;
  try {
    await docker(['run', '-d', '--rm', '--network', 'none', '--name', name, '-e', `POSTGRES_PASSWORD=${password}`, 'postgres:17-alpine']);
    started = true;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      try { await psql('select 1;'); break; }
      catch (error) {
        if (attempt === 239) throw new Error(`postgres readiness timeout: ${error.message}`);
        await sleep(250);
      }
    }

    await psql(`create role anon;
create role authenticated;
create role service_role;
alter role service_role bypassrls;
create schema extensions;
create extension pgcrypto;
create or replace function public.set_row_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create or replace function extensions.digest(data text, typ text)
returns bytea language sql immutable strict as $$ select public.digest(data, typ); $$;
grant execute on function extensions.digest(text, text) to public;`);
    await psql(listings);
    await psql(persistence);
    await psql(journal);
    await psql(simplify);
    await psql(canonical);
    await psql(witness);

    await psql(Object.values(groups).map(seedGroup).join('\n'));
    await psql([
      seedRevision(groups.clean),
      seedRevision(groups.noCheckpoint, { checkpoint: false }),
      seedRevision(groups.badOperation, { badDigest: true }),
      seedRevision(groups.liveTarget),
      seedRevision(groups.otherGroup),
    ].join('\n'));
    await psql([
      removeTarget(groups.clean),
      removeTarget(groups.noCheckpoint),
      removeTarget(groups.badOperation),
      removeTarget(groups.otherGroup),
    ].join('\n'));

    const clean = JSON.parse((await psql(witnessSql(groups.clean), 'service_role')).trim());
    const expectedKeys = [
      'version', 'groupId', 'revisionId', 'targetVariationId', 'targetSku', 'confirmedRevision',
      'desiredRevision', 'capturedDesiredRevision', 'copyIds', 'r2ObjectKeys', 'sourceRefs',
      'liveVariationReferenceCount', 'standardReferenceCount', 'otherGroupRevisionReferenceCount',
      'sameGroupHistoricalReferencesVerified', 'journalHistoryVerified', 'referenceSearchComplete',
      'singleStatementSnapshot', 'deletionAuthorized',
    ];
    assert(JSON.stringify(Object.keys(clean).sort()) === JSON.stringify([...expectedKeys].sort()), 'exact witness JSON keys');
    assert(clean.version === 1 && clean.groupId === groups.clean.id && clean.revisionId === groups.clean.revision && clean.targetVariationId === groups.clean.targetVariationId && clean.targetSku === groups.clean.targetSku, 'witness identity');
    assert(clean.confirmedRevision === 1 && clean.desiredRevision === 1 && clean.capturedDesiredRevision === 1, 'witness revision watermarks');
    assert(clean.copyIds.length === 1 && clean.copyIds[0] === groups.clean.targetCopyId, 'target copy identity');
    assert(clean.r2ObjectKeys.length === 2 && clean.r2ObjectKeys.includes(groups.clean.targetFront) && clean.r2ObjectKeys.includes(groups.clean.targetBack), 'target R2 identity');
    assert(clean.sourceRefs.length === 2 && clean.sourceRefs.includes(groups.clean.targetFrontRef) && clean.sourceRefs.includes(groups.clean.targetBackRef), 'target source identity');
    assert(clean.liveVariationReferenceCount === 0 && clean.standardReferenceCount === 0 && clean.otherGroupRevisionReferenceCount === 0, 'clean reference counts');
    assert(clean.sameGroupHistoricalReferencesVerified === false && clean.journalHistoryVerified === false && clean.referenceSearchComplete === false, 'incomplete coverage flags');
    assert(clean.singleStatementSnapshot === true && clean.deletionAuthorized === false, 'read-only safety flags');

    await assertFailure(witnessSql(groups.clean).replace(groups.clean.revision, '99999999-9999-4999-8999-999999999999'), 'foreign revision identity', 'revision does not exist');
    await assertFailure(witnessSql(groups.noCheckpoint), 'missing terminal checkpoint', 'lacks exact terminal membership proof');
    await assertFailure(witnessSql(groups.badOperation), 'malformed operation digest', 'operation intent digest is invalid');
    await assertFailure(witnessSql(groups.liveTarget), 'still-live target', 'target still exists');

    await psql(`insert into public.listings (listing_id, listing_type, r2_object_keys, image_urls)
values (${sqlLiteral('synthetic-standard-conflict')}, 'single',
  jsonb_build_array(${sqlLiteral(groups.clean.targetFront)}),
  jsonb_build_array(${sqlLiteral(`https://images.invalid/raw/${groups.clean.targetBack}`)}, ${sqlLiteral(`https://images.invalid/${groups.clean.targetFront.replaceAll('/', '%2f')}`)}));`);
    const conflict = JSON.parse((await psql(witnessSql(groups.clean), 'service_role')).trim());
    assert(conflict.standardReferenceCount === 1, 'raw and encoded standard references counted');
    assert(conflict.deletionAuthorized === false, 'standard conflict remains non-authorizing');

    const historical = JSON.parse((await psql(witnessSql(groups.clean), 'service_role')).trim());
    assert(historical.otherGroupRevisionReferenceCount === 0, 'cross-group fixture starts clear');
    await psql(`insert into public.variation_listing_revisions
  (revision_id, group_id, captured_desired_revision, snapshot_version, snapshot_digest, snapshot, operation_count, operation_plan)
values (${sqlLiteral('66666666-6666-4666-8666-666666666666')}::uuid, ${sqlLiteral(groups.otherGroup.id)}::uuid, 2, 3,
  repeat('c', 64), ${jsonLiteral({ nested: groups.clean.targetFront })}, 1,
  ${jsonLiteral([{ resource: groups.clean.targetFrontRef }])});`);
    const crossGroup = JSON.parse((await psql(witnessSql(groups.clean), 'service_role')).trim());
    assert(crossGroup.otherGroupRevisionReferenceCount === 1, 'cross-group historical snapshot/operation-plan reference');
    assert(crossGroup.deletionAuthorized === false, 'cross-group evidence remains non-authorizing');

    await psql(`alter table public.listings alter column image_urls drop not null;
insert into public.listings (listing_id, listing_type, r2_object_keys, image_urls)
values (${sqlLiteral('synthetic-malformed-media')}, 'lot',
  jsonb_build_array(${sqlLiteral('   ')}), null);`);
    await assertFailure(witnessSql(groups.clean), 'malformed and NULL standard media arrays', 'standard listing media arrays are malformed');

    const aclRows = (await psql(`select coalesce(bool_or(x.grantee = (select oid from pg_roles where rolname = 'service_role') and x.privilege_type = 'EXECUTE'), false),
       coalesce(bool_or(x.grantee = (select oid from pg_roles where rolname = 'anon') and x.privilege_type = 'EXECUTE'), false),
       coalesce(bool_or(x.grantee = (select oid from pg_roles where rolname = 'authenticated') and x.privilege_type = 'EXECUTE'), false),
       coalesce(bool_or(x.grantee = 0 and x.privilege_type = 'EXECUTE'), false)
  from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
 where p.oid = 'public.inspect_variation_removed_sku_ownership(uuid,uuid,uuid,text)'::regprocedure;`)).trim().split('|');
    assert(aclRows.join('|') === 't|f|f|f' || aclRows.join('|') === 'true|false|false|false', `service_role-only function ACL (${aclRows.join('|')})`);
    const functionFlags = (await psql(`select p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig, ','), '')
      from pg_proc p where p.oid = 'public.inspect_variation_removed_sku_ownership(uuid,uuid,uuid,text)'::regprocedure;`)).trim().split('|');
    assert(functionFlags[0] === 't' && functionFlags[1] === 's' && functionFlags[2] === 'search_path=""', `security definer stable hardened search_path (${functionFlags.join('|')})`);
    await assertFailure(witnessSql(groups.clean), 'anon cannot execute witness', 'permission denied for function', 'anon');
    await assertFailure(witnessSql(groups.clean), 'authenticated cannot execute witness', 'permission denied for function', 'authenticated');

    console.log('witness integration: passed (1 green path, 9 fail-closed paths, ACL/search_path checks)');
  } finally {
    if (started) await docker(['rm', '-f', name]).catch(() => {});
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

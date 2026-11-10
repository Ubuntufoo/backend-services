#!/usr/bin/env node
/* Disposable PostgreSQL 17 validation for the offline cleanup journal. */
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const name = `codex-cleanup-journal-${process.pid}-${randomBytes(4).toString('hex')}`;
const password = 'synthetic-cleanup-journal-postgres';
const migrationPath = `${root}/supabase/migrations/20261110180000_create_removed_sku_cleanup_journal.sql`;

const command = (file, args, input = '') => new Promise((resolve, reject) => {
  const child = spawn(file, args, {stdio: ['pipe', 'pipe', 'pipe']});
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
const psql = (sql, role = null) => docker([
  'exec', '-i', name, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse', '-At', '-U', 'postgres', '-d', 'postgres',
], role ? `set role ${role};\n${sql}` : sql);
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const assert = (condition, message) => { if (!condition) throw new Error(`assertion failed: ${message}`); };
const expectFailure = async (sql, label, role = 'service_role') => {
  try { await psql(sql, role); } catch { return; }
  throw new Error(`expected failure: ${label}`);
};
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const groupId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const variationId = '33333333-3333-4333-8333-333333333333';
const sku = 'BSKBL-Cleanup-000002';
let started = false;
let journalId;

try {
  await docker(['run', '--rm', '--network', 'none', '--name', name, '-e', `POSTGRES_PASSWORD=${password}`, '-d', 'postgres:17-alpine']);
  started = true;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { await psql('select 1;'); break; }
    catch { if (attempt === 29) throw new Error('postgres did not become ready'); await sleep(500); }
  }
  const migration = await readFile(migrationPath, 'utf8');
  await psql("create extension if not exists pgcrypto; create role service_role; create role anon; create role authenticated;");
  await psql(migration);
  const create = `select public.create_variation_listing_removed_sku_cleanup_journal(
    ${literal(groupId)}::uuid, ${literal(revisionId)}::uuid, ${literal(variationId)}::uuid, ${literal(sku)},
    ARRAY['/synthetic/removed/front.jpg', '/synthetic/removed/back.jpg']::text[],
    ARRAY['variation-listing/synthetic/front', 'variation-listing/synthetic/back']::text[]
  );`;
  journalId = (await psql(create, 'service_role')).trim();
  assert(/^[0-9a-f-]{36}$/.test(journalId), 'journal id');
  assert((await psql(`select count(*) from public.variation_listing_removed_sku_cleanup_resources where journal_id = ${literal(journalId)}::uuid;`, 'postgres')).trim() === '4', 'four frozen resources');
  const duplicate = (await psql(create, 'service_role')).trim();
  assert(duplicate === journalId, 'duplicate exact plan is idempotent');
  await expectFailure(create.replace('/synthetic/removed/back.jpg', '/synthetic/removed/other.jpg'), 'duplicate identity with different frozen resource set');
  await expectFailure(`select public.create_variation_listing_removed_sku_cleanup_journal(${literal(groupId)}::uuid, ${literal(revisionId)}::uuid, ${literal(variationId)}::uuid, ${literal(sku)}, ARRAY['/synthetic/removed/front.jpg','/synthetic/removed/front.jpg']::text[], ARRAY['variation-listing/synthetic/back']::text[]);`, 'duplicate resource');
  await expectFailure(create.replace(sku, `\t${sku}`), 'tab-whitespace target SKU');
  await expectFailure(create.replace('/synthetic/removed/front.jpg', '\t/synthetic/removed/front.jpg'), 'tab-whitespace resource identity');
  const otherRevision = '44444444-4444-4444-8444-444444444444';
  const otherJournalId = (await psql(create.replace(revisionId, otherRevision), 'service_role')).trim();
  assert(otherJournalId !== journalId, 'wrong revision remains a distinct journal identity');
  assert((await psql(`select count(*) from public.variation_listing_removed_sku_cleanup_resources where journal_id = ${literal(otherJournalId)}::uuid;`, 'postgres')).trim() === '4', 'wrong revision resource isolation');

  const start = `select * from public.transition_variation_listing_removed_sku_cleanup_resource(${literal(journalId)}::uuid, 'r2', 'variation-listing/synthetic/front', 'planned', 'attempting', 0, null);`;
  assert((await psql(start, 'service_role')).trim() === 'attempting|1|1', 'durable attempt barrier');
  await expectFailure(start, 'stale CAS start');
  assert((await psql(`select state || '|' || attempt_count from public.variation_listing_removed_sku_cleanup_resources where journal_id = ${literal(journalId)}::uuid and resource_kind = 'local' and resource_identity = '/synthetic/removed/front.jpg';`, 'postgres')).trim() === 'planned|0', 'survivor isolation');
  assert((await psql(`select * from public.recover_variation_listing_removed_sku_cleanup_resource(${literal(journalId)}::uuid, 'r2', 'variation-listing/synthetic/front', 1);`, 'service_role')).trim() === 'unknown|1|2', 'crashed attempt recovery');
  await expectFailure(`select * from public.transition_variation_listing_removed_sku_cleanup_resource(${literal(journalId)}::uuid, 'r2', 'variation-listing/synthetic/front', 'unknown', 'attempting', 2, null);`, 'blind retry after unknown');
  await expectFailure(`select * from public.transition_variation_listing_removed_sku_cleanup_resource(${literal(journalId)}::uuid, 'r2', 'variation-listing/synthetic/front', 'unknown', 'removed', 2, null);`, 'unknown cannot imply removal');

  const secondStart = (await psql(`select * from public.transition_variation_listing_removed_sku_cleanup_resource(${literal(journalId)}::uuid, 'r2', 'variation-listing/synthetic/back', 'planned', 'attempting', 0, null);`, 'service_role')).trim();
  assert(secondStart === 'attempting|1|1', 'second resource starts independently');
  assert((await psql(`select * from public.transition_variation_listing_removed_sku_cleanup_resource(${literal(journalId)}::uuid, 'r2', 'variation-listing/synthetic/back', 'attempting', 'removed', 1, null);`, 'service_role')).trim() === 'removed|1|2', 'terminal proof recorded');
  await expectFailure(`select * from public.transition_variation_listing_removed_sku_cleanup_resource(${literal(journalId)}::uuid, 'r2', 'variation-listing/synthetic/back', 'removed', 'attempting', 2, null);`, 'terminal resource retry');
  await expectFailure(`select * from public.transition_variation_listing_removed_sku_cleanup_resource(${literal(journalId)}::uuid, 'r2', 'variation-listing/synthetic/back', 'removed', 'removed', 2, null);`, 'terminal resource rewrite');
  assert((await psql(`select operator_confirmed || '|' || deletion_authorized from public.variation_listing_removed_sku_cleanup_journals where journal_id = ${literal(journalId)}::uuid;`, 'postgres')).trim() === 'false|false', 'non-authorizing flags');
  await expectFailure(`update public.variation_listing_removed_sku_cleanup_journals set operator_confirmed = true where journal_id = ${literal(journalId)}::uuid;`, 'forged operator confirmation', 'postgres');
  await expectFailure(`update public.variation_listing_removed_sku_cleanup_journals set deletion_authorized = true where journal_id = ${literal(journalId)}::uuid;`, 'forged deletion authorization', 'postgres');
  await expectFailure(`select * from public.variation_listing_removed_sku_cleanup_journals;`, 'table access denied', 'service_role');
  await expectFailure(create, 'anonymous create denied', 'anon');
  const acl = (await psql("select has_function_privilege('service_role','public.transition_variation_listing_removed_sku_cleanup_resource(uuid,text,text,text,text,integer,text)','execute'), has_function_privilege('anon','public.transition_variation_listing_removed_sku_cleanup_resource(uuid,text,text,text,text,integer,text)','execute'), p.proconfig::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'transition_variation_listing_removed_sku_cleanup_resource';", 'postgres')).trim();
  assert(acl === 't|f|{"search_path=pg_catalog, public, pg_temp"}', `service-role ACL/search_path (${acl})`);
  console.log('cleanup journal integration: passed (immutable plan, 4-resource isolation, strict CAS, crash/unknown barrier, terminal proof, ACL/search_path)');
} finally {
  if (started) {
    try { await docker(['stop', '-t', '5', name]); } catch { try { await docker(['rm', '-f', name]); } catch {} }
  }
}

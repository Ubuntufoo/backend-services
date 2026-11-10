#!/usr/bin/env node
/*
 * Disposable PostgreSQL 17 blocked-mode validation for removed-SKU cleanup.
 *
 * This intentionally applies only the existing non-authorizing journal
 * migration.  It must not discover or guess a future freeze/tombstone
 * migration name, and it never connects to a hosted database.
 */
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readFile, readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsRoot = `${root}/supabase/migrations`;
const migrationPath = `${migrationsRoot}/20261110180000_create_removed_sku_cleanup_journal.sql`;
const name = `codex-removed-sku-tombstone-${process.pid}-${randomBytes(4).toString('hex')}`;
const password = 'synthetic-removed-sku-tombstone-postgres';

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
const psqlArgs = [
  'exec', '-i', name, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
  '-v', 'VERBOSITY=terse', '-At', '-U', 'postgres', '-d', 'postgres',
];
const psql = (sql, role = null) => docker(psqlArgs, role ? `set role ${role};\n${sql}` : sql);
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const assert = (condition, message) => { if (!condition) throw new Error(`assertion failed: ${message}`); };
const expectFailure = async (sql, label, role = null) => {
  try {
    await psql(sql, role);
  } catch {
    return;
  }
  throw new Error(`expected failure: ${label}`);
};
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

/** Keep a psql transaction open so a second session can prove no lock exists. */
function openPsql(role = null) {
  const child = spawn('docker', psqlArgs, {stdio: ['pipe', 'pipe', 'pipe']});
  let stdout = '';
  let stderr = '';
  let closed = false;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0
      ? resolve(stdout)
      : reject(new Error(`psql session failed\n${stderr}${stdout}`)));
  });
  const send = sql => child.stdin.write(role ? `set role ${role};\n${sql}\n` : `${sql}\n`);
  const waitFor = async marker => {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      if (stdout.includes(marker)) return;
      await sleep(10);
    }
    throw new Error(`psql session marker timed out: ${marker}\n${stderr}${stdout}`);
  };
  const close = () => {
    if (!closed) {
      closed = true;
      child.stdin.end();
    }
    return done;
  };
  return {send, waitFor, close};
}

async function assertNoCleanupFreezeMigration() {
  const files = (await readdir(migrationsRoot)).filter(file => file.endsWith('.sql'));
  /* Existing copy-condition freeze is unrelated; only removed-SKU cleanup
   * guard/tombstone/freeze names would violate this blocked-mode assertion. */
  const prohibited = /(?:removed[_-]?sku|cleanup).*?(?:tombstone|freeze|guard)|(?:tombstone|freeze|guard).*?(?:removed[_-]?sku|cleanup)/i;
  const matches = files.filter(file => prohibited.test(file));
  assert(matches.length === 0, `unexpected cleanup freeze/tombstone migration: ${matches.join(', ')}`);
}

const base = {
  group: '11111111-1111-4111-8111-111111111111',
  revision: '22222222-2222-4222-8222-222222222222',
  variation: '33333333-3333-4333-8333-333333333333',
  sku: 'BSKBL-Blocked-000002',
};
const createSql = identity => `select public.create_variation_listing_removed_sku_cleanup_journal(
  ${literal(identity.group)}::uuid, ${literal(identity.revision)}::uuid,
  ${literal(identity.variation)}::uuid, ${literal(identity.sku)},
  ARRAY['/synthetic/not-authoritative/front.jpg']::text[],
  ARRAY['variation-listing/not-authoritative/front']::text[]
);`;

async function proveNonSerialization() {
  await psql(`create table public.synthetic_variation_refs (ref_id uuid primary key, resource text not null);
create table public.synthetic_standard_refs (ref_id uuid primary key, r2_object_keys text[] not null, image_urls text[] not null);`);
  const first = {
    group: '44444444-4444-4444-8444-444444444444',
    revision: '55555555-5555-4555-8555-555555555555',
    variation: '66666666-6666-4666-8666-666666666666',
    sku: 'BSKBL-Blocked-000004',
  };
  const second = {
    group: '77777777-7777-4777-8777-777777777777',
    revision: '88888888-8888-4888-8888-888888888888',
    variation: '99999999-9999-4999-8999-999999999999',
    sku: 'BSKBL-Blocked-000005',
  };
  const holder = openPsql();
  const probe = openPsql();
  try {
    holder.send(`begin;
${createSql(first)}
insert into public.synthetic_variation_refs values (${literal(first.variation)}::uuid, 'variation-listing/not-authoritative/front');
select 'JOURNAL_VARIATION_HELD' as marker;`);
    await holder.waitFor('JOURNAL_VARIATION_HELD');
    probe.send(`begin;
insert into public.synthetic_standard_refs values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, ARRAY['variation-listing/not-authoritative/front']::text[], ARRAY['https://images.invalid/variation-listing/not-authoritative/front']::text[]);
commit;
select 'STANDARD_COMMITTED_WHILE_JOURNAL_HELD' as marker;`);
    await probe.waitFor('STANDARD_COMMITTED_WHILE_JOURNAL_HELD');
    await probe.close();
    holder.send(`commit; select 'JOURNAL_COMMITTED' as marker;`);
    await holder.waitFor('JOURNAL_COMMITTED');
    await holder.close();
  } catch (error) {
    try { holder.close(); } catch {}
    try { probe.close(); } catch {}
    throw error;
  }

  const reverseHolder = openPsql();
  const reverseProbe = openPsql();
  try {
    reverseHolder.send(`begin;
insert into public.synthetic_standard_refs values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, ARRAY['variation-listing/not-authoritative/front']::text[], ARRAY['https://images.invalid/variation-listing/not-authoritative/front']::text[]);
select 'STANDARD_HELD' as marker;`);
    await reverseHolder.waitFor('STANDARD_HELD');
    reverseProbe.send(`begin;
${createSql(second)}
insert into public.synthetic_variation_refs values (${literal(second.variation)}::uuid, 'variation-listing/not-authoritative/front');
commit;
select 'JOURNAL_COMMITTED_WHILE_STANDARD_HELD' as marker;`);
    await reverseProbe.waitFor('JOURNAL_COMMITTED_WHILE_STANDARD_HELD');
    reverseHolder.send(`commit; select 'STANDARD_COMMITTED' as marker;`);
    await reverseHolder.waitFor('STANDARD_COMMITTED');
    await Promise.all([reverseHolder.close(), reverseProbe.close()]);
  } catch (error) {
    try { reverseHolder.close(); } catch {}
    try { reverseProbe.close(); } catch {}
    throw error;
  }

  assert((await psql("select count(*) from public.synthetic_variation_refs;")).trim() === '2', 'both Variation references committed');
  assert((await psql("select count(*) from public.synthetic_standard_refs;")).trim() === '2', 'both Standard references committed');
  assert((await psql(`select count(*) from public.variation_listing_removed_sku_cleanup_journals where group_id in (${literal(first.group)}::uuid, ${literal(second.group)}::uuid);`)).trim() === '2', 'both journal creations committed');
}

let started = false;
try {
  await assertNoCleanupFreezeMigration();
  await docker(['run', '--rm', '--network', 'none', '--name', name, '-e', `POSTGRES_PASSWORD=${password}`, '-d', 'postgres:17-alpine']);
  started = true;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { await psql('select 1;'); break; }
    catch { if (attempt === 29) throw new Error('postgres did not become ready'); await sleep(500); }
  }

  const migration = await readFile(migrationPath, 'utf8');
  await psql('create extension if not exists pgcrypto; create role service_role; create role anon; create role authenticated;');
  await psql(migration);

  const journalId = (await psql(createSql(base), 'service_role')).trim();
  assert(/^[0-9a-f-]{36}$/.test(journalId), 'arbitrary caller-supplied identity creates journal');
  assert((await psql(`select operator_confirmed || '|' || deletion_authorized from public.variation_listing_removed_sku_cleanup_journals where journal_id = ${literal(journalId)}::uuid;`)).trim() === 'false|false', 'journal remains non-authorizing');
  await expectFailure(`update public.variation_listing_removed_sku_cleanup_journals set operator_confirmed = true where journal_id = ${literal(journalId)}::uuid;`, 'forged operator confirmation');
  await expectFailure(`update public.variation_listing_removed_sku_cleanup_journals set deletion_authorized = true where journal_id = ${literal(journalId)}::uuid;`, 'forged deletion authorization');
  await expectFailure('select * from public.variation_listing_removed_sku_cleanup_journals;', 'service_role journal table access', 'service_role');
  await expectFailure('select * from public.variation_listing_removed_sku_cleanup_resources;', 'service_role resource table access', 'service_role');
  await expectFailure(createSql({...base, group: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}), 'anonymous RPC execution', 'anon');

  const acl = (await psql(`select count(*) filter (where has_function_privilege('service_role', p.oid, 'execute')) || '|' ||
    count(*) filter (where has_function_privilege('anon', p.oid, 'execute')) || '|' ||
    count(*) filter (where p.prosecdef and p.proconfig = ARRAY['search_path=pg_catalog, public, pg_temp']::text[])
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in (
   'create_variation_listing_removed_sku_cleanup_journal',
   'transition_variation_listing_removed_sku_cleanup_resource',
   'recover_variation_listing_removed_sku_cleanup_resource'
 );`)).trim();
  assert(acl === '3|0|3', `service_role-only ACL and pinned SECURITY DEFINER search_path (${acl})`);
  const rls = (await psql(`select count(*) from pg_class where relnamespace = 'public'::regnamespace
    and relname in ('variation_listing_removed_sku_cleanup_journals','variation_listing_removed_sku_cleanup_resources')
    and relrowsecurity;`)).trim();
  assert(rls === '2', 'journal tables have RLS enabled');

  await proveNonSerialization();
  console.log('removed-SKU tombstone blocked-mode validation: passed (arbitrary journal identity, no authorization, ACL/search_path, absent guard migration, non-serialization proof)');
} finally {
  if (started) {
    try { await docker(['stop', '-t', '5', name]); } catch { try { await docker(['rm', '-f', name]); } catch {} }
  }
}

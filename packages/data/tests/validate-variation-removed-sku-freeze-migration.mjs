#!/usr/bin/env node
/*
 * Disposable PG17 proof for the EXEC4a writer-barrier shape.
 *
 * Applies the CLI-generated migration to disposable PostgreSQL only. This
 * validator never connects to hosted Supabase and never authorizes cleanup.
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const name = `yp9-c4a-${process.pid}-${randomBytes(3).toString('hex')}`;
const password = randomBytes(16).toString('hex');
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const assert = (condition, message) => { if (!condition) throw new Error(`assertion failed: ${message}`); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
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
    if (state) assert(text.includes(`SQL state: ${state}`) || text.includes(`ERROR:  ${state}:`), `${label}: SQLSTATE ${text}`);
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

const barrierMigration = '20261111223116_create_removed_sku_exact_key_writer_barrier.sql';

const bootstrap = `
create role anon;
create role authenticated;
create role service_role;
alter role service_role bypassrls;
create schema extensions;
create extension if not exists pgcrypto;
create or replace function public.set_row_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create or replace function extensions.digest(data text, typ text) returns bytea language sql immutable strict as $$ select public.digest(data, typ); $$;
grant execute on function extensions.digest(text, text) to public;
`;

const groupId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const variationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const frozenKey = 'variation-listing/bridgeb/front-frozen.jpg';
const safeKey = 'variation-listing/bridgeb/front-safe.jpg';
const safeBack = 'variation-listing/bridgeb/back-safe.jpg';
const writerKey = 'variation-listing/bridgeb/front-writer.jpg';
const revisionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

async function main() {
  let started = false;
  try {
    await docker(['run', '--rm', '--network', 'none', '--name', name, '-e', `POSTGRES_PASSWORD=${password}`, '-d', 'postgres:17-alpine']);
    started = true;
    for (let i = 0; i < 60; i += 1) { try { await psql('select 1'); break; } catch (error) { if (i === 59) throw error; await sleep(250); } }
    await psql(bootstrap);
    for (const migration of migrations) await psql(await read(`supabase/migrations/${migration}`));
    await psql(`grant usage on schema public to anon, authenticated, service_role;
grant all privileges on table public.listings to service_role;
grant select on table public.listings to anon, authenticated;`);
    await psql(await read(`supabase/migrations/${barrierMigration}`));
    const effectiveObjects = await psql(`select
      to_regprocedure('public.inspect_variation_removed_sku_ownership(uuid,uuid,uuid,text)') is not null
      and to_regprocedure('public.complete_variation_listing_removed_sku_remote_retirement(uuid,jsonb)') is not null
      and to_regclass('public.variation_listing_removed_sku_cleanup_journals') is not null;`);
    assert(effectiveObjects.trim() === 't', 'effective c2b, witness, and EXEC1 objects present');
    const securityDefiners = await psql(`select string_agg(
      p.proname || ':' || case when p.prosecdef then 'definer' else 'invoker' end, ',' order by p.proname
    ) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'removed_sku_writer_barrier';`);
    assert(
      securityDefiners.trim() === 'decode_ascii:invoker,guard_standard:definer,guard_variation:definer,lock_keys:invoker,reject_frozen:invoker,standard_keys:invoker',
      `only writer guards are SECURITY DEFINER: ${securityDefiners}`,
    );

    // Trusted origins are fixture-only and seeded before the protected registry ACL.
    await psql("insert into removed_sku_writer_barrier.trusted_r2_url_bases(base_url) values ('https://images.murphyfamilyhobby.dev'), ('https://cdn.example.test/media');");
    await psql(`insert into removed_sku_writer_barrier.frozen_r2_keys(key, revision_id) values (${q(frozenKey)}, ${q(revisionId)}::uuid);`);

    // Unrelated Standard references and paired URL/key uploads remain writable.
    await psql("insert into public.listings(listing_id, listing_type, image_urls, r2_object_keys) values ('c4a-safe', 'single', array['https://images.murphyfamilyhobby.dev/listings/standard/a.jpg']::text[], array['listings/standard/a.jpg']::text[]);", 'service_role');
    await psql("update public.listings set image_urls = array['https://images.murphyfamilyhobby.dev/listings/standard/a-2.jpg']::text[] where listing_id = 'c4a-safe';", 'service_role');
    await psql("insert into public.listings(listing_id, listing_type, image_urls, r2_object_keys) values ('c4a-paired', 'single', array['https://images.murphyfamilyhobby.dev/listings/standard/paired.jpg']::text[], array['listings/standard/paired.jpg']::text[]);", 'service_role');
    await psql("insert into public.listings(listing_id, listing_type, image_urls, r2_object_keys) values ('c4a-encoded-unrelated', 'single', array['https://images.murphyfamilyhobby.dev/listings/legacy%20image.jpg']::text[], array[]::text[]);", 'service_role');
    await expectError(`insert into public.listings(listing_id, listing_type, image_urls, r2_object_keys) values ('c4a-frozen', 'single', array['https://images.murphyfamilyhobby.dev/${frozenKey}']::text[], array[]::text[]);`, 'frozen Standard URL', 'service_role', 'retired R2 key frozen');
    await expectError(`insert into public.listings(listing_id, listing_type, image_urls, r2_object_keys) values ('c4a-frozen-key', 'single', array[]::text[], array[${q(frozenKey)}]::text[]);`, 'frozen Standard key', 'service_role', 'retired R2 key frozen');
    await expectError(`update public.listings set r2_object_keys = array[${q(frozenKey)}]::text[] where listing_id = 'c4a-safe';`, 'frozen Standard update', 'service_role', 'retired R2 key frozen');
    await expectError(`insert into public.listings(listing_id, listing_type, image_urls, r2_object_keys) values ('c4a-foreign', 'single', array['https://foreign.example/${frozenKey}']::text[], array[]::text[]);`, 'foreign Variation URL', 'service_role', 'unrecognized Variation R2 URL origin');
    await expectError(`insert into public.listings(listing_id, listing_type, image_urls, r2_object_keys) values ('c4a-encoded', 'single', array['https://images.murphyfamilyhobby.dev/%76ariation-listing/bridgeb/front-frozen.jpg']::text[], array[]::text[]);`, 'encoded Variation URL', 'service_role', 'noncanonical Variation R2 URL');

    // Both effective Variation intake RPCs pass safe keys and reject frozen keys.
    const rpcGroup = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    await psql(`select public.create_variation_listing_group(${q(rpcGroup)}::uuid, ${q(`VL-G-${rpcGroup.replaceAll('-', '').toUpperCase()}`)}, 'OTHER', 'RpcC', '261328', 'EBAY_US', 'loc', 'fulfill', 'pay', 'return', '1000', 'VERY_GOOD');`, 'service_role');
    await psql(`select public.configure_variation_listing_intake('c4a-rpc-new', 'new_variation', ${q(rpcGroup)}::uuid, null, 0.99, null); select public.start_variation_listing_intake_pair('c4a-rpc-new', '11111111-1111-4111-8111-111111111112'::uuid, 'rpc-front', now());`, 'service_role');
    await psql(`select public.complete_variation_listing_new_variation('c4a-rpc-new', '11111111-1111-4111-8111-111111111113'::uuid, '11111111-1111-4111-8111-111111111114'::uuid, '11111111-1111-4111-8111-111111111112'::uuid, 'VERY_GOOD', 'Card RPC', '{}'::jsonb, ${q(safeKey)}, ${q(safeBack)}, 'rpc-back', now());`, 'service_role');
    await psql(`select public.configure_variation_listing_intake('c4a-rpc-dup', 'duplicate_copy', ${q(rpcGroup)}::uuid, '11111111-1111-4111-8111-111111111114'::uuid, 0.99, 'VERY_GOOD'); select public.start_variation_listing_intake_pair('c4a-rpc-dup', '11111111-1111-4111-8111-111111111115'::uuid, 'rpc-front-2', now());`, 'service_role');
    await psql(`select public.complete_variation_listing_duplicate_copy('c4a-rpc-dup', '11111111-1111-4111-8111-111111111116'::uuid, '11111111-1111-4111-8111-111111111115'::uuid, '11111111-1111-4111-8111-111111111114'::uuid, 'VERY_GOOD', 'variation-listing/RpcC/front-2.jpg', 'variation-listing/RpcC/back-2.jpg', 'rpc-back-2', now());`, 'service_role');
    await psql(`select public.configure_variation_listing_intake('c4a-rpc-frozen', 'new_variation', ${q(rpcGroup)}::uuid, null, 0.99, null); select public.start_variation_listing_intake_pair('c4a-rpc-frozen', '11111111-1111-4111-8111-111111111118'::uuid, 'rpc-frozen', now());`, 'service_role');
    await expectError(`select public.complete_variation_listing_new_variation('c4a-rpc-frozen', '11111111-1111-4111-8111-111111111119'::uuid, '11111111-1111-4111-8111-111111111120'::uuid, '11111111-1111-4111-8111-111111111118'::uuid, 'VERY_GOOD', 'Frozen', '{}'::jsonb, ${q(frozenKey)}, 'variation-listing/RpcC/frozen-back.jpg', 'rpc-frozen-back', now());`, 'frozen Variation RPC', 'service_role', 'retired R2 key frozen');
    await psql(`select public.configure_variation_listing_intake('c4a-rpc-frozen-dup', 'duplicate_copy', ${q(rpcGroup)}::uuid, '11111111-1111-4111-8111-111111111114'::uuid, 0.99, 'VERY_GOOD'); select public.start_variation_listing_intake_pair('c4a-rpc-frozen-dup', '11111111-1111-4111-8111-111111111121'::uuid, 'rpc-frozen-dup', now());`, 'service_role');
    await expectError(`select public.complete_variation_listing_duplicate_copy('c4a-rpc-frozen-dup', '11111111-1111-4111-8111-111111111122'::uuid, '11111111-1111-4111-8111-111111111121'::uuid, '11111111-1111-4111-8111-111111111114'::uuid, 'VERY_GOOD', ${q(frozenKey)}, 'variation-listing/RpcC/back-frozen.jpg', 'rpc-frozen-dup-back', now());`, 'frozen duplicate Variation RPC', 'service_role', 'retired R2 key frozen');

    // Two real intake RPCs sharing exact keys serialize on the same sorted
    // advisory locks; the second call cannot complete until the first commits.
    const rpcConcurrencyGroupA = '12121212-1212-4121-8121-121212121212';
    const rpcConcurrencyGroupB = '13131313-1313-4131-8131-131313131313';
    const rpcConcurrencyFront = 'variation-listing/RpcConcurrent/front-shared.jpg';
    const rpcConcurrencyBack = 'variation-listing/RpcConcurrent/back-shared.jpg';
    await psql(`select public.create_variation_listing_group(${q(rpcConcurrencyGroupA)}::uuid, 'VL-G-12121212121241218121121212121212', 'OTHER', 'RpcConcurrentA', '261328', 'EBAY_US', 'loc', 'fulfill', 'pay', 'return', '1000', 'VERY_GOOD');
select public.create_variation_listing_group(${q(rpcConcurrencyGroupB)}::uuid, 'VL-G-13131313131341318131131313131313', 'OTHER', 'RpcConcurrentB', '261328', 'EBAY_US', 'loc', 'fulfill', 'pay', 'return', '1000', 'VERY_GOOD');`, 'service_role');
    await psql(`select public.configure_variation_listing_intake('c4a-rpc-concurrent-a', 'new_variation', ${q(rpcConcurrencyGroupA)}::uuid, null, 0.99, null);
select public.start_variation_listing_intake_pair('c4a-rpc-concurrent-a', '14141414-1414-4141-8141-141414141414'::uuid, 'rpc-concurrent-a', now());
select public.configure_variation_listing_intake('c4a-rpc-concurrent-b', 'new_variation', ${q(rpcConcurrencyGroupB)}::uuid, null, 0.99, null);
select public.start_variation_listing_intake_pair('c4a-rpc-concurrent-b', '15151515-1515-4151-8151-151515151515'::uuid, 'rpc-concurrent-b', now());`, 'service_role');
    const variationRpcWriterA = session();
    const variationRpcWriterB = session();
    variationRpcWriterA.send(`begin; set role service_role; select public.complete_variation_listing_new_variation('c4a-rpc-concurrent-a', '16161616-1616-4161-8161-161616161616'::uuid, '17171717-1717-4171-8171-171717171717'::uuid, '14141414-1414-4141-8141-141414141414'::uuid, 'VERY_GOOD', 'Concurrent A', '{}'::jsonb, ${q(rpcConcurrencyFront)}, ${q(rpcConcurrencyBack)}, 'rpc-concurrent-a-back', now()); select 'VAR_RPC_A_HELD';`);
    await variationRpcWriterA.wait('VAR_RPC_A_HELD');
    variationRpcWriterB.send(`begin; set role service_role; select public.complete_variation_listing_new_variation('c4a-rpc-concurrent-b', '18181818-1818-4181-8181-181818181818'::uuid, '19191919-1919-4191-8191-191919191919'::uuid, '15151515-1515-4151-8151-151515151515'::uuid, 'VERY_GOOD', 'Concurrent B', '{}'::jsonb, ${q(rpcConcurrencyFront)}, ${q(rpcConcurrencyBack)}, 'rpc-concurrent-b-back', now()); select 'VAR_RPC_B_HELD';`);
    await sleep(120);
    assert(!variationRpcWriterB.seen('VAR_RPC_B_HELD'), 'Variation RPC waits on shared key lock');
    variationRpcWriterA.send("commit; select 'VAR_RPC_A_COMMITTED';");
    await variationRpcWriterA.wait('VAR_RPC_A_COMMITTED');
    assert((await variationRpcWriterA.close()).ok, 'first Variation RPC writer');
    await variationRpcWriterB.wait('VAR_RPC_B_HELD');
    variationRpcWriterB.send("commit; select 'VAR_RPC_B_COMMITTED';");
    await variationRpcWriterB.wait('VAR_RPC_B_COMMITTED');
    assert((await variationRpcWriterB.close()).ok, 'second Variation RPC writer');

    // Direct service_role Variation DML remains denied by the effective schema ACL.
    await expectError(`insert into public.variation_listing_copies(copy_id, variation_id, condition_token, front_r2_key, back_r2_key, capture_source_key, capture_pair_id, capture_front_source_ref, capture_back_source_ref, capture_started_at) values ('11111111-1111-4111-8111-111111111117'::uuid, '11111111-1111-4111-8111-111111111114'::uuid, 'VERY_GOOD', ${q(writerKey)}, ${q(safeBack)}, 'direct', '11111111-1111-4111-8111-111111111117'::uuid, 'f', 'b', now());`, 'direct Variation DML ACL', 'service_role', 'permission denied for table', '42501');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await expectError('select count(*) from removed_sku_writer_barrier.frozen_r2_keys;', `${role} marker read`, role, 'permission denied', '42501');
      await expectError(`insert into removed_sku_writer_barrier.frozen_r2_keys(key, revision_id) values (${q(writerKey)}, ${q(revisionId)}::uuid);`, `${role} marker write`, role, 'permission denied', '42501');
      await expectError(`update removed_sku_writer_barrier.frozen_r2_keys set revision_id = ${q(revisionId)}::uuid where key = ${q(frozenKey)};`, `${role} marker update`, role, 'permission denied', '42501');
      await expectError(`delete from removed_sku_writer_barrier.frozen_r2_keys where key = ${q(frozenKey)};`, `${role} marker delete`, role, 'permission denied', '42501');
      await expectError('select count(*) from removed_sku_writer_barrier.trusted_r2_url_bases;', `${role} trusted-origin read`, role, 'permission denied', '42501');
      await expectError("insert into removed_sku_writer_barrier.trusted_r2_url_bases(base_url) values ('https://acl.example.test');", `${role} trusted-origin insert`, role, 'permission denied', '42501');
      await expectError("update removed_sku_writer_barrier.trusted_r2_url_bases set base_url = 'https://acl2.example.test' where base_url = 'https://images.murphyfamilyhobby.dev';", `${role} trusted-origin update`, role, 'permission denied', '42501');
      await expectError("delete from removed_sku_writer_barrier.trusted_r2_url_bases where base_url = 'https://images.murphyfamilyhobby.dev';", `${role} trusted-origin delete`, role, 'permission denied', '42501');
      for (const helperCall of [
        `removed_sku_writer_barrier.decode_ascii('x')`,
        `removed_sku_writer_barrier.lock_keys(array[${q(writerKey)}]::text[])`,
        `removed_sku_writer_barrier.standard_keys('{}'::text[], '{}'::text[])`,
        `removed_sku_writer_barrier.reject_frozen('{}'::text[])`,
      ]) {
        await expectError(`select ${helperCall};`, `${role} barrier helper execute`, role, 'permission denied', '42501');
      }
    }
    const flags = await psql('select bool_and(deletion_authorized is false) from removed_sku_writer_barrier.frozen_r2_keys;');
    assert(flags.trim() === 't', 'authority remains false');
    const publicAcl = await psql(`select
      (select coalesce(bool_and(grantee <> 0), true) from aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))))
        and (select coalesce(bool_and(grantee <> 0), true) from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))))
      from pg_namespace n cross join pg_class c
      where n.oid = 'removed_sku_writer_barrier'::regnamespace
        and c.oid = 'removed_sku_writer_barrier.frozen_r2_keys'::regclass;`);
    assert(publicAcl.trim() === 't', 'PUBLIC has no schema/table privileges');

    // Writer first: freezer waits for the real Standard trigger lock, then can
    // commit only after writer rollback.  This also covers missing-row phantom.
    const writer = session();
    const freezer = session();
    writer.send(`begin; set role service_role; insert into public.listings(listing_id, listing_type, image_urls, r2_object_keys) values ('c4a-lock-writer', 'single', array['https://cdn.example.test/media/${writerKey}']::text[], array[]::text[]); select 'WRITER_HELD';`);
    await writer.wait('WRITER_HELD');
    freezer.send(`begin; select removed_sku_writer_barrier.lock_keys(array[${q(writerKey)}]::text[]); insert into removed_sku_writer_barrier.frozen_r2_keys(key, revision_id) values (${q(writerKey)}, ${q(revisionId)}::uuid); select 'FREEZER_DONE';`);
    await sleep(120);
    assert(!freezer.seen('FREEZER_DONE'), 'freezer waits on writer lock');
    writer.send("rollback; select 'WRITER_ROLLED_BACK';");
    await writer.wait('WRITER_ROLLED_BACK');
    assert((await writer.close()).ok, 'writer rollback');
    await freezer.wait('FREEZER_DONE');
    freezer.send("commit; select 'FREEZER_COMMITTED';");
    await freezer.wait('FREEZER_COMMITTED');
    assert((await freezer.close()).ok, 'freezer commit');
    await expectError(`insert into public.listings(listing_id, listing_type, image_urls, r2_object_keys) values ('c4a-phantom', 'single', array[]::text[], array[${q(writerKey)}]::text[]);`, 'missing-row phantom', 'service_role', 'retired R2 key frozen');

    // Reverse order: marker transaction holds the key first; writer waits and
    // fails after commit.  Rollback leaves no marker behind for this key.
    const reverseKey = 'variation-listing/bridgeb/front-reverse.jpg';
    const freezerFirst = session();
    const writerAfter = session();
    freezerFirst.send(`begin; select removed_sku_writer_barrier.lock_keys(array[${q(reverseKey)}]::text[]); insert into removed_sku_writer_barrier.frozen_r2_keys(key, revision_id) values (${q(reverseKey)}, ${q(revisionId)}::uuid); select 'FREEZE_HELD';`);
    await freezerFirst.wait('FREEZE_HELD');
    writerAfter.send(`begin; set role service_role; insert into public.listings(listing_id, listing_type, image_urls, r2_object_keys) values ('c4a-reverse', 'single', array[]::text[], array[${q(reverseKey)}]::text[]); select 'WRITER_AFTER_FREEZE';`);
    await sleep(120);
    assert(!writerAfter.seen('WRITER_AFTER_FREEZE'), 'writer waits on freezer lock');
    freezerFirst.send("commit; select 'FREEZE_COMMITTED';");
    await freezerFirst.wait('FREEZE_COMMITTED');
    assert((await freezerFirst.close()).ok, 'freezer-first commit');
    const writerResult = await writerAfter.close();
    assert(!writerResult.ok && String(writerResult.error).includes('retired R2 key frozen'), 'writer rejected after marker commit');

    // Marker rollback removes the row and releases the lock; a later writer
    // then succeeds, proving rollback does not leave a phantom freeze.
    const rollbackKey = 'variation-listing/bridgeb/front-rollback.jpg';
    const markerRollback = session();
    const writerAfterRollback = session();
    markerRollback.send(`begin; select removed_sku_writer_barrier.lock_keys(array[${q(rollbackKey)}]::text[]); insert into removed_sku_writer_barrier.frozen_r2_keys(key, revision_id) values (${q(rollbackKey)}, ${q(revisionId)}::uuid); select 'MARKER_ROLLBACK_HELD';`);
    await markerRollback.wait('MARKER_ROLLBACK_HELD');
    writerAfterRollback.send(`begin; set role service_role; insert into public.listings(listing_id, listing_type, image_urls, r2_object_keys) values ('c4a-after-rollback', 'single', array[]::text[], array[${q(rollbackKey)}]::text[]); select 'WRITER_AFTER_ROLLBACK';`);
    await sleep(120);
    assert(!writerAfterRollback.seen('WRITER_AFTER_ROLLBACK'), 'writer waits for rollback lock release');
    markerRollback.send("rollback; select 'MARKER_ROLLBACK_DONE';");
    await markerRollback.wait('MARKER_ROLLBACK_DONE');
    assert((await markerRollback.close()).ok, 'marker rollback');
    await writerAfterRollback.wait('WRITER_AFTER_ROLLBACK');
    writerAfterRollback.send("commit; select 'WRITER_AFTER_ROLLBACK_COMMITTED';");
    await writerAfterRollback.wait('WRITER_AFTER_ROLLBACK_COMMITTED');
    assert((await writerAfterRollback.close()).ok, 'writer after marker rollback');
    const rollbackRows = await psql(`select count(*) from removed_sku_writer_barrier.frozen_r2_keys where key = ${q(rollbackKey)};`);
    assert(rollbackRows.trim() === '0', 'marker rollback leaves no registry row');

    // Opposite input order still serializes through sorted per-key locks.
    const multiA = 'variation-listing/bridgeb/front-multi-a.jpg';
    const multiB = 'variation-listing/bridgeb/back-multi-b.jpg';
    const orderedWriter = session();
    const reverseWriter = session();
    orderedWriter.send(`begin; set role service_role; insert into public.listings(listing_id, listing_type, image_urls, r2_object_keys) values ('c4a-multi-a', 'single', array[]::text[], array[${q(multiA)}, ${q(multiB)}]::text[]); select 'MULTI_A_HELD';`);
    await orderedWriter.wait('MULTI_A_HELD');
    reverseWriter.send(`begin; set role service_role; insert into public.listings(listing_id, listing_type, image_urls, r2_object_keys) values ('c4a-multi-b', 'single', array[]::text[], array[${q(multiB)}, ${q(multiA)}]::text[]); select 'MULTI_B_HELD';`);
    await sleep(120);
    assert(!reverseWriter.seen('MULTI_B_HELD'), 'opposite-order writer waits on sorted locks');
    orderedWriter.send("commit; select 'MULTI_A_COMMITTED';");
    await orderedWriter.wait('MULTI_A_COMMITTED');
    assert((await orderedWriter.close()).ok, 'first multi-key writer');
    await reverseWriter.wait('MULTI_B_HELD');
    reverseWriter.send("commit; select 'MULTI_B_COMMITTED';");
    await reverseWriter.wait('MULTI_B_COMMITTED');
    assert((await reverseWriter.close()).ok, 'reverse multi-key writer');
    const triggers = (await psql("select tgname from pg_trigger where tgrelid = 'public.listings'::regclass and not tgisinternal order by tgname;")).trim();
    assert(triggers.endsWith('zz_removed_sku_standard_writer_barrier'), 'Standard barrier trigger order');
    const variationTriggers = (await psql("select tgname from pg_trigger where tgrelid = 'public.variation_listing_copies'::regclass and not tgisinternal order by tgname;")).trim();
    assert(variationTriggers.endsWith('zz_removed_sku_variation_writer_barrier'), 'Variation barrier trigger order');
    const journalRows = await psql('select count(*) from public.variation_listing_removed_sku_cleanup_journals;');
    assert(journalRows.trim() === '0', 'fixture seeds no EXEC1 journal rows');
    const journalConstraint = await psql("select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.variation_listing_removed_sku_cleanup_journals'::regclass and conname = 'variation_listing_removed_sku_cleanup_journals_flags_ck';");
    const normalizedJournalConstraint = journalConstraint.toLowerCase();
    assert(normalizedJournalConstraint.includes('operator_confirmed') && normalizedJournalConstraint.includes('deletion_authorized') && (normalizedJournalConstraint.includes('false') || normalizedJournalConstraint.includes('not')), `EXEC1 journal flags remain constrained false: ${journalConstraint}`);
    console.log('EXEC4a disposable writer-barrier checks: passed (actual unapplied migration; no hosted operation)');
  } finally {
    if (started) await docker(['rm', '-f', name]).catch(() => {});
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

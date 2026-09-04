#!/usr/bin/env node
/* Disposable SQL seam validation. Never connects to hosted Supabase. */
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const name = `codex-selector-${process.pid}-${randomBytes(4).toString('hex')}`;
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
];
const command = (file, args, input = '') => new Promise((resolve, reject) => {
  const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`${file} ${args.join(' ')} failed\n${stderr}${stdout}`)));
  child.stdin.end(input);
});
const docker = (args, input) => command('docker', args, input);
const psql = (sql, role = 'postgres') => docker(['exec', '-i', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', 'postgres'], role === 'postgres' ? sql : `set role ${role};\n${sql}`);
const sqlLiteral = value => value === null ? 'null' : `'${value.replaceAll("'", "''")}'`;
const assert = (condition, message) => { if (!condition) throw new Error(`assertion failed: ${message}`); };
const expectFailure = async (sql, message, label, role = 'service_role') => {
  try { await psql(sql, role); throw new Error(`expected failure: ${label}`); }
  catch (error) {
    if (error.message.startsWith('expected failure:')) throw error;
    if (!error.message.includes(message)) throw new Error(`${label}: expected ${message}, got ${error.message}`);
  }
};
const group = '11111111-1111-4111-8111-111111111111';
const otherGroup = '22222222-2222-4222-8222-222222222222';
const variation = '33333333-3333-4333-8333-333333333333';
const otherVariation = '44444444-4444-4444-8444-444444444444';
const wrongVariation = '55555555-5555-4555-8555-555555555555';
const copy = '66666666-6666-4666-8666-666666666666';
const otherCopy = '77777777-7777-4777-8777-777777777777';
const wrongCopy = '88888888-8888-4888-8888-888888888888';
const baseGroup = (id, key, bucket, lifecycle = 'intake') => `insert into public.variation_listing_groups(group_id,group_key,sku_category_code,sku_bucket_token,category_id,marketplace_id,merchant_location_key,fulfillment_policy_id,payment_policy_id,return_policy_id,condition_id,condition_token,lifecycle_state) values (${sqlLiteral(id)},${sqlLiteral(key)},'OTHER',${sqlLiteral(bucket)},'261328','EBAY_US','loc','fulfill','pay','return','1000','VERY_GOOD',${sqlLiteral(lifecycle)});`;
const baseVariation = (id, gid, serial, sku, selector, metadata = '{"keep":true}') => `insert into public.variation_listing_variations(variation_id,group_id,inventory_serial,sku,position,selector_value,price_amount,variation_metadata) values (${sqlLiteral(id)},${sqlLiteral(gid)},${serial},${sqlLiteral(sku)},${serial - 1},${sqlLiteral(selector)},0.99,${sqlLiteral(metadata)}::jsonb);`;
const staticFingerprint = `
select
  coalesce((select jsonb_agg(to_jsonb(g) - array['updated_at','desired_revision'] order by g.group_id) from public.variation_listing_groups g), '[]'::jsonb) as groups_static,
  coalesce((select jsonb_agg(to_jsonb(v) - array['updated_at','selector_value'] order by v.variation_id) from public.variation_listing_variations v), '[]'::jsonb) as variations_static,
  coalesce((select jsonb_agg(to_jsonb(c) order by c.copy_id) from public.variation_listing_copies c), '[]'::jsonb) as copies_static;`;

async function main() {
  await docker(['run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_PASSWORD=codex-selector-postgres', 'postgres:17-alpine']);
  try {
    for (let i = 0; i < 120; i += 1) {
      try { await psql('select 1'); break; } catch { if (i === 119) throw new Error('postgres readiness timeout'); await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    const migrations = (await Promise.all(migrationFiles.map(file => readFile(`${root}/${file}`, 'utf8')))).join('\n');
    await psql("create role anon; create role authenticated; create role service_role; alter role service_role bypassrls; create function public.set_row_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;" + migrations);
    await psql([
      baseGroup(group, 'VL-G-11111111111141118111111111111111', 'SelectorA'),
      baseGroup(otherGroup, 'VL-G-22222222222242228222222222222222', 'SelectorB'),
      'begin;',
      baseVariation(variation, group, 1, 'OTHER-SelectorA-000001', 'Card A'),
      baseVariation(otherVariation, group, 2, 'OTHER-SelectorA-000002', 'Card B', '{"keep":false,"nested":{"x":1}}'),
      baseVariation(wrongVariation, otherGroup, 1, 'OTHER-SelectorB-000001', 'Other Card'),
      `insert into public.variation_listing_copies(copy_id,variation_id,condition_token,front_r2_key,back_r2_key,capture_source_key,capture_pair_id,capture_front_source_ref,capture_back_source_ref,capture_started_at) values (${sqlLiteral(copy)},${sqlLiteral(variation)},'VERY_GOOD','variation-listing/selector/front-a','variation-listing/selector/back-a','selector-fixture-a','99999999-9999-4999-8999-999999999991','selector-front-a','selector-back-a',now()), (${sqlLiteral(otherCopy)},${sqlLiteral(otherVariation)},'VERY_GOOD','variation-listing/selector/front-b','variation-listing/selector/back-b','selector-fixture-b','99999999-9999-4999-8999-999999999992','selector-front-b','selector-back-b',now()), (${sqlLiteral(wrongCopy)},${sqlLiteral(wrongVariation)},'VERY_GOOD','variation-listing/selector/front-c','variation-listing/selector/back-c','selector-fixture-c','99999999-9999-4999-8999-999999999993','selector-front-c','selector-back-c',now());`,
      `update public.variation_listing_variations set representative_copy_id=${sqlLiteral(copy)}::uuid where variation_id=${sqlLiteral(variation)}::uuid; update public.variation_listing_variations set representative_copy_id=${sqlLiteral(otherCopy)}::uuid where variation_id=${sqlLiteral(otherVariation)}::uuid; update public.variation_listing_variations set representative_copy_id=${sqlLiteral(wrongCopy)}::uuid where variation_id=${sqlLiteral(wrongVariation)}::uuid; commit;`,
      `update public.variation_listing_groups set desired_revision=4 where group_id=${sqlLiteral(group)}::uuid;`,
    ].join('\n'));
    const rpc = (gid, vid, rev, value) => `select * from public.update_variation_listing_selector_value(${sqlLiteral(gid)}::uuid,${sqlLiteral(vid)}::uuid,${rev},${sqlLiteral(value)});`;
    await expectFailure(`update public.variation_listing_variations set selector_value='Direct' where variation_id=${sqlLiteral(variation)}::uuid;`, 'permission denied', 'service_role direct variation UPDATE denied');
    await expectFailure(`update public.variation_listing_groups set desired_revision=99 where group_id=${sqlLiteral(group)}::uuid;`, 'permission denied', 'service_role direct group UPDATE denied');
    await expectFailure(`update public.variation_listing_variations set sku='OTHER-SelectorA-999999' where variation_id=${sqlLiteral(variation)}::uuid;`, 'identity is immutable', 'identity trigger still protects SKU', 'postgres');
    await expectFailure(rpc(group, variation, -1, 'Negative Revision'), 'expected revision is invalid', 'negative expected revision rejected');
    await expectFailure(rpc(group, variation, 4, null), 'outer-trimmed', 'null selector rejected');
    const successWithFingerprint = `create temp table selector_baseline as ${staticFingerprint.replace(/;$/, '')}; set role service_role; ${rpc(group, variation, 4, 'Card A Prime')} reset role; do $$ declare b record; begin select * into b from selector_baseline; if (select jsonb_agg(to_jsonb(g) - array['updated_at','desired_revision'] order by g.group_id) from public.variation_listing_groups g) is distinct from b.groups_static or (select jsonb_agg(to_jsonb(v) - array['updated_at','selector_value'] order by v.variation_id) from public.variation_listing_variations v) is distinct from b.variations_static or (select jsonb_agg(to_jsonb(c) order by c.copy_id) from public.variation_listing_copies c) is distinct from b.copies_static then raise exception 'selector edit changed protected fingerprint'; end if; if (select desired_revision from public.variation_listing_groups where group_id=${sqlLiteral(group)}::uuid) <> 5 or (select selector_value from public.variation_listing_variations where variation_id=${sqlLiteral(variation)}::uuid) <> 'Card A Prime' then raise exception 'selector edit did not apply exact revision/value'; end if; end $$;`;
    await psql(successWithFingerprint);
    await expectFailure(rpc(group, otherVariation, 5, 'Card A Prime'), 'unique', 'duplicate selector rejected');
    await expectFailure(rpc(group, variation, 4, 'Card A New'), 'VR001', 'stale CAS rejected');
    await expectFailure(rpc(group, wrongVariation, 5, 'Wrong Group'), 'not found in group', 'wrong-group variation rejected');
    await expectFailure(rpc('99999999-9999-4999-8999-999999999999', variation, 5, 'Missing Group'), 'not found', 'missing group rejected');
    await expectFailure(rpc(group, variation, 5, 'Card A Prime'), 'must change', 'same-value no-op rejected');
    for (const value of [' Card Trim ', '\tCard Tab\t', '\nCard Newline\n', '\u00a0Card NBSP\u00a0', '\uFEFFCard BOM\uFEFF', ' \t\n ']) {
      await expectFailure(rpc(group, variation, 5, value), 'outer-trimmed', `outer trim rejected: ${JSON.stringify(value)}`);
    }
    await psql(`do $$ begin if (select desired_revision from public.variation_listing_groups where group_id=${sqlLiteral(group)}::uuid) <> 5 or (select selector_value from public.variation_listing_variations where variation_id=${sqlLiteral(variation)}::uuid) <> 'Card A Prime' or (select count(*) from public.variation_listing_copies where variation_id=${sqlLiteral(variation)}::uuid) <> 1 then raise exception 'failed selector edits changed durable state'; end if; end $$;`);
    await psql(`update public.variation_listing_groups set lifecycle_state='draft' where group_id=${sqlLiteral(group)}::uuid;`);
    await psql(rpc(group, variation, 5, 'Draft Card'), 'service_role');
    await psql(`update public.variation_listing_groups set lifecycle_state='review' where group_id=${sqlLiteral(group)}::uuid;`);
    await psql(rpc(group, variation, 6, 'Review Card'), 'service_role');
    for (const lifecycle of ['publish-ready', 'publishing', 'active', 'withdrawn', 'abandoned', 'cleanup', 'terminal-absent']) {
      await psql(`update public.variation_listing_groups set lifecycle_state=${sqlLiteral(lifecycle)} where group_id=${sqlLiteral(group)}::uuid;`);
      await expectFailure(rpc(group, variation, 7, `Blocked ${lifecycle}`), 'not editable', `${lifecycle} lifecycle rejected`);
    }
    await psql(`do $$ begin if (select desired_revision from public.variation_listing_groups where group_id=${sqlLiteral(group)}::uuid) <> 7 or (select selector_value from public.variation_listing_variations where variation_id=${sqlLiteral(variation)}::uuid) <> 'Review Card' then raise exception 'blocked lifecycle edit changed durable state'; end if; end $$;`);
    const privileges = await psql(`select has_function_privilege('service_role','public.update_variation_listing_selector_value(uuid,uuid,bigint,text)','execute') as service, has_function_privilege('public','public.update_variation_listing_selector_value(uuid,uuid,bigint,text)','execute') as public, has_function_privilege('anon','public.update_variation_listing_selector_value(uuid,uuid,bigint,text)','execute') as anon, has_function_privilege('authenticated','public.update_variation_listing_selector_value(uuid,uuid,bigint,text)','execute') as authenticated;`);
    assert(/t\s+\|\s+f\s+\|\s+f\s+\|\s+f/.test(privileges), 'function EXECUTE is service_role only');
    console.log('selector RPC disposable validation: passed');
  } finally {
    await docker(['rm', '-f', name]).catch(() => {});
  }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

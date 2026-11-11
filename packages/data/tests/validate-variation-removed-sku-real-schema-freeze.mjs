#!/usr/bin/env node
/* Disposable PostgreSQL 17 bridge check. Never connects to hosted services. */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const name = `yp9-c4-real-${process.pid}-${randomBytes(3).toString('hex')}`;
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
      for (let i = 0; i < 600; i += 1) {
        if (stdout.includes(marker)) return;
        if (sessionError) throw sessionError;
        if (child.exitCode !== null) {
          try { await done; } catch (error) { throw error; }
          throw new Error(`missing ${marker}: ${stderr}${stdout}`);
        }
        await sleep(10);
      }
      throw new Error(`missing ${marker}: ${stderr}${stdout}`);
    },
    async close() {
      child.stdin.end();
      try { return {ok: true, output: await done}; }
      catch (error) { return {ok: false, output: stdout, error}; }
    },
  };
}

const assertPgError = (result, label, message, state = 'P0001') => {
  assert(!result.ok, `${label}: expected PostgreSQL error`);
  const text = String(result.error);
  assert(text.includes(`SQL state: ${state}`) || text.includes(`ERROR:  ${state}:`), `${label}: SQLSTATE ${text}`);
  assert(text.includes(message), `${label}: expected ${message}, got ${text}`);
};

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
];

const group = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const variation = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const copy = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const revision = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const checkpoint = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const targetSku = 'OTHER-BridgeB-000002';
const targetFront = 'variation-listing/BridgeB/front-target.jpg';
const targetBack = 'variation-listing/BridgeB/back-target.jpg';
const survivorSkus = ['OTHER-BridgeB-000001', 'OTHER-BridgeB-000003'];
const frozenKey = 'variation-listing/bridgeb/frozen-front.jpg';
const rpcGroup = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const concurrencyRevision = '12121212-1212-4121-8121-121212121212';
const concurrencyKey = 'variation-listing/bridgeb/concurrency-front.jpg';
const concurrencyOtherKey = 'variation-listing/bridgeb/concurrency-back.jpg';
const reverseRevision = '13131313-1313-4131-8131-131313131313';
const reverseKey = 'variation-listing/bridgeb/reverse-front.jpg';
const reverseOtherKey = 'variation-listing/bridgeb/reverse-back.jpg';

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

const seedRealProvenance = `
-- Fixture administrator seeds historical rows, then removes the target before the read-only bridge.
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
  ('${group.slice(0, -1)}1'::uuid, ${q(group)}::uuid, 1, ${q(survivorSkus[0])}, 0, 'Card 1', 0.99),
  (${q(variation)}::uuid, ${q(group)}::uuid, 2, ${q(targetSku)}, 1, 'Card 2', 0.99),
  ('${group.slice(0, -1)}3'::uuid, ${q(group)}::uuid, 3, ${q(survivorSkus[1])}, 2, 'Card 3', 0.99);
with payload as (
  select jsonb_build_object(
    'aggregate', jsonb_build_object(
      'group', to_jsonb(g),
      'variations', (select jsonb_agg(to_jsonb(v) order by v.position) from public.variation_listing_variations v where v.group_id = g.group_id),
      'copies', jsonb_build_array(jsonb_build_object('variation_id', ${q(variation)}, 'copy_id', ${q(copy)},
        'front_r2_key', ${q(targetFront)}, 'back_r2_key', ${q(targetBack)},
        'capture_front_source_ref', 'bridge-source-front', 'capture_back_source_ref', 'bridge-source-back'))),
    'confirmed', jsonb_build_object(
      'aggregate', jsonb_build_object(
        'group', to_jsonb(g),
        'variations', (select jsonb_agg(to_jsonb(v) order by v.position) from public.variation_listing_variations v where v.group_id = g.group_id),
        'copies', jsonb_build_array(jsonb_build_object('variation_id', ${q(variation)}, 'copy_id', ${q(copy)},
          'front_r2_key', ${q(targetFront)}, 'back_r2_key', ${q(targetBack)},
          'capture_front_source_ref', 'bridge-source-front', 'capture_back_source_ref', 'bridge-source-back'))),
      'remote', jsonb_build_object('listingId', 'bridge-listing')),
    'permanentRemoval', jsonb_build_object('version', 1, 'groupKey', g.group_key,
      'marketplaceId', g.marketplace_id, 'targetVariationId', ${q(variation)}, 'targetSku', ${q(targetSku)},
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
values (${q(revision)}::uuid, ${q(group)}::uuid, ${q(variation)}::uuid, ${q(targetSku)}, 'bridge-offer', 'EBAY_US',
  'bridge-listing', 2, ${q(checkpoint)}::uuid, 'confirmed_complete', 'proven_absent',
  jsonb_build_object('revisionId', ${q(revision)}, 'targetSku', ${q(targetSku)}, 'targetOfferId', 'bridge-offer',
    'marketplaceId', 'EBAY_US', 'listingId', 'bridge-listing', 'item', jsonb_build_object('state', 'absent', 'sku', ${q(targetSku)}),
    'offers', jsonb_build_object('complete', true, 'offers', jsonb_build_array()),
    'survivors', jsonb_build_object('exact', true, 'skus', jsonb_build_array(${q(survivorSkus[0])}, ${q(survivorSkus[1])}))),
  now(), now());
delete from public.variation_listing_variations where variation_id = ${q(variation)}::uuid;
alter table public.variation_listing_removed_sku_remote_retirements enable trigger user;
alter table public.variation_listing_publishing_checkpoints enable trigger user;
alter table public.variation_listing_revisions enable trigger user;
alter table public.variation_listing_copies enable trigger user;
alter table public.variation_listing_variations enable trigger user;
alter table public.variation_listing_groups enable trigger user;
`;

async function main() {
  let started = false;
  try {
    await docker(['run', '--rm', '--network', 'none', '--name', name, '-e', `POSTGRES_PASSWORD=${password}`, '-d', 'postgres:17-alpine']);
    started = true;
    for (let i = 0; i < 60; i += 1) {
      try { await psql('select 1'); break; } catch (error) { if (i === 59) throw error; await sleep(250); }
    }
    await psql(bootstrap);
    await psql(await read('packages/data/tests/removed-sku-reference-freeze.prototype.sql'));
    for (const migration of migrations) await psql(await read(`supabase/migrations/${migration}`));
    // Equivalent scoped grant for the Standard table; the production grant
    // migration also names unrelated operational tables omitted from this
    // minimal fixture.
    await psql(`grant usage on schema public to anon, authenticated, service_role;
grant all privileges on table public.listings to service_role;
grant select on table public.listings to anon, authenticated;`);
    await psql(await read('packages/data/tests/removed-sku-real-schema-freeze.prototype.sql'));
    // Explicit trusted URL origins, matching buildPublicImageUrl base + key.
    await psql("insert into yp_c4_probe.allowed_r2_url_bases(base_url) values " +
      "('https://images.invalid'), ('https://images.murphyfamilyhobby.dev'), " +
      "('https://cdn.example.test/media');");
    await expectError(
      "insert into yp_c4_probe.allowed_r2_url_bases(base_url) values ('https://untrusted.example');",
      'service role cannot spoof trusted R2 origin', 'service_role', 'permission denied for table', '42501');
    await psql(seedRealProvenance);

    // Standard direct writes: service_role is the real table writer; unrelated media stays allowed.
    await psql(`insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-standard', 'single', array['https://cdn.example.test/item.jpg']::text[], array['safe/item.jpg']::text[]);`, 'service_role');
    await psql("update public.listings set title = 'unrelated update' where listing_id = 'bridge-standard';", 'service_role');
    await psql("update public.listings set image_urls = array['https://cdn.example.test/item-2.jpg']::text[] where listing_id = 'bridge-standard';", 'service_role');
    // Normal uploads persist a paired public URL + direct key. The bridge
    // canonicalizes that pair instead of treating it as duplicate ownership.
    await psql("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-safe-paired', 'single', array['https://images.murphyfamilyhobby.dev/listings/standard/paired.jpg']::text[], array['listings/standard/paired.jpg']::text[]);", 'service_role');
    // Percent-encoded unrelated legacy media remains usable when it cannot be
    // decoded into a Variation reference; production compatibility is bounded.
    await psql("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-safe-encoded-standard', 'single', array['https://images.murphyfamilyhobby.dev/listings/legacy%20image.jpg']::text[], array[]::text[]);", 'service_role');
    await psql("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-safe-variation-named-standard', 'single', array['https://images.murphyfamilyhobby.dev/listings/variation-listing-banner.jpg']::text[], array[]::text[]);", 'service_role');
    await psql("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-safe-query-standard', 'single', array['https://images.murphyfamilyhobby.dev/listings/catalog.jpg?size=large#front']::text[], array[]::text[]);", 'service_role');
    await psql(`insert into yp_c4_probe.frozen(key, revision_id) values (${q(frozenKey)}, ${q(revision)}::uuid);`);
    await expectError("update public.listings set r2_object_keys = array['" + frozenKey + "']::text[] where listing_id = 'bridge-standard';", 'Standard frozen key', 'service_role', 'retired R2 key frozen');
    await expectError("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-frozen', 'single', array['https://images.invalid/variation-listing/bridgeb/frozen-front.jpg']::text[], array[]::text[]);", 'Standard Variation URL frozen key', 'service_role', 'retired R2 key frozen');
    await expectError("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-frozen-prod-url', 'single', array['https://images.murphyfamilyhobby.dev/" + frozenKey + "']::text[], array[]::text[]);", 'configured R2 production-shaped host frozen key', 'service_role', 'retired R2 key frozen');
    await expectError("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-frozen-prefix-url', 'single', array['https://cdn.example.test/media/" + frozenKey + "']::text[], array[]::text[]);", 'configured R2 path-prefix host frozen key', 'service_role', 'retired R2 key frozen');
    await expectError("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-frozen-foreign-url', 'single', array['https://unknown.example/" + frozenKey + "']::text[], array[]::text[]);", 'unregistered Variation URL origin', 'service_role', 'unrecognized Variation R2 URL origin');
    await expectError("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-frozen-encoded-url', 'single', array['https://images.murphyfamilyhobby.dev/%76ariation-listing/bridgeb/frozen-front.jpg']::text[], array[]::text[]);", 'encoded Variation image URL', 'service_role', 'ambiguous percent-encoded image URL');
    await expectError("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-frozen-double-encoded-url', 'single', array['https://images.murphyfamilyhobby.dev/%2576ariation-listing/bridgeb/frozen-front.jpg']::text[], array[]::text[]);", 'double-encoded Variation image URL', 'service_role', 'ambiguous percent-encoded image URL');
    await expectError("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-frozen-five-times-encoded-url', 'single', array['https://images.murphyfamilyhobby.dev/%2525252576ariation-listing/bridgeb/frozen-front.jpg']::text[], array[]::text[]);", 'decode-budget Variation image URL', 'service_role', 'percent-encoded image URL exceeds decode budget');
    await expectError("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-frozen-query-url', 'single', array['https://images.murphyfamilyhobby.dev/" + frozenKey + "?download=1']::text[], array[]::text[]);", 'query-string alias', 'service_role', 'noncanonical R2 URL');
    await expectError("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-frozen-paired', 'single', array['https://images.invalid/" + frozenKey + "']::text[], array['" + frozenKey + "']::text[]);", 'paired frozen direct key and URL mapping', 'service_role', 'retired R2 key frozen');
    await expectError("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-frozen-dot-path', 'single', array['https://images.murphyfamilyhobby.dev/variation-listing/bridgeb/./frozen-front.jpg']::text[], array[]::text[]);", 'dot-segment Variation URL', 'service_role', 'noncanonical R2 URL');
    await expectError("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-frozen-encoded-dot-path', 'single', array['https://images.murphyfamilyhobby.dev/variation-listing/bridgeb/%2e%2e/frozen-front.jpg']::text[], array[]::text[]);", 'encoded traversal Variation URL', 'service_role', 'noncanonical R2 URL');
    await expectError("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-frozen-multi-slash', 'single', array['https://images.murphyfamilyhobby.dev/variation-listing//bridgeb/frozen-front.jpg']::text[], array[]::text[]);", 'multiple-slash Variation URL', 'service_role', 'noncanonical R2 URL');
    await expectError("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-frozen-fragment-url', 'single', array['https://images.murphyfamilyhobby.dev/variation-listing/bridgeb/frozen-front.jpg#raw']::text[], array[]::text[]);", 'fragment Variation URL', 'service_role', 'noncanonical R2 URL');
    await expectError("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-frozen-userinfo-url', 'single', array['https://user@images.murphyfamilyhobby.dev/variation-listing/bridgeb/frozen-front.jpg']::text[], array[]::text[]);", 'userinfo Variation URL', 'service_role', 'unrecognized Variation R2 URL origin');
    await expectError("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-frozen-port-url', 'single', array['https://images.murphyfamilyhobby.dev:443/variation-listing/bridgeb/frozen-front.jpg']::text[], array[]::text[]);", 'alternate-port Variation URL', 'service_role', 'unrecognized Variation R2 URL origin');
    await expectError("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-frozen-http-url', 'single', array['http://images.murphyfamilyhobby.dev/variation-listing/bridgeb/frozen-front.jpg']::text[], array[]::text[]);", 'invalid-scheme Variation URL', 'service_role', 'unrecognized Variation R2 URL origin');
    await expectError("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-frozen-unicode-url', 'single', array['https://images.murphyfamilyhobby.dev/variation-listing/bridgeb/frozen-front-é.jpg']::text[], array[]::text[]);", 'Unicode Variation URL', 'service_role', 'non-ASCII image URL');
    await expectError("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-frozen-confusable-url', 'single', array['https://images.murphyfamilyhobby.dev/vаriation-listing/bridgeb/frozen-front.jpg']::text[], array[]::text[]);", 'Unicode-confusable Variation URL', 'service_role', 'non-ASCII image URL');
    await expectError("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-frozen-case-url', 'single', array['https://images.murphyfamilyhobby.dev/Variation-listing/bridgeb/frozen-front.jpg']::text[], array[]::text[]);", 'case-variant Variation URL', 'service_role', 'noncanonical Variation R2 URL');
    await psql("insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-safe-public-image', 'single', array['https://images.murphyfamilyhobby.dev/listings/standard/front.jpg']::text[], array['listings/standard/front.jpg']::text[]);", 'service_role');

    // Both effective intake RPCs write the real variation copy table.
    await psql(`select public.create_variation_listing_group(${q(rpcGroup)}::uuid, ${q(`VL-G-${rpcGroup.replaceAll('-', '').toUpperCase()}`)}, 'OTHER', 'RpcB', '261328', 'EBAY_US', 'loc', 'fulfill', 'pay', 'return', '1000', 'VERY_GOOD');`, 'service_role');
    await psql(`select public.configure_variation_listing_intake('bridge-rpc', 'new_variation', ${q(rpcGroup)}::uuid, null, 0.99, null); select public.start_variation_listing_intake_pair('bridge-rpc', '11111111-1111-4111-8111-111111111112'::uuid, 'rpc-front-1', now());`, 'service_role');
    await psql(`select public.complete_variation_listing_new_variation('bridge-rpc', '11111111-1111-4111-8111-111111111113'::uuid, '11111111-1111-4111-8111-111111111114'::uuid, '11111111-1111-4111-8111-111111111112'::uuid, 'VERY_GOOD', 'Card RPC', '{}'::jsonb, 'variation-listing/RpcB/front-1.jpg', 'variation-listing/RpcB/back-1.jpg', 'rpc-back-1', now());`, 'service_role');
    await psql(`select public.configure_variation_listing_intake('bridge-rpc', 'duplicate_copy', ${q(rpcGroup)}::uuid, '11111111-1111-4111-8111-111111111114'::uuid, 0.99, 'VERY_GOOD'); select public.start_variation_listing_intake_pair('bridge-rpc', '11111111-1111-4111-8111-111111111115'::uuid, 'rpc-front-2', now());`, 'service_role');
    await psql(`select public.complete_variation_listing_duplicate_copy('bridge-rpc', '11111111-1111-4111-8111-111111111116'::uuid, '11111111-1111-4111-8111-111111111115'::uuid, '11111111-1111-4111-8111-111111111114'::uuid, 'VERY_GOOD', 'variation-listing/RpcB/front-2.jpg', 'variation-listing/RpcB/back-2.jpg', 'rpc-back-2', now());`, 'service_role');
    await psql(`select public.configure_variation_listing_intake('bridge-rpc-frozen', 'new_variation', ${q(rpcGroup)}::uuid, null, 0.99, null); select public.start_variation_listing_intake_pair('bridge-rpc-frozen', '11111111-1111-4111-8111-111111111118'::uuid, 'rpc-frozen-front', now());`, 'service_role');
    await expectError(`select public.complete_variation_listing_new_variation('bridge-rpc-frozen', '11111111-1111-4111-8111-111111111119'::uuid, '11111111-1111-4111-8111-111111111120'::uuid, '11111111-1111-4111-8111-111111111118'::uuid, 'VERY_GOOD', 'Card Frozen', '{}'::jsonb, ${q(frozenKey)}, 'variation-listing/RpcB/frozen-back.jpg', 'rpc-frozen-back', now());`, 'Variation intake frozen key', 'service_role', 'retired R2 key frozen');
    await expectError(`insert into public.variation_listing_copies (copy_id, variation_id, condition_token, front_r2_key, back_r2_key, capture_source_key, capture_pair_id, capture_front_source_ref, capture_back_source_ref, capture_started_at) values ('11111111-1111-4111-8111-111111111117'::uuid, '11111111-1111-4111-8111-111111111114'::uuid, 'VERY_GOOD', 'variation-listing/RpcB/direct-front.jpg', 'variation-listing/RpcB/direct-back.jpg', 'bridge-direct', '11111111-1111-4111-8111-111111111117'::uuid, 'f', 'b', now());`, 'direct Variation DML ACL', 'service_role', 'permission denied for table', '42501');
    await psql("select listing_id from public.listings where listing_id = 'bridge-standard';", 'anon');
    await expectError(`select yp_c4_probe.inspect_real_retirement(${q(revision)}::uuid);`, 'bridge inspect anon', 'anon', 'permission denied');

    // Read-only c2b + witness seam; all returned authority flags stay false.
    const witness = JSON.parse((await psql(`select yp_c4_probe.inspect_real_retirement(${q(revision)}::uuid);`, 'service_role')).trim());
    assert(witness.revisionId === revision && witness.targetSku === targetSku, 'bridge identity');
    assert(witness.r2ObjectKeys.length === 2 && witness.r2ObjectKeys.includes(targetFront) && witness.r2ObjectKeys.includes(targetBack), 'bridge frozen keys');
    assert(witness.referenceFreezeAuthorized === false && witness.deletionAuthorized === false, 'bridge non-authorizing flags');
    await expectError(`select yp_c4_probe.inspect_real_retirement('99999999-9999-4999-8999-999999999999'::uuid);`, 'wrong revision', 'service_role', 'c2b remote retirement is not confirmed');
    await psql(`update public.variation_listing_removed_sku_remote_retirements set evidence = jsonb_set(evidence, '{offers,complete}', to_jsonb('true'::text)) where revision_id = ${q(revision)}::uuid;`);
    await expectError(`select yp_c4_probe.inspect_real_retirement(${q(revision)}::uuid);`, 'string boolean evidence', 'service_role', 'c2b remote retirement is not confirmed');
    await psql(`update public.variation_listing_removed_sku_remote_retirements set evidence = jsonb_set(evidence, '{targetSku}', to_jsonb('FORGED-SKU'::text)) where revision_id = ${q(revision)}::uuid;`);
    await expectError(`select yp_c4_probe.inspect_real_retirement(${q(revision)}::uuid);`, 'forged target evidence', 'service_role', 'c2b remote retirement is not confirmed');
    await psql(`update public.variation_listing_removed_sku_remote_retirements set evidence = jsonb_set(evidence, '{offers,offers}', to_jsonb('not-an-array'::text)) where revision_id = ${q(revision)}::uuid;`);
    await expectError(`select yp_c4_probe.inspect_real_retirement(${q(revision)}::uuid);`, 'scalar offers evidence', 'service_role', 'c2b remote retirement is not confirmed');
    await psql(`update public.variation_listing_removed_sku_remote_retirements set evidence = '{}'::jsonb where revision_id = ${q(revision)}::uuid;`);
    await expectError(`select yp_c4_probe.inspect_real_retirement(${q(revision)}::uuid);`, 'forged c2b evidence', 'service_role', 'c2b remote retirement is not confirmed');
    await psql(`update public.variation_listing_removed_sku_remote_retirements set evidence = jsonb_build_object('revisionId', ${q(revision)}, 'targetSku', ${q(targetSku)}, 'targetOfferId', 'bridge-offer', 'marketplaceId', 'EBAY_US', 'listingId', 'bridge-listing', 'item', jsonb_build_object('state', 'absent', 'sku', ${q(targetSku)}), 'offers', jsonb_build_object('complete', true, 'offers', jsonb_build_array()), 'survivors', jsonb_build_object('exact', true, 'skus', jsonb_build_array(${q(survivorSkus[0])}, ${q(survivorSkus[1])}))) where revision_id = ${q(revision)}::uuid;`);

    // Effective c2 permits the no-op/proven-absent terminal pair. The bridge
    // reaches the witness for that pair, which intentionally remains stricter.
    await psql(`alter table public.variation_listing_publishing_checkpoints disable trigger user; update public.variation_listing_publishing_checkpoints set state = 'confirmed_no_op', observed_remote_state = 'proven_absent' where checkpoint_id = ${q(checkpoint)}::uuid; alter table public.variation_listing_publishing_checkpoints enable trigger user;`);
    await expectError(`select yp_c4_probe.inspect_real_retirement(${q(revision)}::uuid);`, 'no-op/proven-absent witness boundary', 'service_role', 'lacks exact terminal membership proof');
    await psql(`alter table public.variation_listing_publishing_checkpoints disable trigger user; update public.variation_listing_publishing_checkpoints set state = 'confirmed_complete', observed_remote_state = 'present' where checkpoint_id = ${q(checkpoint)}::uuid; alter table public.variation_listing_publishing_checkpoints enable trigger user;`);

    // Trigger order is explicit: bridge trigger runs after existing migration guards.
    const triggerNames = (await psql("select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'public.listings'::regclass and not tgisinternal;", null)).trim();
    assert(triggerNames.endsWith('zz_c4_real_standard_listing_guard'), 'Standard trigger ordering');
    const variationTriggerNames = (await psql("select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'public.variation_listing_copies'::regclass and not tgisinternal;", null)).trim();
    assert(variationTriggerNames.endsWith('zz_c4_real_variation_copy_guard'), 'Variation trigger ordering');
    await expectError("select count(*) from public.variation_listing_copies;", 'anon Variation ACL', 'anon', 'permission denied for table', '42501');

    // Lock protocol is proven through actual Standard trigger locks plus synthetic marker/owner scan.
    await psql(`insert into yp_c4_probe.proofs values (${q(concurrencyRevision)}::uuid, ${q(group)}::uuid, ${q(variation)}::uuid, ${q(targetSku)}, array[${q(concurrencyKey)}, ${q(concurrencyOtherKey)}]::text[], true, true, true);
insert into yp_c4_probe.standard_refs values ('99999999-9999-4999-8999-999999999999'::uuid, array[${q(concurrencyKey)}]::text[], array[]::text[]);`);
    const writer = session();
    const freezer = session();
    writer.send("begin; set role service_role; insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-missing', 'single', array['https://cdn.example.test/missing.jpg']::text[], array['" + concurrencyKey + "']::text[]); select 'WRITER_HELD';");
    await writer.wait('WRITER_HELD');
    freezer.send(`begin; set role service_role; select yp_c4_probe.freeze(${q(concurrencyRevision)}::uuid, ${q(group)}::uuid, ${q(variation)}::uuid, ${q(targetSku)}); select 'FREEZE_DONE';`);
    await sleep(120);
    assert(!freezer.seen('FREEZE_DONE'), 'freeze waits on real writer lock');
    writer.send('rollback; select \'WRITER_ROLLED_BACK\';');
    await writer.wait('WRITER_ROLLED_BACK');
    const writerResult = await writer.close();
    assert(writerResult.ok, `writer-before-freeze close failed: ${writerResult.error || writerResult.output}`);
    const freezerResult = await freezer.close();
    assertPgError(freezerResult, 'writer-before-freeze final scan', 'live owner prevents freeze');
    await psql(`delete from yp_c4_probe.standard_refs where listing_id = '99999999-9999-4999-8999-999999999999'::uuid; delete from yp_c4_probe.proofs where revision_id = ${q(concurrencyRevision)}::uuid;`);

    // Reverse order: synthetic freeze holds the same advisory lock first;
    // an actual Standard trigger writer waits, then fails on the frozen key.
    await psql(`insert into yp_c4_probe.proofs values (${q(reverseRevision)}::uuid, ${q(group)}::uuid, ${q(variation)}::uuid, ${q(targetSku)}, array[${q(reverseKey)}, ${q(reverseOtherKey)}]::text[], true, true, true);`);
    const freezerFirst = session();
    const writerAfter = session();
    freezerFirst.send(`begin; set role service_role; select yp_c4_probe.freeze(${q(reverseRevision)}::uuid, ${q(group)}::uuid, ${q(variation)}::uuid, ${q(targetSku)}); select 'FREEZE_HELD';`);
    await freezerFirst.wait('FREEZE_HELD');
    writerAfter.send("begin; set role service_role; insert into public.listings (listing_id, listing_type, image_urls, r2_object_keys) values ('bridge-after-freeze', 'single', array['https://cdn.example.test/after.jpg']::text[], array['" + reverseKey + "']::text[]); select 'WRITER_AFTER_FREEZE';");
    await sleep(120);
    assert(!writerAfter.seen('WRITER_AFTER_FREEZE'), 'real writer waits on freeze lock');
    freezerFirst.send("commit; select 'FREEZE_COMMITTED';");
    await freezerFirst.wait('FREEZE_COMMITTED');
    const freezerFirstResult = await freezerFirst.close();
    assert(freezerFirstResult.ok, `freeze-before-writer close failed: ${freezerFirstResult.error || freezerFirstResult.output}`);
    const writerAfterResult = await writerAfter.close();
    assertPgError(writerAfterResult, 'freeze-before-writer final write', 'retired R2 key frozen');
    await psql(`delete from yp_c4_probe.frozen where revision_id = ${q(reverseRevision)}::uuid; delete from yp_c4_probe.proofs where revision_id = ${q(reverseRevision)}::uuid;`);
    console.log('real-schema bridge checks: passed (actual migrations + synthetic freeze; no freeze authority)');
  } finally {
    if (started) await docker(['rm', '-f', name]).catch(() => {});
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

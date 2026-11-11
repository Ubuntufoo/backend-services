#!/usr/bin/env node
/* Isolated PostgreSQL 17 concurrency proof; no hosted environment access. */
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const sqlFile = root + '/packages/data/tests/removed-sku-reference-freeze.prototype.sql';
const name = 'yp-c4-freeze-' + process.pid + '-' + randomBytes(3).toString('hex');
const pass = randomBytes(14).toString('hex');
const group = '11111111-1111-4111-8111-111111111111';
const variation = '22222222-2222-4222-8222-222222222222';
const rev1 = '33333333-3333-4333-8333-333333333333';
const rev2 = '44444444-4444-4444-8444-444444444444';
const front = 'variation-listing/probe/front-aaaaaaaaaaaa.jpg';
const back = 'variation-listing/probe/back-bbbbbbbbbbbb.jpg';
const lit = value => "'" + String(value).replaceAll("'", "''") + "'";
const ensure = (ok, reason) => { if (!ok) throw new Error('assertion failed: ' + reason); };
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const cli = (file, args, input = '') => new Promise((resolve, reject) => {
  const child = spawn(file, args, {stdio: ['pipe', 'pipe', 'pipe']});
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => code === 0
    ? resolve(stdout)
    : reject(new Error(`${file} ${code}: ${stderr}${stdout}`)));
  child.stdin.end(input);
});
const docker = (args, input = '') => cli('docker', args, input);
const psqlArgs = [
  'exec', '-i', name, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1',
  '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', 'postgres',
];
const query = (sql, role = null) => docker(psqlArgs,
  (role ? `set role ${role};\n` : '') + sql + '\n');

const expectError = async (sql, label, role, expectedMessage, expectedState = 'P0001') => {
  ensure(expectedMessage, `${label}: exact expected error required`);
  try {
    await query(sql, role);
  } catch (error) {
    const text = String(error);
    ensure(text.includes(`SQL state: ${expectedState}`) || text.includes(`ERROR:  ${expectedState}:`),
      `${label}: unexpected SQLSTATE: ${text}`);
    ensure(text.includes(`ERROR:  ${expectedState}: ${expectedMessage}`) ||
      text.includes(`ERROR:  ${expectedMessage}`) || text.includes(`ERROR: ${expectedMessage}`),
      `${label}: unexpected message: ${text}`);
    return;
  }
  throw new Error('expected rejection: ' + label);
};

const proof = (revision, a, b, ownership = true) =>
  'insert into yp_c4_probe.proofs values (' + lit(revision) + '::uuid,' + lit(group) +
  '::uuid,' + lit(variation) + "::uuid,'BSKBL-TEST-000002',array[" + lit(a) + ',' +
  lit(b) + '],true,' + ownership + ',true);';
const freeze = revision =>
  'select yp_c4_probe.freeze(' + lit(revision) + '::uuid,' + lit(group) + '::uuid,' +
  lit(variation) + "::uuid,'BSKBL-TEST-000002');";
const standard = (id, keys, urls = []) =>
  'insert into yp_c4_probe.standard_refs values (' + lit(id) + '::uuid,array[' +
  keys.map(lit).join(',') + ']::text[],array[' + urls.map(lit).join(',') + ']::text[]);';
const variationRef = (id, a, b) =>
  'insert into yp_c4_probe.variation_refs values (' + lit(id) + '::uuid,' + lit(a) + ',' + lit(b) + ');';

/* Assert the inner statement's exact SQLSTATE/message while keeping a held lock. */
const heldFailure = (sql, expectedMessage, expectedState = 'P0001') => `
do $$
declare actual_state text; actual_message text;
begin
  begin
    ${sql}
  exception when others then
    get stacked diagnostics actual_state = returned_sqlstate, actual_message = message_text;
  end;
  if actual_state is null then raise exception 'UNEXPECTED_SUCCESS'; end if;
  if actual_state <> ${lit(expectedState)} or actual_message <> ${lit(expectedMessage)} then
    raise exception 'UNEXPECTED_ERROR state=% message=%', actual_state, actual_message;
  end if;
end
$$;
`;

function session() {
  const child = spawn('docker', psqlArgs, {stdio: ['pipe', 'pipe', 'pipe']});
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0
      ? resolve(stdout)
      : reject(new Error(`psql exit ${code}: ${stderr}${stdout}`)));
  });
  return {
    send(sql) { child.stdin.write(sql + '\n'); },
    seen(marker) { return stdout.includes(marker); },
    output() { return stdout; },
    async wait(marker) {
      for (let attempt = 0; attempt < 600; attempt += 1) {
        if (stdout.includes(marker)) return;
        await sleep(10);
      }
      throw new Error(`missing ${marker}: ${stderr}${stdout}`);
    },
    close() { child.stdin.end(); return done; },
  };
}

const waitForQuery = async (sql, label) => {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if ((await query(sql)).trim() === 't') return;
    await sleep(10);
  }
  throw new Error('condition timed out: ' + label);
};

let started = false;
try {
  await docker(['run', '--rm', '--network', 'none', '--name', name,
    '-e', 'POSTGRES_PASSWORD=' + pass, '-d', 'postgres:17-alpine']);
  started = true;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { await query('select 1;'); break; }
    catch (error) {
      if (attempt === 29) throw error;
      await sleep(500);
    }
  }
  await query('create role service_role; create role anon; create role authenticated;');
  await query(await readFile(sqlFile, 'utf8'));

  const untrusted = 'untrusted or incomplete retirement proof';
  const frozen = 'retired R2 key frozen';
  const live = 'live owner prevents freeze';
  const collision = 'key already belongs to another retirement';
  const denied = 'permission denied for table';

  await expectError(freeze(rev1), 'missing proof', 'service_role', untrusted);
  await expectError(proof(rev1, front, back), 'service-role proof seed denied',
    'service_role', `${denied} proofs`, '42501');
  await expectError("insert into yp_c4_probe.frozen values ('injected'," + lit(rev1) +
    '::uuid,false);', 'service-role forged freeze denied', 'service_role', `${denied} frozen`, '42501');
  await expectError("insert into yp_c4_probe.frozen values ('admin-injected'," + lit(rev1) +
    '::uuid,true);', 'deletion authorization flag denied', null,
    'new row for relation "frozen" violates check constraint', '23514');
  await expectError(freeze(rev1), 'forged freeze remains absent', 'service_role', untrusted);

  await query(proof(rev1, front, back, false));
  await expectError(freeze(rev1), 'incomplete ownership', 'service_role', untrusted);
  await query('update yp_c4_probe.proofs set ownership_complete=true;');
  await expectError(freeze(rev1).replace(group, '99999999-9999-4999-8999-999999999999'),
    'wrong group', 'service_role', untrusted);

  // Null, duplicate, malformed and encoded proof keys fail closed before freezing.
  const malformedCases = [
    ['66666666-6666-4666-8666-666666666666', `array[${lit(front)},null]`, 'null proof key', untrusted],
    ['77777777-7777-4777-8777-777777777777', `array[${lit(front)},${lit(front)}]`, 'duplicate proof key', untrusted],
    ['88888888-8888-4888-8888-888888888888', `array[${lit(front + ' ')},${lit(back)}]`, 'whitespace proof key', 'malformed key'],
    ['99999999-9999-4999-8999-999999999999', `array[${lit(front + '%2Falias')},${lit(back)}]`, 'encoded proof key', 'malformed key'],
  ];
  for (const [revision, keys, label, message] of malformedCases) {
    await query(`insert into yp_c4_probe.proofs values (${lit(revision)}::uuid,${lit(group)}::uuid,${lit(variation)}::uuid,'BSKBL-TEST-000002',${keys},true,true,true);`);
    await expectError(freeze(revision), label, 'service_role', message);
  }

  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await query(standard(id, [], ['https://images.invalid/' + front]), 'service_role');
  await expectError(freeze(rev1), 'live Standard URL', 'service_role', live);
  await query('delete from yp_c4_probe.standard_refs;');
  await expectError(
    "insert into yp_c4_probe.standard_refs values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,ARRAY[]::text[],ARRAY[NULL]::text[]);",
    'null Standard URL', 'service_role', 'null URL');
  await expectError(standard(id, [], ['https://images.invalid/variation-listing/probe/./front.jpg']),
    'dot-segment URL alias', 'service_role', 'noncanonical Variation URL');
  await expectError(standard(id, [], ['https://images.invalid/variation%2Flisting/probe/front.jpg']),
    'encoded URL alias', 'service_role', 'noncanonical Variation URL');
  await expectError(standard(id, [], ['https://images.invalid/%76ariation-listing/probe/front.jpg']),
    'encoded first-character URL alias', 'service_role', 'noncanonical Variation URL');
  await expectError(standard(id, [], ['HTTPS://IMAGES.INVALID/%76ariation-listing/probe/front.jpg']),
    'uppercase encoded first-character URL alias', 'service_role', 'noncanonical Variation URL');
  await expectError(standard(id, [front], ['https://images.invalid/' + front]),
    'duplicate direct and URL-derived identity', 'service_role', 'duplicate Standard key');
  await query(standard(id, [], ['https://images.invalid/listings/unrelated.jpg']), 'service_role');
  await query('delete from yp_c4_probe.standard_refs;');
  await query(variationRef(id, back, 'variation-listing/other.jpg'), 'service_role');
  await expectError(freeze(rev1), 'live Variation copy', 'service_role', live);
  await query('delete from yp_c4_probe.variation_refs;');

  // Direct Variation UPDATE is exercised before the race tests.
  const updateId = 'abababab-abab-4aba-8aba-abababababab';
  await query(variationRef(updateId, 'variation-listing/probe/update-a.jpg',
    'variation-listing/probe/update-b.jpg'), 'service_role');
  await query('update yp_c4_probe.variation_refs set back_key=' + lit(front) +
    ' where copy_id=' + lit(updateId) + '::uuid;', 'service_role');
  await query('delete from yp_c4_probe.variation_refs;');
  await expectError(
    "insert into yp_c4_probe.variation_refs values ('abababab-abab-4aba-8aba-abababababab'::uuid," + lit(front) + ',' + lit(front) + ');',
    'duplicate Variation key', 'service_role', 'duplicate Variation key');
  await expectError(
    "insert into yp_c4_probe.variation_refs values ('abababab-abab-4aba-8aba-abababababab'::uuid,NULL," + lit(back) + ');',
    'null Variation key', 'service_role', 'malformed key');

  // Writer before freeze: freeze waits, then sees the committed owner.
  const writer = session();
  const freezer = session();
  try {
    writer.send('begin; set role service_role; ' + standard(id, [front]) + " select 'WRITER_HELD';");
    await writer.wait('WRITER_HELD');
    freezer.send(heldFailure(freeze(rev1), live) + " select 'FREEZE_DENIED';");
    await sleep(140);
    ensure(!freezer.seen('FREEZE_DENIED'), 'freeze waits for writer');
    writer.send("commit; select 'WRITER_COMMITTED';");
    await writer.wait('WRITER_COMMITTED');
    await freezer.wait('FREEZE_DENIED');
    await Promise.all([writer.close(), freezer.close()]);
  } catch (error) {
    writer.send('rollback;');
    freezer.send('rollback;');
    await Promise.allSettled([writer.close(), freezer.close()]);
    throw error;
  }
  ensure((await query('select count(*) from yp_c4_probe.frozen;')).trim() === '0', 'no marker after denied freeze');
  await query('delete from yp_c4_probe.standard_refs;');

  // Freeze before writer: new Standard write waits, then fails closed.
  const freezing = session();
  const later = session();
  try {
    freezing.send('begin; set role service_role; ' + freeze(rev1) + " select 'FREEZE_HELD';");
    await freezing.wait('FREEZE_HELD');
    later.send(heldFailure(standard(id, [back, front]), frozen) + " select 'STANDARD_DENIED';");
    await sleep(140);
    ensure(!later.seen('STANDARD_DENIED'), 'Standard waits for freeze');
    freezing.send("commit; select 'FREEZE_COMMITTED';");
    await freezing.wait('FREEZE_COMMITTED');
    await later.wait('STANDARD_DENIED');
    await Promise.all([freezing.close(), later.close()]);
  } catch (error) {
    freezing.send('rollback;');
    later.send('rollback;');
    await Promise.allSettled([freezing.close(), later.close()]);
    throw error;
  }
  ensure((await query('select count(*) from yp_c4_probe.frozen;')).trim() === '2', 'exact two keys frozen');
  ensure((await query('select bool_and(not deletion_authorized) from yp_c4_probe.frozen;')).trim() === 't',
    'non-authorizing freeze');
  ensure((await query(freeze(rev1), 'service_role')).trim() === '2', 'same-revision idempotence');

  await expectError(variationRef(id, front, 'variation-listing/other.jpg'),
    'Variation insert after freeze', 'service_role', frozen);
  await query(variationRef('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'variation-listing/probe/post-a.jpg', 'variation-listing/probe/post-b.jpg'), 'service_role');
  await expectError(
    'update yp_c4_probe.variation_refs set front_key=' + lit(front) +
      ' where copy_id=' + lit('cccccccc-cccc-4ccc-8ccc-cccccccccccc') + '::uuid;',
    'Variation update after freeze', 'service_role', frozen);
  await query('delete from yp_c4_probe.variation_refs;');
  await expectError(standard(id, [], ['https://images.invalid/' + back]),
    'Standard URL after freeze', 'service_role', frozen);
  await expectError(standard(id, [], ['https://images.invalid/variation%2Flisting/bypass']),
    'ambiguous URL after freeze', 'service_role', 'noncanonical Variation URL');
  await query(standard(id, ['listings/unrelated.jpg']), 'service_role');
  await expectError(
    'update yp_c4_probe.standard_refs set keys=array[' + lit(front) +
      '] where listing_id=' + lit(id) + '::uuid;',
    'Standard UPDATE key after freeze', 'service_role', frozen);
  await expectError(
    'update yp_c4_probe.standard_refs set urls=array[' + lit('https://images.invalid/' + back) +
      '] where listing_id=' + lit(id) + '::uuid;',
    'Standard UPDATE image_urls after freeze', 'service_role', frozen);
  await expectError(standard('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', [back]),
    'missing-row phantom', 'service_role', frozen);
  await expectError(standard('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', [front, front]),
    'duplicate Standard key', 'service_role', 'duplicate Standard key');
  await expectError(
    "insert into yp_c4_probe.standard_refs values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,ARRAY[NULL]::text[],ARRAY[]::text[]);",
    'null Standard key', 'service_role', 'malformed key');
  await query('delete from yp_c4_probe.standard_refs;');

  // Rollback releases advisory locks and does not persist a marker.
  const a = 'variation-listing/probe/rollback-a.jpg';
  const b = 'variation-listing/probe/rollback-b.jpg';
  await query(proof(rev2, a, b));
  const undo = session();
  const after = session();
  try {
    undo.send('begin; set role service_role; ' + freeze(rev2) + " select 'ROLLBACK_HELD';");
    await undo.wait('ROLLBACK_HELD');
    after.send(variationRef('cccccccc-cccc-4ccc-8ccc-cccccccccccc', a,
      'variation-listing/other.jpg') + " select 'WRITER_AFTER_ROLLBACK';");
    await sleep(140);
    ensure(!after.seen('WRITER_AFTER_ROLLBACK'), 'writer waits for pending rollback');
    undo.send("rollback; select 'ROLLBACK_DONE';");
    await undo.wait('ROLLBACK_DONE');
    await after.wait('WRITER_AFTER_ROLLBACK');
    await Promise.all([undo.close(), after.close()]);
  } catch (error) {
    undo.send('rollback;');
    after.send('rollback;');
    await Promise.allSettled([undo.close(), after.close()]);
    throw error;
  }
  ensure((await query('select count(*) from yp_c4_probe.frozen where revision_id=' + lit(rev2) + ';')).trim() === '0',
    'rollback persists no freeze');

  // Reverse-order input keys are serialized lexicographically.
  const rev3 = '55555555-5555-4555-8555-555555555555';
  const x = 'variation-listing/probe/reverse-a.jpg';
  const y = 'variation-listing/probe/reverse-b.jpg';
  const other = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  await query(proof(rev3, x, y));
  await query(standard(other, [y, x]), 'service_role');
  await expectError(freeze(rev3), 'reverse-order keys reject live owner', 'service_role', live);
  await query('delete from yp_c4_probe.standard_refs where listing_id=' + lit(other) + '::uuid;');
  ensure((await query(freeze(rev3), 'service_role')).trim() === '2', 'reverse-order keys freeze');

  // Two real sessions submit opposite proof-array order. Session A owns the
  // lexically first key, while B waits in PostgreSQL's advisory lock table;
  // the database wait event proves contention rather than a timing guess.
  const reverseA = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const reverseB = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const reverseX = 'variation-listing/probe/opposite-a.jpg';
  const reverseY = 'variation-listing/probe/opposite-b.jpg';
  await query(proof(reverseA, reverseX, reverseY));
  await query(proof(reverseB, reverseY, reverseX));
  const reverseFirst = session();
  const reverseSecond = session();
  try {
    reverseFirst.send(
      'begin; set role service_role; select pg_catalog.pg_advisory_xact_lock(' +
      "pg_catalog.hashtextextended(" + lit('YP9.6c4:' + reverseX) +
      ',0)); select \'REVERSE_A_HELD\';');
    await reverseFirst.wait('REVERSE_A_HELD');
    reverseSecond.send("set role service_role; select 'REVERSE_B_PID:' || pg_backend_pid();");
    await reverseSecond.wait('REVERSE_B_PID:');
    const pidMatch = reverseSecond.output().match(/REVERSE_B_PID:(\d+)/);
    ensure(pidMatch, 'reverse-order waiter backend pid');
    const reverseSecondPid = Number(pidMatch[1]);
    reverseSecond.send('begin; ' + heldFailure(freeze(reverseB), collision) +
      " select 'REVERSE_B_DONE';");
    await waitForQuery(
      `select exists (select 1 from pg_catalog.pg_stat_activity where pid=${reverseSecondPid} and wait_event_type='Lock');`,
      'reverse-order advisory lock wait');
    reverseFirst.send(freeze(reverseA) + " select 'REVERSE_A_DONE';");
    await reverseFirst.wait('REVERSE_A_DONE');
    reverseFirst.send("commit; select 'REVERSE_A_COMMITTED';");
    await reverseFirst.wait('REVERSE_A_COMMITTED');
    await reverseSecond.wait('REVERSE_B_DONE');
    await Promise.all([reverseFirst.close(), reverseSecond.close()]);
  } catch (error) {
    reverseFirst.send('rollback;');
    reverseSecond.send('rollback;');
    await Promise.allSettled([reverseFirst.close(), reverseSecond.close()]);
    throw error;
  }
  ensure((await query(
    `select count(*) filter (where key = any(array[${lit(reverseX)},${lit(reverseY)}])) || '|' ||
      count(*) filter (where key = any(array[${lit(reverseX)},${lit(reverseY)}]) and revision_id=${lit(reverseA)}::uuid) || '|' ||
      count(*) filter (where key = any(array[${lit(reverseX)},${lit(reverseY)}]) and revision_id=${lit(reverseB)}::uuid)
     from yp_c4_probe.frozen;`)).trim() === '2|2|0',
    'opposite-order contention commits one owner and rolls back loser');

  // A second revision cannot claim an already frozen key.
  const rev4 = 'aaaaaaaa-1111-4111-8111-111111111111';
  await query(proof(rev4, x, 'variation-listing/probe/collision-c.jpg'));
  await expectError(freeze(rev4), 'cross-revision frozen-key collision', 'service_role',
    collision);
  await expectError(freeze(rev4), 'cross-revision collision remains deterministic', 'service_role',
    collision);
  ensure((await query(
    `select count(*) filter (where key=${lit('variation-listing/probe/collision-c.jpg')}) || '|' ||
      count(*) || '|' || count(*) filter (where revision_id=${lit(rev3)}::uuid)
     from yp_c4_probe.frozen;`)).trim() === '0|6|2',
    'cross-revision collision rolls back non-colliding key and preserves owners');

  await expectError(freeze(rev1), 'anonymous freeze denied', 'anon', 'permission denied for schema yp_c4_probe', '42501');
  await expectError('select * from yp_c4_probe.frozen;', 'anonymous marker read denied',
    'anon', 'permission denied for schema yp_c4_probe', '42501');
  console.log('YP9.6c4 disposable freeze: PASS (simultaneous lock orders, direct DML, exact failures, rollback, ACL, no deletion)');
} finally {
  if (started) {
    try { await docker(['stop', '-t', '5', name]); }
    catch { try { await docker(['rm', '-f', name]); } catch {} }
  }
}

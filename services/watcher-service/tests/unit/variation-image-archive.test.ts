import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  archiveVariationImagePair,
  clearVariationImageArchiveRecovery,
  persistVariationImageArchiveRecovery,
  recoverPendingVariationImageArchives,
  type VariationImageArchiveFileSystem,
  type VariationImageArchiveInput,
} from '../../src/variation-image-archive.js';
import type { VariationListingCompletionPersistenceResult } from '../../src/variation-listing-persistence.js';
import type { VariationListingStorageReadyCompletionCommand } from '../../src/variation-listing-intake.js';

const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const VARIATION_ID = '22222222-2222-4222-8222-222222222222';
const COPY_ID = '33333333-3333-4333-8333-333333333333';

const fileSystem = async (): Promise<VariationImageArchiveFileSystem> => {
  const fs = await import('node:fs/promises');
  return {
    copyFile: fs.copyFile.bind(fs),
    link: fs.link.bind(fs),
    lstat: fs.lstat.bind(fs),
    mkdir: fs.mkdir.bind(fs),
    realpath: fs.realpath.bind(fs),
    readFile: fs.readFile.bind(fs),
    unlink: fs.unlink.bind(fs),
  };
};

function hash(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 12);
}

function createInput(
  incomingDirectory: string,
  processedDirectory: string,
  copyId = COPY_ID,
  frontBody = 'front-bytes',
  backBody = 'back-bytes',
  token = 'BucketA',
): VariationImageArchiveInput {
  const frontSourceRef = path.join(incomingDirectory, `front-${copyId}.jpg`);
  const backSourceRef = path.join(incomingDirectory, `back-${copyId}.jpg`);
  const frontR2Key = `variation-listing/${GROUP_ID}/${VARIATION_ID}/${copyId}/front-${hash(frontBody)}.jpg`;
  const backR2Key = `variation-listing/${GROUP_ID}/${VARIATION_ID}/${copyId}/back-${hash(backBody)}.jpg`;
  const command = {
    backR2Key,
    backSourceRef,
    capturePairId: '44444444-4444-4444-8444-444444444444',
    captureSourceKey: 'station-main',
    captureStartedAt: '2026-11-04T00:00:00.000Z',
    completionKind: 'new_variation' as const,
    conditionToken: 'EXCELLENT' as const,
    copyId,
    expectedDesiredRevision: 1,
    frontR2Key,
    frontSourceRef,
    frozenPriceAmount: 1.49 as const,
    frozenPriceCurrency: 'USD' as const,
    selectorValue: 'Card A',
    targetGroupId: GROUP_ID,
    variationId: VARIATION_ID,
    variationMetadata: {},
  } satisfies VariationListingStorageReadyCompletionCommand;
  const persisted = {
    completionKind: 'new_variation' as const,
    copy: {
      copy_id: copyId,
      variation_id: VARIATION_ID,
      capture_pair_id: command.capturePairId,
      capture_source_key: command.captureSourceKey,
      capture_front_source_ref: frontSourceRef,
      capture_back_source_ref: backSourceRef,
      front_r2_key: frontR2Key,
      back_r2_key: backR2Key,
    },
    group: {
      group_id: GROUP_ID,
      sku_category_code: 'BSKBL',
      sku_bucket_token: token,
    },
    variation: {variation_id: VARIATION_ID, group_id: GROUP_ID},
    status: 'completed' as const,
  } as unknown as VariationListingCompletionPersistenceResult;
  return {
    command,
    incomingDirectory,
    persisted,
    processedDirectory,
  };
}

describe('variation image archive', () => {
  let tempDirectory: string | undefined;

  afterEach(async () => {
    if (tempDirectory) await rm(tempDirectory, {recursive: true, force: true});
    tempDirectory = undefined;
  });

  async function layout() {
    tempDirectory = await realpath(await mkdtemp(path.join(tmpdir(), 'variation-image-archive-')));
    const incomingDirectory = path.join(tempDirectory, 'incoming');
    const processedDirectory = path.join(tempDirectory, 'processed');
    await mkdir(incomingDirectory);
    await mkdir(processedDirectory);
    return {incomingDirectory, processedDirectory};
  }

  it('archives an exact front/back pair into a stable bucket with copy-safe names', async () => {
    const {incomingDirectory, processedDirectory} = await layout();
    const input = createInput(incomingDirectory, processedDirectory);
    await writeFile(input.command.frontSourceRef, 'front-bytes');
    await writeFile(input.command.backSourceRef, 'back-bytes');

    const result = await archiveVariationImagePair(input, await fileSystem());
    expect(result.status).toBe('archived');
    expect(result.bucketDirectory).toBe(path.join(processedDirectory, `BSKBL-BucketA--${GROUP_ID}`));
    await expect(readFile(result.frontPath, 'utf8')).resolves.toBe('front-bytes');
    await expect(readFile(result.backPath, 'utf8')).resolves.toBe('back-bytes');
    await expect(readFile(input.command.frontSourceRef)).rejects.toMatchObject({code: 'ENOENT'});
    await expect(readFile(input.command.backSourceRef)).rejects.toMatchObject({code: 'ENOENT'});
  });

  it('reconciles repeated success and a front-only partial archive', async () => {
    const {incomingDirectory, processedDirectory} = await layout();
    const input = createInput(incomingDirectory, processedDirectory);
    await writeFile(input.command.frontSourceRef, 'front-bytes');
    await expect(archiveVariationImagePair(input, await fileSystem())).rejects.toThrow('back source and archive destination are both missing');
    await writeFile(input.command.backSourceRef, 'back-bytes');
    await expect(archiveVariationImagePair(input, await fileSystem())).resolves.toMatchObject({status: 'archived'});
    await expect(archiveVariationImagePair(input, await fileSystem())).resolves.toMatchObject({status: 'archived'});
  });

  it('archives an already-completed durable reconciliation exactly once', async () => {
    const {incomingDirectory, processedDirectory} = await layout();
    const input = createInput(incomingDirectory, processedDirectory);
    (input.persisted as {status: string}).status = 'already_completed';
    await writeFile(input.command.frontSourceRef, 'front-bytes');
    await writeFile(input.command.backSourceRef, 'back-bytes');
    await expect(archiveVariationImagePair(input, await fileSystem())).resolves.toMatchObject({status: 'archived'});
    await expect(archiveVariationImagePair(input, await fileSystem())).resolves.toMatchObject({status: 'archived'});
  });

  it('requires an existing real incoming root', async () => {
    const {incomingDirectory, processedDirectory} = await layout();
    await rm(incomingDirectory, {recursive: true, force: true});
    const input = createInput(incomingDirectory, processedDirectory);
    await expect(archiveVariationImagePair(input, await fileSystem())).rejects.toThrow('archive directory is missing');
  });

  it('rejects a configured archive root below a symlinked parent', async () => {
    const {incomingDirectory} = await layout();
    const realParent = path.join(tempDirectory!, 'real-parent');
    const symlinkParent = path.join(tempDirectory!, 'symlink-parent');
    await mkdir(realParent);
    await symlink(realParent, symlinkParent);
    const input = createInput(incomingDirectory, path.join(symlinkParent, 'processed'));
    await writeFile(input.command.frontSourceRef, 'front-bytes');
    await writeFile(input.command.backSourceRef, 'back-bytes');
    await expect(archiveVariationImagePair(input, await fileSystem())).rejects.toThrow(/symlink/);
    await expect((await import('node:fs/promises')).access(path.join(realParent, 'processed'))).rejects.toMatchObject({code: 'ENOENT'});
  });

  it('rejects a front/back source alias before creating archive state', async () => {
    const {incomingDirectory, processedDirectory} = await layout();
    const input = createInput(incomingDirectory, processedDirectory);
    (input.command as unknown as {backSourceRef: string}).backSourceRef = input.command.frontSourceRef;
    (input.persisted as unknown as {copy: {capture_back_source_ref: string}}).copy.capture_back_source_ref = input.command.frontSourceRef;
    await writeFile(input.command.frontSourceRef, 'front-bytes');
    await expect(archiveVariationImagePair(input, await fileSystem())).rejects.toThrow('source references must be distinct');
    await expect(readFile(input.command.frontSourceRef, 'utf8')).resolves.toBe('front-bytes');
    expect(await (await import('node:fs/promises')).readdir(processedDirectory)).toHaveLength(0);
  });

  it('fails closed for hash changes, collisions, symlinks, and unsafe bucket tokens', async () => {
    const {incomingDirectory, processedDirectory} = await layout();
    const input = createInput(incomingDirectory, processedDirectory);
    await writeFile(input.command.frontSourceRef, 'changed');
    await writeFile(input.command.backSourceRef, 'back-bytes');
    await expect(archiveVariationImagePair(input, await fileSystem())).rejects.toThrow('front source bytes');
    await writeFile(input.command.frontSourceRef, 'front-bytes');
    const bucket = path.join(processedDirectory, `BSKBL-BucketA--${GROUP_ID}`);
    await mkdir(bucket, {recursive: true});
    const collision = path.join(bucket, `${COPY_ID}_front-${hash('front-bytes')}.jpg`);
    await writeFile(collision, 'foreign');
    await expect(archiveVariationImagePair(input, await fileSystem())).rejects.toThrow('collides');
    await rm(collision);
    await rm(bucket, {recursive: true});
    await rm(input.command.frontSourceRef);
    await symlink(path.join(incomingDirectory, 'missing.jpg'), input.command.frontSourceRef);
    await expect(archiveVariationImagePair(input, await fileSystem())).rejects.toThrow('source is a symlink');
    const unsafe = createInput(incomingDirectory, processedDirectory, COPY_ID, 'front-bytes', 'back-bytes', '../escape');
    await expect(archiveVariationImagePair(unsafe, await fileSystem())).rejects.toThrow('bucket token');
    const trailingSeparator = createInput(incomingDirectory, processedDirectory, COPY_ID, 'front-bytes', 'back-bytes', 'Bucket_');
    await expect(archiveVariationImagePair(trailingSeparator, await fileSystem())).rejects.toThrow('bucket token');
    const overlongToken = createInput(incomingDirectory, processedDirectory, COPY_ID, 'front-bytes', 'back-bytes', 'A'.repeat(33));
    await expect(archiveVariationImagePair(overlongToken, await fileSystem())).rejects.toThrow('bucket token');
    const invalidCategory = createInput(incomingDirectory, processedDirectory);
    (invalidCategory.persisted as unknown as {group: {sku_category_code: string}}).group.sku_category_code = 'BAD';
    await expect(archiveVariationImagePair(invalidCategory, await fileSystem())).rejects.toThrow('SKU category');
  });

  it('rejects a destination bucket symlink and preserves source files', async () => {
    const {incomingDirectory, processedDirectory} = await layout();
    const input = createInput(incomingDirectory, processedDirectory);
    await writeFile(input.command.frontSourceRef, 'front-bytes');
    await writeFile(input.command.backSourceRef, 'back-bytes');
    const outside = path.join(tempDirectory!, 'outside');
    await mkdir(outside);
    await symlink(outside, path.join(processedDirectory, `BSKBL-BucketA--${GROUP_ID}`));
    await expect(archiveVariationImagePair(input, await fileSystem())).rejects.toThrow('archive directory is a symlink');
    await expect(readFile(input.command.frontSourceRef, 'utf8')).resolves.toBe('front-bytes');
    await expect(readFile(input.command.backSourceRef, 'utf8')).resolves.toBe('back-bytes');
  });

  it('uses EXDEV copy fallback and permits multiple copies in one bucket', async () => {
    const {incomingDirectory, processedDirectory} = await layout();
    const input = createInput(incomingDirectory, processedDirectory);
    await writeFile(input.command.frontSourceRef, 'front-bytes');
    await writeFile(input.command.backSourceRef, 'back-bytes');
    const baseFileSystem = await fileSystem();
    const exdevFileSystem: VariationImageArchiveFileSystem = {
      ...baseFileSystem,
      link: async () => {
        const error = new Error('cross-device');
        Object.assign(error, {code: 'EXDEV'});
        throw error;
      },
    };
    await expect(archiveVariationImagePair(input, exdevFileSystem)).resolves.toMatchObject({status: 'archived'});
    const second = createInput(incomingDirectory, processedDirectory, '55555555-5555-4555-8555-555555555555');
    await writeFile(second.command.frontSourceRef, 'front-bytes');
    await writeFile(second.command.backSourceRef, 'back-bytes');
    await expect(archiveVariationImagePair(second, await fileSystem())).resolves.toMatchObject({status: 'archived'});
    expect(await (await import('node:fs/promises')).readdir(path.join(processedDirectory, `BSKBL-BucketA--${GROUP_ID}`))).toHaveLength(4);
  });

  it('verifies destination bytes before unlinking the source', async () => {
    const {incomingDirectory, processedDirectory} = await layout();
    const input = createInput(incomingDirectory, processedDirectory);
    await writeFile(input.command.frontSourceRef, 'front-bytes');
    await writeFile(input.command.backSourceRef, 'back-bytes');
    const baseFileSystem = await fileSystem();
    const corruptingFileSystem: VariationImageArchiveFileSystem = {
      ...baseFileSystem,
      link: async () => {
        const error = new Error('cross-device');
        Object.assign(error, {code: 'EXDEV'});
        throw error;
      },
      copyFile: async (from, to, flags) => {
        await baseFileSystem.copyFile(from, to, flags);
        await writeFile(to, 'corrupt');
      },
    };
    await expect(archiveVariationImagePair(input, corruptingFileSystem)).rejects.toThrow('verification bytes');
    await expect(readFile(input.command.frontSourceRef, 'utf8')).resolves.toBe('front-bytes');
  });

  it('does not unlink a replacement source after a move race', async () => {
    const {incomingDirectory, processedDirectory} = await layout();
    const input = createInput(incomingDirectory, processedDirectory);
    await writeFile(input.command.frontSourceRef, 'front-bytes');
    await writeFile(input.command.backSourceRef, 'back-bytes');
    const baseFileSystem = await fileSystem();
    const racingFileSystem: VariationImageArchiveFileSystem = {
      ...baseFileSystem,
      link: async (from, to) => {
        await baseFileSystem.link(from, to);
        await baseFileSystem.unlink(from);
        await writeFile(from, 'replacement');
      },
    };
    await expect(archiveVariationImagePair(input, racingFileSystem)).rejects.toThrow('identity changed');
    await expect(readFile(input.command.frontSourceRef, 'utf8')).resolves.toBe('replacement');
  });

  it('writes an exact durable recovery journal, reuses it idempotently, and clears it safely', async () => {
    const {incomingDirectory, processedDirectory} = await layout();
    const input = createInput(incomingDirectory, processedDirectory);
    const journalPath = path.join(
      incomingDirectory,
      `.variation-archive-recovery-${input.command.capturePairId}.json`,
    );
    await writeFile(`${journalPath}.tmp`, 'orphan');

    const record = await persistVariationImageArchiveRecovery(input.command, incomingDirectory);
    expect(record).toMatchObject({
      version: 1,
      completionKind: 'new_variation',
      capturePairId: input.command.capturePairId,
      captureSourceKey: input.command.captureSourceKey,
      targetGroupId: GROUP_ID,
      variationId: VARIATION_ID,
      copyId: COPY_ID,
      frontSourceRef: input.command.frontSourceRef,
      backSourceRef: input.command.backSourceRef,
      frontR2Key: input.command.frontR2Key,
      backR2Key: input.command.backR2Key,
    });
    expect(JSON.parse(await readFile(journalPath, 'utf8'))).toEqual(record);
    await expect(persistVariationImageArchiveRecovery(input.command, incomingDirectory)).resolves.toEqual(record);

    const mismatch = {...input.command, captureSourceKey: 'other-station'};
    await expect(persistVariationImageArchiveRecovery(mismatch, incomingDirectory)).rejects.toThrow(
      'does not match the immutable capture command',
    );
    await clearVariationImageArchiveRecovery(input.command, incomingDirectory);
    await clearVariationImageArchiveRecovery(input.command, incomingDirectory);
    await expect(readFile(journalPath)).rejects.toMatchObject({code: 'ENOENT'});
  });

  it('blocks startup recovery when durable completion is absent and preserves the journal and sources', async () => {
    const {incomingDirectory, processedDirectory} = await layout();
    const input = createInput(incomingDirectory, processedDirectory);
    await writeFile(input.command.frontSourceRef, 'front-bytes');
    await writeFile(input.command.backSourceRef, 'back-bytes');
    await persistVariationImageArchiveRecovery(input.command, incomingDirectory);
    const findCompletedPair = vi.fn(async () => null);

    await expect(
      recoverPendingVariationImageArchives({
        incomingDirectory,
        processedDirectory,
        findCompletedPair,
      }),
    ).rejects.toThrow('durable capture completion is not present');
    expect(findCompletedPair).toHaveBeenCalledWith(input.command.capturePairId);
    await expect(readFile(input.command.frontSourceRef, 'utf8')).resolves.toBe('front-bytes');
    await expect(readFile(input.command.backSourceRef, 'utf8')).resolves.toBe('back-bytes');
    await expect(
      readFile(path.join(incomingDirectory, `.variation-archive-recovery-${input.command.capturePairId}.json`)),
    ).resolves.toBeTruthy();
  });

  it('treats a missing incoming root as an empty recovery set without calling the finder', async () => {
    tempDirectory = await realpath(await mkdtemp(path.join(tmpdir(), 'variation-image-archive-')));
    const incomingDirectory = path.join(tempDirectory, 'missing-incoming');
    const processedDirectory = path.join(tempDirectory, 'processed');
    const findCompletedPair = vi.fn();

    await expect(
      recoverPendingVariationImageArchives({
        incomingDirectory,
        processedDirectory,
        findCompletedPair,
      }),
    ).resolves.toEqual({recoveredCount: 0});
    expect(findCompletedPair).not.toHaveBeenCalled();
  });

  it('blocks startup on a reserved temporary journal left before finalization', async () => {
    const {incomingDirectory, processedDirectory} = await layout();
    const input = createInput(incomingDirectory, processedDirectory);
    await writeFile(input.command.frontSourceRef, 'front-bytes');
    await writeFile(input.command.backSourceRef, 'back-bytes');
    const journalPath = path.join(
      incomingDirectory,
      `.variation-archive-recovery-${input.command.capturePairId}.json`,
    );
    await persistVariationImageArchiveRecovery(input.command, incomingDirectory);
    const journalBody = await readFile(journalPath, 'utf8');
    await (await import('node:fs/promises')).rm(journalPath);
    await writeFile(`${journalPath}.tmp`, journalBody);
    const findCompletedPair = vi.fn();

    await expect(
      recoverPendingVariationImageArchives({
        incomingDirectory,
        processedDirectory,
        findCompletedPair,
      }),
    ).rejects.toThrow('unsupported filename');
    expect(findCompletedPair).not.toHaveBeenCalled();
    await expect(readFile(input.command.frontSourceRef, 'utf8')).resolves.toBe('front-bytes');
    await expect(readFile(input.command.backSourceRef, 'utf8')).resolves.toBe('back-bytes');
  });

  it('reconciles an exact read-only completion with a front-only partial move and clears the journal', async () => {
    const {incomingDirectory, processedDirectory} = await layout();
    const input = createInput(incomingDirectory, processedDirectory);
    await writeFile(input.command.frontSourceRef, 'front-bytes');
    await writeFile(input.command.backSourceRef, 'back-bytes');
    await persistVariationImageArchiveRecovery(input.command, incomingDirectory);

    const bucket = path.join(processedDirectory, `BSKBL-BucketA--${GROUP_ID}`);
    const frontDestination = path.join(bucket, `${COPY_ID}_front-${hash('front-bytes')}.jpg`);
    await mkdir(bucket, {recursive: true});
    await writeFile(frontDestination, 'front-bytes');
    await (await import('node:fs/promises')).rm(input.command.frontSourceRef);

    const persisted = {
      ...input.persisted,
      completionKind: 'unknown' as const,
      status: 'already_completed' as const,
    };
    const findCompletedPair = vi.fn(async () => persisted as never);
    await expect(
      recoverPendingVariationImageArchives({
        incomingDirectory,
        processedDirectory,
        findCompletedPair,
      }),
    ).resolves.toEqual({recoveredCount: 1});

    const backDestination = path.join(bucket, `${COPY_ID}_back-${hash('back-bytes')}.jpg`);
    await expect(readFile(frontDestination, 'utf8')).resolves.toBe('front-bytes');
    await expect(readFile(backDestination, 'utf8')).resolves.toBe('back-bytes');
    await expect(readFile(input.command.backSourceRef)).rejects.toMatchObject({code: 'ENOENT'});
    await expect(
      readFile(path.join(incomingDirectory, `.variation-archive-recovery-${input.command.capturePairId}.json`)),
    ).rejects.toMatchObject({code: 'ENOENT'});
  });

  it('blocks exact-journal recovery on proof mismatch or malformed journal without moving files', async () => {
    const {incomingDirectory, processedDirectory} = await layout();
    const input = createInput(incomingDirectory, processedDirectory);
    await writeFile(input.command.frontSourceRef, 'front-bytes');
    await writeFile(input.command.backSourceRef, 'back-bytes');
    await persistVariationImageArchiveRecovery(input.command, incomingDirectory);
    const mismatchedPersisted = {
      ...input.persisted,
      completionKind: 'unknown' as const,
      status: 'already_completed' as const,
      copy: {...input.persisted.copy, capture_pair_id: '55555555-5555-4555-8555-555555555555'},
    };
    await expect(
      recoverPendingVariationImageArchives({
        incomingDirectory,
        processedDirectory,
        findCompletedPair: vi.fn(async () => mismatchedPersisted as never),
      }),
    ).rejects.toThrow('durable completion proof does not match');
    await expect(readFile(input.command.frontSourceRef, 'utf8')).resolves.toBe('front-bytes');

    const journalPath = path.join(
      incomingDirectory,
      `.variation-archive-recovery-${input.command.capturePairId}.json`,
    );
    await writeFile(journalPath, '{not-json');
    await expect(
      recoverPendingVariationImageArchives({
        incomingDirectory,
        processedDirectory,
        findCompletedPair: vi.fn(),
      }),
    ).rejects.toThrow('not valid JSON');
    await expect(readFile(input.command.backSourceRef, 'utf8')).resolves.toBe('back-bytes');
  });
});

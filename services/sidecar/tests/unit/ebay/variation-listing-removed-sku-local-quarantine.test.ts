import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, writeFile, readFile, readdir, symlink, link, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';

import {
  inspectDisposableRemovedSkuArchive,
  quarantineDisposableRemovedSkuArchive,
  type DisposableArchiveIdentity,
} from '@/ebay/variation-listing-removed-sku-local-quarantine.js';

const groupId = '11111111-1111-4111-8111-111111111111';
const targetVariationId = '22222222-2222-4222-8222-222222222222';
const copyId = '33333333-3333-4333-8333-333333333333';
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(path => rm(path, {recursive: true, force: true})));
});

async function setup() {
  const sandboxRoot = await mkdtemp(join(tmpdir(), 'yp-c4-exec2-'));
  dirs.push(sandboxRoot);
  const archive = join(sandboxRoot, 'processed', `BSKBL-Remove--${groupId}`);
  const quarantine = join(sandboxRoot, 'quarantine');
  await mkdir(archive, {recursive: true});
  await mkdir(quarantine);
  const images = await Promise.all((['front', 'back'] as const).map(async role => {
    const body = Buffer.from(`${role} removed-SKU synthetic data`);
    const sha = createHash('sha256').update(body).digest('hex').slice(0, 12);
    const archivePath = join(archive, `${copyId}_${role}-${sha}.jpg`);
    const frozenR2Key = `variation-listing/${groupId}/${targetVariationId}/${copyId}/${role}-${sha}.jpg`;
    await writeFile(archivePath, body);
    return {
      identity: {sandboxRoot, archivePath, groupId, targetVariationId, copyId, role, frozenR2Key} as DisposableArchiveIdentity,
      body,
    };
  }));
  return {sandboxRoot, archive, quarantine, front: images[0]!, back: images[1]!};
}

describe('EXEC2 synthetic-only removed-SKU archive quarantine', () => {
  it('pins a frozen image but fails closed before any move; sibling image remains unchanged', async () => {
    const {front, back, quarantine} = await setup();
    const pin = await inspectDisposableRemovedSkuArchive(front.identity);
    expect(pin.size).toBe(front.body.byteLength);
    const result = await quarantineDisposableRemovedSkuArchive(front.identity, quarantine, pin);
    expect(result.status).toBe('unknown');
    expect(result.reason).toMatch(/validation-only|no-clobber/);
    expect((await readFile(result.originalPath)).equals(front.body)).toBe(true);
    expect(await readdir(quarantine)).toEqual([]);
    expect((await readFile(back.identity.archivePath)).equals(back.body)).toBe(true);
    const backPin = await inspectDisposableRemovedSkuArchive(back.identity);
    expect(backPin.archivePath).toContain('_back-');
  });

  it('rejects changed bytes after pin and leaves files untouched', async () => {
    const {front, back, quarantine} = await setup();
    const pin = await inspectDisposableRemovedSkuArchive(front.identity);
    await writeFile(front.identity.archivePath, 'tampered');
    await expect(quarantineDisposableRemovedSkuArchive(front.identity, quarantine, pin)).rejects.toThrow(/mismatch|changed/);
    expect(await readFile(front.identity.archivePath, 'utf8')).toBe('tampered');
    expect((await readFile(back.identity.archivePath)).equals(back.body)).toBe(true);
  });

  it('rejects inode substitution even when replacement bytes have the same digest', async () => {
    const {front, quarantine} = await setup();
    const pin = await inspectDisposableRemovedSkuArchive(front.identity);
    await rm(front.identity.archivePath);
    await writeFile(front.identity.archivePath, front.body);
    await expect(quarantineDisposableRemovedSkuArchive(front.identity, quarantine, pin)).rejects.toThrow(/changed/);
    expect(await readFile(front.identity.archivePath)).toEqual(front.body);
  });

  it('rejects symlink source, hardlinked source and frozen-key mismatch', async () => {
    const {front, back, sandboxRoot} = await setup();
    const outside = join(sandboxRoot, 'other.jpg');
    await writeFile(outside, 'outside');
    await rm(front.identity.archivePath);
    await symlink(outside, front.identity.archivePath);
    await expect(inspectDisposableRemovedSkuArchive(front.identity)).rejects.toThrow();
    await rm(front.identity.archivePath);
    await writeFile(front.identity.archivePath, front.body);
    const hardlink = join(sandboxRoot, 'hardlink.jpg');
    await link(front.identity.archivePath, hardlink);
    await expect(inspectDisposableRemovedSkuArchive(front.identity)).rejects.toThrow(/hard-linked/);
    await expect(inspectDisposableRemovedSkuArchive({
      ...back.identity, frozenR2Key: front.identity.frozenR2Key,
    })).rejects.toThrow(/R2 identity/);
  });

  it('refuses paths outside the designated temporary sandbox', async () => {
    const {front, quarantine} = await setup();
    await expect(inspectDisposableRemovedSkuArchive({
      ...front.identity,
      sandboxRoot: tmpdir(),
    })).rejects.toThrow(/disposable/);
    const pin = await inspectDisposableRemovedSkuArchive(front.identity);
    await expect(inspectDisposableRemovedSkuArchive({
      ...front.identity,
      archivePath: join(front.identity.sandboxRoot, 'processed', `BSKBL-Remove--${groupId}`, '..', `${copyId}_front-${pin.sha256Prefix}.jpg`),
    })).rejects.toThrow();
    await expect(quarantineDisposableRemovedSkuArchive(
      front.identity, join(front.identity.sandboxRoot, 'processed'), pin,
    )).rejects.toThrow(/quarantine must/);
    expect(await readFile(front.identity.archivePath)).toBeDefined();
    expect(basename(quarantine)).toBe('quarantine');
  });

  it('rejects a symlinked sandbox root before resolving any archive path', async () => {
    const {front, sandboxRoot} = await setup();
    const rootLinkParent = await mkdtemp(join(tmpdir(), 'yp-c4-exec2-root-link-'));
    dirs.push(rootLinkParent);
    const rootLink = join(rootLinkParent, 'root');
    await symlink(sandboxRoot, rootLink);
    await expect(inspectDisposableRemovedSkuArchive({
      ...front.identity, sandboxRoot: rootLink,
    })).rejects.toThrow(/symlinked|disposable/);
  });

  it('does not follow symlinked archive directories or accept wrong archive filename', async () => {
    const {front, archive, sandboxRoot} = await setup();
    const renamed = join(sandboxRoot, 'old-archive');
    const {rename} = await import('node:fs/promises');
    await rename(archive, renamed);
    await symlink(renamed, archive);
    await expect(inspectDisposableRemovedSkuArchive(front.identity)).rejects.toThrow(/directory/);
    await rm(archive);
    await rename(renamed, archive);
    await expect(inspectDisposableRemovedSkuArchive({
      ...front.identity, archivePath: join(archive, 'unrelated.jpg'),
    })).rejects.toThrow(/path does not match/);
  });

  it('rejects a replaced archive directory before any quarantine attempt', async () => {
    const {front, archive, sandboxRoot, quarantine} = await setup();
    const pin = await inspectDisposableRemovedSkuArchive(front.identity);
    const moved = join(sandboxRoot, 'old-archive');
    const {rename} = await import('node:fs/promises');
    await rename(archive, moved);
    await mkdir(archive);
    await writeFile(join(archive, `${copyId}_front-${pin.sha256Prefix}.jpg`), front.body);
    await expect(quarantineDisposableRemovedSkuArchive(front.identity, quarantine, pin)).rejects.toThrow(/changed|path/);
    expect(await readFile(join(moved, `${copyId}_front-${pin.sha256Prefix}.jpg`))).toEqual(front.body);
  });

  it('rejects a missing source and leaves sibling/quarantine untouched', async () => {
    const {front, back, quarantine} = await setup();
    const pin = await inspectDisposableRemovedSkuArchive(front.identity);
    await rm(front.identity.archivePath);
    await expect(quarantineDisposableRemovedSkuArchive(front.identity, quarantine, pin)).rejects.toThrow();
    expect(await readFile(back.identity.archivePath)).toEqual(back.body);
    expect(await readdir(quarantine)).toEqual([]);
  });

  it('keeps repeated validation unknown without claiming idempotent removal', async () => {
    const {front, quarantine} = await setup();
    const pin = await inspectDisposableRemovedSkuArchive(front.identity);
    const result = await quarantineDisposableRemovedSkuArchive(front.identity, quarantine, pin);
    expect(result.status).toBe('unknown');
    const repeat = await quarantineDisposableRemovedSkuArchive(front.identity, quarantine, pin);
    expect(repeat.status).toBe('unknown');
    const repeatedPin = await inspectDisposableRemovedSkuArchive(front.identity);
    expect(repeatedPin.archivePath).toBe(pin.archivePath);
  });

  it('leaves a colliding quarantine entry untouched and never moves an unrelated file', async () => {
    const {front, quarantine} = await setup();
    const pin = await inspectDisposableRemovedSkuArchive(front.identity);
    const collision = join(quarantine, 'preexisting-collision.jpg');
    await writeFile(collision, 'unrelated');
    const result = await quarantineDisposableRemovedSkuArchive(front.identity, quarantine, pin);
    expect(result.status).toBe('unknown');
    expect(await readFile(collision, 'utf8')).toBe('unrelated');
    expect(await readFile(front.identity.archivePath)).toEqual(front.body);
  });
});

import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat, open, realpath, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';

/**
 * EXEC2 offline-only local quarantine seam. No production source path is accepted.
 * This is NOT a deletion executor, authorization token, or durable journal.
 */
export interface DisposableArchiveIdentity {
  sandboxRoot: string;
  archivePath: string;
  groupId: string;
  targetVariationId: string;
  copyId: string;
  role: 'front' | 'back';
  frozenR2Key: string;
}

export interface PinnedDisposableFile {
  archivePath: string;
  archiveDirectoryDevice: number;
  archiveDirectoryInode: number;
  device: number;
  inode: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  sha256Prefix: string;
}

export interface DisposableQuarantineOutcome {
  /** Native Node/macOS has no portable atomic no-clobber rename with path identity. */
  status: 'unknown';
  path: string;
  originalPath: string;
  reason: string;
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const imageExtension = /^(?:jpg|jpeg|png|webp)$/;
const sandboxPrefix = 'yp-c4-exec2-';

function isChild(root: string, target: string): boolean {
  const r = relative(root, target);
  return r !== '' && r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r);
}

function sameIdentity(a: PinnedDisposableFile, b: PinnedDisposableFile): boolean {
  return a.archiveDirectoryDevice === b.archiveDirectoryDevice &&
    a.archiveDirectoryInode === b.archiveDirectoryInode &&
    a.device === b.device && a.inode === b.inode && a.size === b.size &&
    a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.sha256Prefix === b.sha256Prefix;
}

async function disposableRoot(input: string): Promise<string> {
  if (!isAbsolute(input)) throw new Error('EXEC2 requires an absolute disposable test root.');
  const supplied = await lstat(input);
  if (!supplied.isDirectory() || supplied.isSymbolicLink()) {
    throw new Error('EXEC2 refuses a symlinked or non-directory disposable test root.');
  }
  const [temporary, actual] = await Promise.all([realpath(tmpdir()), realpath(input)]);
  if (!isChild(temporary, actual) ||
      !basename(actual).startsWith(sandboxPrefix) ||
      !(await lstat(actual)).isDirectory()) {
    throw new Error('EXEC2 refuses paths outside an explicitly named disposable test root.');
  }
  return actual;
}

async function expectedSource(input: DisposableArchiveIdentity): Promise<{
  root: string; path: string; digest: string;
}> {
  const root = await disposableRoot(input.sandboxRoot);
  const {groupId, targetVariationId, copyId, role, frozenR2Key} = input;
  if (![groupId, targetVariationId, copyId].every(id => UUID.test(id)) ||
      !['front', 'back'].includes(role)) {
    throw new Error('EXEC2 frozen identity is invalid.');
  }
  const prefix = `variation-listing/${groupId}/${targetVariationId}/${copyId}/${role}-`;
  if (!frozenR2Key.startsWith(prefix)) throw new Error('EXEC2 R2 identity is not exact.');
  const match = /^([a-f0-9]{12})\.([a-z0-9]+)$/.exec(frozenR2Key.slice(prefix.length));
  if (!match || !imageExtension.test(match[2]!)) throw new Error('EXEC2 frozen image digest or extension is invalid.');
  const archiveName = basename(dirname(input.archivePath));
  if (!new RegExp(`^(?:BSKBL|BSBL|OTHER)-[A-Za-z0-9._-]+--${groupId}$`).test(archiveName)) {
    throw new Error('EXEC2 expected archive bucket name is invalid.');
  }
  const candidatePath = resolve(input.archivePath);
  const candidateDirectory = dirname(candidatePath);
  const candidateDirectoryInfo = await lstat(candidateDirectory);
  if (!candidateDirectoryInfo.isDirectory() || candidateDirectoryInfo.isSymbolicLink()) {
    throw new Error('EXEC2 archive directory is not a stable, real directory.');
  }
  // tmpdir() may be exposed as /var while realpath() returns /private/var on
  // macOS. Canonicalize only the existing parent; O_NOFOLLOW below still
  // rejects a symlink at the source path itself.
  const path = join(await realpath(dirname(candidatePath)), basename(candidatePath));
  const required = join(root, 'processed', archiveName, `${copyId}_${role}-${match[1]}.${match[2]}`);
  if (path !== required || !isChild(root, path)) {
    throw new Error('EXEC2 path does not match the frozen archive identity.');
  }
  // Reject symlinked directories at this instant. Node's path-based APIs do
  // not bind these ancestor checks to an open directory handle (openat/dirfd),
  // so root/ancestor replacement races remain unresolved. The seam below is
  // validation-only and performs no mutation, making that gap non-destructive.
  for (const directory of [join(root, 'processed'), dirname(path)]) {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) {
      throw new Error('EXEC2 archive directory is not a stable, real directory.');
    }
  }
  return {root, path, digest: match[1]!};
}

/**
 * Reopen with O_NOFOLLOW and pin the frozen SHA-256 prefix and physical inode.
 * This proof is ephemeral: it does not pin ancestor/root/source/quarantine
 * directories across the async calls and leaves TOCTOU windows unresolved.
 * It cannot authorize a production filesystem mutation.
 */
export async function inspectDisposableRemovedSkuArchive(input: DisposableArchiveIdentity): Promise<PinnedDisposableFile> {
  const {path, digest} = await expectedSource(input);
  const archiveDirectory = await lstat(dirname(path));
  if (!archiveDirectory.isDirectory() || archiveDirectory.isSymbolicLink()) {
    throw new Error('EXEC2 archive directory is not a stable, real directory.');
  }
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await fd.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size === 0) {
      throw new Error('EXEC2 rejects nonregular, empty, or hard-linked files.');
    }
    const hash = createHash('sha256');
    for await (const chunk of fd.createReadStream({autoClose: false})) hash.update(chunk);
    const after = await fd.stat();
    const current = await lstat(path);
    if ([after, current].some(s => !s.isFile() || s.nlink !== 1 ||
        s.dev !== before.dev || s.ino !== before.ino || s.size !== before.size ||
        s.mtimeMs !== before.mtimeMs || s.ctimeMs !== before.ctimeMs)) {
      throw new Error('EXEC2 file identity changed during inspection.');
    }
    const sha256Prefix = hash.digest('hex').slice(0, 12);
    if (sha256Prefix !== digest) throw new Error('EXEC2 frozen archive hash mismatch.');
    return {
      archivePath: path,
      archiveDirectoryDevice: archiveDirectory.dev,
      archiveDirectoryInode: archiveDirectory.ino,
      device: before.dev, inode: before.ino,
      size: before.size, mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs, sha256Prefix,
    };
  } finally {
    await fd.close();
  }
}

/**
 * Test-fixture-only quarantine validation.
 *
 * Node's portable fs/promises API has no atomic no-clobber rename that also
 * pins the source inode. A source path can be replaced after the final stat
 * and before rename(), which could move an unrelated file. Therefore this
 * seam deliberately performs no filesystem mutation and returns `unknown`.
 * Ancestor/root/source/quarantine replacement between validation calls is
 * likewise unresolved; that is harmless here only because this seam never
 * moves, deletes, or overwrites a file.
 * A future executor must supply an OS-specific, dirfd/identity-safe primitive
 * plus the EXEC1 durable pre-attempt barrier before any move is attempted.
 */
export async function quarantineDisposableRemovedSkuArchive(
  input: DisposableArchiveIdentity,
  quarantineDirectory: string,
  expectedPin: PinnedDisposableFile,
): Promise<DisposableQuarantineOutcome> {
  const {root, path} = await expectedSource(input);
  const quarantineCandidate = resolve(quarantineDirectory);
  const quarantineInfo = await lstat(quarantineCandidate);
  if (!quarantineInfo.isDirectory() || quarantineInfo.isSymbolicLink()) {
    throw new Error('EXEC2 quarantine directory is not a real directory.');
  }
  const quarantine = await realpath(quarantineCandidate);
  if (quarantine !== join(root, 'quarantine') || !isChild(root, quarantine)) {
    throw new Error('EXEC2 quarantine must be the disposable root quarantine directory.');
  }
  const directory = await lstat(quarantine);
  if (!directory.isDirectory() || directory.isSymbolicLink() ||
      await realpath(quarantine) !== quarantine) {
    throw new Error('EXEC2 quarantine directory is not a real directory.');
  }
  if (expectedPin.archivePath !== path ||
      !sameIdentity(expectedPin, await inspectDisposableRemovedSkuArchive(input))) {
    throw new Error('EXEC2 source has changed since the frozen identity pin.');
  }
  if ((await stat(quarantine)).dev !== expectedPin.device) {
    throw new Error('EXEC2 requires an atomic same-device quarantine rename.');
  }
  return {
    status: 'unknown',
    path,
    originalPath: path,
    reason: 'EXEC2 quarantine is validation-only: portable no-clobber/source-identity rename is unavailable.',
  };
}

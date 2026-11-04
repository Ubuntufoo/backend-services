import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { dirname, extname, isAbsolute, normalize, relative, resolve, sep } from 'node:path';

import {
  findCompletedVariationListingCapturePair,
  type VariationListingCompletionPersistenceResult,
  type VariationListingUnknownCompletedCapturePairResult,
} from './variation-listing-persistence.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CATEGORY_PATTERN = /^(?:BSKBL|BSBL|OTHER)$/u;
const BUCKET_PATTERN = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/u;
const R2_KEY_PATTERN =
  /^variation-listing\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/(front|back)-([0-9a-f]{12})(\.(?:jpg|jpeg|png|webp))$/iu;

const RECOVERY_FILE_PREFIX = '.variation-archive-recovery-';
const RECOVERY_FILE_SUFFIX = '.json';
const RECOVERY_VERSION = 1 as const;

const RECOVERY_KEYS = [
  'version',
  'completionKind',
  'capturePairId',
  'captureSourceKey',
  'targetGroupId',
  'variationId',
  'copyId',
  'frontSourceRef',
  'backSourceRef',
  'frontR2Key',
  'backR2Key',
] as const;

export interface VariationImageArchiveCommand {
  completionKind: 'new_variation' | 'duplicate_copy';
  capturePairId: string;
  captureSourceKey: string;
  targetGroupId: string;
  variationId: string;
  copyId: string;
  frontSourceRef: string;
  backSourceRef: string;
  frontR2Key: string;
  backR2Key: string;
}

export interface VariationImageArchiveRecoveryRecord extends VariationImageArchiveCommand {
  version: typeof RECOVERY_VERSION;
}

export interface VariationImageArchiveInput {
  incomingDirectory: string;
  processedDirectory: string;
  command: VariationImageArchiveCommand;
  persisted: VariationListingCompletionPersistenceResult | VariationListingUnknownCompletedCapturePairResult;
}

export interface VariationImageArchiveResult {
  status: 'archived';
  bucketDirectory: string;
  frontPath: string;
  backPath: string;
}

export interface VariationImageArchiveFileSystem {
  copyFile: typeof fs.copyFile;
  link: typeof fs.link;
  lstat: typeof fs.lstat;
  mkdir: typeof fs.mkdir;
  realpath: typeof fs.realpath;
  readFile: typeof fs.readFile;
  unlink: typeof fs.unlink;
}

const DEFAULT_FILE_SYSTEM: VariationImageArchiveFileSystem = {
  copyFile: fs.copyFile.bind(fs),
  link: fs.link.bind(fs),
  lstat: fs.lstat.bind(fs),
  mkdir: fs.mkdir.bind(fs),
  realpath: fs.realpath.bind(fs),
  readFile: fs.readFile.bind(fs),
  unlink: fs.unlink.bind(fs),
};

interface ParsedR2Key {
  groupId: string;
  variationId: string;
  copyId: string;
  role: 'front' | 'back';
  hash: string;
  extension: string;
}

interface ArchiveFileSpec {
  role: 'front' | 'back';
  sourcePath: string;
  r2Key: string;
  expectedPath: string;
}

interface FileIdentity {
  dev: number | bigint;
  ino: number | bigint;
}

interface ReadRegularFile {
  bytes: Buffer;
  identity: FileIdentity;
}

function fail(message: string): never {
  throw new Error(`Variation image archive failed: ${message}`);
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as {code?: string}).code === 'ENOENT';
}

function isCrossDevice(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as {code?: string}).code === 'EXDEV';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) fail(`${label} is not a valid UUID.`);
  return value.toLowerCase();
}

function parseR2Key(key: string, role: 'front' | 'back'): ParsedR2Key {
  const match = R2_KEY_PATTERN.exec(key);
  if (!match || match[4]?.toLowerCase() !== role) {
    fail(`${role} R2 key does not match the immutable variation-image format.`);
  }
  return {
    groupId: match[1]!.toLowerCase(),
    variationId: match[2]!.toLowerCase(),
    copyId: match[3]!.toLowerCase(),
    role,
    hash: match[5]!.toLowerCase(),
    extension: match[6]!.toLowerCase(),
  };
}

function assertContainedChild(root: string, child: string, label: string): void {
  const rootPath = resolve(root);
  const childPath = resolve(child);
  if (child !== childPath || normalize(child) !== child) {
    fail(`${label} must be a normalized absolute path.`);
  }
  const childRelative = relative(rootPath, childPath);
  if (
    childRelative.length === 0 ||
    childRelative === '..' ||
    childRelative.startsWith(`..${sep}`) ||
    isAbsolute(childRelative) ||
    childRelative.includes(sep)
  ) {
    fail(`${label} must be a direct child of the configured incoming directory.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertLowercaseUuid(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(`${label} must be a UUID string.`);
  const normalized = assertUuid(value, label);
  if (value !== normalized) fail(`${label} must be lowercase.`);
  return normalized;
}

function assertNonEmptyText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\u0000')) {
    fail(`${label} must be a non-empty string.`);
  }
  return value;
}

function recoveryFileName(capturePairId: string): string {
  const pairId = assertLowercaseUuid(capturePairId, 'capturePairId');
  return `${RECOVERY_FILE_PREFIX}${pairId}${RECOVERY_FILE_SUFFIX}`;
}

function recoveryFilePath(incomingDirectory: string, capturePairId: string): string {
  const root = resolve(incomingDirectory);
  return resolve(root, recoveryFileName(capturePairId));
}

function createRecoveryRecord(command: VariationImageArchiveCommand): VariationImageArchiveRecoveryRecord {
  return {
    version: RECOVERY_VERSION,
    completionKind: command.completionKind,
    capturePairId: assertLowercaseUuid(command.capturePairId, 'capturePairId'),
    captureSourceKey: assertNonEmptyText(command.captureSourceKey, 'captureSourceKey'),
    targetGroupId: assertLowercaseUuid(command.targetGroupId, 'targetGroupId'),
    variationId: assertLowercaseUuid(command.variationId, 'variationId'),
    copyId: assertLowercaseUuid(command.copyId, 'copyId'),
    frontSourceRef: command.frontSourceRef,
    backSourceRef: command.backSourceRef,
    frontR2Key: command.frontR2Key,
    backR2Key: command.backR2Key,
  };
}

function assertRecoveryRecord(
  value: unknown,
  incomingDirectory: string,
): VariationImageArchiveRecoveryRecord {
  if (!isRecord(value)) fail('archive recovery journal must contain an object.');
  const keys = Object.keys(value).sort();
  const expectedKeys = [...RECOVERY_KEYS].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    fail('archive recovery journal has an unsupported shape.');
  }
  if (value.version !== RECOVERY_VERSION) fail('archive recovery journal version is unsupported.');
  if (value.completionKind !== 'new_variation' && value.completionKind !== 'duplicate_copy') {
    fail('archive recovery journal completionKind is invalid.');
  }

  const record = {
    version: RECOVERY_VERSION,
    completionKind: value.completionKind,
    capturePairId: assertLowercaseUuid(value.capturePairId, 'capturePairId'),
    captureSourceKey: assertNonEmptyText(value.captureSourceKey, 'captureSourceKey'),
    targetGroupId: assertLowercaseUuid(value.targetGroupId, 'targetGroupId'),
    variationId: assertLowercaseUuid(value.variationId, 'variationId'),
    copyId: assertLowercaseUuid(value.copyId, 'copyId'),
    frontSourceRef: assertNonEmptyText(value.frontSourceRef, 'frontSourceRef'),
    backSourceRef: assertNonEmptyText(value.backSourceRef, 'backSourceRef'),
    frontR2Key: assertNonEmptyText(value.frontR2Key, 'frontR2Key'),
    backR2Key: assertNonEmptyText(value.backR2Key, 'backR2Key'),
  } satisfies VariationImageArchiveRecoveryRecord;

  assertContainedChild(incomingDirectory, record.frontSourceRef, 'front source path');
  assertContainedChild(incomingDirectory, record.backSourceRef, 'back source path');
  if (record.frontSourceRef === record.backSourceRef) {
    fail('front and back source references must be distinct.');
  }

  const frontKey = parseR2Key(record.frontR2Key, 'front');
  const backKey = parseR2Key(record.backR2Key, 'back');
  for (const parsed of [frontKey, backKey]) {
    if (
      parsed.groupId !== record.targetGroupId ||
      parsed.variationId !== record.variationId ||
      parsed.copyId !== record.copyId
    ) {
      fail('archive recovery journal R2 identity does not match its immutable IDs.');
    }
  }
  if (extname(record.frontSourceRef).toLowerCase() !== frontKey.extension) {
    fail('front source extension does not match the frozen R2 key.');
  }
  if (extname(record.backSourceRef).toLowerCase() !== backKey.extension) {
    fail('back source extension does not match the frozen R2 key.');
  }

  return record;
}

function recoveryRecordsEqual(
  left: VariationImageArchiveRecoveryRecord,
  right: VariationImageArchiveRecoveryRecord,
): boolean {
  return RECOVERY_KEYS.every((key) => left[key] === right[key]);
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await fs.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncFile(filePath: string): Promise<void> {
  const handle = await fs.open(filePath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readRecoveryRecord(
  journalPath: string,
  incomingDirectory: string,
): Promise<VariationImageArchiveRecoveryRecord> {
  const stats = await fs.lstat(journalPath);
  if (stats.isSymbolicLink()) fail(`archive recovery journal is a symlink: ${journalPath}.`);
  if (!stats.isFile()) fail(`archive recovery journal is not a regular file: ${journalPath}.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(journalPath, 'utf8'));
  } catch {
    fail(`archive recovery journal is not valid JSON: ${journalPath}.`);
  }
  return assertRecoveryRecord(parsed, incomingDirectory);
}

async function removeOrphanRecoveryTemp(tempPath: string): Promise<void> {
  try {
    const stats = await fs.lstat(tempPath);
    if (stats.isSymbolicLink()) fail(`archive recovery temporary file is a symlink: ${tempPath}.`);
    if (!stats.isFile()) fail(`archive recovery temporary path is not a regular file: ${tempPath}.`);
    await fs.unlink(tempPath);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

export async function persistVariationImageArchiveRecovery(
  command: VariationImageArchiveCommand,
  incomingDirectory: string,
): Promise<VariationImageArchiveRecoveryRecord> {
  await ensureDirectory(incomingDirectory, DEFAULT_FILE_SYSTEM, false);
  const root = resolve(incomingDirectory);
  const record = assertRecoveryRecord(createRecoveryRecord(command), root);
  const destination = recoveryFilePath(root, record.capturePairId);
  try {
    const existing = await readRecoveryRecord(destination, root);
    if (!recoveryRecordsEqual(existing, record)) {
      fail('archive recovery journal does not match the immutable capture command.');
    }
    await syncFile(destination);
    await syncDirectory(root);
    await removeOrphanRecoveryTemp(`${destination}.tmp`);
    await syncDirectory(root);
    return existing;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  const temporary = `${destination}.tmp`;
  await removeOrphanRecoveryTemp(temporary);
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`, {encoding: 'utf8'});
    await handle.sync();
  } finally {
    await handle.close();
  }

  await fs.link(temporary, destination);
  await fs.unlink(temporary);
  await syncDirectory(root);
  return record;
}

export async function clearVariationImageArchiveRecovery(
  command: VariationImageArchiveCommand,
  incomingDirectory: string,
): Promise<void> {
  await ensureDirectory(incomingDirectory, DEFAULT_FILE_SYSTEM, false);
  const root = resolve(incomingDirectory);
  const record = assertRecoveryRecord(createRecoveryRecord(command), root);
  const destination = recoveryFilePath(root, record.capturePairId);
  try {
    const existing = await readRecoveryRecord(destination, root);
    if (!recoveryRecordsEqual(existing, record)) {
      fail('archive recovery journal does not match the immutable capture command.');
    }
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  await fs.unlink(destination);
  await syncDirectory(root);
}

async function assertDirectoryChain(
  root: string,
  target: string,
  fileSystem: Pick<VariationImageArchiveFileSystem, 'lstat'>,
): Promise<void> {
  const rootPath = resolve(root);
  const targetPath = resolve(target);
  const targetRelative = relative(rootPath, targetPath);
  if (
    targetRelative === '..' ||
    targetRelative.startsWith(`..${sep}`) ||
    isAbsolute(targetRelative)
  ) {
    fail('archive path escapes its configured root.');
  }

  const components = targetRelative.length === 0 ? [] : targetRelative.split(sep);
  let current = rootPath;
  for (const component of components) {
    current = resolve(current, component);
    try {
      const stats = await fileSystem.lstat(current);
      if (stats.isSymbolicLink()) fail(`archive directory is a symlink: ${current}.`);
      if (!stats.isDirectory()) fail(`archive directory is not a directory: ${current}.`);
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
  }
}

async function ensureDirectory(
  directory: string,
  fileSystem: VariationImageArchiveFileSystem,
  createIfMissing: boolean,
): Promise<void> {
  const root = resolve(directory);
  await assertDirectoryChain(root, root, fileSystem);
  let creationAncestor: string | null = null;
  try {
    const stats = await fileSystem.lstat(root);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      fail(`archive root is not a real directory: ${root}.`);
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
    if (!createIfMissing) fail(`archive directory is missing: ${root}.`);
    creationAncestor = await assertExistingAncestorForCreation(root, fileSystem);
    await fileSystem.mkdir(root, {recursive: true});
    await syncCreatedDirectoryChain(root, creationAncestor);
  }
  const realRoot = await fileSystem.realpath(root);
  if (resolve(realRoot) !== root) fail(`archive root resolves through a symlink: ${root}.`);
  await assertDirectoryChain(root, root, fileSystem);
  const stats = await fileSystem.lstat(root);
  if (stats.isSymbolicLink() || !stats.isDirectory()) fail(`archive root is not a real directory: ${root}.`);
}

async function assertExistingAncestorForCreation(
  target: string,
  fileSystem: VariationImageArchiveFileSystem,
): Promise<string> {
  let current = resolve(target);
  while (true) {
    try {
      const stats = await fileSystem.lstat(current);
      if (stats.isSymbolicLink()) fail(`archive directory ancestor is a symlink: ${current}.`);
      if (!stats.isDirectory()) fail(`archive directory ancestor is not a directory: ${current}.`);
      const realCurrent = await fileSystem.realpath(current);
      if (resolve(realCurrent) !== current) fail(`archive directory ancestor resolves through a symlink: ${current}.`);
      return current;
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = dirname(current);
      if (parent === current) fail(`archive directory ancestor is unavailable: ${current}.`);
      current = parent;
    }
  }
}

async function syncCreatedDirectoryChain(root: string, ancestor: string): Promise<void> {
  const rootPath = resolve(root);
  const ancestorPath = resolve(ancestor);
  const relativeRoot = relative(ancestorPath, rootPath);
  if (
    relativeRoot.length === 0 ||
    relativeRoot === '..' ||
    relativeRoot.startsWith(`..${sep}`) ||
    isAbsolute(relativeRoot)
  ) {
    fail('archive directory creation ancestor is invalid.');
  }
  const components = relativeRoot.split(sep);
  const createdDirectories: string[] = [];
  let current = ancestorPath;
  for (const component of components) {
    current = resolve(current, component);
    createdDirectories.unshift(current);
  }
  for (const directory of createdDirectories) {
    await syncDirectory(directory);
  }
  await syncDirectory(ancestorPath);
}

async function readRegularFile(
  filePath: string,
  label: string,
  fileSystem: VariationImageArchiveFileSystem,
): Promise<ReadRegularFile> {
  const stats = await fileSystem.lstat(filePath).catch((error: unknown) => {
    if (isMissing(error)) fail(`${label} is missing.`);
    throw error;
  });
  if (stats.isSymbolicLink()) fail(`${label} is a symlink.`);
  if (!stats.isFile()) fail(`${label} is not a regular file.`);
  return {
    bytes: Buffer.from(await fileSystem.readFile(filePath)),
    identity: {dev: stats.dev, ino: stats.ino},
  };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function assertSameRegularFile(
  filePath: string,
  label: string,
  expected: ReadRegularFile,
  parsedHash: string,
  fileSystem: VariationImageArchiveFileSystem,
): Promise<ReadRegularFile> {
  const current = await readRegularFile(filePath, label, fileSystem);
  if (!sameIdentity(current.identity, expected.identity)) {
    fail(`${label} identity changed before archive cleanup.`);
  }
  if (!current.bytes.equals(expected.bytes) || hashPrefix(current.bytes) !== parsedHash) {
    fail(`${label} bytes changed before archive cleanup.`);
  }
  return current;
}

async function assertDirectoryIdentity(
  directoryPath: string,
  expected: FileIdentity,
  fileSystem: Pick<VariationImageArchiveFileSystem, 'lstat'>,
): Promise<void> {
  const stats = await fileSystem.lstat(directoryPath).catch((error: unknown) => {
    if (isMissing(error)) fail(`archive bucket disappeared: ${directoryPath}.`);
    throw error;
  });
  if (stats.isSymbolicLink() || !stats.isDirectory()) fail('archive bucket was replaced by a non-directory.');
  if (!sameIdentity({dev: stats.dev, ino: stats.ino}, expected)) {
    fail('archive bucket identity changed during archiving.');
  }
}

function hashPrefix(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 12);
}

function assertR2Proof(
  input: VariationImageArchiveInput,
): {bucketDirectory: string; front: ArchiveFileSpec; back: ArchiveFileSpec} {
  const command = input.command;
  const persisted = input.persisted;
  if (command.frontSourceRef === command.backSourceRef) {
    fail('front and back source references must be distinct.');
  }
  if (persisted.status !== 'completed' && persisted.status !== 'already_completed') {
    fail('archive requires a durably completed capture result.');
  }
  if (persisted.completionKind === 'unknown' && persisted.status !== 'already_completed') {
    fail('archive recovery proof must be an already-completed capture result.');
  }
  if (persisted.completionKind !== 'unknown' && persisted.completionKind !== command.completionKind) {
    fail('completion kind does not match the durable capture command.');
  }

  const group = persisted.group;
  const copy = persisted.copy;
  const variation = 'variation' in persisted ? persisted.variation : null;
  const groupId = assertUuid(command.targetGroupId, 'targetGroupId');
  const variationId = assertUuid(command.variationId, 'variationId');
  const copyId = assertUuid(command.copyId, 'copyId');
  if (!group || !copy) fail('durable completion proof is incomplete.');
  if (
    group.group_id !== command.targetGroupId ||
    copy.copy_id !== command.copyId ||
    copy.variation_id !== command.variationId ||
    (variation !== null && (
      variation.variation_id !== command.variationId ||
      variation.group_id !== command.targetGroupId
    )) ||
    copy.capture_pair_id !== command.capturePairId ||
    copy.capture_source_key !== command.captureSourceKey ||
    copy.capture_front_source_ref !== command.frontSourceRef ||
    copy.capture_back_source_ref !== command.backSourceRef ||
    copy.front_r2_key !== command.frontR2Key ||
    copy.back_r2_key !== command.backR2Key
  ) {
    fail('durable completion proof does not match the immutable capture command.');
  }
  if (!CATEGORY_PATTERN.test(group.sku_category_code)) {
    fail('durable SKU category is not one of BSKBL, BSBL, or OTHER.');
  }
  if (group.sku_bucket_token.length < 1 || group.sku_bucket_token.length > 32 || !BUCKET_PATTERN.test(group.sku_bucket_token)) {
    fail('durable SKU bucket token is not a safe ASCII path segment.');
  }

  const frontKey = parseR2Key(command.frontR2Key, 'front');
  const backKey = parseR2Key(command.backR2Key, 'back');
  for (const parsed of [frontKey, backKey]) {
    if (parsed.groupId !== groupId || parsed.variationId !== variationId || parsed.copyId !== copyId) {
      fail('R2 key identity does not match the durable capture command.');
    }
  }

  const bucketName = `${group.sku_category_code}-${group.sku_bucket_token}--${groupId}`;
  const bucketDirectory = resolve(input.processedDirectory, bucketName);
  const expectedFront = resolve(bucketDirectory, `${copyId}_front-${frontKey.hash}${frontKey.extension}`);
  const expectedBack = resolve(bucketDirectory, `${copyId}_back-${backKey.hash}${backKey.extension}`);
  return {
    bucketDirectory,
    front: {role: 'front', sourcePath: command.frontSourceRef, r2Key: command.frontR2Key, expectedPath: expectedFront},
    back: {role: 'back', sourcePath: command.backSourceRef, r2Key: command.backR2Key, expectedPath: expectedBack},
  };
}

async function archiveOne(
  spec: ArchiveFileSpec,
  incomingDirectory: string,
  bucketDirectory: string,
  bucketIdentity: FileIdentity,
  fileSystem: VariationImageArchiveFileSystem,
): Promise<void> {
  if (!isAbsolute(spec.sourcePath)) fail(`${spec.role} source path must be absolute.`);
  assertContainedChild(incomingDirectory, spec.sourcePath, `${spec.role} source path`);
  await assertDirectoryChain(resolve(incomingDirectory), dirname(resolve(spec.sourcePath)), fileSystem);
  const source = await readRegularFile(spec.sourcePath, `${spec.role} source`, fileSystem).catch((error) => {
    if (error instanceof Error && error.message.includes('is missing')) return null;
    throw error;
  });
  const parsed = parseR2Key(spec.r2Key, spec.role);
  if (source && hashPrefix(source.bytes) !== parsed.hash) {
    fail(`${spec.role} source bytes do not match the frozen R2 hash.`);
  }
  const sourceExtension = extname(spec.sourcePath).toLowerCase();
  if (sourceExtension !== parsed.extension) {
    fail(`${spec.role} source extension does not match the frozen R2 key.`);
  }

  let destination: ReadRegularFile | null = null;
  try {
    destination = await readRegularFile(spec.expectedPath, `${spec.role} destination`, fileSystem);
  } catch (error) {
    if (!(error instanceof Error && error.message.includes('is missing'))) throw error;
  }
  if (destination && hashPrefix(destination.bytes) !== parsed.hash) {
    fail(`${spec.role} archive destination collides with different bytes.`);
  }
  if (source === null) {
    if (destination !== null) {
      await assertDirectoryIdentity(bucketDirectory, bucketIdentity, fileSystem);
      await syncFile(spec.expectedPath);
      await syncDirectory(bucketDirectory);
      await syncDirectory(incomingDirectory);
      return;
    }
    fail(`${spec.role} source and archive destination are both missing.`);
  }
  if (destination !== null) {
    if (!source.bytes.equals(destination.bytes)) fail(`${spec.role} source and destination bytes disagree.`);
    // A crash after a successful no-overwrite copy can leave both exact files.
    await assertDirectoryIdentity(bucketDirectory, bucketIdentity, fileSystem);
    await assertSameRegularFile(spec.sourcePath, `${spec.role} source`, source, parsed.hash, fileSystem);
    await syncFile(spec.expectedPath);
    await syncDirectory(bucketDirectory);
    await fileSystem.unlink(spec.sourcePath);
    await syncDirectory(incomingDirectory);
    const finalDestination = await readRegularFile(spec.expectedPath, `${spec.role} archive`, fileSystem);
    if (!finalDestination.bytes.equals(source.bytes) || hashPrefix(finalDestination.bytes) !== parsed.hash) {
      fail(`${spec.role} archive verification bytes do not match the frozen source.`);
    }
    return;
  }

  await assertDirectoryIdentity(bucketDirectory, bucketIdentity, fileSystem);
  await assertSameRegularFile(spec.sourcePath, `${spec.role} source`, source, parsed.hash, fileSystem);
  try {
    await fileSystem.link(spec.sourcePath, spec.expectedPath);
  } catch (error) {
    if (!isCrossDevice(error)) throw new Error(`${spec.role} archive link failed: ${errorMessage(error)}`);
    try {
      await fileSystem.copyFile(spec.sourcePath, spec.expectedPath, fsConstants.COPYFILE_EXCL);
    } catch (copyError) {
      throw new Error(`${spec.role} cross-device archive copy failed: ${errorMessage(copyError)}`);
    }
  }
  let written: ReadRegularFile;
  try {
    written = await readRegularFile(spec.expectedPath, `${spec.role} archive`, fileSystem);
  } catch (error) {
    throw new Error(`${spec.role} archive verification failed: ${errorMessage(error)}`);
  }
  if (!written.bytes.equals(source.bytes) || hashPrefix(written.bytes) !== parsed.hash) {
    fail(`${spec.role} archive verification bytes do not match the frozen source.`);
  }
  await assertDirectoryIdentity(bucketDirectory, bucketIdentity, fileSystem);
  await assertSameRegularFile(spec.sourcePath, `${spec.role} source`, source, parsed.hash, fileSystem);
  await syncFile(spec.expectedPath);
  await syncDirectory(bucketDirectory);
  // Preserve both exact copies if cleanup fails; the next run reconciles them.
  await fileSystem.unlink(spec.sourcePath);
  await syncDirectory(incomingDirectory);
  const finalDestination = await readRegularFile(spec.expectedPath, `${spec.role} archive`, fileSystem);
  if (!finalDestination.bytes.equals(source.bytes) || hashPrefix(finalDestination.bytes) !== parsed.hash) {
    fail(`${spec.role} archive verification bytes do not match the frozen source.`);
  }
}

export async function archiveVariationImagePair(
  input: VariationImageArchiveInput,
  fileSystem: VariationImageArchiveFileSystem = DEFAULT_FILE_SYSTEM,
): Promise<VariationImageArchiveResult> {
  const proof = assertR2Proof(input);
  const incomingDirectory = resolve(input.incomingDirectory);
  const processedDirectory = resolve(input.processedDirectory);
  await ensureDirectory(incomingDirectory, fileSystem, false);
  await ensureDirectory(processedDirectory, fileSystem, true);
  await assertDirectoryChain(processedDirectory, proof.bucketDirectory, fileSystem);
  await fileSystem.mkdir(proof.bucketDirectory, {recursive: true});
  await assertDirectoryChain(processedDirectory, proof.bucketDirectory, fileSystem);
  await syncDirectory(processedDirectory);
  const bucketStats = await fileSystem.lstat(proof.bucketDirectory);
  if (bucketStats.isSymbolicLink() || !bucketStats.isDirectory()) fail('archive bucket is not a real directory.');
  const bucketIdentity: FileIdentity = {dev: bucketStats.dev, ino: bucketStats.ino};

  await archiveOne(proof.front, incomingDirectory, proof.bucketDirectory, bucketIdentity, fileSystem);
  await archiveOne(proof.back, incomingDirectory, proof.bucketDirectory, bucketIdentity, fileSystem);
  return {
    status: 'archived',
    bucketDirectory: proof.bucketDirectory,
    frontPath: proof.front.expectedPath,
    backPath: proof.back.expectedPath,
  };
}

export interface RecoverPendingVariationImageArchivesInput {
  incomingDirectory: string;
  processedDirectory: string;
  findCompletedPair?: typeof findCompletedVariationListingCapturePair;
}

export async function recoverPendingVariationImageArchives(
  input: RecoverPendingVariationImageArchivesInput,
): Promise<{recoveredCount: number}> {
  const incomingDirectory = resolve(input.incomingDirectory);
  try {
    await fs.lstat(incomingDirectory);
  } catch (error) {
    if (isMissing(error)) return {recoveredCount: 0};
    throw error;
  }
  await ensureDirectory(incomingDirectory, DEFAULT_FILE_SYSTEM, false);
  const entries = await fs.readdir(incomingDirectory, {withFileTypes: true});
  const journalPattern =
    /^\.variation-archive-recovery-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/u;
  const reservedNames = entries
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(RECOVERY_FILE_PREFIX))
    .sort();
  let recoveredCount = 0;
  const findCompletedPair = input.findCompletedPair ?? findCompletedVariationListingCapturePair;

  for (const journalName of reservedNames) {
    if (!journalPattern.test(journalName)) {
      fail(`archive recovery reserved path has an unsupported filename: ${journalName}.`);
    }
    const journalPath = resolve(incomingDirectory, journalName);
    const record = await readRecoveryRecord(journalPath, incomingDirectory);
    if (recoveryFileName(record.capturePairId) !== journalName) {
      fail(`archive recovery journal filename does not match capturePairId: ${journalName}.`);
    }
    const persisted = await findCompletedPair(record.capturePairId);
    if (!persisted) {
      fail(`durable capture completion is not present for ${record.capturePairId}.`);
    }
    await archiveVariationImagePair({
      command: record,
      incomingDirectory,
      persisted,
      processedDirectory: input.processedDirectory,
    });
    await clearVariationImageArchiveRecovery(record, incomingDirectory);
    recoveredCount += 1;
  }

  return {recoveredCount};
}

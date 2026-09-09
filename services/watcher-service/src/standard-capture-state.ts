import {access, mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {isAbsolute, join, relative, resolve, sep} from 'node:path';

import {createEmptyWatcherGroupingState, type WatcherGroupingState} from './image-grouping.js';

export const STANDARD_CAPTURE_STATE_FILE = '.standard-capture-pending.json';

type PersistedStandardCaptureState = {
  version: 1;
  pending: string[];
};

function isMissingPathError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as {code?: string}).code === 'ENOENT';
}

function statePath(incomingDirectory: string): string {
  return join(resolve(incomingDirectory), STANDARD_CAPTURE_STATE_FILE);
}

function assertPendingPathInsideIncoming(pathValue: string, incomingDirectory: string): string {
  if (!isAbsolute(pathValue)) throw new Error('Standard capture pending state contains a non-absolute path.');
  const normalized = resolve(pathValue);
  const root = resolve(incomingDirectory);
  const rel = relative(root, normalized);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Standard capture pending state contains a path outside WATCHER_INCOMING_DIR.');
  }
  return normalized;
}

export async function readStandardCaptureGroupingState(
  incomingDirectory: string,
): Promise<WatcherGroupingState> {
  let text: string;
  try {
    text = await readFile(statePath(incomingDirectory), 'utf8');
  } catch (error) {
    if (isMissingPathError(error)) return createEmptyWatcherGroupingState();
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Standard capture pending state is not valid JSON.');
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as {version?: unknown}).version !== 1 ||
    !Array.isArray((parsed as {pending?: unknown}).pending)
  ) {
    throw new Error('Standard capture pending state has an unsupported shape.');
  }

  const pending: Array<{path: string}> = [];
  for (const value of (parsed as PersistedStandardCaptureState).pending) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error('Standard capture pending state contains an invalid path.');
    }
    const path = assertPendingPathInsideIncoming(value, incomingDirectory);
    try {
      await access(path);
    } catch (error) {
      if (isMissingPathError(error)) continue;
      throw error;
    }
    pending.push({path});
  }

  return {pending};
}

export async function persistStandardCaptureGroupingState(
  incomingDirectory: string,
  state: WatcherGroupingState,
): Promise<void> {
  const destination = statePath(incomingDirectory);
  if (state.pending.length === 0) {
    try {
      await unlink(destination);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
    return;
  }

  const pending = state.pending.map((entry) =>
    assertPendingPathInsideIncoming(entry.path, incomingDirectory),
  );
  await mkdir(resolve(incomingDirectory), {recursive: true});
  const temporary = `${destination}.tmp`;
  const body: PersistedStandardCaptureState = {version: 1, pending};
  await writeFile(temporary, `${JSON.stringify(body)}\n`, {encoding: 'utf8', flag: 'w'});
  await rename(temporary, destination);
}

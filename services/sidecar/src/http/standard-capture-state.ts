import {access, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {isAbsolute, join, relative, resolve, sep} from 'node:path';

const STANDARD_CAPTURE_STATE_FILE = '.standard-capture-pending.json';
const BACKEND_REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const WATCHER_PACKAGE_DIR = join(BACKEND_REPO_ROOT, 'services', 'watcher-service');

type PersistedStandardCaptureState = {
  version: 1;
  pending: string[];
};

function isMissingPathError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as {code?: string}).code === 'ENOENT';
}

export function resolveWatcherIncomingDirectory(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.WATCHER_INCOMING_DIR) return resolve(WATCHER_PACKAGE_DIR, env.WATCHER_INCOMING_DIR);
  const base = resolve(WATCHER_PACKAGE_DIR, env.WATCHER_BASE_DIR || 'watcher');
  return resolve(base, 'incoming');
}

function assertInsideIncoming(pathValue: string, incomingDirectory: string): string {
  if (!isAbsolute(pathValue)) throw new Error('Standard capture pending state contains a non-absolute path.');
  const normalized = resolve(pathValue);
  const rel = relative(incomingDirectory, normalized);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Standard capture pending state contains a path outside WATCHER_INCOMING_DIR.');
  }
  return normalized;
}

export async function hasPendingStandardCapture(
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const incomingDirectory = resolveWatcherIncomingDirectory(env);
  const marker = join(incomingDirectory, STANDARD_CAPTURE_STATE_FILE);
  let text: string;
  try {
    text = await readFile(marker, 'utf8');
  } catch (error) {
    if (isMissingPathError(error)) return false;
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

  for (const value of (parsed as PersistedStandardCaptureState).pending) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error('Standard capture pending state contains an invalid path.');
    }
    const sourcePath = assertInsideIncoming(value, incomingDirectory);
    try {
      await access(sourcePath);
      return true;
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
  }
  return false;
}

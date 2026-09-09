import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {
  hasPendingStandardCapture,
  resolveWatcherIncomingDirectory,
} from '@/http/standard-capture-state.js';

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) rmSync(tempDir, {recursive: true, force: true});
  tempDir = undefined;
});

describe('Sidecar Standard capture state reader', () => {
  it('uses the explicit watcher incoming directory', () => {
    expect(resolveWatcherIncomingDirectory({WATCHER_INCOMING_DIR: '/tmp/incoming'})).toBe('/tmp/incoming');
  });

  it('reports a live persisted Standard partial group', async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'sidecar-standard-state-'));
    const front = path.join(tempDir, 'front.jpg');
    writeFileSync(front, 'front');
    writeFileSync(
      path.join(tempDir, '.standard-capture-pending.json'),
      JSON.stringify({version: 1, pending: [front]}),
    );

    await expect(hasPendingStandardCapture({WATCHER_INCOMING_DIR: tempDir})).resolves.toBe(true);
  });

  it('ignores a marker whose pending source no longer exists', async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'sidecar-standard-state-'));
    writeFileSync(
      path.join(tempDir, '.standard-capture-pending.json'),
      JSON.stringify({version: 1, pending: [path.join(tempDir, 'missing.jpg')]}),
    );

    await expect(hasPendingStandardCapture({WATCHER_INCOMING_DIR: tempDir})).resolves.toBe(false);
  });
});

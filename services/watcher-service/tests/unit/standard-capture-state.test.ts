import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {
  persistCaptureWorkspace,
  persistStandardCaptureGroupingState,
  readCaptureWorkspace,
  readStandardCaptureGroupingState,
  STANDARD_CAPTURE_STATE_FILE,
} from '../../src/standard-capture-state.js';

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) rmSync(tempDir, {recursive: true, force: true});
  tempDir = undefined;
});

describe('standard capture pending state', () => {
  it('defaults a missing workspace marker to Standard and persists an atomic workspace marker', async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'standard-capture-state-'));

    await expect(readCaptureWorkspace(tempDir)).resolves.toBe('standard');
    await persistCaptureWorkspace(tempDir, 'variation');
    await expect(readCaptureWorkspace(tempDir)).resolves.toBe('variation');
  });

  it('rejects malformed workspace markers instead of falling back to Standard', async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'standard-capture-state-'));
    writeFileSync(path.join(tempDir, '.capture-workspace.json'), '{bad');

    await expect(readCaptureWorkspace(tempDir)).rejects.toThrow(/not valid JSON/);
  });

  it('persists and restores a live pending Standard image', async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'standard-capture-state-'));
    const front = path.join(tempDir, 'front.jpg');
    writeFileSync(front, 'front');

    await persistStandardCaptureGroupingState(tempDir, {pending: [{path: front}]});
    await expect(readStandardCaptureGroupingState(tempDir)).resolves.toEqual({pending: [{path: front}]});
  });

  it('clears the marker after the Standard pair completes', async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'standard-capture-state-'));
    const front = path.join(tempDir, 'front.jpg');
    writeFileSync(front, 'front');
    await persistStandardCaptureGroupingState(tempDir, {pending: [{path: front}]});

    await persistStandardCaptureGroupingState(tempDir, {pending: []});

    await expect(readStandardCaptureGroupingState(tempDir)).resolves.toEqual({pending: []});
    await expect(readFile(path.join(tempDir, STANDARD_CAPTURE_STATE_FILE), 'utf8')).rejects.toMatchObject({code: 'ENOENT'});
  });

  it('drops stale pending paths whose source image no longer exists', async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'standard-capture-state-'));
    const missing = path.join(tempDir, 'missing.jpg');
    const marker = path.join(tempDir, STANDARD_CAPTURE_STATE_FILE);
    writeFileSync(marker, JSON.stringify({version: 1, pending: [missing]}));

    await expect(readStandardCaptureGroupingState(tempDir)).resolves.toEqual({pending: []});
  });
});

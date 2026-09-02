import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateVariationListingIntakeIdentityHandoff } from '@/gemini/variation-listing-intake-identity.js';

const variationId = '11111111-1111-4111-8111-111111111111';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

describe('variation listing intake identity handoff', () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirectories
        .splice(0)
        .map(async (directory) => await rm(directory, { recursive: true, force: true }))
    );
  });

  async function createIncomingFiles() {
    const root = await mkdtemp(join(tmpdir(), 'variation-intake-'));
    tempDirectories.push(root);
    const baseDirectory = join(root, 'watcher');
    const incomingDirectory = join(baseDirectory, 'incoming');
    await mkdir(incomingDirectory, { recursive: true });
    const front = join(incomingDirectory, 'front.jpg');
    const back = join(incomingDirectory, 'back.png');
    await writeFile(front, 'front');
    await writeFile(back, 'back');
    return { back, baseDirectory, front, incomingDirectory, root };
  }

  function createIdentityMock() {
    return vi.fn(async (input) => ({
      variationId,
      selectorValue: '2003 Topps Tracy McGrady #1',
      identity: { features: [] },
      variationMetadata: { Set: 'Topps' },
      evidence: {},
      reviewNotes: [],
      warnings: [],
      sourceImages: {
        front: {
          imageUrl: input.imageUrls[0],
          sourceRef: input.sourceRefs.front,
          imageIndex: 0 as const,
        },
        back: {
          imageUrl: input.imageUrls[1],
          sourceRef: input.sourceRefs.back,
          imageIndex: 1 as const,
        },
      },
    }));
  }

  it('reads configured incoming files and emits selector metadata', async () => {
    const paths = await createIncomingFiles();
    const generateIdentity = createIdentityMock();
    const result = await generateVariationListingIntakeIdentityHandoff(
      { variationId, frontSourceRef: paths.front, backSourceRef: paths.back },
      {
        cwd: paths.root,
        env: { WATCHER_INCOMING_DIR: paths.incomingDirectory },
        generateIdentity,
      }
    );

    expect(generateIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        variationId,
        sourceRefs: { front: paths.front, back: paths.back },
        imageUrls: [
          expect.stringMatching(/^data:image\/jpeg;base64,/u),
          expect.stringMatching(/^data:image\/png;base64,/u),
        ],
      }),
      expect.objectContaining({ model: expect.any(String) })
    );
    expect(result).toEqual({
      selectorValue: '2003 Topps Tracy McGrady #1',
      variationMetadata: { Set: 'Topps' },
    });
  });

  it('mirrors watcher base-directory fallback when incoming directory is unset', async () => {
    const paths = await createIncomingFiles();
    const generateIdentity = createIdentityMock();
    await generateVariationListingIntakeIdentityHandoff(
      { variationId, frontSourceRef: paths.front, backSourceRef: paths.back },
      {
        cwd: paths.root,
        env: { WATCHER_BASE_DIR: paths.baseDirectory },
        generateIdentity,
      }
    );
    expect(generateIdentity).toHaveBeenCalledTimes(1);
  });

  it('rejects a source path outside WATCHER_INCOMING_DIR before reading', async () => {
    const paths = await createIncomingFiles();
    const outside = join(paths.root, 'outside.jpg');
    await writeFile(outside, 'outside');
    const generateIdentity = vi.fn();
    await expect(
      generateVariationListingIntakeIdentityHandoff(
        { variationId, frontSourceRef: outside, backSourceRef: paths.back },
        {
          cwd: paths.root,
          env: { WATCHER_INCOMING_DIR: paths.incomingDirectory },
          generateIdentity,
        }
      )
    ).rejects.toThrow(/inside WATCHER_INCOMING_DIR/);
    expect(generateIdentity).not.toHaveBeenCalled();
  });

  it('rejects symlink escapes before reading or generation', async () => {
    const paths = await createIncomingFiles();
    const outside = join(paths.root, 'outside.jpg');
    const linkedFront = join(paths.incomingDirectory, 'linked-front.jpg');
    await writeFile(outside, 'outside');
    await symlink(outside, linkedFront);
    const generateIdentity = vi.fn();

    await expect(
      generateVariationListingIntakeIdentityHandoff(
        { variationId, frontSourceRef: linkedFront, backSourceRef: paths.back },
        {
          cwd: paths.root,
          env: { WATCHER_INCOMING_DIR: paths.incomingDirectory },
          generateIdentity,
        }
      )
    ).rejects.toThrow(/inside WATCHER_INCOMING_DIR/);
    expect(generateIdentity).not.toHaveBeenCalled();
  });

  it('rejects oversized local files at the bounded read seam', async () => {
    const paths = await createIncomingFiles();
    await writeFile(paths.front, Buffer.alloc(MAX_IMAGE_BYTES + 1, 1));
    const generateIdentity = vi.fn();

    await expect(
      generateVariationListingIntakeIdentityHandoff(
        { variationId, frontSourceRef: paths.front, backSourceRef: paths.back },
        {
          cwd: paths.root,
          env: { WATCHER_INCOMING_DIR: paths.incomingDirectory },
          generateIdentity,
        }
      )
    ).rejects.toThrow(/exceeds the 10 MB Gemini input limit/);
    expect(generateIdentity).not.toHaveBeenCalled();
  });

  it('rejects unsupported extensions before reading', async () => {
    const paths = await createIncomingFiles();
    const unsupported = join(paths.incomingDirectory, 'notes.txt');
    await writeFile(unsupported, 'not an image');
    const readImage = vi.fn(async () => Buffer.from('unexpected'));

    await expect(
      generateVariationListingIntakeIdentityHandoff(
        { variationId, frontSourceRef: unsupported, backSourceRef: paths.back },
        {
          cwd: paths.root,
          env: { WATCHER_INCOMING_DIR: paths.incomingDirectory },
          readImage,
        }
      )
    ).rejects.toThrow(/unsupported image extension/);
    expect(readImage).not.toHaveBeenCalled();
  });
});

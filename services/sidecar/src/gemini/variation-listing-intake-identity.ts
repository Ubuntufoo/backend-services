import { O_NOFOLLOW, O_NONBLOCK, O_RDONLY } from 'node:constants';
import { open, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

import type { Json } from '@ebay-inventory/data';

import { DEFAULT_GEMINI_DRAFT_MODEL } from './config.js';
import {
  generateVariationListingIdentity,
  toVariationListingNewVariationIdentityHandoff,
} from './variation-listing-identity.js';
import type {
  GeneratedVariationListingIdentityDraft,
  GenerateVariationListingIdentityInput,
} from './variation-listing-identity-contracts.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_READ_CHUNK_BYTES = 64 * 1024;

export interface GenerateVariationListingIntakeIdentityInput {
  variationId: string;
  frontSourceRef: string;
  backSourceRef: string;
}

export interface VariationListingIntakeIdentityDependencies {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  readImage?: (path: string) => Promise<Buffer | Uint8Array>;
  generateIdentity?: (
    input: GenerateVariationListingIdentityInput,
    options: { model: string }
  ) => Promise<GeneratedVariationListingIdentityDraft>;
}

function fail(message: string): never {
  throw new Error(`Variation listing intake identity failed: ${message}`);
}

function requireExactPath(value: string, label: string): string {
  if (!value || value !== value.trim() || !isAbsolute(value)) {
    return fail(`${label} must be a non-empty outer-trimmed absolute path.`);
  }
  return resolve(value);
}

function resolveIncomingDirectory(env: NodeJS.ProcessEnv, cwd: string): string {
  const configuredIncomingDirectory = env.WATCHER_INCOMING_DIR;
  if (configuredIncomingDirectory) {
    return resolve(cwd, configuredIncomingDirectory);
  }

  const baseDirectory = resolve(cwd, env.WATCHER_BASE_DIR || 'watcher');
  return resolve(baseDirectory, 'incoming');
}

function assertInsideIncomingDirectory(
  pathValue: string,
  incomingDirectory: string,
  label: string
): void {
  const pathRelative = relative(incomingDirectory, pathValue);
  if (
    pathRelative === '' ||
    pathRelative === '..' ||
    pathRelative.startsWith(`..${sep}`) ||
    isAbsolute(pathRelative)
  ) {
    return fail(`${label} must resolve to a file inside WATCHER_INCOMING_DIR.`);
  }
}

function mimeTypeForPath(pathValue: string): string {
  switch (extname(pathValue).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return fail(`unsupported image extension for ${pathValue}.`);
  }
}

function toImageDataUrl(body: Buffer | Uint8Array, mimeType: string, label: string): string {
  const bytes = Buffer.from(body);
  if (bytes.length === 0) return fail(`${label} image must not be empty.`);
  if (bytes.length > MAX_IMAGE_BYTES) {
    return fail(`${label} image exceeds the 10 MB Gemini input limit.`);
  }
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

async function resolveCanonicalIncomingDirectory(pathValue: string): Promise<string> {
  try {
    return await realpath(pathValue);
  } catch {
    return fail('WATCHER_INCOMING_DIR must resolve to an existing directory.');
  }
}

async function resolveCanonicalSourceRef(
  sourceRef: string,
  incomingDirectory: string,
  label: string
): Promise<string> {
  let canonicalSourceRef: string;
  try {
    canonicalSourceRef = await realpath(sourceRef);
  } catch {
    return fail(`${label} must resolve to a file inside WATCHER_INCOMING_DIR.`);
  }
  assertInsideIncomingDirectory(canonicalSourceRef, incomingDirectory, label);
  return canonicalSourceRef;
}

function assertMatchingImageMimeTypes(
  sourceRefMimeType: string,
  canonicalSourceRef: string,
  label: string
): void {
  const canonicalMimeType = mimeTypeForPath(canonicalSourceRef);
  if (canonicalMimeType !== sourceRefMimeType) {
    return fail(`${label} extension does not match its canonical file.`);
  }
}

async function readBoundedImage(sourcePath: string, label: string): Promise<Buffer> {
  const file = await open(sourcePath, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  try {
    const stats = await file.stat();
    if (!stats.isFile()) {
      return fail(`${label} image must be a regular file.`);
    }
    if (stats.size > MAX_IMAGE_BYTES) {
      return fail(`${label} image exceeds the 10 MB Gemini input limit.`);
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (totalBytes <= MAX_IMAGE_BYTES) {
      const bytesToRead = Math.min(IMAGE_READ_CHUNK_BYTES, MAX_IMAGE_BYTES + 1 - totalBytes);
      const chunk = Buffer.allocUnsafe(bytesToRead);
      const { bytesRead } = await file.read(chunk, 0, bytesToRead, null);
      if (bytesRead === 0) break;
      chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
      totalBytes += bytesRead;
      if (totalBytes > MAX_IMAGE_BYTES) {
        return fail(`${label} image exceeds the 10 MB Gemini input limit.`);
      }
    }

    return Buffer.concat(chunks, totalBytes);
  } finally {
    await file.close();
  }
}

export async function generateVariationListingIntakeIdentityHandoff(
  input: GenerateVariationListingIntakeIdentityInput,
  dependencies: VariationListingIntakeIdentityDependencies = {}
): Promise<{ selectorValue: string; variationMetadata: Json }> {
  const env = dependencies.env ?? process.env;
  const cwd = dependencies.cwd ?? process.cwd();
  const frontSourceRef = requireExactPath(input.frontSourceRef, 'frontSourceRef');
  const backSourceRef = requireExactPath(input.backSourceRef, 'backSourceRef');
  if (frontSourceRef === backSourceRef)
    return fail('frontSourceRef and backSourceRef must differ.');
  const frontMimeType = mimeTypeForPath(frontSourceRef);
  const backMimeType = mimeTypeForPath(backSourceRef);
  const incomingDirectory = await resolveCanonicalIncomingDirectory(
    resolveIncomingDirectory(env, cwd)
  );
  const canonicalFrontSourceRef = await resolveCanonicalSourceRef(
    frontSourceRef,
    incomingDirectory,
    'frontSourceRef'
  );
  const canonicalBackSourceRef = await resolveCanonicalSourceRef(
    backSourceRef,
    incomingDirectory,
    'backSourceRef'
  );
  assertMatchingImageMimeTypes(frontMimeType, canonicalFrontSourceRef, 'frontSourceRef');
  assertMatchingImageMimeTypes(backMimeType, canonicalBackSourceRef, 'backSourceRef');

  const readImage = dependencies.readImage;
  const read = readImage
    ? async (sourcePath: string, _label: string): Promise<Buffer | Uint8Array> =>
        await readImage(sourcePath)
    : readBoundedImage;
  const readAndEncode = async (
    sourcePath: string,
    mimeType: string,
    label: string
  ): Promise<string> => toImageDataUrl(await read(sourcePath, label), mimeType, label);
  const frontImageUrl = await readAndEncode(canonicalFrontSourceRef, frontMimeType, 'front');
  const backImageUrl = await readAndEncode(canonicalBackSourceRef, backMimeType, 'back');
  const generateIdentity =
    dependencies.generateIdentity ??
    (async (identityInput, options) =>
      await generateVariationListingIdentity(identityInput, options));
  const draft = await generateIdentity(
    {
      variationId: input.variationId,
      imageUrls: [frontImageUrl, backImageUrl],
      sourceRefs: {
        front: frontSourceRef,
        back: backSourceRef,
      },
    },
    { model: DEFAULT_GEMINI_DRAFT_MODEL }
  );
  return toVariationListingNewVariationIdentityHandoff(draft);
}

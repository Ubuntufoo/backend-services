import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { loadR2Env } from '@ebay-inventory/env';

export interface R2ImageStorageConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicBaseUrl: string;
  region: 'auto';
  s3Endpoint: string;
}

export interface UploadImageInput {
  listingId: string;
  filename: string;
  contentType: string;
  body: Buffer | Uint8Array;
}

export interface UploadImageResult {
  objectKey: string;
  publicUrl: string;
}

export type R2ObjectMetadataStatus = 'present' | 'absent' | 'inaccessible' | 'unknown';

/** Safe, read-only metadata returned by an R2 HEAD request. No object body is read. */
export interface R2ObjectMetadataInspection {
  objectKey: string;
  status: R2ObjectMetadataStatus;
  contentLength?: number;
  contentType?: string;
  etag?: string;
  lastModified?: string;
  reason?: string;
}

interface UploadImageOptions {
  client?: Pick<S3Client, 'send'>;
  config?: R2ImageStorageConfig;
  env?: NodeJS.ProcessEnv;
  objectKey?: string;
}

interface DeleteR2ObjectsOptions {
  client?: Pick<S3Client, 'send'>;
  config?: R2ImageStorageConfig;
  env?: NodeJS.ProcessEnv;
}

export interface InspectR2ObjectMetadataOptions {
  client?: Pick<S3Client, 'send'>;
  config?: R2ImageStorageConfig;
  env?: NodeJS.ProcessEnv;
}

const R2_REGION = 'auto' as const;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function sanitizePathSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .toLowerCase();

  return sanitized || fallback;
}

function assertNonEmpty(name: string, value: string): void {
  if (value.trim() === '') {
    throw new Error(`${name} is required`);
  }
}

function getSanitizedFilenameParts(filename: string): { baseName: string; extension: string } {
  const trimmedFilename = filename.trim();
  const rawExtension = extname(trimmedFilename);
  const baseName = rawExtension
    ? trimmedFilename.slice(0, -rawExtension.length)
    : trimmedFilename;

  const sanitizedBaseName = sanitizePathSegment(baseName, 'image');
  const sanitizedExtension = sanitizePathSegment(rawExtension.replace(/^\./, ''), '');

  return {
    baseName: sanitizedBaseName,
    extension: sanitizedExtension ? `.${sanitizedExtension}` : '',
  };
}

function encodeObjectKeyForPublicUrl(objectKey: string): string {
  return objectKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function loadR2ImageStorageConfig(
  env: NodeJS.ProcessEnv = process.env
): R2ImageStorageConfig {
  const r2Env = loadR2Env({ env });

  return {
    accountId: r2Env.R2_ACCOUNT_ID,
    accessKeyId: r2Env.R2_ACCESS_KEY_ID,
    secretAccessKey: r2Env.R2_SECRET_ACCESS_KEY,
    bucketName: r2Env.R2_BUCKET_NAME,
    publicBaseUrl: trimTrailingSlash(r2Env.R2_PUBLIC_BASE_URL),
    region: R2_REGION,
    s3Endpoint: trimTrailingSlash(r2Env.R2_S3_ENDPOINT),
  };
}

export function createR2ImageStorageClient(
  env: NodeJS.ProcessEnv = process.env
): S3Client {
  const config = loadR2ImageStorageConfig(env);

  return createR2ImageStorageClientFromConfig(config);
}

function createR2ImageStorageClientFromConfig(config: R2ImageStorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.s3Endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export function buildR2ImageObjectKey(
  input: Pick<UploadImageInput, 'filename' | 'listingId' | 'body'>
): string {
  const listingSegment = sanitizePathSegment(input.listingId, 'listing');
  const { baseName, extension } = getSanitizedFilenameParts(input.filename);
  const contentHash = createHash('sha256').update(input.body).digest('hex').slice(0, 12);

  return `listings/${listingSegment}/${baseName}-${contentHash}${extension}`;
}

export function buildPublicImageUrl(publicBaseUrl: string, objectKey: string): string {
  return `${trimTrailingSlash(publicBaseUrl)}/${encodeObjectKeyForPublicUrl(objectKey)}`;
}

export async function uploadImage(
  input: UploadImageInput,
  options: UploadImageOptions = {}
): Promise<UploadImageResult> {
  assertNonEmpty('listingId', input.listingId);
  assertNonEmpty('filename', input.filename);
  assertNonEmpty('contentType', input.contentType);

  if (input.body.byteLength === 0) {
    throw new Error('body must not be empty');
  }

  const config = options.config ?? loadR2ImageStorageConfig(options.env);
  const client = options.client ?? createR2ImageStorageClientFromConfig(config);
  const objectKey = options.objectKey ?? buildR2ImageObjectKey(input);

  assertNonEmpty('objectKey', objectKey);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucketName,
      Key: objectKey,
      Body: input.body,
      CacheControl: 'public, max-age=31536000, immutable',
      ContentType: input.contentType,
    })
  );

  return {
    objectKey,
    publicUrl: buildPublicImageUrl(config.publicBaseUrl, objectKey),
  };
}

function getR2ErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as {
    code?: unknown;
    name?: unknown;
    statusCode?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  if (typeof value.statusCode === 'number') return String(value.statusCode);
  if (typeof value.$metadata?.httpStatusCode === 'number') {
    return String(value.$metadata.httpStatusCode);
  }
  if (typeof value.code === 'string') return value.code;
  if (typeof value.name === 'string') return value.name;
  return undefined;
}

function classifyR2HeadFailure(error: unknown): Pick<R2ObjectMetadataInspection, 'status' | 'reason'> {
  const code = getR2ErrorCode(error);
  if (code === '404' || code === 'NotFound' || code === 'NoSuchKey') {
    return { status: 'absent', reason: code };
  }
  if (code === '401' || code === '403' || code === 'AccessDenied') {
    return { status: 'inaccessible', reason: code };
  }
  return { status: 'unknown', reason: code ?? 'head_failed' };
}

/**
 * Read-only R2 metadata probe. It intentionally returns no object body and
 * classifies failures without treating key shape or metadata as ownership.
 */
export async function inspectR2ObjectMetadata(
  objectKey: string,
  options: InspectR2ObjectMetadataOptions = {}
): Promise<R2ObjectMetadataInspection> {
  assertNonEmpty('objectKey', objectKey);

  const config = options.config ?? loadR2ImageStorageConfig(options.env);
  const client = options.client ?? createR2ImageStorageClientFromConfig(config);

  try {
    const result = (await client.send(
      new HeadObjectCommand({
        Bucket: config.bucketName,
        Key: objectKey,
      })
    )) as {
      ContentLength?: unknown;
      ContentType?: unknown;
      ETag?: unknown;
      LastModified?: unknown;
    };

    return {
      objectKey,
      status: 'present',
      ...(typeof result.ContentLength === 'number' && Number.isFinite(result.ContentLength)
        ? { contentLength: result.ContentLength }
        : {}),
      ...(typeof result.ContentType === 'string' ? { contentType: result.ContentType } : {}),
      ...(typeof result.ETag === 'string' ? { etag: result.ETag } : {}),
      ...(result.LastModified instanceof Date ? { lastModified: result.LastModified.toISOString() } : {}),
    };
  } catch (error) {
    return {
      objectKey,
      ...classifyR2HeadFailure(error),
    };
  }
}

export async function deleteR2Objects(
  objectKeys: readonly string[],
  options: DeleteR2ObjectsOptions = {}
): Promise<void> {
  const exactObjectKeys = [
    ...new Set(objectKeys.map((key) => key.trim()).filter((key) => key.length > 0)),
  ];

  if (exactObjectKeys.length === 0) {
    return;
  }

  const config = options.config ?? loadR2ImageStorageConfig(options.env);
  const client = options.client ?? createR2ImageStorageClientFromConfig(config);

  for (const objectKey of exactObjectKeys) {
    await client.send(
      new DeleteObjectCommand({
        Bucket: config.bucketName,
        Key: objectKey,
      })
    );
  }
}

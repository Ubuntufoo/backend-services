import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

interface UploadImageOptions {
  client?: Pick<S3Client, 'send'>;
  config?: R2ImageStorageConfig;
  env?: NodeJS.ProcessEnv;
  objectKey?: string;
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

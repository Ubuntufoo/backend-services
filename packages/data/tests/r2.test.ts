import { afterEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn();
const s3ClientMock = vi.fn();
const putObjectCommandMock = vi.fn(function PutObjectCommandMock(
  this: { input?: unknown },
  input: unknown
) {
  Object.assign(this, { input });
});

vi.mock('@aws-sdk/client-s3', () => ({
  PutObjectCommand: putObjectCommandMock,
  S3Client: class S3ClientMock {
    constructor(input: unknown) {
      s3ClientMock(input);
    }

    send = sendMock;
  },
}));

const r2Env = {
  R2_ACCOUNT_ID: 'account-id',
  R2_ACCESS_KEY_ID: 'access-key-id',
  R2_SECRET_ACCESS_KEY: 'secret-access-key',
  R2_BUCKET_NAME: 'listing-images',
  R2_S3_ENDPOINT: 'https://account-id.r2.cloudflarestorage.com/',
  R2_PUBLIC_BASE_URL: 'https://images.example.com/',
} as NodeJS.ProcessEnv;

describe('shared R2 image upload service', () => {
  afterEach(() => {
    sendMock.mockReset();
    s3ClientMock.mockClear();
    putObjectCommandMock.mockClear();
  });

  it('loads normalized R2 storage config from environment variables', async () => {
    const { loadR2ImageStorageConfig } = await import('../src/index.js');

    const config = loadR2ImageStorageConfig(r2Env);

    expect(config).toEqual({
      accountId: 'account-id',
      accessKeyId: 'access-key-id',
      secretAccessKey: 'secret-access-key',
      bucketName: 'listing-images',
      publicBaseUrl: 'https://images.example.com',
      region: 'auto',
      s3Endpoint: 'https://account-id.r2.cloudflarestorage.com',
    });
  });

  it('builds public image URLs on the custom domain', async () => {
    const { buildPublicImageUrl } = await import('../src/index.js');

    expect(
      buildPublicImageUrl(
        'https://images.murphyfamilyhobby.dev/',
        'listings/listing-123/front image.jpg'
      )
    ).toBe(
      'https://images.murphyfamilyhobby.dev/listings/listing-123/front%20image.jpg'
    );
  });

  it('creates an R2 S3 client with the expected endpoint, credentials, and region', async () => {
    const { createR2ImageStorageClient } = await import('../src/index.js');

    createR2ImageStorageClient(r2Env);

    expect(s3ClientMock).toHaveBeenCalledWith({
      credentials: {
        accessKeyId: 'access-key-id',
        secretAccessKey: 'secret-access-key',
      },
      endpoint: 'https://account-id.r2.cloudflarestorage.com',
      region: 'auto',
    });
  });

  it('uploads one image and returns the public URL plus object key', async () => {
    sendMock.mockResolvedValue({ ETag: '"etag-value"' });

    const { uploadImage } = await import('../src/index.js');

    const result = await uploadImage(
      {
        listingId: 'Listing / 123',
        filename: 'Front Image!!.JPG',
        contentType: 'image/jpeg',
        body: Buffer.from('image-bytes'),
      },
      {
        env: r2Env,
      }
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(putObjectCommandMock).toHaveBeenCalledWith({
      Body: Buffer.from('image-bytes'),
      CacheControl: 'public, max-age=31536000, immutable',
      Bucket: 'listing-images',
      ContentType: 'image/jpeg',
      Key: 'listings/listing-123/front-image-2c8648d103e3.jpg',
    });
    expect(result).toEqual({
      objectKey: 'listings/listing-123/front-image-2c8648d103e3.jpg',
      publicUrl:
        'https://images.example.com/listings/listing-123/front-image-2c8648d103e3.jpg',
    });
  });

  it('uses a provided config to create the upload client when no client is passed', async () => {
    sendMock.mockResolvedValue({ ETag: '"etag-value"' });

    const { uploadImage } = await import('../src/index.js');

    const result = await uploadImage(
      {
        listingId: 'listing-123',
        filename: 'front.png',
        contentType: 'image/png',
        body: Buffer.from('image-bytes'),
      },
      {
        config: {
          accountId: 'account-id',
          accessKeyId: 'config-access-key',
          secretAccessKey: 'config-secret-key',
          bucketName: 'config-bucket',
          publicBaseUrl: 'https://images.example.com',
          region: 'auto',
          s3Endpoint: 'https://config-endpoint.example.com',
        },
      }
    );

    expect(s3ClientMock).toHaveBeenCalledWith({
      credentials: {
        accessKeyId: 'config-access-key',
        secretAccessKey: 'config-secret-key',
      },
      endpoint: 'https://config-endpoint.example.com',
      region: 'auto',
    });
    expect(putObjectCommandMock).toHaveBeenCalledWith({
      Body: Buffer.from('image-bytes'),
      CacheControl: 'public, max-age=31536000, immutable',
      Bucket: 'config-bucket',
      ContentType: 'image/png',
      Key: 'listings/listing-123/front-2c8648d103e3.png',
    });
    expect(result).toEqual({
      objectKey: 'listings/listing-123/front-2c8648d103e3.png',
      publicUrl:
        'https://images.example.com/listings/listing-123/front-2c8648d103e3.png',
    });
  });

  it('honors an explicit objectKey override and keeps public URLs stable for deterministic callers', async () => {
    sendMock.mockResolvedValue({ ETag: '"etag-value"' });

    const { uploadImage } = await import('../src/index.js');

    const result = await uploadImage(
      {
        listingId: 'listing-123',
        filename: 'front.png',
        contentType: 'image/png',
        body: Buffer.from('image-bytes'),
      },
      {
        env: r2Env,
        objectKey: 'listings/listing-123/front.png',
      }
    );

    expect(putObjectCommandMock).toHaveBeenCalledWith({
      Body: Buffer.from('image-bytes'),
      CacheControl: 'public, max-age=31536000, immutable',
      Bucket: 'listing-images',
      ContentType: 'image/png',
      Key: 'listings/listing-123/front.png',
    });
    expect(result).toEqual({
      objectKey: 'listings/listing-123/front.png',
      publicUrl: 'https://images.example.com/listings/listing-123/front.png',
    });
  });

  it('rejects empty upload bodies before attempting to send an object', async () => {
    const { uploadImage } = await import('../src/index.js');

    await expect(
      uploadImage(
        {
          listingId: 'listing-123',
          filename: 'front.png',
          contentType: 'image/png',
          body: new Uint8Array(),
        },
        {
          env: r2Env,
        }
      )
    ).rejects.toThrow(/body must not be empty/);

    expect(sendMock).not.toHaveBeenCalled();
  });
});

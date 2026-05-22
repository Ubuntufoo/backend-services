import { extname } from 'node:path';

export const IMAGE_SERVICE_SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;

export type ImageServiceSupportedExtension = (typeof IMAGE_SERVICE_SUPPORTED_EXTENSIONS)[number];

const IMAGE_SERVICE_SUPPORTED_EXTENSION_SET = new Set<ImageServiceSupportedExtension>(
  IMAGE_SERVICE_SUPPORTED_EXTENSIONS
);

export function normalizeImageServiceExtension(filePath: string): string {
  return extname(filePath).toLowerCase();
}

export function isSupportedImageServiceExtension(
  extension: string
): extension is ImageServiceSupportedExtension {
  return IMAGE_SERVICE_SUPPORTED_EXTENSION_SET.has(
    extension.toLowerCase() as ImageServiceSupportedExtension
  );
}

export function isSupportedImageServicePath(filePath: string): boolean {
  return isSupportedImageServiceExtension(normalizeImageServiceExtension(filePath));
}

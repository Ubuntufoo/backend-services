import type { ListingRow } from '@ebay-inventory/data';
import { PublishListingError } from '@/ebay/publish-validation.js';

const IMAGE_URL_CHECK_TIMEOUT_MS = 10_000;
const SUPPORTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;
type FetchResponse = Awaited<ReturnType<typeof globalThis.fetch>>;

export interface PublishImageUrlReadinessIssue {
  field: `image_urls[${number}]`;
  message: string;
  scope: 'listing';
  url: string;
}

export interface PublishImageUrlReadinessSuccess {
  ok: true;
}

export interface PublishImageUrlReadinessFailure {
  code: 'IMAGE_URL_NOT_READY_FOR_EBAY';
  fields: PublishImageUrlReadinessIssue[];
  issues: string[];
  kind: 'user_fixable';
  ok: false;
}

export type PublishImageUrlReadinessResult =
  | PublishImageUrlReadinessSuccess
  | PublishImageUrlReadinessFailure;

export interface PublishImageUrlReadinessOptions {
  allowedPublicBaseUrl?: string | null;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export class PublishImageUrlReadinessValidationError extends PublishListingError {
  readonly fields: PublishImageUrlReadinessIssue[];
  readonly kind = 'user_fixable' as const;
  readonly validationCode = 'IMAGE_URL_NOT_READY_FOR_EBAY' as const;

  constructor(listingId: string | null, fields: PublishImageUrlReadinessIssue[]) {
    super(
      'LISTING_NOT_READY',
      fields.map((field) => field.message).join('; '),
      {
        fields,
        issues: fields.map((field) => field.message),
        kind: 'user_fixable',
        listingId,
        stage: 'validate',
        validationCode: 'IMAGE_URL_NOT_READY_FOR_EBAY',
      }
    );
    this.name = 'PublishImageUrlReadinessValidationError';
    this.fields = fields;
  }
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseContentType(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.split(';')[0]?.trim().toLowerCase() || undefined;
}

function isImageContentType(value: string): boolean {
  return value === 'image/jpeg' || value === 'image/png' || value === 'image/webp';
}

function getAllowedImageHost(allowedPublicBaseUrl: string | null | undefined): string | undefined {
  if (!hasText(allowedPublicBaseUrl)) {
    return undefined;
  }

  try {
    return new URL(allowedPublicBaseUrl.trim()).host.toLowerCase();
  } catch {
    return undefined;
  }
}

function getUrlExtension(pathname: string): string {
  const normalizedPath = pathname.toLowerCase();
  const lastDotIndex = normalizedPath.lastIndexOf('.');

  if (lastDotIndex < 0) {
    return '';
  }

  return normalizedPath.slice(lastDotIndex);
}

function hasSupportedImageExtension(pathname: string): boolean {
  return SUPPORTED_IMAGE_EXTENSIONS.includes(getUrlExtension(pathname) as (typeof SUPPORTED_IMAGE_EXTENSIONS)[number]);
}

function makeIssue(
  field: `image_urls[${number}]`,
  url: string,
  message: string
): PublishImageUrlReadinessIssue {
  return {
    field,
    message,
    scope: 'listing',
    url,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchWithTimeout(
  fetchFn: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<FetchResponse> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchFn(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      throw new Error(`timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function responseHasNonEmptyBody(response: FetchResponse): Promise<boolean> {
  if (!response.body) {
    return false;
  }

  const reader = response.body.getReader();

  try {
    const { done, value } = await reader.read();
    return !done && !!value && value.byteLength > 0;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Ignore cancel errors. The request already produced enough data for validation.
    }
  }
}

function getFailureResult(fields: PublishImageUrlReadinessIssue[]): PublishImageUrlReadinessFailure {
  return {
    code: 'IMAGE_URL_NOT_READY_FOR_EBAY',
    fields,
    issues: fields.map((field) => field.message),
    kind: 'user_fixable',
    ok: false,
  };
}

async function validateSingleImageUrl(
  imageUrl: string,
  index: number,
  options: Required<Pick<PublishImageUrlReadinessOptions, 'fetch' | 'timeoutMs'>> & {
    allowedImageHost?: string;
  }
): Promise<PublishImageUrlReadinessIssue | undefined> {
  const field = `image_urls[${index}]` as const;
  const trimmedUrl = imageUrl.trim();

  if (!hasText(trimmedUrl)) {
    return makeIssue(field, imageUrl, 'Image URL must be a non-empty HTTPS URL before publishing.');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    return makeIssue(field, trimmedUrl, 'Image URL must be a valid HTTPS URL before publishing.');
  }

  if (parsedUrl.protocol !== 'https:') {
    return makeIssue(field, trimmedUrl, 'Image URL must use HTTPS before publishing.');
  }

  if (options.allowedImageHost && parsedUrl.host.toLowerCase() !== options.allowedImageHost) {
    return makeIssue(
      field,
      trimmedUrl,
      `Image URL must use configured public image host "${options.allowedImageHost}" before publishing.`
    );
  }

  if (!hasSupportedImageExtension(parsedUrl.pathname)) {
    return makeIssue(
      field,
      trimmedUrl,
      'Image URL path must end in .jpg, .jpeg, .png, or .webp before publishing.'
    );
  }

  let headResponse: FetchResponse;
  try {
    headResponse = await fetchWithTimeout(
      options.fetch,
      trimmedUrl,
      {
        method: 'HEAD',
      },
      options.timeoutMs
    );
  } catch (error) {
    return makeIssue(
      field,
      trimmedUrl,
      `Image URL could not be reached for eBay publish: ${asErrorMessage(error)}`
    );
  }

  const headUnsupported = headResponse.status === 405 || headResponse.status === 501;

  if (!headResponse.ok && !headUnsupported) {
    return makeIssue(
      field,
      trimmedUrl,
      `Image URL returned HTTP ${headResponse.status} when checked for eBay publish.`
    );
  }

  const headContentType = parseContentType(headResponse.headers.get('content-type'));

  if (!headUnsupported && headContentType && !isImageContentType(headContentType)) {
    return makeIssue(
      field,
      trimmedUrl,
      `Image URL returned unsupported Content-Type "${headContentType}" for eBay publish.`
    );
  }

  const headContentLength = Number.parseInt(
    headResponse.headers.get('content-length') ?? '',
    10
  );
  const headHasUsefulLength = Number.isFinite(headContentLength) && headContentLength > 0;

  if (!headUnsupported && headResponse.ok && headContentType && headHasUsefulLength) {
    return undefined;
  }

  let getResponse: FetchResponse;
  try {
    getResponse = await fetchWithTimeout(
      options.fetch,
      trimmedUrl,
      {
        method: 'GET',
        headers: {
          Range: 'bytes=0-0',
        },
      },
      options.timeoutMs
    );
  } catch (error) {
    return makeIssue(
      field,
      trimmedUrl,
      `Image URL could not be reached for eBay publish: ${asErrorMessage(error)}`
    );
  }

  if (!getResponse.ok) {
    return makeIssue(
      field,
      trimmedUrl,
      `Image URL returned HTTP ${getResponse.status} when checked for eBay publish.`
    );
  }

  const getContentType = parseContentType(getResponse.headers.get('content-type'));

  if (getContentType && !isImageContentType(getContentType)) {
    return makeIssue(
      field,
      trimmedUrl,
      `Image URL returned unsupported Content-Type "${getContentType}" for eBay publish.`
    );
  }

  const hasBody = await responseHasNonEmptyBody(getResponse);

  if (!hasBody) {
    return makeIssue(field, trimmedUrl, 'Image URL returned an empty response body.');
  }

  return undefined;
}

export async function validateListingImageUrlsReadyForEbay(
  listing: Pick<ListingRow, 'image_urls' | 'listing_id'>,
  options: PublishImageUrlReadinessOptions = {}
): Promise<PublishImageUrlReadinessResult> {
  if (!Array.isArray(listing.image_urls) || listing.image_urls.length === 0) {
    return getFailureResult([
      makeIssue(
        'image_urls[0]',
        '',
        'Listing must include at least one image URL before publishing.'
      ),
    ]);
  }

  const fetchFn = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? IMAGE_URL_CHECK_TIMEOUT_MS;
  const allowedImageHost = getAllowedImageHost(options.allowedPublicBaseUrl);
  const issues: PublishImageUrlReadinessIssue[] = [];

  for (const [index, imageUrl] of listing.image_urls.entries()) {
    if (typeof imageUrl !== 'string') {
      issues.push(
        makeIssue(
          `image_urls[${index}]`,
          String(imageUrl),
          'Image URL must be a valid HTTPS URL before publishing.'
        )
      );
      continue;
    }

    const issue = await validateSingleImageUrl(imageUrl, index, {
      allowedImageHost,
      fetch: fetchFn,
      timeoutMs,
    });

    if (issue) {
      issues.push(issue);
    }
  }

  if (issues.length === 0) {
    return { ok: true };
  }

  return getFailureResult(issues);
}

export async function assertListingImageUrlsReadyForEbay(
  listing: Pick<ListingRow, 'image_urls' | 'listing_id'>,
  options: PublishImageUrlReadinessOptions = {}
): Promise<void> {
  const result = await validateListingImageUrlsReadyForEbay(listing, options);

  if (!result.ok) {
    throw new PublishImageUrlReadinessValidationError(listing.listing_id, result.fields);
  }
}

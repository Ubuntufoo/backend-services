import { describe, expect, it, vi } from 'vitest';

import { apiLogger, logErrorResponse, withExpectedApiNotFound } from '@/utils/logger.js';

describe('expected API not-found logging', () => {
  it('suppresses only a scoped expected 404 error log', async () => {
    const errorSpy = vi.spyOn(apiLogger, 'error').mockImplementation(() => {});

    await withExpectedApiNotFound(async () => {
      logErrorResponse(404, 'Not Found', 'https://api.ebay.test/resource', {
        errors: [{ message: 'Not found' }],
      });
    });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('still logs non-404 errors inside the expected-not-found scope', async () => {
    const errorSpy = vi.spyOn(apiLogger, 'error').mockImplementation(() => {});

    await withExpectedApiNotFound(async () => {
      logErrorResponse(500, 'Internal Server Error', 'https://api.ebay.test/resource');
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('still logs an unscoped 404 as an API error', () => {
    const errorSpy = vi.spyOn(apiLogger, 'error').mockImplementation(() => {});

    logErrorResponse(404, 'Not Found', 'https://api.ebay.test/resource', {
      errors: [{ message: 'Not found' }],
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadDotenvFilesMock = vi.hoisted(() => vi.fn());

vi.mock('@ebay-inventory/env', () => ({
  loadDotenvFiles: loadDotenvFilesMock,
}));

import { ROOT_ENV_PATH, loadRootEnvironment } from '@/config/env-paths.js';

describe('sidecar canonical environment paths', () => {
  beforeEach(() => loadDotenvFilesMock.mockClear());

  it('loads only the repo-root .env file', () => {
    loadRootEnvironment();

    expect(loadDotenvFilesMock).toHaveBeenCalledWith([ROOT_ENV_PATH]);
    expect(loadDotenvFilesMock.mock.calls[0]?.[0]).not.toContain(
      expect.stringMatching(/\.env\.local$/)
    );
  });
});

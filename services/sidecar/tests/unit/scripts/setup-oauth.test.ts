import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { getSetupOAuthAuthorizationUrl, verifyRefreshToken } from '@/scripts/setup.js';

describe('setup OAuth refresh verification', () => {
  beforeEach(() => {
    nock.disableNetConnect();
  });

  it('requests only the required app scopes for production consent', () => {
    const url = getSetupOAuthAuthorizationUrl('client-id', 'redirect-name', 'production');
    const scopes = new URL(url).searchParams.get('scope')?.split(' ');

    expect(scopes).toEqual([
      'https://api.ebay.com/oauth/api_scope',
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
      'https://api.ebay.com/oauth/api_scope/sell.account',
      'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
    ]);
    expect(scopes).not.toContain('https://api.ebay.com/oauth/api_scope/sell.marketing');
    expect(scopes).not.toContain('https://api.ebay.com/oauth/api_scope/commerce.shipping');
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('uses the refresh token grant as-is before checking Commerce Identity', async () => {
    nock('https://api.sandbox.ebay.com')
      .post('/identity/v1/oauth2/token', (body: unknown) => {
        if (typeof body === 'string') {
          return !body.includes('scope=');
        }
        return !Object.prototype.hasOwnProperty.call(body, 'scope');
      })
      .reply(200, { access_token: 'access-token' });
    nock('https://apiz.sandbox.ebay.com')
      .get('/commerce/identity/v1/user/')
      .matchHeader('authorization', 'Bearer access-token')
      .reply(200, { username: 'seller' });

    await expect(
      verifyRefreshToken('refresh-token', 'client-id', 'client-secret', 'sandbox')
    ).resolves.toEqual({ accessToken: 'access-token', userInfo: { username: 'seller' } });
  });

  it('reports missing Commerce Identity permission clearly', async () => {
    nock('https://api.sandbox.ebay.com')
      .post('/identity/v1/oauth2/token', (body: unknown) => {
        if (typeof body === 'string') {
          return !body.includes('scope=');
        }
        return !Object.prototype.hasOwnProperty.call(body, 'scope');
      })
      .reply(200, { access_token: 'access-token' });
    nock('https://apiz.sandbox.ebay.com')
      .get('/commerce/identity/v1/user/')
      .reply(403, { errors: [{ message: 'Insufficient permission' }] });

    await expect(
      verifyRefreshToken('refresh-token', 'client-id', 'client-secret', 'sandbox')
    ).rejects.toThrow('commerce.identity.readonly permission');
  });
});

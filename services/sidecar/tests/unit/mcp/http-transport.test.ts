import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  createHttpMcpApp,
  createHttpTransportConfigFromEnv,
  getAuthServerMetadataUrl,
  getHttpServerUrl,
  type HttpTransportConfig,
} from '@/mcp/http-transport.js';
import type { SidecarDataAccess } from '@/data/sidecar-data.js';

const listingRow = {
  approved_for_export_at: null,
  capture_mode: null,
  category_id: null,
  condition_id: null,
  condition_notes: null,
  created_at: '2026-05-17T00:00:00.000Z',
  description: null,
  ebay_listing_id: null,
  ebay_listing_status: null,
  ebay_listing_url: null,
  ebay_offer_id: null,
  ese_eligible: null,
  estimated_weight_oz: null,
  exported_at: null,
  handling_days: null,
  id: 'listing-row-id',
  image_urls: [],
  item_specifics: {},
  last_error_at: null,
  last_error_code: null,
  listing_id: 'LIST-001',
  listing_type: null,
  merchant_location_key: null,
  package_type: null,
  price: null,
  r2_delete_after: null,
  r2_deleted_at: null,
  r2_object_keys: [],
  r2_retention_policy: null,
  seller_hints: null,
  shipping_profile: null,
  sku: null,
  sold_at: null,
  status: 'record_created',
  sub_status: 'idle',
  title: null,
  updated_at: '2026-05-17T00:00:00.000Z',
};

function createDataAccess(): SidecarDataAccess {
  return {
    listings: {
      create: async () => listingRow,
      getByListingId: async () => listingRow,
      list: async () => [listingRow],
      saveImageMetadata: async () => listingRow,
      update: async () => listingRow,
      updateWorkflowState: async () => listingRow,
    },
    jobs: {
      create: async () => {
        throw new Error('not implemented');
      },
      getById: async () => null,
      listByListingId: async () => [],
      update: async () => {
        throw new Error('not implemented');
      },
    },
    orders: {
      create: async () => {
        throw new Error('not implemented');
      },
      getByOrderId: async () => null,
      update: async () => {
        throw new Error('not implemented');
      },
    },
    appSettings: {
      create: async () => {
        throw new Error('not implemented');
      },
      get: async () => null,
      update: async () => {
        throw new Error('not implemented');
      },
    },
  };
}

function createTestConfig(overrides: Partial<HttpTransportConfig> = {}): HttpTransportConfig {
  return {
    authEnabled: false,
    dataAccess: createDataAccess(),
    ebayEnabled: true,
    ebayConfig: {
      clientId: 'client',
      clientSecret: 'secret',
      environment: 'sandbox',
    },
    host: '127.0.0.1',
    oauth: {
      authServerUrl: 'http://localhost:8080/realms/master',
      requiredScopes: ['mcp:tools'],
      useIntrospection: true,
    },
    port: 3000,
    projectRoot: process.cwd(),
    ...overrides,
  };
}

describe('HTTP MCP transport', () => {
  it('builds HTTP server and metadata URLs from config', () => {
    const config = createTestConfig();

    expect(getHttpServerUrl(config)).toBe('http://127.0.0.1:3000');
    expect(getAuthServerMetadataUrl(config)).toBe(
      'http://localhost:8080/realms/master/.well-known/openid-configuration'
    );

    expect(
      getAuthServerMetadataUrl({
        oauth: {
          ...config.oauth,
          authServerUrl: 'https://auth.example.test',
        },
      })
    ).toBe('https://auth.example.test/.well-known/oauth-authorization-server');
  });

  it('creates config from env defaults and overrides', () => {
    const config = createHttpTransportConfigFromEnv({
      MCP_HOST: '0.0.0.0',
      MCP_PORT: '4444',
      EBAY_ENABLED: 'false',
      OAUTH_ENABLED: 'false',
      OAUTH_REQUIRED_SCOPES: 'mcp:tools,mcp:admin',
    });

    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(4444);
    expect(config.authEnabled).toBe(false);
    expect(config.ebayEnabled).toBe(false);
    expect(config.oauth.requiredScopes).toEqual(['mcp:tools', 'mcp:admin']);
  });

  it('keeps health available in DB-only mode without OAuth', async () => {
    const app = await createHttpMcpApp(createTestConfig({ ebayEnabled: false, ebayConfig: undefined }));
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'healthy',
      ebay_enabled: false,
      oauth_enabled: false,
    });
    expect(response.body.timestamp).toEqual(expect.any(String));
  });

  it('serves listings data in DB-only mode', async () => {
    const app = await createHttpMcpApp(createTestConfig({ ebayEnabled: false, ebayConfig: undefined }));
    const response = await request(app).get('/api/listings');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      listings: [listingRow],
    });
  });

  it('rejects session requests without a valid MCP session id', async () => {
    const app = await createHttpMcpApp(createTestConfig());
    const response = await request(app).get('/');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'invalid_session',
      error_description: 'Invalid or missing session ID',
    });
  });
});

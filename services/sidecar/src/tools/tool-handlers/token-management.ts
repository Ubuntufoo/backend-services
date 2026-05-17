import type { ToolHandlerMap } from './types.js';
import { buildCredentialDisplay, maskToken } from '@/auth/credential-session.js';
import { getOAuthAuthorizationUrl, validateScopes } from '@/config/environment.js';
import { convertToTimestamp, validateTokenExpiry } from '@/utils/date-converter.js';

/** Handler map for OAuth token setup, refresh, validation, and status tools. */
export const tokenManagementHandlers: ToolHandlerMap = {
  ebay_get_oauth_url: (api, args) => {
    // Get config from environment
    const clientId = process.env.EBAY_CLIENT_ID ?? '';
    const environment = (process.env.EBAY_ENVIRONMENT ?? 'sandbox') as 'production' | 'sandbox';
    const envRedirectUri = process.env.EBAY_REDIRECT_URI;

    // Use redirectUri from args if provided, otherwise use from .env.local
    const redirectUri = (args.redirectUri as string | undefined) ?? envRedirectUri;
    const scopes = args.scopes as string[] | undefined;
    const state = args.state as string | undefined;

    if (!clientId) {
      throw new Error('EBAY_CLIENT_ID environment variable is required to generate OAuth URL');
    }

    if (!redirectUri) {
      throw new Error(
        'Redirect URI is required. Either provide it as a parameter or set EBAY_REDIRECT_URI in backend-services/.env.local.'
      );
    }

    // Validate scopes if custom scopes are provided
    let scopeWarnings: string[] = [];
    let validatedScopes = scopes;

    if (scopes && scopes.length > 0) {
      const validation = validateScopes(scopes, environment);
      scopeWarnings = validation.warnings;
      validatedScopes = validation.validScopes;
    }

    const authUrl = getOAuthAuthorizationUrl(
      clientId,
      redirectUri,
      environment,
      validatedScopes,
      state
    );

    const result: Record<string, unknown> = {
      authorizationUrl: authUrl,
      redirectUri,
      instructions:
        'Open this URL in a browser to authorize the application. After authorization, you will be redirected to your redirect URI with an authorization code that can be exchanged for an access token.',
      environment,
      scopes: scopes ?? 'default (all Sell API scopes)',
    };

    // Include warnings if any scopes are invalid for the environment
    if (scopeWarnings.length > 0) {
      result.warnings = scopeWarnings;
    }

    return result;
  },

  ebay_set_user_tokens: async (api, args) => {
    const accessToken = args.accessToken as string;
    const refreshToken = args.refreshToken as string;

    if (!accessToken || !refreshToken) {
      throw new Error('Both accessToken and refreshToken are required');
    }

    await api.setUserTokens(accessToken, refreshToken);

    return {
      success: true,
      message:
        'User tokens successfully stored. These tokens will be used for all subsequent API requests and will be automatically refreshed when needed.',
      tokenInfo: api.getTokenInfo(),
    };
  },

  ebay_get_token_status: (api, _args) => {
    const tokenInfo = api.getTokenInfo();
    const hasUserTokens = api.hasUserTokens();

    return {
      hasUserToken: tokenInfo.hasUserToken,
      hasAppAccessToken: tokenInfo.hasAppAccessToken,
      authenticated: api.isAuthenticated(),
      currentTokenType: tokenInfo.hasUserToken
        ? 'user_token (10,000-50,000 req/day)'
        : tokenInfo.hasAppAccessToken
          ? 'app_access_token (1,000 req/day)'
          : 'none',
      message: hasUserTokens
        ? 'Using user access token with automatic refresh'
        : 'Using app access token from client credentials flow (lower rate limits). Consider setting user tokens for higher rate limits.',
    };
  },

  ebay_clear_tokens: (api, _args) => {
    const authClient = api.getAuthClient().getOAuthClient();
    authClient.clearAllTokens();

    return {
      success: true,
      message:
        'All tokens cleared successfully. You will need to re-authenticate for subsequent API calls.',
    };
  },

  ebay_convert_date_to_timestamp: (api, args) => {
    const dateInput = args.dateInput as string | number;

    try {
      const timestamp = convertToTimestamp(dateInput);

      return {
        success: true,
        timestamp,
        input: dateInput,
        formattedDate: new Date(timestamp).toISOString(),
        message: `Successfully converted to timestamp: ${timestamp}ms (${new Date(timestamp).toISOString()})`,
      };
    } catch (error) {
      throw new Error(
        `Failed to convert date: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },

  ebay_validate_token_expiry: (api, args) => {
    const accessTokenExpiry = args.accessTokenExpiry as string | number;
    const refreshTokenExpiry = args.refreshTokenExpiry as string | number;

    try {
      // Convert to timestamps
      const accessExpiry = convertToTimestamp(accessTokenExpiry);
      const refreshExpiry = convertToTimestamp(refreshTokenExpiry);

      // Validate
      const validation = validateTokenExpiry(accessExpiry, refreshExpiry);

      return {
        ...validation,
        accessTokenExpiryTimestamp: accessExpiry,
        refreshTokenExpiryTimestamp: refreshExpiry,
        accessTokenExpiryDate: new Date(accessExpiry).toISOString(),
        refreshTokenExpiryDate: new Date(refreshExpiry).toISOString(),
      };
    } catch (error) {
      throw new Error(
        `Failed to validate token expiry: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },

  ebay_set_user_tokens_with_expiry: async (api, args) => {
    const accessToken = args.accessToken as string;
    const refreshToken = args.refreshToken as string;
    const accessTokenExpiry = args.accessTokenExpiry as string | number | undefined;
    const refreshTokenExpiry = args.refreshTokenExpiry as string | number | undefined;
    const autoRefresh = (args.autoRefresh as boolean) ?? true;

    if (!accessToken || !refreshToken) {
      throw new Error('Both accessToken and refreshToken are required');
    }

    try {
      // Convert expiry times to timestamps if provided
      let accessExpiry: number | undefined;
      let refreshExpiry: number | undefined;

      if (accessTokenExpiry !== undefined) {
        accessExpiry = convertToTimestamp(accessTokenExpiry);
      }

      if (refreshTokenExpiry !== undefined) {
        refreshExpiry = convertToTimestamp(refreshTokenExpiry);
      }

      // Set tokens (will use defaults if expiry times not provided)
      await api.setUserTokens(accessToken, refreshToken, accessExpiry, refreshExpiry);

      // If autoRefresh is enabled, attempt to get a fresh access token
      // (The OAuth client will handle refresh internally if needed)
      if (autoRefresh) {
        try {
          const authClient = api.getAuthClient().getOAuthClient();
          await authClient.getAccessToken();

          return {
            success: true,
            message:
              'User tokens stored successfully in memory. Access token validated and refreshed if needed. To persist tokens, update EBAY_USER_REFRESH_TOKEN in backend-services/.env.local.',
            tokenInfo: api.getTokenInfo(),
            refreshed: true,
          };
        } catch (refreshError) {
          return {
            success: true,
            message:
              'User tokens stored, but failed to validate/refresh access token. You may need to re-authorize.',
            tokenInfo: api.getTokenInfo(),
            refreshed: false,
            refreshError: refreshError instanceof Error ? refreshError.message : 'Unknown error',
          };
        }
      }

      return {
        success: true,
        message:
          'User tokens successfully stored in memory. These tokens will be used for all subsequent API requests and will be automatically refreshed when needed. To persist tokens, update EBAY_USER_REFRESH_TOKEN in backend-services/.env.local.',
        tokenInfo: api.getTokenInfo(),
        refreshed: false,
      };
    } catch (error) {
      throw new Error(
        `Failed to set user tokens: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },

  ebay_display_credentials: (api, _args) => {
    const tokenInfo = api.getTokenInfo();
    const authClient = api.getAuthClient().getOAuthClient();

    return buildCredentialDisplay({
      appAccessToken: authClient.getCachedAppAccessToken(),
      appAccessTokenExpiry: authClient.getCachedAppAccessTokenExpiry(),
      authenticated: api.isAuthenticated(),
      env: process.env,
      tokenInfo,
      userTokens: authClient.getUserTokens(),
    });
  },

  ebay_exchange_authorization_code: async (api, args) => {
    const code = args.code as string;

    if (!code) {
      throw new Error('Authorization code is required');
    }

    try {
      // URL-decode the code if it's URL-encoded (contains % characters)
      const decodedCode = code.includes('%') ? decodeURIComponent(code) : code;

      // Get the OAuth client
      const authClient = api.getAuthClient().getOAuthClient();

      // Exchange the authorization code for tokens
      const tokenData = await authClient.exchangeCodeForToken(decodedCode);

      return {
        success: true,
        message:
          'Authorization code successfully exchanged for tokens. Tokens have been stored and will be used for subsequent API requests.',
        tokenData: {
          accessToken: maskToken(tokenData.access_token),
          refreshToken: maskToken(tokenData.refresh_token),
          expiresIn: tokenData.expires_in,
          refreshTokenExpiresIn: tokenData.refresh_token_expires_in,
          tokenType: tokenData.token_type,
          scope: tokenData.scope,
        },
        note: 'The refresh token has been saved to backend-services/.env.local for future use.',
      };
    } catch (error) {
      throw new Error(
        `Failed to exchange authorization code: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },

  ebay_refresh_access_token: async (api, _args) => {
    const authClient = api.getAuthClient().getOAuthClient();

    // Check if user tokens are available
    if (!api.hasUserTokens()) {
      throw new Error(
        'No user tokens available. Please set user tokens first using ebay_set_user_tokens_with_expiry or add EBAY_USER_REFRESH_TOKEN to backend-services/.env.local.'
      );
    }

    try {
      // Call the public refreshUserToken method
      await authClient.refreshUserToken();

      // Get updated token info
      const internalTokens = authClient.getUserTokens();

      return {
        success: true,
        message: 'Access token refreshed successfully',
        accessToken: internalTokens?.userAccessToken
          ? maskToken(internalTokens.userAccessToken)
          : 'Not available',
        accessTokenExpiry: internalTokens?.userAccessTokenExpiry
          ? {
              timestamp: internalTokens.userAccessTokenExpiry,
              date: new Date(internalTokens.userAccessTokenExpiry).toISOString(),
              expiresInSeconds: Math.floor(
                (internalTokens.userAccessTokenExpiry - Date.now()) / 1000
              ),
            }
          : 'Not available',
        tokenInfo: api.getTokenInfo(),
      };
    } catch (error) {
      throw new Error(
        `Failed to refresh access token: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};

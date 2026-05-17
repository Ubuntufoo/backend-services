#!/usr/bin/env node

import { dirname, join, resolve } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir, platform } from 'os';

import axios from 'axios';
import chalk from 'chalk';
import { checkForUpdates } from '../utils/version.js';
import stringify from 'dotenv-stringify';
import { fileURLToPath } from 'url';
import { getOAuthAuthorizationUrl } from '../config/environment.js';
import { ROOT_ENV_LOCAL_PATH, REPO_ROOT, loadRootEnvironment } from '../config/env-paths.js';
import { defineWizard, runWizard, ClackRenderer } from '../utils/setup-wizard.js';
import { loadExistingConfig } from './setup-shared.js';
import { configureLLMClient, detectLLMClients } from '../utils/llm-client-detector.js';
import { runSecurityChecks, displaySecurityResults } from '../utils/security-checker.js';
import { validateSetup, displayRecommendations } from '../utils/setup-validator.js';
import type { EbayTokenCore } from '../types/ebay.js';

loadRootEnvironment();

checkForUpdates();

const MARKETPLACE_OPTIONS: { value: string; label: string }[] = [
  { value: 'EBAY_US', label: 'EBAY_US — United States' },
  { value: 'EBAY_GB', label: 'EBAY_GB — United Kingdom' },
  { value: 'EBAY_DE', label: 'EBAY_DE — Germany' },
  { value: 'EBAY_FR', label: 'EBAY_FR — France' },
  { value: 'EBAY_IT', label: 'EBAY_IT — Italy' },
  { value: 'EBAY_ES', label: 'EBAY_ES — Spain' },
  { value: 'EBAY_CA', label: 'EBAY_CA — Canada' },
  { value: 'EBAY_AU', label: 'EBAY_AU — Australia' },
];

const CONTENT_LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'en-US', label: 'en-US — English (United States)' },
  { value: 'en-GB', label: 'en-GB — English (United Kingdom)' },
  { value: 'de-DE', label: 'de-DE — German (Germany)' },
  { value: 'fr-FR', label: 'fr-FR — French (France)' },
  { value: 'it-IT', label: 'it-IT — Italian (Italy)' },
  { value: 'es-ES', label: 'es-ES — Spanish (Spain)' },
  { value: 'fr-CA', label: 'fr-CA — French (Canada)' },
  { value: 'nl-BE', label: 'nl-BE — Dutch (Belgium)' },
];

const ebay = {
  red: chalk.hex('#E53238'),
  blue: chalk.hex('#0064D2'),
  yellow: chalk.hex('#F5AF02'),
  green: chalk.hex('#86B817'),
};

const LOGO = `
   ${ebay.red('███████╗')}${ebay.blue('██████╗ ')}${ebay.yellow('█████╗ ')}${ebay.green('██╗   ██╗')}
   ${ebay.red('██╔════╝')}${ebay.blue('██╔══██╗')}${ebay.yellow('██╔══██╗')}${ebay.green('╚██╗ ██╔╝')}
   ${ebay.red('█████╗  ')}${ebay.blue('██████╔╝')}${ebay.yellow('███████║')}${ebay.green(' ╚████╔╝ ')}
   ${ebay.red('██╔══╝  ')}${ebay.blue('██╔══██╗')}${ebay.yellow('██╔══██║')}${ebay.green('  ╚██╔╝  ')}
   ${ebay.red('███████╗')}${ebay.blue('██████╔╝')}${ebay.yellow('██║  ██║')}${ebay.green('   ██║   ')}
   ${ebay.red('╚══════╝')}${ebay.blue('╚═════╝ ')}${ebay.yellow('╚═╝  ╚═╝')}${ebay.green('   ╚═╝   ')}
`;

const ui = {
  dim: chalk.dim,
  bold: chalk.bold,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  info: chalk.cyan,
};

// ─── Business-logic helpers (preserved from original) ─────────────────────────

function parseAuthorizationCode(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.includes('code=') || trimmed.includes('?') || trimmed.includes('&')) {
    try {
      let searchParams: URLSearchParams;
      if (trimmed.startsWith('http')) {
        searchParams = new URL(trimmed).searchParams;
      } else {
        searchParams = new URLSearchParams(trimmed.startsWith('?') ? trimmed.slice(1) : trimmed);
      }
      const code = searchParams.get('code');
      if (code) return decodeURIComponent(code);
    } catch {
      // fall through
    }
  }
  if (trimmed.startsWith('v^1.1#') || trimmed.startsWith('v%5E1.1')) {
    try {
      return decodeURIComponent(trimmed);
    } catch {
      return trimmed;
    }
  }
  return null;
}

interface TokenExchangeResult extends EbayTokenCore {
  refreshTokenExpiresIn: number;
}

interface EbayUserInfo {
  userId: string;
  username: string;
  accountType?: string;
  registrationMarketplaceId?: string;
  individualAccount?: { firstName?: string; lastName?: string; email?: string };
  businessAccount?: { name?: string; email?: string };
}

async function exchangeAuthorizationCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  environment: 'sandbox' | 'production'
): Promise<TokenExchangeResult> {
  const baseUrl =
    environment === 'production' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com';
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await axios.post(
    `${baseUrl}/identity/v1/oauth2/token`,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }).toString(),
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );
  return {
    accessToken: response.data.access_token,
    refreshToken: response.data.refresh_token,
    expiresIn: response.data.expires_in,
    refreshTokenExpiresIn: response.data.refresh_token_expires_in,
  };
}

async function getAppAccessToken(
  clientId: string,
  clientSecret: string,
  environment: 'sandbox' | 'production'
): Promise<string> {
  const baseUrl =
    environment === 'production' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com';
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await axios.post(
    `${baseUrl}/identity/v1/oauth2/token`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }).toString(),
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );
  return response.data.access_token;
}

async function verifyRefreshToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  environment: 'sandbox' | 'production'
): Promise<{ accessToken: string; userInfo: EbayUserInfo }> {
  const baseUrl =
    environment === 'production' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com';
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const tokenResponse = await axios.post(
    `${baseUrl}/identity/v1/oauth2/token`,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope:
        'https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory',
    }).toString(),
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );
  const accessToken = tokenResponse.data.access_token;
  const identityBase =
    environment === 'production' ? 'https://apiz.ebay.com' : 'https://apiz.sandbox.ebay.com';
  const userResponse = await axios.get(`${identityBase}/commerce/identity/v1/user/`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });
  return { accessToken, userInfo: userResponse.data };
}

async function fetchEbayUserInfo(
  accessToken: string,
  environment: 'sandbox' | 'production'
): Promise<EbayUserInfo> {
  const identityBase =
    environment === 'production' ? 'https://apiz.ebay.com' : 'https://apiz.sandbox.ebay.com';
  const response = await axios.get(`${identityBase}/commerce/identity/v1/user/`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });
  return response.data;
}

/**
 * Resolve Claude Desktop config path for the current operating system.
 *
 * @returns Absolute path to Claude Desktop config JSON.
 */
function getClaudeDesktopConfigPath(): string {
  const home = homedir();
  const os = platform();
  if (os === 'darwin')
    return join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
  if (os === 'win32') return join(home, 'AppData/Roaming/Claude/claude_desktop_config.json');
  return join(home, '.config/Claude/claude_desktop_config.json');
}

/**
 * Check whether Claude Desktop appears to be installed locally.
 *
 * @returns `true` when the Claude Desktop config directory exists.
 */
function isClaudeDesktopInstalled(): boolean {
  return existsSync(dirname(getClaudeDesktopConfigPath()));
}

/**
 * Merge eBay MCP settings into Claude Desktop config.
 *
 * @param envConfig Current setup environment values to persist.
 * @param environment Target eBay environment name.
 * @returns Update result with success state, config path, and optional error details.
 */
function updateClaudeDesktopConfig(
  envConfig: Record<string, string>,
  environment: string
): { success: boolean; configPath: string; error?: string; details?: string } {
  const configPath = getClaudeDesktopConfigPath();
  if (!existsSync(dirname(configPath)))
    return { success: false, configPath, error: 'Claude Desktop not installed' };
  try {
    let existing: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        existing = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      } catch (e) {
        return {
          success: false,
          configPath,
          error: `Invalid JSON in config: ${e instanceof Error ? e.message : 'parse error'}`,
          details: 'Please fix the JSON syntax in your Claude config file',
        };
      }
    }
    if (!existing.mcpServers || typeof existing.mcpServers !== 'object') existing.mcpServers = {};
    const mcpServers = existing.mcpServers as Record<string, unknown>;
    const envVars: Record<string, string> = { EBAY_ENVIRONMENT: environment };
    if (envConfig.EBAY_CLIENT_ID) envVars.EBAY_CLIENT_ID = envConfig.EBAY_CLIENT_ID;
    if (envConfig.EBAY_CLIENT_SECRET) envVars.EBAY_CLIENT_SECRET = envConfig.EBAY_CLIENT_SECRET;
    if (envConfig.EBAY_REDIRECT_URI) envVars.EBAY_REDIRECT_URI = envConfig.EBAY_REDIRECT_URI;
    if (envConfig.EBAY_MARKETPLACE_ID) envVars.EBAY_MARKETPLACE_ID = envConfig.EBAY_MARKETPLACE_ID;
    if (envConfig.EBAY_CONTENT_LANGUAGE)
      envVars.EBAY_CONTENT_LANGUAGE = envConfig.EBAY_CONTENT_LANGUAGE;
    if (envConfig.EBAY_USER_REFRESH_TOKEN)
      envVars.EBAY_USER_REFRESH_TOKEN = envConfig.EBAY_USER_REFRESH_TOKEN;
    if (envConfig.EBAY_USER_ACCESS_TOKEN?.startsWith('v^'))
      envVars.EBAY_USER_ACCESS_TOKEN = envConfig.EBAY_USER_ACCESS_TOKEN;
    if (envConfig.EBAY_APP_ACCESS_TOKEN?.startsWith('v^'))
      envVars.EBAY_APP_ACCESS_TOKEN = envConfig.EBAY_APP_ACCESS_TOKEN;
    mcpServers.ebay = {
      command: 'npx',
      args: ['--yes', '--quiet', 'ebay-mcp'],
      env: { ...envVars, NODE_NO_WARNINGS: '1', NPM_CONFIG_UPDATE_NOTIFIER: 'false' },
    };
    writeFileSync(configPath, JSON.stringify(existing, null, 2));
    const otherServers = Object.keys(mcpServers).filter((k) => k !== 'ebay');
    return {
      success: true,
      configPath,
      details:
        otherServers.length > 0
          ? `Preserved ${otherServers.length} existing server(s): ${otherServers.join(', ')}`
          : `Added ebay server (${Object.keys(mcpServers).length} total)`,
    };
  } catch (error) {
    return {
      success: false,
      configPath,
      error: error instanceof Error ? error.message : 'Unknown',
    };
  }
}

function formatDate(date: Date): string {
  return date.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}

function saveConfig(envConfig: Record<string, string>, environment: string): void {
  const envPath = ROOT_ENV_LOCAL_PATH;
  const existingConfig = loadExistingConfig(REPO_ROOT);
  const mergedConfig = {
    ...existingConfig,
    ...envConfig,
    EBAY_ENVIRONMENT: environment,
  };

  writeFileSync(
    envPath,
    `# Local runtime configuration for backend-services
# Last Updated: ${formatDate(new Date())}
# Environment: ${environment}

${stringify(mergedConfig)}`,
    'utf-8'
  );
}

function showInfo(message: string): void {
  console.log(`  ${ui.info('ℹ')} ${message}`);
}

function showWarning(message: string): void {
  console.log(`  ${ui.warning('⚠')} ${message}`);
}

function showSuccess(message: string): void {
  console.log(`  ${ui.success('✓')} ${message}`);
}

function showError(message: string): void {
  console.log(`  ${ui.error('✗')} ${message}`);
}

function showBox(title: string, content: string[]): void {
  const width = 54;
  const line = '─'.repeat(width);
  console.log(
    `  ${ui.dim('┌─')} ${ui.bold(title)} ${ui.dim('─'.repeat(width - title.length - 2))}┐`
  );
  for (const item of content) {
    const displayItem = item.length > width - 2 ? item.slice(0, width - 5) + '...' : item;
    console.log(`  ${ui.dim('│')} ${displayItem.padEnd(width)}${ui.dim('│')}`);
  }
  console.log(`  ${ui.dim('└' + line + '┘')}\n`);
}

function showSetupProgress(message: string): () => void {
  console.log(`  ⠋  ${message}...`);
  return () => undefined;
}

function displayUserInfo(userInfo: EbayUserInfo): void {
  const name =
    userInfo.individualAccount?.firstName && userInfo.individualAccount?.lastName
      ? `${userInfo.individualAccount.firstName} ${userInfo.individualAccount.lastName}`
      : userInfo.businessAccount?.name || 'N/A';
  const email = userInfo.individualAccount?.email || userInfo.businessAccount?.email || 'N/A';
  const marketplaceMap: Record<string, string> = {
    EBAY_US: 'eBay United States',
    EBAY_GB: 'eBay United Kingdom',
    EBAY_DE: 'eBay Germany',
    EBAY_AU: 'eBay Australia',
    EBAY_CA: 'eBay Canada',
    EBAY_FR: 'eBay France',
    EBAY_IT: 'eBay Italy',
    EBAY_ES: 'eBay Spain',
  };
  const marketplace =
    marketplaceMap[userInfo.registrationMarketplaceId || ''] ||
    userInfo.registrationMarketplaceId ||
    'N/A';
  console.log(`  ${ui.dim('┌─ eBay Account Verified ─────────────────────────')}`);
  console.log(`  ${ui.dim('│')} Username:     ${userInfo.username}`);
  console.log(`  ${ui.dim('│')} Name:         ${name}`);
  console.log(`  ${ui.dim('│')} Email:        ${email}`);
  console.log(`  ${ui.dim('│')} Type:         ${userInfo.accountType || 'N/A'}`);
  console.log(`  ${ui.dim('│')} Marketplace:  ${marketplace}`);
  console.log(`  ${ui.dim('└─────────────────────────────────────────────────')}`);
  console.log('');
}

// ─── Setup wizard ─────────────────────────────────────────────────────────────

/**
 * Runs the interactive eBay MCP setup wizard from the script entry point.
 */
export async function runSetup(): Promise<void> {
  const existingConfig = loadExistingConfig(REPO_ROOT);
  const detectedClients = detectLLMClients();
  const availableClients = detectedClients.filter((c) => c.detected);

  const tokens: {
    refreshToken?: string;
    accessToken?: string;
    appAccessToken?: string;
  } = {};

  const finalStepId = availableClients.length > 0 ? 'mcp-clients' : 'no-mcp-clients';

  const args = parseArgs();

  console.log(LOGO);
  console.log(ui.bold.white('            MCP Server Setup Wizard by Yosef Hayim Sabag'));
  console.log(ui.dim('              Powered by ') + chalk.hex('#0064D2').bold('prompts') + '\n');

  console.log(ui.dim('  Welcome to the eBay MCP Server setup wizard!\n'));
  console.log('  This wizard will help you:\n');
  console.log(`    ${ui.success('1.')} Choose environment (sandbox/production)`);
  console.log(`    ${ui.success('2.')} Set default marketplace and language (optional)`);
  console.log(`    ${ui.success('3.')} Configure your eBay Developer credentials`);
  console.log(`    ${ui.success('4.')} Set up OAuth authentication`);
  console.log(`    ${ui.success('5.')} Configure your MCP client (Claude, Cline, etc.)`);
  console.log(`    ${ui.success('6.')} Validate your setup\n`);

  if (Object.keys(existingConfig).length > 0) {
    showInfo('Existing configuration detected. You can update or keep current values.');
    console.log('');
  }

  const wizardConfig = defineWizard({
    meta: {
      name: 'eBay MCP',
      description: 'Server Setup Wizard',
    },
    theme: {
      tokens: {
        primary: '#0064D2',
        success: '#86B817',
        warning: '#F5AF02',
        error: '#E53238',
      },
    },
    steps: [
      {
        id: 'environment',
        type: 'select',
        message: 'Select eBay environment:',
        description: '🧪 Sandbox for testing  •  🚀 Production for live trading',
        options: [
          { value: 'sandbox', label: '🧪 Sandbox  — development & testing (recommended)' },
          { value: 'production', label: '🚀 Production — live trading' },
        ],
        default: (existingConfig.EBAY_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
      },
      {
        id: 'marketplace',
        type: 'select',
        message: 'Default eBay marketplace:',
        description: 'Used as a default header for API requests — optional',
        options: [
          { value: '', label: 'Skip — leave unset' },
          ...MARKETPLACE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
          { value: '__custom__', label: 'Other — enter manually' },
        ],
        default: existingConfig.EBAY_MARKETPLACE_ID || 'EBAY_US',
      },
      {
        id: 'marketplace-custom',
        type: 'text',
        message: 'Enter marketplace ID:',
        description: 'e.g. EBAY_US, EBAY_DE',
        when: { field: 'marketplace', equals: '__custom__' },
        default: existingConfig.EBAY_MARKETPLACE_ID || 'EBAY_US',
        validate: [{ rule: 'required' }],
      },
      {
        id: 'content-language',
        type: 'select',
        message: 'Default Content-Language:',
        description: 'Used as a default header for API requests — optional',
        options: [
          { value: '', label: 'Skip — leave unset' },
          ...CONTENT_LANGUAGE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
          { value: '__custom__', label: 'Other — enter manually' },
        ],
        default: existingConfig.EBAY_CONTENT_LANGUAGE || 'en-US',
      },
      {
        id: 'content-language-custom',
        type: 'text',
        message: 'Enter Content-Language:',
        description: 'e.g. en-US, de-DE',
        when: { field: 'content-language', equals: '__custom__' },
        default: existingConfig.EBAY_CONTENT_LANGUAGE || 'en-US',
        validate: [{ rule: 'required' }],
      },
      {
        id: 'client-id',
        type: 'text',
        message: 'Client ID (App ID):',
        description: 'From https://developer.ebay.com/my/keys',
        default: existingConfig.EBAY_CLIENT_ID || '',
        validate: [{ rule: 'required' }],
      },
      {
        id: 'client-secret',
        type: 'password',
        message: 'Client Secret (Cert ID):',
        description: existingConfig.EBAY_CLIENT_SECRET
          ? 'Press Enter to keep existing secret'
          : 'From https://developer.ebay.com/my/keys',
        required: existingConfig.EBAY_CLIENT_SECRET ? false : true,
      },
      {
        id: 'redirect-uri',
        type: 'text',
        message: 'Redirect URI (RuName):',
        description: 'The RuName configured in your eBay developer account',
        default: existingConfig.EBAY_REDIRECT_URI || '',
        validate: [{ rule: 'required' }],
      },
      {
        id: 'oauth-method',
        type: 'select',
        message: 'Set up OAuth for higher API rate limits:',
        description: 'App credentials: 1,000 req/day  •  User OAuth: 10,000–50,000 req/day',
        options: [
          { value: 'existing', label: '📝 I have a refresh token' },
          { value: 'manual', label: '🔗 Generate OAuth URL (opens browser)' },
          { value: 'code', label: '🔑 Paste authorization code (already have code)' },
          { value: 'skip', label: '⏭️  Skip for now (1,000 req/day limit)' },
        ],
      },
      {
        id: 'oauth-token',
        type: 'text',
        message: 'Paste your refresh token:',
        description: 'Should start with v^1.1#',
        default: '',
      },
      {
        id: 'oauth-code',
        type: 'text',
        message: 'Paste the callback URL or authorization code:',
        description: 'Copy the full redirect URL or just the code= parameter',
        default: '',
      },
      ...(availableClients.length > 0
        ? ([
            {
              id: 'mcp-clients',
              type: 'multiselect' as const,
              message: 'Configure MCP clients:',
              description: 'Select AI assistants to connect to the eBay MCP server',
              required: false,
              options: availableClients.map((c) => ({
                value: c.name,
                label: `${c.displayName}${c.configExists ? '  (update)' : '  (new)'}`,
              })),
            },
          ] as const)
        : ([
            {
              id: 'no-mcp-clients',
              type: 'note' as const,
              message: 'No MCP clients detected',
              description:
                'Install Claude Desktop, Cline (VSCode), or Continue.dev, then run setup again.',
            },
          ] as const)),
    ],
  });

  const answers = await runWizard(wizardConfig, {
    renderer: new ClackRenderer(),
    quiet: true,

    optionsProvider: (stepId) => {
      if (stepId === 'oauth-method') {
        const hasToken = existingConfig.EBAY_USER_REFRESH_TOKEN?.startsWith('v^1.1#');
        if (hasToken) {
          return [
            { value: 'keep', label: '✓  Keep and verify existing token' },
            { value: 'existing', label: '📝 Replace with a different refresh token' },
            { value: 'manual', label: '🔗 Generate OAuth URL (opens browser)' },
            { value: 'code', label: '🔑 Paste authorization code' },
            { value: 'skip', label: '⏭️  Skip for now' },
          ];
        }
      }
      return undefined;
    },

    asyncValidate: (stepId, value) => {
      if (stepId === 'oauth-token') {
        const clean = String(value)
          .trim()
          .replace(/^["']|["']$/g, '');
        if (!clean) return 'Token is required';
        if (!clean.startsWith('v^1.1#')) return 'Token should start with v^1.1#';
      }
      if (stepId === 'oauth-code') {
        const code = parseAuthorizationCode(String(value));
        if (!code)
          return 'Could not find authorization code. Paste the full redirect URL or the code parameter.';
      }
      return null;
    },

    onAfterStep: async (stepId, value, context) => {
      const a = context.answers;
      const environment = (a.environment as 'sandbox' | 'production') || 'sandbox';
      const clientId = (a['client-id'] as string) || existingConfig.EBAY_CLIENT_ID || '';
      const clientSecret =
        (a['client-secret'] as string) || existingConfig.EBAY_CLIENT_SECRET || '';
      const redirectUri = (a['redirect-uri'] as string) || existingConfig.EBAY_REDIRECT_URI || '';

      if (stepId === 'environment' && args.quick) {
        showInfo('Quick setup enabled — skipping optional marketplace configuration.');
        context.setNextStep('client-id');
      }

      // ── oauth-method: dispatch to correct sub-flow ─────────────────────────
      if (stepId === 'oauth-method') {
        const method = value as string;

        if (method === 'keep') {
          const stopSpinner = showSetupProgress('Verifying existing refresh token...');
          try {
            const { accessToken, userInfo } = await verifyRefreshToken(
              existingConfig.EBAY_USER_REFRESH_TOKEN,
              clientId,
              clientSecret,
              environment
            );
            stopSpinner();
            showSuccess('Refresh token verified!');
            tokens.refreshToken = existingConfig.EBAY_USER_REFRESH_TOKEN;
            tokens.accessToken = accessToken;
            displayUserInfo(userInfo);
            try {
              tokens.appAccessToken = await getAppAccessToken(clientId, clientSecret, environment);
              showSuccess('App access token obtained.');
            } catch {
              showWarning('Could not obtain app access token (user tokens still work).');
            }
            if (isClaudeDesktopInstalled()) {
              const r = updateClaudeDesktopConfig(
                {
                  ...(a as Record<string, string>),
                  EBAY_USER_REFRESH_TOKEN: tokens.refreshToken ?? '',
                },
                environment
              );
              if (r.success) {
                showSuccess('Claude Desktop config updated.');
                if (r.details) showInfo(r.details);
              } else showWarning(`Could not update Claude Desktop: ${r.error}`);
            }
          } catch (error) {
            stopSpinner();
            const msg = axios.isAxiosError(error)
              ? error.response?.data?.error_description ||
                error.response?.data?.errors?.[0]?.message ||
                error.message
              : error instanceof Error
                ? error.message
                : 'Unknown error';
            showError(`Token verification failed: ${msg}`);
            if (msg.toLowerCase().includes('access denied'))
              showWarning('Token may be missing required OAuth scopes.');
            else showWarning('Existing token may be expired or invalid.');
            showInfo('Continuing with existing token — re-run setup to refresh it.');
            tokens.refreshToken = existingConfig.EBAY_USER_REFRESH_TOKEN;
          }
          context.setNextStep(finalStepId);
        } else if (method === 'existing') {
          context.setNextStep('oauth-token');
        } else if (method === 'manual') {
          const authUrl = getOAuthAuthorizationUrl(clientId, redirectUri, environment);
          context.showNote('OAuth Authorization URL', authUrl);
          await context.openBrowser(authUrl);
          showInfo('1. Sign in to your eBay account in the browser');
          showInfo('2. Grant permissions to your app');
          showInfo('3. Copy the redirect URL or the code parameter, then paste it below');
          console.log('');
          context.setNextStep('oauth-code');
        } else if (method === 'code') {
          context.setNextStep('oauth-code');
        } else if (method === 'skip') {
          showWarning("Skipping OAuth — you'll be limited to 1,000 requests/day.");
          context.setNextStep(finalStepId);
        }
      }

      // ── oauth-token: verify pasted refresh token ───────────────────────────
      if (stepId === 'oauth-token') {
        const rawToken = String(value)
          .trim()
          .replace(/^["']|["']$/g, '');
        tokens.refreshToken = rawToken;
        const stopSpinner = showSetupProgress('Verifying refresh token...');
        try {
          const { accessToken, userInfo } = await verifyRefreshToken(
            rawToken,
            clientId,
            clientSecret,
            environment
          );
          stopSpinner();
          showSuccess('Refresh token verified!');
          tokens.accessToken = accessToken;
          displayUserInfo(userInfo);
          try {
            tokens.appAccessToken = await getAppAccessToken(clientId, clientSecret, environment);
            showSuccess('App access token obtained.');
          } catch {
            showWarning('Could not obtain app access token (user tokens still work).');
          }
          if (isClaudeDesktopInstalled()) {
            const r = updateClaudeDesktopConfig(
              { ...(a as Record<string, string>), EBAY_USER_REFRESH_TOKEN: rawToken },
              environment
            );
            if (r.success) {
              showSuccess('Claude Desktop config updated.');
              if (r.details) showInfo(r.details);
            } else showWarning(`Could not update Claude Desktop: ${r.error}`);
          }
        } catch (error) {
          stopSpinner();
          const msg = axios.isAxiosError(error)
            ? error.response?.data?.error_description ||
              error.response?.data?.errors?.[0]?.message ||
              error.message
            : error instanceof Error
              ? error.message
              : 'Unknown error';
          showError(`Token verification failed: ${msg}`);
          showWarning("Token saved anyway — you may need to re-authenticate if it doesn't work.");
        }
        context.setNextStep(finalStepId);
      }

      // ── oauth-code: exchange authorization code for tokens ─────────────────
      if (stepId === 'oauth-code') {
        const authCode = parseAuthorizationCode(String(value));
        if (!authCode) return;
        const stopSpinner = showSetupProgress('Exchanging authorization code for tokens...');
        try {
          const result = await exchangeAuthorizationCode(
            authCode,
            clientId,
            clientSecret,
            redirectUri,
            environment
          );
          stopSpinner();
          showSuccess('Authorization code exchanged successfully!');
          tokens.refreshToken = result.refreshToken;
          tokens.accessToken = result.accessToken;
          try {
            const userInfo = await fetchEbayUserInfo(result.accessToken, environment);
            showSuccess('Account verified!');
            displayUserInfo(userInfo);
          } catch (userError) {
            const userMsg = axios.isAxiosError(userError)
              ? userError.response?.data?.errors?.[0]?.message || userError.message
              : userError instanceof Error
                ? userError.message
                : 'Unknown';
            showWarning(`Could not fetch account info: ${userMsg}`);
            if (userMsg.toLowerCase().includes('access denied'))
              showInfo(
                'Normal if RuName lacks commerce.identity.readonly scope — tokens are valid.'
              );
          }
          try {
            tokens.appAccessToken = await getAppAccessToken(clientId, clientSecret, environment);
            showSuccess('App access token obtained.');
          } catch {
            showWarning('Could not obtain app access token (user tokens still work).');
          }
          showInfo(`Access token expires in: ${Math.floor(result.expiresIn / 60)} minutes`);
          showInfo(
            `Refresh token expires in: ${Math.floor(result.refreshTokenExpiresIn / 60 / 60 / 24)} days`
          );
          if (isClaudeDesktopInstalled()) {
            const r = updateClaudeDesktopConfig(
              {
                ...(a as Record<string, string>),
                EBAY_USER_REFRESH_TOKEN: tokens.refreshToken ?? '',
                EBAY_USER_ACCESS_TOKEN: tokens.accessToken ?? '',
              },
              environment
            );
            if (r.success) {
              showSuccess('Claude Desktop config updated.');
              if (r.details) showInfo(r.details);
            } else showWarning(`Could not update Claude Desktop: ${r.error}`);
          }
        } catch (error) {
          stopSpinner();
          const msg = axios.isAxiosError(error)
            ? error.response?.data?.error_description || error.message
            : error instanceof Error
              ? error.message
              : 'Unknown error';
          showError(`Failed to exchange code: ${msg}`);
          console.log('  Common issues:');
          console.log('  • Authorization code expired (codes are valid for ~5 minutes)');
          console.log('  • Code was already used (each code can only be used once)');
          console.log('  • Redirect URI mismatch\n');
        }
        context.setNextStep(finalStepId);
      }

      // ── mcp-clients: configure selected clients ────────────────────────────
      if (stepId === 'mcp-clients') {
        const selectedNames = value as string[];
        for (const name of selectedNames) {
          const client = detectedClients.find((c) => c.name === name);
          if (!client) continue;
          const stopSpinner = showSetupProgress(`Configuring ${client.displayName}...`);
          await new Promise((r) => {
            setTimeout(r, 400);
          });
          const success = configureLLMClient(client.name, REPO_ROOT);
          stopSpinner();
          if (success) showSuccess(`Configured ${client.displayName}`);
          else showError(`Failed to configure ${client.displayName}`);
        }
      }
    },

    onCancel: () => {
      console.log(ui.warning('\n  Setup cancelled.\n'));
      process.exit(0);
    },
  });

  // ── Persist final .env.local ───────────────────────────────────────────────

  const marketplaceId =
    answers.marketplace === '__custom__'
      ? (answers['marketplace-custom'] as string)
      : (answers.marketplace as string);

  const contentLanguage =
    answers['content-language'] === '__custom__'
      ? (answers['content-language-custom'] as string)
      : (answers['content-language'] as string);

  const environment = answers.environment as string;

  const finalConfig: Record<string, string> = {
    EBAY_CLIENT_ID: answers['client-id'] as string,
    EBAY_CLIENT_SECRET:
      (answers['client-secret'] as string) || existingConfig.EBAY_CLIENT_SECRET || '',
    EBAY_REDIRECT_URI: answers['redirect-uri'] as string,
    EBAY_ENVIRONMENT: environment,
    ...(marketplaceId ? { EBAY_MARKETPLACE_ID: marketplaceId } : {}),
    ...(contentLanguage ? { EBAY_CONTENT_LANGUAGE: contentLanguage } : {}),
    ...(tokens.refreshToken
      ? { EBAY_USER_REFRESH_TOKEN: tokens.refreshToken }
      : existingConfig.EBAY_USER_REFRESH_TOKEN
        ? { EBAY_USER_REFRESH_TOKEN: existingConfig.EBAY_USER_REFRESH_TOKEN }
        : {}),
    ...(tokens.accessToken ? { EBAY_USER_ACCESS_TOKEN: tokens.accessToken } : {}),
    ...(tokens.appAccessToken ? { EBAY_APP_ACCESS_TOKEN: tokens.appAccessToken } : {}),
  };

  const stopSave = showSetupProgress('Saving configuration...');
  await new Promise((r) => {
    setTimeout(r, 300);
  });
  saveConfig(finalConfig, environment);
  stopSave();
  showSuccess('Configuration saved to backend-services/.env.local\n');

  console.log(LOGO);
  console.log(ui.bold.white('            MCP Server Setup Wizard by Yosef Hayim Sabag'));
  console.log(ui.dim('              Powered by ') + chalk.hex('#0064D2').bold('prompts') + '\n');

  console.log(ui.bold.green('\n  🎉 Setup Complete!\n'));
  showBox('Configuration Summary', [
    `Environment:     ${environment}`,
    `Marketplace ID:  ${finalConfig.EBAY_MARKETPLACE_ID || 'Not set'}`,
    `Content-Lang:    ${finalConfig.EBAY_CONTENT_LANGUAGE || 'Not set'}`,
    `Client ID:       ${(finalConfig.EBAY_CLIENT_ID || '').slice(0, 20)}...`,
    `Redirect URI:    ${(finalConfig.EBAY_REDIRECT_URI || '').slice(0, 30)}...`,
    `OAuth Token:     ${finalConfig.EBAY_USER_REFRESH_TOKEN ? '✓ Configured' : '✗ Not set'}`,
    `Rate Limit:      ${finalConfig.EBAY_USER_REFRESH_TOKEN ? '10k-50k/day' : '1k/day'}`,
  ]);

  console.log(ui.bold.cyan('\n  📋 Quick Reference\n'));
  console.log('  ' + ui.dim('─'.repeat(56)));
  console.log(`  ${ui.bold('Start MCP Server:')}     ${ui.info('npm start')}`);
  console.log(`  ${ui.bold('Run Diagnostics:')}      ${ui.info('npm run diagnose')}`);
  console.log(`  ${ui.bold('View Logs:')}            ${ui.info('npm run dev')}`);
  console.log(`  ${ui.bold('Run Tests:')}            ${ui.info('npm test')}`);
  console.log('  ' + ui.dim('─'.repeat(56)));

  console.log(ui.bold.cyan('\n  🚀 Next Steps\n'));
  console.log('  1. Restart your MCP client (Claude Desktop, etc.)');
  console.log('  2. The eBay server should appear in available tools');
  console.log('  3. Try: "Show my eBay seller information"\n');

  console.log(
    ui.dim('  Documentation: ') +
      ui.info('https://github.com/Ubuntufoo/backend-services/blob/main/services/sidecar/README.md')
  );
  console.log(
    ui.dim('  Get Help:      ') + ui.info('https://github.com/Ubuntufoo/backend-services/issues\n')
  );
}

// ─── Entry point ──────────────────────────────────────────────────────────────

function parseArgs(): { help: boolean; quick: boolean; diagnose: boolean } {
  const args = process.argv.slice(2);
  return {
    help: args.includes('--help') || args.includes('-h'),
    quick: args.includes('--quick') || args.includes('-q'),
    diagnose: args.includes('--diagnose') || args.includes('-d'),
  };
}

function showHelp(): void {
  console.log(`
${chalk.bold('eBay MCP Server Setup')}  ${chalk.dim('interactive setup')}

${chalk.bold('Usage:')}
  npm run setup [options]

${chalk.bold('Options:')}
  --help, -h       Show this help message
  --quick, -q      Quick setup (skip optional configuration)
  --diagnose, -d   Run diagnostics only

${chalk.bold('Examples:')}
  npm run setup              Full interactive wizard
  npm run setup --quick      Skip optional configuration
  npm run setup --diagnose   Check system health
`);
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  if (args.diagnose) {
    console.clear();
    console.log(ui.bold.cyan('  Running Diagnostics...\n'));
    const securityResults = await runSecurityChecks(REPO_ROOT);
    displaySecurityResults(securityResults);
    const summary = await validateSetup(REPO_ROOT);
    displayRecommendations(summary);
    process.exit(0);
  }

  await runSetup();
}

process.on('SIGINT', () => {
  console.log(ui.warning('\n\n  Setup interrupted.\n'));
  process.exit(0);
});

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));
if (entryPath && modulePath === entryPath) {
  main().catch((error) => {
    console.error(ui.error('\n  Setup failed:'), error);
    process.exit(1);
  });
}

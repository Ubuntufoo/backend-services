/**
 * Setup Validation Module
 *
 * Tests the configuration after setup to ensure everything is working properly.
 */

import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { EbayOAuthClient } from '../auth/oauth.js';
import { getOAuthAuthorizationUrl } from '../config/environment.js';
import { createSupabaseServiceClient } from '../supabase/client.js';
import { ROOT_ENV_LOCAL_PATH } from '../config/env-paths.js';
import { parseEnvFile } from './env-parser.js';
import type { EbayConfig } from '../types/ebay.js';

/**
 * Result for one setup validation test.
 */
export interface ValidationResult {
  test: string;
  passed: boolean;
  message: string;
  error?: string;
}

/**
 * Aggregate result returned after all setup validation tests run.
 */
export interface ValidationSummary {
  totalTests: number;
  passed: number;
  failed: number;
  results: ValidationResult[];
}

/**
 * Validate .env.local file exists and is readable
 */
function validateEnvFile(): ValidationResult {
  const envPath = ROOT_ENV_LOCAL_PATH;

  if (!existsSync(envPath)) {
    return {
      test: '.env.local File Existence',
      passed: false,
      message: 'Configuration file not found',
      error: `.env.local file does not exist at ${envPath}`,
    };
  }

  try {
    readFileSync(envPath, 'utf-8');
    return {
      test: '.env.local File Existence',
      passed: true,
      message: 'Configuration file exists and is readable',
    };
  } catch (error) {
    return {
      test: '.env.local File Existence',
      passed: false,
      message: 'Configuration file cannot be read',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Validate required app credentials are present
 */
function validateAppCredentials(envVars: Record<string, string>): ValidationResult {
  const required = ['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET', 'EBAY_REDIRECT_URI'];
  const missing: string[] = [];

  for (const key of required) {
    if (!envVars[key] || envVars[key].trim() === '') {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    return {
      test: 'App Credentials',
      passed: false,
      message: 'Missing required app credentials',
      error: `Missing: ${missing.join(', ')}`,
    };
  }

  return {
    test: 'App Credentials',
    passed: true,
    message: 'All required app credentials are present',
  };
}

function validateSupabaseConfiguration(envVars: Record<string, string>): ValidationResult {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_PROJECT_REF',
  ];
  const missing = required.filter((key) => !envVars[key] || envVars[key].trim() === '');

  if (missing.length > 0) {
    return {
      test: 'Supabase Configuration',
      passed: false,
      message: 'Missing required Supabase configuration',
      error: `Missing: ${missing.join(', ')}`,
    };
  }

  return {
    test: 'Supabase Configuration',
    passed: true,
    message: `Supabase project ref configured as "${envVars.SUPABASE_PROJECT_REF}"`,
  };
}

/**
 * Validate environment setting
 */
function validateEnvironment(envVars: Record<string, string>): ValidationResult {
  const env = envVars.EBAY_ENVIRONMENT || 'sandbox';

  if (env !== 'sandbox' && env !== 'production') {
    return {
      test: 'Environment Setting',
      passed: false,
      message: 'Invalid environment value',
      error: `EBAY_ENVIRONMENT must be "sandbox" or "production", got "${env}"`,
    };
  }

  return {
    test: 'Environment Setting',
    passed: true,
    message: `Environment set to "${env}"`,
  };
}

/**
 * Check if user tokens are configured
 */
function validateUserTokens(envVars: Record<string, string>): ValidationResult {
  const hasRefreshToken =
    envVars.EBAY_USER_REFRESH_TOKEN && envVars.EBAY_USER_REFRESH_TOKEN.trim() !== '';

  if (!hasRefreshToken) {
    return {
      test: 'User Tokens (Optional)',
      passed: true,
      message: 'No user tokens configured (app token only mode)',
      error: 'To enable user-specific API calls, set EBAY_USER_REFRESH_TOKEN',
    };
  }

  return {
    test: 'User Tokens',
    passed: true,
    message: 'User refresh token is configured',
  };
}

/**
 * Test OAuth client initialization
 */
async function validateOAuthInitialization(config: EbayConfig): Promise<ValidationResult> {
  try {
    const oauthClient = new EbayOAuthClient(config);
    await oauthClient.initialize();

    return {
      test: 'OAuth Client Initialization',
      passed: true,
      message: 'OAuth client initialized successfully',
    };
  } catch (error) {
    return {
      test: 'OAuth Client Initialization',
      passed: false,
      message: 'Failed to initialize OAuth client',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Test OAuth URL generation
 */
function validateOAuthURL(config: EbayConfig): ValidationResult {
  try {
    if (!config.redirectUri) {
      return {
        test: 'OAuth URL Generation',
        passed: false,
        message: 'Redirect URI is required for OAuth URL generation',
        error: 'EBAY_REDIRECT_URI is not configured',
      };
    }

    const url = getOAuthAuthorizationUrl(config.clientId, config.redirectUri, config.environment);

    if (!url.startsWith('http')) {
      return {
        test: 'OAuth URL Generation',
        passed: false,
        message: 'Invalid OAuth URL generated',
        error: 'Generated URL is not valid',
      };
    }

    return {
      test: 'OAuth URL Generation',
      passed: true,
      message: 'OAuth URL can be generated',
    };
  } catch (error) {
    return {
      test: 'OAuth URL Generation',
      passed: false,
      message: 'Failed to generate OAuth URL',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function validateSupabaseClientInitialization(envVars: Record<string, string>): ValidationResult {
  try {
    createSupabaseServiceClient(envVars);

    return {
      test: 'Supabase Client Initialization',
      passed: true,
      message: 'Supabase service client initialized successfully',
    };
  } catch (error) {
    return {
      test: 'Supabase Client Initialization',
      passed: false,
      message: 'Failed to initialize Supabase service client',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Run all validation tests
 */
export async function validateSetup(): Promise<ValidationSummary> {
  const results: ValidationResult[] = [];

  console.log(chalk.bold.cyan('\n🧪 Running Configuration Tests...\n'));

  // Test 1: .env.local file exists
  const envFileResult = validateEnvFile();
  results.push(envFileResult);
  printResult(envFileResult);

  if (!envFileResult.passed) {
    return {
      totalTests: 1,
      passed: 0,
      failed: 1,
      results,
    };
  }

  // Parse .env.local file
  const envVars = parseEnvFile(ROOT_ENV_LOCAL_PATH);

  // Test 2: App credentials
  const appCredsResult = validateAppCredentials(envVars);
  results.push(appCredsResult);
  printResult(appCredsResult);

  // Test 3: Supabase configuration
  const supabaseConfigResult = validateSupabaseConfiguration(envVars);
  results.push(supabaseConfigResult);
  printResult(supabaseConfigResult);

  // Test 4: Environment setting
  const envResult = validateEnvironment(envVars);
  results.push(envResult);
  printResult(envResult);

  // Test 5: User tokens (optional)
  const userTokensResult = validateUserTokens(envVars);
  results.push(userTokensResult);
  printResult(userTokensResult);

  // Test 6: Supabase client initialization
  if (supabaseConfigResult.passed) {
    const supabaseClientResult = validateSupabaseClientInitialization(envVars);
    results.push(supabaseClientResult);
    printResult(supabaseClientResult);
  }

  // If app credentials are valid, test OAuth functionality
  if (appCredsResult.passed) {
    const config: EbayConfig = {
      clientId: envVars.EBAY_CLIENT_ID,
      clientSecret: envVars.EBAY_CLIENT_SECRET,
      redirectUri: envVars.EBAY_REDIRECT_URI,
      environment: (envVars.EBAY_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production',
    };

    // Test 7: OAuth initialization
    const oauthInitResult = await validateOAuthInitialization(config);
    results.push(oauthInitResult);
    printResult(oauthInitResult);

    // Test 8: OAuth URL generation
    if (oauthInitResult.passed) {
      const oauthURLResult = validateOAuthURL(config);
      results.push(oauthURLResult);
      printResult(oauthURLResult);
    }
  }

  // Calculate summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  // Print summary
  console.log(chalk.gray('\n' + '─'.repeat(60)));
  console.log(chalk.bold.white('\n📊 Validation Summary\n'));
  console.log(`  Total Tests: ${results.length}`);
  console.log(`  ${chalk.green('✓ Passed:')} ${passed}`);
  console.log(`  ${chalk.red('✗ Failed:')} ${failed}`);

  if (failed === 0) {
    console.log(chalk.green.bold('\n✨ All tests passed! Configuration is valid.\n'));
  } else {
    console.log(chalk.yellow.bold('\n⚠️  Some tests failed. Please review the errors above.\n'));
  }

  return {
    totalTests: results.length,
    passed,
    failed,
    results,
  };
}

/**
 * Print a single validation result
 */
function printResult(result: ValidationResult): void {
  const icon = result.passed ? chalk.green('✓') : chalk.red('✗');
  const status = result.passed ? chalk.green('PASS') : chalk.red('FAIL');

  console.log(`${icon} ${chalk.bold(result.test)}: ${status}`);
  console.log(`  ${chalk.gray(result.message)}`);

  if (result.error) {
    console.log(`  ${chalk.yellow('→')} ${chalk.yellow(result.error)}`);
  }

  console.log('');
}

/**
 * Display recommendations based on validation results
 */
export function displayRecommendations(summary: ValidationSummary): void {
  const hasUserTokens = summary.results.some(
    (r) => r.test === 'User Tokens' && r.passed && !r.error
  );

  console.log(chalk.bold.cyan('💡 Recommendations:\n'));

  if (!hasUserTokens) {
    console.log(chalk.yellow('  ⚠️  User tokens not configured'));
    console.log(chalk.gray('     • You can only use app token for limited API access'));
    console.log(chalk.gray('     • To enable full API access, use the ebay_get_oauth_url tool'));
    console.log(
      chalk.gray(
        '     • Then save your refresh token to EBAY_USER_REFRESH_TOKEN in backend-services/.env.local\n'
      )
    );
  }

  if (summary.failed > 0) {
    console.log(chalk.red('  ❌ Configuration has errors'));
    console.log(chalk.gray('     • Review the failed tests above'));
    console.log(chalk.gray('     • Update your backend-services/.env.local file with correct values'));
    console.log(chalk.gray('     • Run the setup wizard again: npm run setup\n'));
  } else {
    console.log(chalk.green('  ✅ Configuration is complete and valid'));
    console.log(chalk.gray('     • Restart your MCP client (Claude Desktop, Cline, etc.)'));
    console.log(chalk.gray('     • The eBay MCP server should now be available'));
    console.log(chalk.gray('     • Try using tools like: ebay_get_user, ebay_get_oauth_url\n'));
  }
}

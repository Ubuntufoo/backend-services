import type { ComponentLogger } from '@/utils/logger.js';
import { setupLogger } from '@/utils/logger.js';
import { validateSandboxOAuthAccess } from '@/ebay/sandbox-bootstrap.js';
import type { components as AccountComponents } from '@/types/sell-apps/account-management/sellAccountV1Oas3.js';

type Program = AccountComponents['schemas']['Program'];
type Programs = AccountComponents['schemas']['Programs'];

export const SELLING_POLICY_MANAGEMENT_PROGRAM = 'SELLING_POLICY_MANAGEMENT';

export interface SandboxProgramApi {
  account: {
    getOptedInPrograms(): Promise<Programs>;
    optInToProgram(request: Program): Promise<void>;
  };
  getAuthClient(): {
    getConfig(): {
      environment?: string;
      marketplaceId?: string;
    };
    getOAuthClient(): {
      getAccessToken(): Promise<string>;
      getUserTokens(): { scope?: string } | null;
    };
  };
  hasUserTokens(): boolean;
}

export interface SellingPolicyManagementDiagnostic {
  /* eslint-disable-next-line @typescript-eslint/naming-convention -- CLI diagnostic field is intentionally snake_case */
  selling_policy_management_opted_in: boolean | 'unknown';
  warnings: string[];
}

export interface SellingPolicyOptInResult {
  message: string;
  status: 'already_opted_in' | 'already_requested' | 'opt_in_requested';
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAuthorizationScopeError(error: unknown): boolean {
  const message = normalizeError(error).toLowerCase();
  return (
    message.includes('insufficient_scope') ||
    message.includes('insufficient scope') ||
    message.includes('forbidden') ||
    message.includes('unauthorized') ||
    message.includes('status code 401') ||
    message.includes('status code 403')
  );
}

function isAlreadyRequestedError(error: unknown): boolean {
  const message = normalizeError(error).toLowerCase();
  return (
    message.includes('25803') ||
    message.includes('status code 409') ||
    message.includes('already opted in') ||
    message.includes('already requested')
  );
}

function formatAuthorizationError(error: unknown): Error {
  return new Error(
    `Re-authorize sandbox user with scopes: api_scope, sell.account, sell.inventory. Root cause: ${normalizeError(error)}`
  );
}

function hasSellingPolicyManagementProgram(programs: Programs | undefined): boolean {
  return (
    programs?.programs?.some(
      (program) => program.programType === SELLING_POLICY_MANAGEMENT_PROGRAM
    ) ?? false
  );
}

export async function getSandboxSellingPolicyManagementDiagnostic(
  api: SandboxProgramApi,
  logger: ComponentLogger = setupLogger
): Promise<SellingPolicyManagementDiagnostic> {
  const warnings: string[] = [];

  await validateSandboxOAuthAccess(api, logger);

  try {
    const programs = await api.account.getOptedInPrograms();
    return {
      selling_policy_management_opted_in: hasSellingPolicyManagementProgram(programs),
      warnings,
    };
  } catch (error) {
    const warning = isAuthorizationScopeError(error)
      ? 'Could not determine selling policy opt-in status. Re-authorize sandbox user with scopes: api_scope, sell.account, sell.inventory.'
      : `Could not determine selling policy opt-in status. Root cause: ${normalizeError(error)}`;
    logger.warn(warning);
    warnings.push(warning);

    return {
      selling_policy_management_opted_in: 'unknown',
      warnings,
    };
  }
}

export async function optInSandboxSellingPolicyManagement(
  api: SandboxProgramApi,
  logger: ComponentLogger = setupLogger
): Promise<SellingPolicyOptInResult> {
  await validateSandboxOAuthAccess(api, logger);

  try {
    const programs = await api.account.getOptedInPrograms();
    if (hasSellingPolicyManagementProgram(programs)) {
      return {
        message: 'Already opted in to SELLING_POLICY_MANAGEMENT.',
        status: 'already_opted_in',
      };
    }
  } catch (error) {
    if (isAuthorizationScopeError(error)) {
      throw formatAuthorizationError(error);
    }

    throw new Error(`Failed to inspect opted-in programs. Root cause: ${normalizeError(error)}`);
  }

  try {
    await api.account.optInToProgram({
      programType: SELLING_POLICY_MANAGEMENT_PROGRAM,
    });
    return {
      message:
        'Opt-in request submitted for SELLING_POLICY_MANAGEMENT. eBay may take up to 24 hours to process. Rerun ebay:diagnose-sandbox later.',
      status: 'opt_in_requested',
    };
  } catch (error) {
    if (isAlreadyRequestedError(error)) {
      return {
        message:
          'SELLING_POLICY_MANAGEMENT already opted in or opt-in already requested. eBay may take up to 24 hours to process. Rerun ebay:diagnose-sandbox later.',
        status: 'already_requested',
      };
    }

    if (isAuthorizationScopeError(error)) {
      throw formatAuthorizationError(error);
    }

    throw new Error(`Failed to opt in to SELLING_POLICY_MANAGEMENT. Root cause: ${normalizeError(error)}`);
  }
}

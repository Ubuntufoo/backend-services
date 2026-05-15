import type { ToolHandlerMap } from './types.js';

/** Handler map for Account Management API tool execution. */
export const accountHandlers: ToolHandlerMap = {
  ebay_get_custom_policies: async (api, args) => {
    return await api.account.getCustomPolicies(args.policyTypes as string);
  },

  ebay_get_fulfillment_policies: async (api, args) => {
    return await api.account.getFulfillmentPolicies(args.marketplaceId as string);
  },

  ebay_get_payment_policies: async (api, args) => {
    return await api.account.getPaymentPolicies(args.marketplaceId as string);
  },

  ebay_get_return_policies: async (api, args) => {
    return await api.account.getReturnPolicies(args.marketplaceId as string);
  },

  ebay_create_fulfillment_policy: async (api, args) => {
    return await api.account.createFulfillmentPolicy(args.policy as Record<string, unknown>);
  },

  ebay_get_fulfillment_policy: async (api, args) => {
    return await api.account.getFulfillmentPolicy(args.fulfillmentPolicyId as string);
  },

  ebay_get_fulfillment_policy_by_name: async (api, args) => {
    return await api.account.getFulfillmentPolicyByName(
      args.marketplaceId as string,
      args.name as string
    );
  },

  ebay_update_fulfillment_policy: async (api, args) => {
    return await api.account.updateFulfillmentPolicy(
      args.fulfillmentPolicyId as string,
      args.policy as Record<string, unknown>
    );
  },

  ebay_delete_fulfillment_policy: async (api, args) => {
    return await api.account.deleteFulfillmentPolicy(args.fulfillmentPolicyId as string);
  },

  ebay_create_payment_policy: async (api, args) => {
    return await api.account.createPaymentPolicy(args.policy as Record<string, unknown>);
  },

  ebay_get_payment_policy: async (api, args) => {
    return await api.account.getPaymentPolicy(args.paymentPolicyId as string);
  },

  ebay_get_payment_policy_by_name: async (api, args) => {
    return await api.account.getPaymentPolicyByName(
      args.marketplaceId as string,
      args.name as string
    );
  },

  ebay_update_payment_policy: async (api, args) => {
    return await api.account.updatePaymentPolicy(
      args.paymentPolicyId as string,
      args.policy as Record<string, unknown>
    );
  },

  ebay_delete_payment_policy: async (api, args) => {
    return await api.account.deletePaymentPolicy(args.paymentPolicyId as string);
  },

  ebay_create_return_policy: async (api, args) => {
    return await api.account.createReturnPolicy(args.policy as Record<string, unknown>);
  },

  ebay_get_return_policy: async (api, args) => {
    return await api.account.getReturnPolicy(args.returnPolicyId as string);
  },

  ebay_get_return_policy_by_name: async (api, args) => {
    return await api.account.getReturnPolicyByName(
      args.marketplaceId as string,
      args.name as string
    );
  },

  ebay_update_return_policy: async (api, args) => {
    return await api.account.updateReturnPolicy(
      args.returnPolicyId as string,
      args.policy as Record<string, unknown>
    );
  },

  ebay_delete_return_policy: async (api, args) => {
    return await api.account.deleteReturnPolicy(args.returnPolicyId as string);
  },

  ebay_create_custom_policy: async (api, args) => {
    return await api.account.createCustomPolicy(args.policy as Record<string, unknown>);
  },

  ebay_get_custom_policy: async (api, args) => {
    return await api.account.getCustomPolicy(args.customPolicyId as string);
  },

  ebay_update_custom_policy: async (api, args) => {
    return await api.account.updateCustomPolicy(
      args.customPolicyId as string,
      args.policy as Record<string, unknown>
    );
  },

  ebay_delete_custom_policy: async (api, args) => {
    return await api.account.deleteCustomPolicy(args.customPolicyId as string);
  },

  ebay_get_kyc: async (api, _args) => {
    return await api.account.getKyc();
  },

  ebay_opt_in_to_payments_program: async (api, args) => {
    return await api.account.optInToPaymentsProgram(
      args.marketplaceId as string,
      args.paymentsProgramType as string
    );
  },

  ebay_get_payments_program_status: async (api, args) => {
    return await api.account.getPaymentsProgramStatus(
      args.marketplaceId as string,
      args.paymentsProgramType as string
    );
  },

  ebay_get_rate_tables: async (api, _args) => {
    return await api.account.getRateTables();
  },

  ebay_create_or_replace_sales_tax: async (api, args) => {
    return await api.account.createOrReplaceSalesTax(
      args.countryCode as string,
      args.jurisdictionId as string,
      args.salesTaxBase as Record<string, unknown>
    );
  },

  ebay_bulk_create_or_replace_sales_tax: async (api, args) => {
    return await api.account.bulkCreateOrReplaceSalesTax(
      args.requests as {
        countryCode: string;
        jurisdictionId: string;
        salesTaxBase: Record<string, unknown>;
      }[]
    );
  },

  ebay_delete_sales_tax: async (api, args) => {
    return await api.account.deleteSalesTax(
      args.countryCode as string,
      args.jurisdictionId as string
    );
  },

  ebay_get_sales_tax: async (api, args) => {
    return await api.account.getSalesTax(args.countryCode as string, args.jurisdictionId as string);
  },

  ebay_get_sales_taxes: async (api, args) => {
    return await api.account.getSalesTaxes(args.countryCode as string);
  },

  ebay_get_subscription: async (api, args) => {
    return await api.account.getSubscription(args.limitType as string);
  },

  ebay_opt_in_to_program: async (api, args) => {
    return await api.account.optInToProgram(args.request as Record<string, unknown>);
  },

  ebay_opt_out_of_program: async (api, args) => {
    return await api.account.optOutOfProgram(args.request as Record<string, unknown>);
  },

  ebay_get_opted_in_programs: async (api, _args) => {
    return await api.account.getOptedInPrograms();
  },

  ebay_get_privileges: async (api, _args) => {
    return await api.account.getPrivileges();
  },

  ebay_get_advertising_eligibility: async (api, args) => {
    return await api.account.getAdvertisingEligibility(
      args.marketplaceId as string,
      args.programTypes as string | undefined
    );
  },

  ebay_get_payments_program: async (api, args) => {
    return await api.account.getPaymentsProgram(
      args.marketplaceId as string,
      args.paymentsProgramType as string
    );
  },

  ebay_get_payments_program_onboarding: async (api, args) => {
    return await api.account.getPaymentsProgramOnboarding(
      args.marketplaceId as string,
      args.paymentsProgramType as string
    );
  },
};

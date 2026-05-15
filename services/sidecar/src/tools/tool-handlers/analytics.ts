import type { ToolHandlerMap } from './types.js';

/** Handler map for Analytics API reporting tools. */
export const analyticsHandlers: ToolHandlerMap = {
  ebay_get_traffic_report: async (api, args) => {
    return await api.analytics.getTrafficReport(
      args.dimension as string,
      args.filter as string,
      args.metric as string,
      args.sort as string
    );
  },

  ebay_find_seller_standards_profiles: async (api, _args) => {
    return await api.analytics.findSellerStandardsProfiles();
  },

  ebay_get_seller_standards_profile: async (api, args) => {
    return await api.analytics.getSellerStandardsProfile(
      args.program as string,
      args.cycle as string
    );
  },

  ebay_get_customer_service_metric: async (api, args) => {
    return await api.analytics.getCustomerServiceMetric(
      args.customerServiceMetricType as string,
      args.evaluationType as string,
      args.evaluationMarketplaceId as string
    );
  },
};

import type { ToolHandlerMap } from './types.js';

/** Handler map for miscellaneous eBay API tools. */
/* eslint-disable @typescript-eslint/naming-convention -- handler keys must match published tool ids */
export const otherApiHandlers: ToolHandlerMap = {
  ebay_get_user: async (api, _args) => {
    return await api.identity.getUser();
  },

  ebay_get_listing_violations: async (api, args) => {
    return await api.compliance.getListingViolations(
      args.complianceType as string,
      args.offset as number,
      args.limit as number
    );
  },

  ebay_get_listing_violations_summary: async (api, args) => {
    return await api.compliance.getListingViolationsSummary(args.complianceType as string);
  },

  ebay_suppress_violation: async (api, args) => {
    return await api.compliance.suppressViolation(args.listingViolationId as string);
  },

  ebay_create_vero_report: async (api, args) => {
    return await api.vero.createVeroReport(args.reportData as Record<string, unknown>);
  },

  ebay_get_vero_report: async (api, args) => {
    return await api.vero.getVeroReport(args.veroReportId as string);
  },

  ebay_get_vero_report_items: async (api, args) => {
    return await api.vero.getVeroReportItems(
      args.filter as string,
      args.limit as number,
      args.offset as number
    );
  },

  ebay_get_vero_reason_code: async (api, args) => {
    return await api.vero.getVeroReasonCode(args.veroReasonCodeId as string);
  },

  ebay_get_vero_reason_codes: async (api, _args) => {
    return await api.vero.getVeroReasonCodes();
  },

  ebay_translate: async (api, args) => {
    return await api.translation.translate(
      args.from as string,
      args.to as string,
      args.translationContext as string,
      args.text as string[]
    );
  },

  ebay_create_shipping_quote: async (api, args) => {
    return await api.edelivery.createShippingQuote(
      args.shippingQuoteRequest as Record<string, unknown>
    );
  },

  ebay_get_shipping_quote: async (api, args) => {
    return await api.edelivery.getShippingQuote(args.shippingQuoteId as string);
  },

  ebay_get_actual_costs: async (api, args) => {
    return await api.edelivery.getActualCosts(args.params as Record<string, string> | undefined);
  },

  ebay_get_address_preferences: async (api, _args) => {
    return await api.edelivery.getAddressPreferences();
  },

  ebay_create_address_preference: async (api, args) => {
    return await api.edelivery.createAddressPreference(
      args.addressPreference as Record<string, unknown>
    );
  },

  ebay_get_consign_preferences: async (api, _args) => {
    return await api.edelivery.getConsignPreferences();
  },

  ebay_create_consign_preference: async (api, args) => {
    return await api.edelivery.createConsignPreference(
      args.consignPreference as Record<string, unknown>
    );
  },

  ebay_get_agents: async (api, args) => {
    return await api.edelivery.getAgents(args.params as Record<string, string> | undefined);
  },

  ebay_get_battery_qualifications: async (api, args) => {
    return await api.edelivery.getBatteryQualifications(
      args.params as Record<string, string> | undefined
    );
  },

  ebay_get_dropoff_sites: async (api, args) => {
    return await api.edelivery.getDropoffSites(args.params as Record<string, string>);
  },

  ebay_get_shipping_services: async (api, args) => {
    return await api.edelivery.getShippingServices(
      args.params as Record<string, string> | undefined
    );
  },

  ebay_create_bundle: async (api, args) => {
    return await api.edelivery.createBundle(args.bundleRequest as Record<string, unknown>);
  },

  ebay_get_bundle: async (api, args) => {
    return await api.edelivery.getBundle(args.bundleId as string);
  },

  ebay_cancel_bundle: async (api, args) => {
    return await api.edelivery.cancelBundle(args.bundleId as string);
  },

  ebay_get_bundle_label: async (api, args) => {
    return await api.edelivery.getBundleLabel(args.bundleId as string);
  },

  ebay_create_package: async (api, args) => {
    return await api.edelivery.createPackage(args.packageRequest as Record<string, unknown>);
  },

  ebay_get_package: async (api, args) => {
    return await api.edelivery.getPackage(args.packageId as string);
  },

  ebay_delete_package: async (api, args) => {
    return await api.edelivery.deletePackage(args.packageId as string);
  },

  ebay_get_package_by_order_line_item: async (api, args) => {
    return await api.edelivery.getPackageByOrderLineItem(args.orderLineItemId as string);
  },

  ebay_cancel_package: async (api, args) => {
    return await api.edelivery.cancelPackage(args.packageId as string);
  },

  ebay_clone_package: async (api, args) => {
    return await api.edelivery.clonePackage(args.packageId as string);
  },

  ebay_confirm_package: async (api, args) => {
    return await api.edelivery.confirmPackage(args.packageId as string);
  },

  ebay_bulk_cancel_packages: async (api, args) => {
    return await api.edelivery.bulkCancelPackages(
      args.bulkCancelRequest as Record<string, unknown>
    );
  },

  ebay_bulk_confirm_packages: async (api, args) => {
    return await api.edelivery.bulkConfirmPackages(
      args.bulkConfirmRequest as Record<string, unknown>
    );
  },

  ebay_bulk_delete_packages: async (api, args) => {
    return await api.edelivery.bulkDeletePackages(
      args.bulkDeleteRequest as Record<string, unknown>
    );
  },

  ebay_get_labels: async (api, args) => {
    return await api.edelivery.getLabels(args.params as Record<string, string> | undefined);
  },

  ebay_get_handover_sheet: async (api, args) => {
    return await api.edelivery.getHandoverSheet(args.params as Record<string, string> | undefined);
  },

  ebay_get_tracking: async (api, args) => {
    return await api.edelivery.getTracking(args.params as Record<string, string>);
  },

  ebay_create_complaint: async (api, args) => {
    return await api.edelivery.createComplaint(args.complaintRequest as Record<string, unknown>);
  },
};

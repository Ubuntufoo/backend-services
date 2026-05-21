import type { ToolHandlerMap } from './types.js';

/** Handler map for Metadata API marketplace and policy metadata tools. */
/* eslint-disable @typescript-eslint/naming-convention -- handler keys must match published tool ids */
export const metadataHandlers: ToolHandlerMap = {
  ebay_get_automotive_parts_compatibility_policies: async (api, args) => {
    return await api.metadata.getAutomotivePartsCompatibilityPolicies(
      args.marketplaceId as string,
      args.filter as string
    );
  },

  ebay_get_category_policies: async (api, args) => {
    return await api.metadata.getCategoryPolicies(
      args.marketplaceId as string,
      args.filter as string
    );
  },

  ebay_get_extended_producer_responsibility_policies: async (api, args) => {
    return await api.metadata.getExtendedProducerResponsibilityPolicies(
      args.marketplaceId as string,
      args.filter as string
    );
  },

  ebay_get_hazardous_materials_labels: async (api, args) => {
    return await api.metadata.getHazardousMaterialsLabels(args.marketplaceId as string);
  },

  ebay_get_item_condition_policies: async (api, args) => {
    return await api.metadata.getItemConditionPolicies(
      args.marketplaceId as string,
      args.filter as string
    );
  },

  ebay_get_listing_structure_policies: async (api, args) => {
    return await api.metadata.getListingStructurePolicies(
      args.marketplaceId as string,
      args.filter as string
    );
  },

  ebay_get_negotiated_price_policies: async (api, args) => {
    return await api.metadata.getNegotiatedPricePolicies(
      args.marketplaceId as string,
      args.filter as string
    );
  },

  ebay_get_product_safety_labels: async (api, args) => {
    return await api.metadata.getProductSafetyLabels(args.marketplaceId as string);
  },

  ebay_get_regulatory_policies: async (api, args) => {
    return await api.metadata.getRegulatoryPolicies(
      args.marketplaceId as string,
      args.filter as string
    );
  },

  ebay_get_return_policy_metadata: async (api, args) => {
    return await api.metadata.getReturnPolicies(
      args.marketplaceId as string,
      args.filter as string
    );
  },

  ebay_get_shipping_cost_type_policies: async (api, args) => {
    return await api.metadata.getShippingCostTypePolicies(
      args.marketplaceId as string,
      args.filter as string
    );
  },

  ebay_get_classified_ad_policies: async (api, args) => {
    return await api.metadata.getClassifiedAdPolicies(
      args.marketplaceId as string,
      args.filter as string
    );
  },

  ebay_get_currencies: async (api, args) => {
    return await api.metadata.getCurrencies(args.marketplaceId as string);
  },

  ebay_get_listing_type_policies: async (api, args) => {
    return await api.metadata.getListingTypePolicies(
      args.marketplaceId as string,
      args.filter as string
    );
  },

  ebay_get_motors_listing_policies: async (api, args) => {
    return await api.metadata.getMotorsListingPolicies(
      args.marketplaceId as string,
      args.filter as string
    );
  },

  ebay_get_shipping_policies: async (api, args) => {
    return await api.metadata.getShippingPolicies(
      args.marketplaceId as string,
      args.filter as string
    );
  },

  ebay_get_site_visibility_policies: async (api, args) => {
    return await api.metadata.getSiteVisibilityPolicies(
      args.marketplaceId as string,
      args.filter as string
    );
  },

  ebay_get_compatibilities_by_specification: async (api, args) => {
    return await api.metadata.getCompatibilitiesBySpecification(
      args.specification as Record<string, unknown>
    );
  },

  ebay_get_compatibility_property_names: async (api, args) => {
    return await api.metadata.getCompatibilityPropertyNames(args.data as Record<string, unknown>);
  },

  ebay_get_compatibility_property_values: async (api, args) => {
    return await api.metadata.getCompatibilityPropertyValues(args.data as Record<string, unknown>);
  },

  ebay_get_multi_compatibility_property_values: async (api, args) => {
    return await api.metadata.getMultiCompatibilityPropertyValues(
      args.data as Record<string, unknown>
    );
  },

  ebay_get_product_compatibilities: async (api, args) => {
    return await api.metadata.getProductCompatibilities(args.data as Record<string, unknown>);
  },

  ebay_get_sales_tax_jurisdictions: async (api, args) => {
    return await api.metadata.getSalesTaxJurisdictions(args.countryCode as string);
  },
};

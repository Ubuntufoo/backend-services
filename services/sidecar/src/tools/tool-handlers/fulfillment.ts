import type { ToolHandlerMap } from './types.js';

/** Handler map for Fulfillment API order, shipping, refund, and cancellation tools. */
export const fulfillmentHandlers: ToolHandlerMap = {
  ebay_get_orders: async (api, args) => {
    return await api.fulfillment.getOrders(
      args.filter as string,
      args.limit as number,
      args.offset as number
    );
  },

  ebay_get_order: async (api, args) => {
    return await api.fulfillment.getOrder(args.orderId as string);
  },

  ebay_create_shipping_fulfillment: async (api, args) => {
    return await api.fulfillment.createShippingFulfillment(
      args.orderId as string,
      args.fulfillment as Record<string, unknown>
    );
  },

  ebay_issue_refund: async (api, args) => {
    return await api.fulfillment.issueRefund(
      args.orderId as string,
      args.refundData as Record<string, unknown>
    );
  },

  ebay_get_shipping_fulfillments: async (api, args) => {
    return await api.fulfillment.getShippingFulfillments(args.orderId as string);
  },

  ebay_get_shipping_fulfillment: async (api, args) => {
    return await api.fulfillment.getShippingFulfillment(
      args.orderId as string,
      args.fulfillmentId as string
    );
  },

  ebay_get_payment_dispute_summaries: async (api, args) => {
    return await api.dispute.getPaymentDisputeSummaries({
      order_id: args.orderFilter as string | undefined,
      buyer_username: args.buyerFilter as string | undefined,
      payment_dispute_status: args.openFilter ? 'OPEN' : undefined,
      limit: args.limit as number | undefined,
      offset: args.offset as number | undefined,
    });
  },

  ebay_get_payment_dispute: async (api, args) => {
    return await api.dispute.getPaymentDispute(args.paymentDisputeId as string);
  },

  ebay_get_payment_dispute_activities: async (api, args) => {
    return await api.dispute.getActivities(args.paymentDisputeId as string);
  },

  ebay_accept_payment_dispute: async (api, args) => {
    return await api.dispute.acceptPaymentDispute(
      args.paymentDisputeId as string,
      args.returnAddress as Record<string, unknown> | undefined
    );
  },

  ebay_contest_payment_dispute: async (api, args) => {
    return await api.dispute.contestPaymentDispute(
      args.paymentDisputeId as string,
      args.returnAddress as Record<string, unknown> | undefined
    );
  },

  ebay_add_payment_dispute_evidence: async (api, args) => {
    return await api.dispute.addEvidence(args.paymentDisputeId as string, args);
  },

  ebay_update_payment_dispute_evidence: async (api, args) => {
    return await api.dispute.updateEvidence(args.paymentDisputeId as string, args);
  },

  ebay_upload_payment_dispute_evidence_file: async (api, args) => {
    return await api.dispute.uploadEvidenceFile(
      args.paymentDisputeId as string,
      args.file as ArrayBuffer
    );
  },

  ebay_fetch_payment_dispute_evidence_content: async (api, args) => {
    return await api.dispute.fetchEvidenceContent(
      args.paymentDisputeId as string,
      args.evidenceId as string,
      args.fileId as string
    );
  },
};

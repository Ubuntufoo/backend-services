import type { ToolHandlerMap } from './types.js';
import {
  getAwaitingFeedbackSchema,
  getFeedbackRatingSummarySchema,
  getFeedbackSchema,
  leaveFeedbackForBuyerSchema,
  respondToFeedbackSchema,
} from '@/utils/communication/feedback.js';
import {
  bulkUpdateConversationSchema,
  getConversationSchema,
  getConversationsSchema,
  sendMessageSchema,
  updateConversationSchema,
} from '@/utils/communication/message.js';
import {
  findEligibleItemsSchema,
  getOffersToBuyersSchema,
  sendOfferToInterestedBuyersSchema,
} from '@/utils/communication/negotiation.js';
import {
  createDestinationSchema,
  createSubscriptionFilterSchema,
  createSubscriptionSchema,
  deleteDestinationSchema,
  deleteSubscriptionFilterSchema,
  deleteSubscriptionSchema,
  disableSubscriptionSchema,
  enableSubscriptionSchema,
  getConfigSchema,
  getDestinationSchema,
  getPublicKeySchema,
  getSubscriptionFilterSchema,
  getSubscriptionSchema,
  getSubscriptionsSchema,
  getTopicSchema,
  getTopicsSchema,
  testSubscriptionSchema,
  updateConfigSchema,
  updateDestinationSchema,
  updateSubscriptionSchema,
} from '@/utils/communication/notification.js';

/** Handler map for communication and feedback tools. */
export const communicationHandlers: ToolHandlerMap = {
  ebay_get_offers_to_buyers: async (api, args) => {
    const validated = getOffersToBuyersSchema.parse(args);
    return await api.negotiation.getOffersToBuyers(
      validated.filter,
      validated.limit ? Number(validated.limit) : undefined,
      validated.offset ? Number(validated.offset) : undefined
    );
  },

  ebay_send_offer_to_interested_buyers: async (api, args) => {
    const validated = sendOfferToInterestedBuyersSchema.parse(args);
    return await api.negotiation.sendOfferToInterestedBuyers(validated as Record<string, unknown>);
  },

  ebay_find_eligible_items: async (api, args) => {
    const validated = findEligibleItemsSchema.parse(args);
    return await api.negotiation.findEligibleItems(
      validated.marketplace_id,
      validated.limit ? Number(validated.limit) : undefined,
      validated.offset ? Number(validated.offset) : undefined
    );
  },

  ebay_search_messages: async (api, args) => {
    const validated = getConversationsSchema.parse(args);
    return await api.message.searchMessages(
      undefined,
      validated.limit ? Number(validated.limit) : undefined,
      validated.offset ? Number(validated.offset) : undefined
    );
  },

  ebay_get_message: async (api, args) => {
    const validated = getConversationSchema.parse(args);
    return await api.message.getMessage(validated.conversation_id);
  },

  ebay_send_message: async (api, args) => {
    const validated = sendMessageSchema.parse(args);
    return await api.message.sendMessage(validated as Record<string, unknown>);
  },

  ebay_reply_to_message: async (api, args) => {
    // This is a deprecated method that maps to sendMessage
    // We'll validate with a simple schema
    if (!args.messageId || !args.messageContent) {
      throw new Error('messageId and messageContent are required');
    }
    return await api.message.replyToMessage(
      args.messageId as string,
      args.messageContent as string
    );
  },

  ebay_get_conversations: async (api, args) => {
    const validated = getConversationsSchema.parse(args);
    return await api.message.getConversations(
      undefined,
      validated.limit ? Number(validated.limit) : undefined,
      validated.offset ? Number(validated.offset) : undefined
    );
  },

  ebay_get_conversation: async (api, args) => {
    const validated = getConversationSchema.parse(args);
    return await api.message.getConversation(validated.conversation_id);
  },

  ebay_bulk_update_conversation: async (api, args) => {
    const validated = bulkUpdateConversationSchema.parse(args);
    return await api.message.bulkUpdateConversation(validated as Record<string, unknown>);
  },

  ebay_update_conversation: async (api, args) => {
    const validated = updateConversationSchema.parse(args);
    return await api.message.updateConversation(validated as Record<string, unknown>);
  },

  ebay_get_notification_config: async (api, args) => {
    getConfigSchema.parse(args); // Validate empty args
    return await api.notification.getConfig();
  },

  ebay_update_notification_config: async (api, args) => {
    const validated = updateConfigSchema.parse(args);
    return await api.notification.updateConfig(validated as Record<string, unknown>);
  },

  ebay_get_notification_destinations: async (api, args) => {
    return await api.notification.getDestinations(
      args.limit as number | undefined,
      args.continuationToken as string | undefined
    );
  },

  ebay_create_notification_destination: async (api, args) => {
    const validated = createDestinationSchema.parse(args);
    return await api.notification.createDestination(validated as Record<string, unknown>);
  },

  ebay_get_notification_destination: async (api, args) => {
    const validated = getDestinationSchema.parse(args);
    return await api.notification.getDestination(validated.destination_id);
  },

  ebay_update_notification_destination: async (api, args) => {
    const validated = updateDestinationSchema.parse(args);
    return await api.notification.updateDestination(
      validated.destination_id,
      validated as Record<string, unknown>
    );
  },

  ebay_delete_notification_destination: async (api, args) => {
    const validated = deleteDestinationSchema.parse(args);
    return await api.notification.deleteDestination(validated.destination_id);
  },

  ebay_get_notification_subscriptions: async (api, args) => {
    const validated = getSubscriptionsSchema.parse(args);
    return await api.notification.getSubscriptions(
      validated.limit ? Number(validated.limit) : undefined,
      validated.continuation_token
    );
  },

  ebay_create_notification_subscription: async (api, args) => {
    const validated = createSubscriptionSchema.parse(args);
    return await api.notification.createSubscription(validated as Record<string, unknown>);
  },

  ebay_get_notification_subscription: async (api, args) => {
    const validated = getSubscriptionSchema.parse(args);
    return await api.notification.getSubscription(validated.subscription_id);
  },

  ebay_update_notification_subscription: async (api, args) => {
    const validated = updateSubscriptionSchema.parse(args);
    return await api.notification.updateSubscription(
      validated.subscription_id,
      validated as Record<string, unknown>
    );
  },

  ebay_delete_notification_subscription: async (api, args) => {
    const validated = deleteSubscriptionSchema.parse(args);
    return await api.notification.deleteSubscription(validated.subscription_id);
  },

  ebay_disable_notification_subscription: async (api, args) => {
    const validated = disableSubscriptionSchema.parse(args);
    return await api.notification.disableSubscription(validated.subscription_id);
  },

  ebay_enable_notification_subscription: async (api, args) => {
    const validated = enableSubscriptionSchema.parse(args);
    return await api.notification.enableSubscription(validated.subscription_id);
  },

  ebay_test_notification_subscription: async (api, args) => {
    const validated = testSubscriptionSchema.parse(args);
    return await api.notification.testSubscription(validated.subscription_id);
  },

  ebay_get_notification_topic: async (api, args) => {
    const validated = getTopicSchema.parse(args);
    return await api.notification.getTopic(validated.topic_id);
  },

  ebay_get_notification_topics: async (api, args) => {
    const validated = getTopicsSchema.parse(args);
    return await api.notification.getTopics(
      validated.limit ? Number(validated.limit) : undefined,
      validated.continuation_token
    );
  },

  ebay_create_notification_subscription_filter: async (api, args) => {
    const validated = createSubscriptionFilterSchema.parse(args);
    return await api.notification.createSubscriptionFilter(
      validated.subscription_id,
      validated as Record<string, unknown>
    );
  },

  ebay_get_notification_subscription_filter: async (api, args) => {
    const validated = getSubscriptionFilterSchema.parse(args);
    return await api.notification.getSubscriptionFilter(
      validated.subscription_id,
      validated.filter_id
    );
  },

  ebay_delete_notification_subscription_filter: async (api, args) => {
    const validated = deleteSubscriptionFilterSchema.parse(args);
    return await api.notification.deleteSubscriptionFilter(
      validated.subscription_id,
      validated.filter_id
    );
  },

  ebay_get_notification_public_key: async (api, args) => {
    const validated = getPublicKeySchema.parse(args);
    return await api.notification.getPublicKey(validated.public_key_id);
  },

  ebay_get_feedback: async (api, args) => {
    const validated = getFeedbackSchema.parse(args);
    return await api.feedback.getFeedback(validated.transaction_id ?? '');
  },

  ebay_leave_feedback_for_buyer: async (api, args) => {
    const validated = leaveFeedbackForBuyerSchema.parse(args);
    return await api.feedback.leaveFeedbackForBuyer(validated as Record<string, unknown>);
  },

  ebay_get_feedback_summary: async (api, _args) => {
    return await api.feedback.getFeedbackSummary();
  },

  ebay_get_feedback_rating_summary: async (api, args) => {
    getFeedbackRatingSummarySchema.parse(args);
    return await api.feedback.getFeedbackRatingSummary();
  },

  ebay_get_awaiting_feedback: async (api, args) => {
    const validated = getAwaitingFeedbackSchema.parse(args);
    return await api.feedback.getAwaitingFeedback(
      validated.filter,
      validated.limit ? Number(validated.limit) : undefined,
      validated.offset ? Number(validated.offset) : undefined
    );
  },

  ebay_respond_to_feedback: async (api, args) => {
    const validated = respondToFeedbackSchema.parse(args);
    return await api.feedback.respondToFeedback(
      validated.feedback_id ?? '',
      validated.response_text ?? ''
    );
  },
};

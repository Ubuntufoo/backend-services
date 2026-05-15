import { accountHandlers } from './account.js';
import { analyticsHandlers } from './analytics.js';
import { chatHandlers } from './chat.js';
import { communicationHandlers } from './communication.js';
import { developerHandlers } from './developer.js';
import { fulfillmentHandlers } from './fulfillment.js';
import { inventoryHandlers } from './inventory.js';
import { marketingHandlers } from './marketing.js';
import { metadataHandlers } from './metadata.js';
import { otherApiHandlers } from './other.js';
import { taxonomyHandlers } from './taxonomy.js';
import { tokenManagementHandlers } from './token-management.js';
import { tradingHandlers } from './trading.js';
import type { ToolHandlerMap } from './types.js';

/** Public handler types exported with the combined handler catalog. */
export type { ToolHandler, ToolHandlerMap } from './types.js';

/** Combined handler map keyed by registered tool name. */
export const toolHandlers: ToolHandlerMap = {
  ...chatHandlers,
  ...tokenManagementHandlers,
  ...accountHandlers,
  ...inventoryHandlers,
  ...fulfillmentHandlers,
  ...marketingHandlers,
  ...analyticsHandlers,
  ...metadataHandlers,
  ...taxonomyHandlers,
  ...communicationHandlers,
  ...otherApiHandlers,
  ...developerHandlers,
  ...tradingHandlers,
};

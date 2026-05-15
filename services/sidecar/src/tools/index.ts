/** Public tool definition type exported by the tools module. */
export type { ToolDefinition } from '@/tools/tool-definitions.js';

/** Public tool contract helpers exported by the tools module. */
export { getToolContracts, validateToolContracts, type ToolContract } from '@/tools/contracts.js';

/** Public registry helpers exported by the tools module. */
export {
  executeTool,
  getToolDefinitions,
  getToolEntries,
  getToolHandler,
  validateToolRegistry,
} from '@/tools/registry.js';

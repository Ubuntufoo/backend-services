import type { EbayApiClient } from '../client.js';
import { buildTruthyPaginatedParams } from '../shared/query-params.js';

/**
 * VERO API - Verified Rights Owner program
 * Based on: docs/sell-apps/other-apis/commerce_vero_v1_oas3.json
 */
export class VeroApi {
  private readonly basePath = '/commerce/vero/v1';

  constructor(private client: EbayApiClient) {}

  /**
   * Create a VERO report to report intellectual property infringement
   */
  async createVeroReport(reportData: Record<string, unknown>) {
    return await this.client.post(`${this.basePath}/vero_report`, reportData);
  }

  /**
   * Get a specific VERO report by ID
   */
  async getVeroReport(veroReportId: string) {
    return await this.client.get(`${this.basePath}/vero_report/${veroReportId}`);
  }

  /**
   * Get VERO report items (listings reported for infringement)
   */
  async getVeroReportItems(filter?: string, limit?: number, offset?: number) {
    const params = buildTruthyPaginatedParams(filter, limit, offset);
    return await this.client.get(`${this.basePath}/vero_report_items`, params);
  }

  /**
   * Get a specific VERO reason code by ID
   */
  async getVeroReasonCode(veroReasonCodeId: string) {
    return await this.client.get(`${this.basePath}/vero_reason_code/${veroReasonCodeId}`);
  }

  /**
   * Get all available VERO reason codes
   */
  async getVeroReasonCodes() {
    return await this.client.get(`${this.basePath}/vero_reason_code`);
  }
}

import axios from 'axios';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type { EbayApiClient } from '@/api/client.js';
import { apiLogger } from '@/utils/logger.js';
import { isRecord } from '@/utils/type-guards.js';

const COMPAT_LEVEL = '1451';
const SITE_ID = '0';

const getTradingErrorMessage = (error: unknown): string => {
  if (!isRecord(error)) {
    return 'Unknown Trading API error';
  }

  if (typeof error.ShortMessage === 'string') {
    return error.ShortMessage;
  }

  if (typeof error.LongMessage === 'string') {
    return error.LongMessage;
  }

  return 'Unknown Trading API error';
};

/**
 * XML-based client for eBay Trading API calls that are not covered by REST APIs.
 */
export class TradingApiClient {
  private restClient: EbayApiClient;
  private baseUrl: string;
  private parser: XMLParser;
  private builder: XMLBuilder;

  constructor(restClient: EbayApiClient) {
    this.restClient = restClient;
    const env = restClient.getConfig().environment;
    this.baseUrl = env === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';

    this.parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
      parseTagValue: true,
      isArray: (_name: string) => {
        const arrayTags = [
          'Item',
          'Errors',
          'Error',
          'NameValueList',
          'Value',
          'ShippingServiceOptions',
          'InternationalShippingServiceOption',
          'PaymentMethods',
          'PictureURL',
          'CompatibilityList',
          'Variation',
        ];
        return arrayTags.includes(_name);
      },
    });

    this.builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      suppressEmptyNode: true,
    });
  }

  /**
   * Return the Trading API base URL for the configured eBay environment.
   */
  getTradingBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Execute a named Trading API call with XML request/response conversion.
   */
  async execute(
    callName: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const token = await this.restClient.getOAuthClient().getAccessToken();

    const requestTag = `${callName}Request`;
    const responseTag = `${callName}Response`;

    const xmlObj: Record<string, unknown> = {};
    xmlObj[requestTag] = {
      '@_xmlns': 'urn:ebay:apis:eBLBaseComponents',
      ...params,
    };

    const xmlBody = `<?xml version="1.0" encoding="utf-8"?>\n${this.builder.build(xmlObj)}`;

    apiLogger.debug(`Trading API ${callName}`, { xmlBody });

    let response;
    try {
      response = await axios.post<string>(`${this.baseUrl}/ws/api.dll`, xmlBody, {
        headers: {
          'X-EBAY-API-SITEID': SITE_ID,
          'X-EBAY-API-COMPATIBILITY-LEVEL': COMPAT_LEVEL,
          'X-EBAY-API-CALL-NAME': callName,
          'X-EBAY-API-IAF-TOKEN': token,
          'Content-Type': 'text/xml',
        },
        timeout: 30000,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown HTTP error';
      throw new Error(`Trading API ${callName} request failed: ${message}`);
    }

    let parsed: Record<string, unknown>;
    try {
      const parsedValue: unknown = this.parser.parse(response.data);
      if (!isRecord(parsedValue)) {
        throw new Error('Trading API response must be an object');
      }
      parsed = parsedValue;
    } catch (e) {
      throw new Error(
        `Failed to parse Trading API ${callName} response: ${e instanceof Error ? e.message : String(e)}`
      );
    }
    const resultValue = parsed[responseTag] ?? parsed;
    if (!isRecord(resultValue)) {
      throw new Error(`Trading API ${callName} response payload is not an object`);
    }
    const result = resultValue;

    // Log warnings without failing
    if (result.Ack === 'Warning') {
      apiLogger.warn(`Trading API ${callName} returned warnings`, {
        errors: result.Errors,
      });
    }

    // Check for eBay errors
    if (result.Ack === 'Failure' || result.Ack === 'PartialFailure') {
      const errors: unknown = result.Errors;
      const firstError: unknown = Array.isArray(errors) ? errors[0] : errors;
      throw new Error(getTradingErrorMessage(firstError));
    }

    return result;
  }
}

import type { CaptureMode, ListingStatus, ListingSubStatus } from '@ebay-inventory/types';
import type { Database as GeneratedDatabase } from './database-generated.js';

export type { Json } from './database-generated.js';
import type { Json } from './database-generated.js';

type GeneratedPublicTables = GeneratedDatabase['public']['Tables'];
type GeneratedAppSettings = GeneratedPublicTables['app_settings'];
type GeneratedListings = GeneratedPublicTables['listings'];

export type Database = Omit<GeneratedDatabase, 'public'> & {
  public: Omit<GeneratedDatabase['public'], 'Tables'> & {
    Tables: Omit<GeneratedPublicTables, 'app_settings' | 'listings'> & {
      app_settings: {
        Row: Omit<GeneratedAppSettings['Row'], 'capture_mode' | 'ebay_publish_config'> & {
          capture_mode: CaptureMode | null;
          ebay_publish_config?: Json | null;
        };
        Insert: Omit<GeneratedAppSettings['Insert'], 'capture_mode' | 'ebay_publish_config'> & {
          capture_mode?: CaptureMode | null;
          ebay_publish_config?: Json | null;
        };
        Update: Omit<GeneratedAppSettings['Update'], 'capture_mode' | 'ebay_publish_config'> & {
          capture_mode?: CaptureMode | null;
          ebay_publish_config?: Json | null;
        };
        Relationships: GeneratedAppSettings['Relationships'];
      };
      listings: {
        Row: Omit<
          GeneratedListings['Row'],
          'capture_mode' | 'listing_type' | 'status' | 'sub_status' | 'image_urls' | 'r2_object_keys'
        > & {
          capture_mode: CaptureMode | null;
          image_urls: string[];
          listing_type: 'single' | 'lot' | null;
          status: ListingStatus;
          sub_status: ListingSubStatus;
          r2_object_keys: string[];
        };
        Insert: Omit<
          GeneratedListings['Insert'],
          'capture_mode' | 'listing_type' | 'status' | 'sub_status' | 'image_urls' | 'r2_object_keys'
        > & {
          capture_mode?: CaptureMode | null;
          image_urls?: string[];
          listing_type?: 'single' | 'lot' | null;
          status: ListingStatus;
          sub_status: ListingSubStatus;
          r2_object_keys?: string[];
        };
        Update: Omit<
          GeneratedListings['Update'],
          'capture_mode' | 'listing_type' | 'status' | 'sub_status' | 'image_urls' | 'r2_object_keys'
        > & {
          capture_mode?: CaptureMode | null;
          image_urls?: string[];
          listing_type?: 'single' | 'lot' | null;
          status?: ListingStatus | null;
          sub_status?: ListingSubStatus | null;
          r2_object_keys?: string[];
        };
        Relationships: GeneratedListings['Relationships'];
      };
    };
  };
};

type PublicTables = Database['public']['Tables'];

export type TableName = keyof PublicTables;
export type TableRow<TTableName extends TableName> = PublicTables[TTableName]['Row'];
export type TableInsert<TTableName extends TableName> = PublicTables[TTableName]['Insert'];
export type TableUpdate<TTableName extends TableName> = PublicTables[TTableName]['Update'];

export type AppSettingsRow = TableRow<'app_settings'>;
export type AppSettingsInsert = TableInsert<'app_settings'>;
export type AppSettingsUpdate = TableUpdate<'app_settings'>;

export type AiModelAttemptRow = TableRow<'ai_model_attempts'>;
export type AiModelAttemptInsert = TableInsert<'ai_model_attempts'>;
export type AiModelAttemptUpdate = TableUpdate<'ai_model_attempts'>;

export type AiModelCatalogRow = TableRow<'ai_model_catalog'>;
export type AiModelCatalogInsert = TableInsert<'ai_model_catalog'>;
export type AiModelCatalogUpdate = TableUpdate<'ai_model_catalog'>;

export type AiModelTaskRouteRow = TableRow<'ai_model_task_routes'>;
export type AiModelTaskRouteInsert = TableInsert<'ai_model_task_routes'>;
export type AiModelTaskRouteUpdate = TableUpdate<'ai_model_task_routes'>;

export type AiModelUsageWindowRow = TableRow<'ai_model_usage_windows'>;
export type AiModelUsageWindowInsert = TableInsert<'ai_model_usage_windows'>;
export type AiModelUsageWindowUpdate = TableUpdate<'ai_model_usage_windows'>;

export type DailyUsageRow = TableRow<'daily_usage'>;
export type DailyUsageInsert = TableInsert<'daily_usage'>;
export type DailyUsageUpdate = TableUpdate<'daily_usage'>;

export type JobRow = TableRow<'jobs'>;
export type JobInsert = TableInsert<'jobs'>;
export type JobUpdate = TableUpdate<'jobs'>;

export type ListingPriceResearchRow = TableRow<'listing_price_research'>;
export type ListingPriceResearchInsert = TableInsert<'listing_price_research'>;
export type ListingPriceResearchUpdate = TableUpdate<'listing_price_research'>;

export type ListingRow = TableRow<'listings'>;
export type ListingInsert = TableInsert<'listings'>;
export type ListingUpdate = TableUpdate<'listings'>;

export type OrderRow = TableRow<'orders'>;
export type OrderInsert = TableInsert<'orders'>;
export type OrderUpdate = TableUpdate<'orders'>;

export type VariationListingGroupRow = TableRow<'variation_listing_groups'>;
export type VariationListingGroupInsert = TableInsert<'variation_listing_groups'>;
export type VariationListingGroupUpdate = TableUpdate<'variation_listing_groups'>;

export type VariationListingVariationRow = TableRow<'variation_listing_variations'>;
export type VariationListingVariationInsert = TableInsert<'variation_listing_variations'>;
export type VariationListingVariationUpdate = TableUpdate<'variation_listing_variations'>;

export type VariationListingCopyRow = TableRow<'variation_listing_copies'>;
export type VariationListingCopyInsert = TableInsert<'variation_listing_copies'>;
export type VariationListingCopyUpdate = TableUpdate<'variation_listing_copies'>;

export type VariationListingIntakeSessionRow = TableRow<'variation_listing_intake_sessions'>;
export type VariationListingIntakeSessionInsert = TableInsert<'variation_listing_intake_sessions'>;
export type VariationListingIntakeSessionUpdate = TableUpdate<'variation_listing_intake_sessions'>;

export type VariationListingRevisionRow = TableRow<'variation_listing_revisions'>;
export type VariationListingRevisionInsert = TableInsert<'variation_listing_revisions'>;
export type VariationListingRevisionUpdate = TableUpdate<'variation_listing_revisions'>;

export type VariationListingOperationRow = TableRow<'variation_listing_operations'>;
export type VariationListingOperationInsert = TableInsert<'variation_listing_operations'>;
export type VariationListingOperationUpdate = TableUpdate<'variation_listing_operations'>;

export type VariationListingOperationAttemptRow = TableRow<'variation_listing_operation_attempts'>;
export type VariationListingOperationAttemptInsert = TableInsert<'variation_listing_operation_attempts'>;
export type VariationListingOperationAttemptUpdate = TableUpdate<'variation_listing_operation_attempts'>;

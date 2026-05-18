import type { CaptureMode, ListingStatus, ListingSubStatus } from '@ebay-inventory/types';
import type { Database as GeneratedDatabase } from './database-generated.js';

export type { Json } from './database-generated.js';

type GeneratedPublicTables = GeneratedDatabase['public']['Tables'];
type GeneratedAppSettings = GeneratedPublicTables['app_settings'];
type GeneratedListings = GeneratedPublicTables['listings'];

export type Database = Omit<GeneratedDatabase, 'public'> & {
  public: Omit<GeneratedDatabase['public'], 'Tables'> & {
    Tables: Omit<GeneratedPublicTables, 'app_settings' | 'listings'> & {
      app_settings: {
        Row: Omit<GeneratedAppSettings['Row'], 'capture_mode'> & {
          capture_mode: CaptureMode | null;
        };
        Insert: Omit<GeneratedAppSettings['Insert'], 'capture_mode'> & {
          capture_mode?: CaptureMode | null;
        };
        Update: Omit<GeneratedAppSettings['Update'], 'capture_mode'> & {
          capture_mode?: CaptureMode | null;
        };
        Relationships: GeneratedAppSettings['Relationships'];
      };
      listings: {
        Row: Omit<
          GeneratedListings['Row'],
          'capture_mode' | 'listing_type' | 'status' | 'sub_status'
        > & {
          capture_mode: CaptureMode | null;
          listing_type: 'single' | 'lot' | null;
          status: ListingStatus | null;
          sub_status: ListingSubStatus | null;
        };
        Insert: Omit<
          GeneratedListings['Insert'],
          'capture_mode' | 'listing_type' | 'status' | 'sub_status'
        > & {
          capture_mode?: CaptureMode | null;
          listing_type?: 'single' | 'lot' | null;
          status?: ListingStatus | null;
          sub_status?: ListingSubStatus | null;
        };
        Update: Omit<
          GeneratedListings['Update'],
          'capture_mode' | 'listing_type' | 'status' | 'sub_status'
        > & {
          capture_mode?: CaptureMode | null;
          listing_type?: 'single' | 'lot' | null;
          status?: ListingStatus | null;
          sub_status?: ListingSubStatus | null;
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

export type DailyUsageRow = TableRow<'daily_usage'>;
export type DailyUsageInsert = TableInsert<'daily_usage'>;
export type DailyUsageUpdate = TableUpdate<'daily_usage'>;

export type JobRow = TableRow<'jobs'>;
export type JobInsert = TableInsert<'jobs'>;
export type JobUpdate = TableUpdate<'jobs'>;

export type ListingRow = TableRow<'listings'>;
export type ListingInsert = TableInsert<'listings'>;
export type ListingUpdate = TableUpdate<'listings'>;

export type OrderRow = TableRow<'orders'>;
export type OrderInsert = TableInsert<'orders'>;
export type OrderUpdate = TableUpdate<'orders'>;

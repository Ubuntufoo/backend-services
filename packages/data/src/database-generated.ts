// Generated from the connected Supabase project schema.
// Regenerate with:
//   npx supabase gen types typescript --project-id "$PROJECT_REF" --schema public > packages/data/src/database-generated.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      app_settings: {
        Row: {
          capture_mode: string | null;
          default_fulfillment_policy_id: string | null;
          default_package_type: string | null;
          default_payment_policy_id: string | null;
          default_return_policy_id: string | null;
          default_shipping_profile: string | null;
          ebay_marketplace_id: string | null;
          gemini_daily_limit: number | null;
          handling_days: number | null;
          id: string;
          incoming_folder_path: string | null;
          max_order_syncs_per_day: number | null;
          merchant_location_key: string | null;
          office_location_name: string | null;
          processed_folder_path: string | null;
          r2_retention_days_after_sold: number | null;
          updated_at: string;
        };
        Insert: {
          capture_mode?: string | null;
          default_fulfillment_policy_id?: string | null;
          default_package_type?: string | null;
          default_payment_policy_id?: string | null;
          default_return_policy_id?: string | null;
          default_shipping_profile?: string | null;
          ebay_marketplace_id?: string | null;
          gemini_daily_limit?: number | null;
          handling_days?: number | null;
          id?: string;
          incoming_folder_path?: string | null;
          max_order_syncs_per_day?: number | null;
          merchant_location_key?: string | null;
          office_location_name?: string | null;
          processed_folder_path?: string | null;
          r2_retention_days_after_sold?: number | null;
          updated_at?: string;
        };
        Update: {
          capture_mode?: string | null;
          default_fulfillment_policy_id?: string | null;
          default_package_type?: string | null;
          default_payment_policy_id?: string | null;
          default_return_policy_id?: string | null;
          default_shipping_profile?: string | null;
          ebay_marketplace_id?: string | null;
          gemini_daily_limit?: number | null;
          handling_days?: number | null;
          id?: string;
          incoming_folder_path?: string | null;
          max_order_syncs_per_day?: number | null;
          merchant_location_key?: string | null;
          office_location_name?: string | null;
          processed_folder_path?: string | null;
          r2_retention_days_after_sold?: number | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      daily_usage: {
        Row: {
          gemini_calls_used: number;
          gemini_daily_limit: number;
          order_sync_count: number;
          usage_date: string;
        };
        Insert: {
          gemini_calls_used?: number;
          gemini_daily_limit?: number;
          order_sync_count?: number;
          usage_date?: string;
        };
        Update: {
          gemini_calls_used?: number;
          gemini_daily_limit?: number;
          order_sync_count?: number;
          usage_date?: string;
        };
        Relationships: [];
      };
      jobs: {
        Row: {
          attempts: number;
          created_at: string;
          gemini_attempt_count: number;
          gemini_attempts: Json;
          gemini_selected_model: string | null;
          id: string;
          job_type: string;
          last_error: string | null;
          last_error_at: string | null;
          last_error_code: string | null;
          listing_id: string | null;
          max_attempts: number;
          next_run_at: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          created_at?: string;
          gemini_attempt_count?: number;
          gemini_attempts?: Json;
          gemini_selected_model?: string | null;
          id?: string;
          job_type: string;
          last_error?: string | null;
          last_error_at?: string | null;
          last_error_code?: string | null;
          listing_id?: string | null;
          max_attempts?: number;
          next_run_at?: string | null;
          status: string;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          gemini_attempt_count?: number;
          gemini_attempts?: Json;
          gemini_selected_model?: string | null;
          id?: string;
          job_type?: string;
          last_error?: string | null;
          last_error_at?: string | null;
          last_error_code?: string | null;
          listing_id?: string | null;
          max_attempts?: number;
          next_run_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'jobs_listing_id_fkey';
            columns: ['listing_id'];
            isOneToOne: false;
            referencedRelation: 'listings';
            referencedColumns: ['listing_id'];
          },
        ];
      };
      listings: {
        Row: {
          approved_for_export_at: string | null;
          capture_mode: string | null;
          category_id: string | null;
          condition_id: string | null;
          condition_notes: string | null;
          created_at: string;
          description: string | null;
          ebay_listing_id: string | null;
          ebay_listing_status: string | null;
          ebay_listing_url: string | null;
          ebay_offer_id: string | null;
          ese_eligible: boolean | null;
          estimated_weight_oz: number | null;
          exported_at: string | null;
          handling_days: number | null;
          id: string;
          generated_at: string | null;
          image_urls: string[];
          item_specifics: Json;
          last_error_at: string | null;
          last_error_code: string | null;
          last_error_context: Json;
          last_error_message: string | null;
          listing_id: string;
          listing_type: string | null;
          merchant_location_key: string | null;
          package_type: string | null;
          price: number | null;
          r2_delete_after: string | null;
          r2_deleted_at: string | null;
          r2_object_keys: string[];
          r2_retention_policy: string | null;
          seller_hints: string | null;
          shipping_profile: string | null;
          sku: string | null;
          sold_at: string | null;
          status: string;
          sub_status: string;
          title: string | null;
          updated_at: string;
        };
        Insert: {
          approved_for_export_at?: string | null;
          capture_mode?: string | null;
          category_id?: string | null;
          condition_id?: string | null;
          condition_notes?: string | null;
          created_at?: string;
          description?: string | null;
          ebay_listing_id?: string | null;
          ebay_listing_status?: string | null;
          ebay_listing_url?: string | null;
          ebay_offer_id?: string | null;
          ese_eligible?: boolean | null;
          estimated_weight_oz?: number | null;
          exported_at?: string | null;
          handling_days?: number | null;
          id?: string;
          generated_at?: string | null;
          image_urls?: string[];
          item_specifics?: Json;
          last_error_at?: string | null;
          last_error_code?: string | null;
          last_error_context?: Json;
          last_error_message?: string | null;
          listing_id: string;
          listing_type?: string | null;
          merchant_location_key?: string | null;
          package_type?: string | null;
          price?: number | null;
          r2_delete_after?: string | null;
          r2_deleted_at?: string | null;
          r2_object_keys?: string[];
          r2_retention_policy?: string | null;
          seller_hints?: string | null;
          shipping_profile?: string | null;
          sku?: string | null;
          sold_at?: string | null;
          status: string;
          sub_status: string;
          title?: string | null;
          updated_at?: string;
        };
        Update: {
          approved_for_export_at?: string | null;
          capture_mode?: string | null;
          category_id?: string | null;
          condition_id?: string | null;
          condition_notes?: string | null;
          created_at?: string;
          description?: string | null;
          ebay_listing_id?: string | null;
          ebay_listing_status?: string | null;
          ebay_listing_url?: string | null;
          ebay_offer_id?: string | null;
          ese_eligible?: boolean | null;
          estimated_weight_oz?: number | null;
          exported_at?: string | null;
          handling_days?: number | null;
          id?: string;
          generated_at?: string | null;
          image_urls?: string[];
          item_specifics?: Json;
          last_error_at?: string | null;
          last_error_code?: string | null;
          last_error_context?: Json;
          last_error_message?: string | null;
          listing_id?: string;
          listing_type?: string | null;
          merchant_location_key?: string | null;
          package_type?: string | null;
          price?: number | null;
          r2_delete_after?: string | null;
          r2_deleted_at?: string | null;
          r2_object_keys?: string[];
          r2_retention_policy?: string | null;
          seller_hints?: string | null;
          shipping_profile?: string | null;
          sku?: string | null;
          sold_at?: string | null;
          status?: string | null;
          sub_status?: string | null;
          title?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          created_at: string;
          ebay_listing_id: string | null;
          fulfillment_status: string | null;
          id: string;
          listing_id: string | null;
          order_id: string;
          order_status: string | null;
          quantity_sold: number | null;
          sale_price: number | null;
          ship_by_date: string | null;
          sku: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          ebay_listing_id?: string | null;
          fulfillment_status?: string | null;
          id?: string;
          listing_id?: string | null;
          order_id: string;
          order_status?: string | null;
          quantity_sold?: number | null;
          sale_price?: number | null;
          ship_by_date?: string | null;
          sku?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          ebay_listing_id?: string | null;
          fulfillment_status?: string | null;
          id?: string;
          listing_id?: string | null;
          order_id?: string;
          order_status?: string | null;
          quantity_sold?: number | null;
          sale_price?: number | null;
          ship_by_date?: string | null;
          sku?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'orders_listing_id_fkey';
            columns: ['listing_id'];
            isOneToOne: false;
            referencedRelation: 'listings';
            referencedColumns: ['listing_id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

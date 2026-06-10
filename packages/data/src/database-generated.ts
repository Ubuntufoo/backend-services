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
      ai_model_attempts: {
        Row: {
          attempt_order: number;
          created_at: string;
          duration_ms: number | null;
          failure_code: string | null;
          failure_message: string | null;
          finished_at: string | null;
          id: string;
          job_id: string | null;
          listing_id: string;
          metadata: Json;
          model_name: string;
          provider: string;
          provider_model_id: string | null;
          routing_source: string | null;
          started_at: string;
          status: string;
        };
        Insert: {
          attempt_order: number;
          created_at?: string;
          duration_ms?: number | null;
          failure_code?: string | null;
          failure_message?: string | null;
          finished_at?: string | null;
          id?: string;
          job_id?: string | null;
          listing_id: string;
          metadata?: Json;
          model_name: string;
          provider: string;
          provider_model_id?: string | null;
          routing_source?: string | null;
          started_at?: string;
          status: string;
        };
        Update: {
          attempt_order?: number;
          created_at?: string;
          duration_ms?: number | null;
          failure_code?: string | null;
          failure_message?: string | null;
          finished_at?: string | null;
          id?: string;
          job_id?: string | null;
          listing_id?: string;
          metadata?: Json;
          model_name?: string;
          provider?: string;
          provider_model_id?: string | null;
          routing_source?: string | null;
          started_at?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_model_attempts_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_model_attempts_listing_id_fkey';
            columns: ['listing_id'];
            isOneToOne: false;
            referencedRelation: 'listings';
            referencedColumns: ['listing_id'];
          },
        ];
      };
      ai_model_catalog: {
        Row: {
          created_at: string;
          display_name: string | null;
          free_tier_daily_request_limit: number | null;
          free_tier_status: string;
          id: string;
          input_token_limit: number | null;
          is_enabled: boolean;
          is_free_tier_eligible: boolean;
          last_verified_at: string | null;
          model_name: string;
          notes: string | null;
          output_token_limit: number | null;
          provider: string;
          supports_images: boolean;
          supports_json_output: boolean;
          supports_structured_output: boolean;
          supports_text: boolean;
          updated_at: string;
          verification_notes: string | null;
          verification_source_url: string | null;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          free_tier_daily_request_limit?: number | null;
          free_tier_status?: string;
          id?: string;
          input_token_limit?: number | null;
          is_enabled?: boolean;
          is_free_tier_eligible?: boolean;
          last_verified_at?: string | null;
          model_name: string;
          notes?: string | null;
          output_token_limit?: number | null;
          provider: string;
          supports_images?: boolean;
          supports_json_output?: boolean;
          supports_structured_output?: boolean;
          supports_text?: boolean;
          updated_at?: string;
          verification_notes?: string | null;
          verification_source_url?: string | null;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          free_tier_daily_request_limit?: number | null;
          free_tier_status?: string;
          id?: string;
          input_token_limit?: number | null;
          is_enabled?: boolean;
          is_free_tier_eligible?: boolean;
          last_verified_at?: string | null;
          model_name?: string;
          notes?: string | null;
          output_token_limit?: number | null;
          provider?: string;
          supports_images?: boolean;
          supports_json_output?: boolean;
          supports_structured_output?: boolean;
          supports_text?: boolean;
          updated_at?: string;
          verification_notes?: string | null;
          verification_source_url?: string | null;
        };
        Relationships: [];
      };
      ai_model_task_routes: {
        Row: {
          created_at: string;
          fallback_on_quota_exceeded: boolean;
          fallback_on_rate_limit: boolean;
          fallback_on_unavailable: boolean;
          id: string;
          is_enabled: boolean;
          model_name: string;
          notes: string | null;
          provider: string;
          require_images: boolean;
          require_json_output: boolean;
          require_structured_output: boolean;
          route_order: number;
          task_type: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          fallback_on_quota_exceeded?: boolean;
          fallback_on_rate_limit?: boolean;
          fallback_on_unavailable?: boolean;
          id?: string;
          is_enabled?: boolean;
          model_name: string;
          notes?: string | null;
          provider: string;
          require_images?: boolean;
          require_json_output?: boolean;
          require_structured_output?: boolean;
          route_order: number;
          task_type: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          fallback_on_quota_exceeded?: boolean;
          fallback_on_rate_limit?: boolean;
          fallback_on_unavailable?: boolean;
          id?: string;
          is_enabled?: boolean;
          model_name?: string;
          notes?: string | null;
          provider?: string;
          require_images?: boolean;
          require_json_output?: boolean;
          require_structured_output?: boolean;
          route_order?: number;
          task_type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_model_task_routes_provider_model_name_fkey';
            columns: ['provider', 'model_name'];
            isOneToOne: false;
            referencedRelation: 'ai_model_catalog';
            referencedColumns: ['provider', 'model_name'];
          },
        ];
      };
      ai_model_usage_windows: {
        Row: {
          created_at: string;
          id: string;
          model_name: string;
          provider: string;
          requests_used: number;
          task_type: string;
          updated_at: string;
          window_start: string;
          window_type: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          model_name: string;
          provider: string;
          requests_used?: number;
          task_type: string;
          updated_at?: string;
          window_start: string;
          window_type: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          model_name?: string;
          provider?: string;
          requests_used?: number;
          task_type?: string;
          updated_at?: string;
          window_start?: string;
          window_type?: string;
        };
        Relationships: [];
      };
      app_settings: {
        Row: {
          capture_mode: string | null;
          default_fulfillment_policy_id: string | null;
          default_package_type: string | null;
          default_payment_policy_id: string | null;
          default_return_policy_id: string | null;
          default_shipping_profile: string | null;
          ebay_marketplace_id: string | null;
          ebay_publish_config: Json | null;
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
          ebay_publish_config?: Json | null;
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
          ebay_publish_config?: Json | null;
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
      listing_price_research: {
        Row: {
          comps: Json;
          confidence: string | null;
          created_at: string;
          error_code: string | null;
          error_message: string | null;
          id: string;
          listing_id: string;
          llm_price_explanation: string | null;
          llm_reasoning_json: Json;
          llm_rejected_comp_ids: Json;
          llm_selected_comp_ids: Json;
          median_sold_price: number | null;
          pricing_model_name: string | null;
          provider: string;
          query: string | null;
          raw_result_json: Json;
          sold_count: number | null;
          status: string;
          suggested_price: number | null;
          updated_at: string;
        };
        Insert: {
          comps?: Json;
          confidence?: string | null;
          created_at?: string;
          error_code?: string | null;
          error_message?: string | null;
          id?: string;
          listing_id: string;
          llm_price_explanation?: string | null;
          llm_reasoning_json?: Json;
          llm_rejected_comp_ids?: Json;
          llm_selected_comp_ids?: Json;
          median_sold_price?: number | null;
          pricing_model_name?: string | null;
          provider: string;
          query?: string | null;
          raw_result_json?: Json;
          sold_count?: number | null;
          status: string;
          suggested_price?: number | null;
          updated_at?: string;
        };
        Update: {
          comps?: Json;
          confidence?: string | null;
          created_at?: string;
          error_code?: string | null;
          error_message?: string | null;
          id?: string;
          listing_id?: string;
          llm_price_explanation?: string | null;
          llm_reasoning_json?: Json;
          llm_rejected_comp_ids?: Json;
          llm_selected_comp_ids?: Json;
          median_sold_price?: number | null;
          pricing_model_name?: string | null;
          provider?: string;
          query?: string | null;
          raw_result_json?: Json;
          sold_count?: number | null;
          status?: string;
          suggested_price?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'listing_price_research_listing_id_fkey';
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
      reserve_ai_model_usage: {
        Args: {
          p_amount?: number;
          p_model_name: string;
          p_now: string;
          p_provider: string;
          p_requests_per_day?: number | null;
          p_requests_per_minute?: number | null;
          p_task_type: string;
        };
        Returns: {
          allowed: boolean;
          day_remaining: number | null;
          day_request_limit: number | null;
          day_requests_used: number | null;
          day_window_start: string | null;
          denied_reason: string | null;
          minute_remaining: number | null;
          minute_request_limit: number | null;
          minute_requests_used: number | null;
          minute_window_start: string | null;
        }[];
      };
      reserve_ai_model_usage_window: {
        Args: {
          p_amount?: number;
          p_limit: number;
          p_model_name: string;
          p_provider: string;
          p_task_type: string;
          p_window_start: string;
          p_window_type: string;
        };
        Returns: {
          allowed: boolean;
          remaining: number;
          request_limit: number;
          requests_used: number;
          window_start: string;
          window_type: string;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

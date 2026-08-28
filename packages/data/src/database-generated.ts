// Generated from the connected Supabase project schema. Pending additive migration
// table blocks are mechanically merged from its disposable local schema validation.
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
          requests_per_day: number | null;
          requests_per_minute: number | null;
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
          requests_per_day?: number | null;
          requests_per_minute?: number | null;
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
          requests_per_day?: number | null;
          requests_per_minute?: number | null;
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
          pricing_provider_mode: string;
          soldcomps_usage_snapshot: Json | null;
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
          pricing_provider_mode?: string;
          soldcomps_usage_snapshot?: Json | null;
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
          pricing_provider_mode?: string;
          soldcomps_usage_snapshot?: Json | null;
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
          created_at: string;
          dismissed_pricing_warning_codes: Json;
          error_code: string | null;
          error_message: string | null;
          id: string;
          listing_id: string;
          llm_price_explanation: string | null;
          llm_reasoning_json: Json;
          llm_rejected_comp_ids: Json;
          median_sold_price: number | null;
          suggested_price: number | null;
          confidence: string | null;
          pricing_model_name: string | null;
          provider: string;
          query: string | null;
          raw_result_json: Json;
          sold_count: number | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          comps?: Json;
          created_at?: string;
          dismissed_pricing_warning_codes?: Json;
          error_code?: string | null;
          error_message?: string | null;
          id?: string;
          listing_id: string;
          llm_price_explanation?: string | null;
          llm_reasoning_json?: Json;
          llm_rejected_comp_ids?: Json;
          median_sold_price?: number | null;
          suggested_price?: number | null;
          confidence?: string | null;
          pricing_model_name?: string | null;
          provider: string;
          query?: string | null;
          raw_result_json?: Json;
          sold_count?: number | null;
          status: string;
          updated_at?: string;
        };
        Update: {
          comps?: Json;
          created_at?: string;
          dismissed_pricing_warning_codes?: Json;
          error_code?: string | null;
          error_message?: string | null;
          id?: string;
          listing_id?: string;
          llm_price_explanation?: string | null;
          llm_reasoning_json?: Json;
          llm_rejected_comp_ids?: Json;
          median_sold_price?: number | null;
          suggested_price?: number | null;
          confidence?: string | null;
          pricing_model_name?: string | null;
          provider?: string;
          query?: string | null;
          raw_result_json?: Json;
          sold_count?: number | null;
          status?: string;
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
          auto_pricing_enabled: boolean;
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
          auto_pricing_enabled?: boolean;
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
          auto_pricing_enabled?: boolean;
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
      variation_listing_copies: {
        Row: {
          availability_state: string;
          back_r2_key: string;
          capture_back_source_ref: string;
          capture_front_source_ref: string;
          capture_pair_id: string;
          capture_session_version: number;
          capture_source_key: string;
          capture_started_at: string;
          captured_at: string;
          condition_notes: string | null;
          condition_token: string;
          copy_id: string;
          created_at: string;
          front_r2_key: string;
          updated_at: string;
          variation_id: string;
        };
        Insert: {
          availability_state?: string;
          back_r2_key: string;
          capture_back_source_ref: string;
          capture_front_source_ref: string;
          capture_pair_id: string;
          capture_session_version: number;
          capture_source_key: string;
          capture_started_at: string;
          captured_at?: string;
          condition_notes?: string | null;
          condition_token: string;
          copy_id: string;
          created_at?: string;
          front_r2_key: string;
          updated_at?: string;
          variation_id: string;
        };
        Update: {
          availability_state?: string;
          back_r2_key?: string;
          capture_back_source_ref?: string;
          capture_front_source_ref?: string;
          capture_pair_id?: string;
          capture_session_version?: number;
          capture_source_key?: string;
          capture_started_at?: string;
          captured_at?: string;
          condition_notes?: string | null;
          condition_token?: string;
          copy_id?: string;
          created_at?: string;
          front_r2_key?: string;
          updated_at?: string;
          variation_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'variation_listing_copies_variation_id_fkey';
            columns: ['variation_id'];
            isOneToOne: false;
            referencedRelation: 'variation_listing_variations';
            referencedColumns: ['variation_id'];
          },
        ];
      };
      variation_listing_groups: {
        Row: {
          category_id: string;
          condition_description: string | null;
          condition_descriptors: Json;
          condition_id: string;
          condition_token: string;
          created_at: string;
          derived_common_ebay_aspects: Json;
          description: string | null;
          desired_revision: number;
          fulfillment_policy_id: string;
          group_id: string;
          group_key: string;
          last_confirmed_revision: number | null;
          lifecycle_state: string;
          listing_format: string;
          marketplace_id: string;
          merchant_location_key: string;
          next_inventory_serial: number;
          payment_policy_id: string;
          recovery_required: boolean;
          return_policy_id: string;
          selector_name: string;
          sku_bucket_token: string;
          sku_category_code: string;
          title: string | null;
          updated_at: string;
        };
        Insert: {
          category_id: string;
          condition_description?: string | null;
          condition_descriptors?: Json;
          condition_id: string;
          condition_token: string;
          created_at?: string;
          derived_common_ebay_aspects?: Json;
          description?: string | null;
          desired_revision?: number;
          fulfillment_policy_id: string;
          group_id: string;
          group_key: string;
          last_confirmed_revision?: number | null;
          lifecycle_state?: string;
          listing_format?: string;
          marketplace_id: string;
          merchant_location_key: string;
          next_inventory_serial?: number;
          payment_policy_id: string;
          recovery_required?: boolean;
          return_policy_id: string;
          selector_name?: string;
          sku_bucket_token: string;
          sku_category_code: string;
          title?: string | null;
          updated_at?: string;
        };
        Update: {
          category_id?: string;
          condition_description?: string | null;
          condition_descriptors?: Json;
          condition_id?: string;
          condition_token?: string;
          created_at?: string;
          derived_common_ebay_aspects?: Json;
          description?: string | null;
          desired_revision?: number;
          fulfillment_policy_id?: string;
          group_id?: string;
          group_key?: string;
          last_confirmed_revision?: number | null;
          lifecycle_state?: string;
          listing_format?: string;
          marketplace_id?: string;
          merchant_location_key?: string;
          next_inventory_serial?: number;
          payment_policy_id?: string;
          recovery_required?: boolean;
          return_policy_id?: string;
          selector_name?: string;
          sku_bucket_token?: string;
          sku_category_code?: string;
          title?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      variation_listing_intake_sessions: {
        Row: {
          capture_source_key: string;
          created_at: string;
          mode: string;
          pending_pair_front_source_ref: string | null;
          pending_pair_id: string | null;
          pending_pair_mode: string | null;
          pending_pair_price_amount: number | null;
          pending_pair_price_currency: string | null;
          pending_pair_session_version: number | null;
          pending_pair_started_at: string | null;
          pending_pair_target_group_id: string | null;
          pending_pair_target_variation_id: string | null;
          session_version: number;
          sticky_price_amount: number;
          sticky_price_currency: string;
          target_group_id: string | null;
          target_variation_id: string | null;
          updated_at: string;
        };
        Insert: {
          capture_source_key: string;
          created_at?: string;
          mode?: string;
          pending_pair_front_source_ref?: string | null;
          pending_pair_id?: string | null;
          pending_pair_mode?: string | null;
          pending_pair_price_amount?: number | null;
          pending_pair_price_currency?: string | null;
          pending_pair_session_version?: number | null;
          pending_pair_started_at?: string | null;
          pending_pair_target_group_id?: string | null;
          pending_pair_target_variation_id?: string | null;
          session_version?: number;
          sticky_price_amount?: number;
          sticky_price_currency?: string;
          target_group_id?: string | null;
          target_variation_id?: string | null;
          updated_at?: string;
        };
        Update: {
          capture_source_key?: string;
          created_at?: string;
          mode?: string;
          pending_pair_front_source_ref?: string | null;
          pending_pair_id?: string | null;
          pending_pair_mode?: string | null;
          pending_pair_price_amount?: number | null;
          pending_pair_price_currency?: string | null;
          pending_pair_session_version?: number | null;
          pending_pair_started_at?: string | null;
          pending_pair_target_group_id?: string | null;
          pending_pair_target_variation_id?: string | null;
          session_version?: number;
          sticky_price_amount?: number;
          sticky_price_currency?: string;
          target_group_id?: string | null;
          target_variation_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'variation_listing_intake_sessions_pending_pair_group_fkey';
            columns: ['pending_pair_target_group_id'];
            isOneToOne: false;
            referencedRelation: 'variation_listing_groups';
            referencedColumns: ['group_id'];
          },
          {
            foreignKeyName: 'variation_listing_intake_sessions_pending_variation_group_fkey';
            columns: ['pending_pair_target_group_id', 'pending_pair_target_variation_id'];
            isOneToOne: false;
            referencedRelation: 'variation_listing_variations';
            referencedColumns: ['group_id', 'variation_id'];
          },
          {
            foreignKeyName: 'variation_listing_intake_sessions_target_group_id_fkey';
            columns: ['target_group_id'];
            isOneToOne: false;
            referencedRelation: 'variation_listing_groups';
            referencedColumns: ['group_id'];
          },
          {
            foreignKeyName: 'variation_listing_intake_sessions_target_variation_group_fkey';
            columns: ['target_group_id', 'target_variation_id'];
            isOneToOne: false;
            referencedRelation: 'variation_listing_variations';
            referencedColumns: ['group_id', 'variation_id'];
          },
        ];
      };
      variation_listing_variations: {
        Row: {
          created_at: string;
          group_id: string;
          inventory_serial: number;
          position: number;
          price_amount: number;
          price_currency: string;
          representative_copy_id: string | null;
          selector_value: string;
          sku: string;
          updated_at: string;
          variation_id: string;
          variation_metadata: Json;
        };
        Insert: {
          created_at?: string;
          group_id: string;
          inventory_serial: number;
          position: number;
          price_amount: number;
          price_currency?: string;
          representative_copy_id?: string | null;
          selector_value: string;
          sku: string;
          updated_at?: string;
          variation_id: string;
          variation_metadata?: Json;
        };
        Update: {
          created_at?: string;
          group_id?: string;
          inventory_serial?: number;
          position?: number;
          price_amount?: number;
          price_currency?: string;
          representative_copy_id?: string | null;
          selector_value?: string;
          sku?: string;
          updated_at?: string;
          variation_id?: string;
          variation_metadata?: Json;
        };
        Relationships: [
          {
            foreignKeyName: 'variation_listing_variations_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'variation_listing_groups';
            referencedColumns: ['group_id'];
          },
          {
            foreignKeyName: 'variation_listing_variations_representative_copy_fkey';
            columns: ['variation_id', 'representative_copy_id'];
            isOneToOne: false;
            referencedRelation: 'variation_listing_copies';
            referencedColumns: ['variation_id', 'copy_id'];
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

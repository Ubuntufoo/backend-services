insert into public.app_settings (
  id,
  capture_mode,
  gemini_daily_limit,
  max_order_syncs_per_day,
  handling_days,
  r2_retention_days_after_sold,
  incoming_folder_path,
  processed_folder_path,
  merchant_location_key,
  office_location_name,
  default_payment_policy_id,
  default_fulfillment_policy_id,
  default_return_policy_id,
  default_shipping_profile,
  default_package_type,
  ebay_marketplace_id
)
values (
  'default',
  'single_2_image',
  500,
  25,
  2,
  30,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null
)
on conflict (id) do nothing;

alter table public.ai_model_catalog
add column if not exists requests_per_minute integer;

alter table public.ai_model_catalog
add column if not exists requests_per_day integer;

insert into public.ai_model_catalog (
  provider,
  model_name,
  display_name,
  free_tier_status,
  input_token_limit,
  is_enabled,
  is_free_tier_eligible,
  notes,
  output_token_limit,
  requests_per_minute,
  requests_per_day,
  supports_images,
  supports_json_output,
  supports_structured_output,
  supports_text
)
values (
  'google',
  'gemma-4-31b-it',
  'Gemma 4 31B IT',
  'verified_paid_only',
  null,
  true,
  false,
  'Hosted pricing-reasoning model. Reserved per-model limits for future usage-window enforcement: 15 RPM, 1500 RPD.',
  null,
  15,
  1500,
  false,
  true,
  true,
  true
)
on conflict (provider, model_name) do update
set
  display_name = excluded.display_name,
  free_tier_status = excluded.free_tier_status,
  input_token_limit = excluded.input_token_limit,
  is_enabled = excluded.is_enabled,
  is_free_tier_eligible = excluded.is_free_tier_eligible,
  notes = excluded.notes,
  output_token_limit = excluded.output_token_limit,
  requests_per_minute = excluded.requests_per_minute,
  requests_per_day = excluded.requests_per_day,
  supports_images = excluded.supports_images,
  supports_json_output = excluded.supports_json_output,
  supports_structured_output = excluded.supports_structured_output,
  supports_text = excluded.supports_text;

insert into public.ai_model_task_routes (
  task_type,
  provider,
  model_name,
  route_order,
  is_enabled,
  require_images,
  require_json_output,
  require_structured_output,
  fallback_on_rate_limit,
  fallback_on_quota_exceeded,
  fallback_on_unavailable,
  notes
)
values (
  'pricing_reasoning',
  'google',
  'gemma-4-31b-it',
  1,
  true,
  false,
  true,
  true,
  true,
  true,
  true,
  'Primary hosted pricing-reasoning route.'
)
on conflict (task_type, provider, model_name) do update
set
  is_enabled = excluded.is_enabled,
  require_images = excluded.require_images,
  require_json_output = excluded.require_json_output,
  require_structured_output = excluded.require_structured_output,
  fallback_on_rate_limit = excluded.fallback_on_rate_limit,
  fallback_on_quota_exceeded = excluded.fallback_on_quota_exceeded,
  fallback_on_unavailable = excluded.fallback_on_unavailable,
  route_order = excluded.route_order,
  notes = excluded.notes;

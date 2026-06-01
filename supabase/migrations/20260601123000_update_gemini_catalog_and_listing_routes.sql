alter table public.ai_model_catalog
add column if not exists free_tier_daily_request_limit integer;

alter table public.ai_model_catalog
drop constraint if exists ai_model_catalog_free_tier_status_check;

alter table public.ai_model_catalog
add constraint ai_model_catalog_free_tier_status_check check (
  free_tier_status in (
    'unknown',
    'confirmed',
    'verified_free',
    'verified_paid_only',
    'deprecated',
    'unavailable'
  )
);

insert into public.ai_model_catalog (
  provider,
  model_name,
  display_name,
  free_tier_daily_request_limit,
  free_tier_status,
  input_token_limit,
  is_enabled,
  is_free_tier_eligible,
  notes,
  output_token_limit,
  supports_images,
  supports_json_output,
  supports_structured_output,
  supports_text
)
values
  (
    'google',
    'gemini-3.1-flash-lite',
    'Gemini 3.1 Flash Lite',
    500,
    'confirmed',
    null,
    true,
    true,
    'Confirmed multimodal structured-output fallback. Free-tier daily request limit: 500 RPD. Token limits not independently verified from fetched docs during this repo task.',
    null,
    true,
    true,
    true,
    true
  ),
  (
    'google',
    'gemini-3.5-flash',
    'Gemini 3.5 Flash',
    20,
    'confirmed',
    1048576,
    true,
    true,
    'Confirmed strongest listing-generation route. Free-tier daily request limit: 20 RPD.',
    65536,
    true,
    true,
    true,
    true
  ),
  (
    'google',
    'gemini-3-flash-preview',
    'Gemini 3 Flash Preview',
    20,
    'confirmed',
    1048576,
    true,
    true,
    'Confirmed multimodal preview fallback. Free-tier daily request limit: 20 RPD.',
    65536,
    true,
    true,
    true,
    true
  )
on conflict (provider, model_name) do update
set
  display_name = excluded.display_name,
  free_tier_daily_request_limit = excluded.free_tier_daily_request_limit,
  free_tier_status = excluded.free_tier_status,
  input_token_limit = excluded.input_token_limit,
  is_enabled = excluded.is_enabled,
  is_free_tier_eligible = excluded.is_free_tier_eligible,
  notes = excluded.notes,
  output_token_limit = excluded.output_token_limit,
  supports_images = excluded.supports_images,
  supports_json_output = excluded.supports_json_output,
  supports_structured_output = excluded.supports_structured_output,
  supports_text = excluded.supports_text;

do $$
begin
  update public.ai_model_task_routes
  set route_order = route_order + 1000
  where task_type = 'listing_draft_generation';

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
  values
    (
      'listing_draft_generation',
      'google',
      'gemini-3.5-flash',
      101,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      'Strongest-first primary route for listing draft generation.'
    ),
    (
      'listing_draft_generation',
      'google',
      'gemini-3-flash-preview',
      102,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      'Second-choice preview fallback for listing draft generation.'
    ),
    (
      'listing_draft_generation',
      'google',
      'gemini-3.1-flash-lite',
      103,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      'High-volume fallback route for listing draft generation.'
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
    notes = excluded.notes;

  update public.ai_model_task_routes
  set route_order = 1
  where task_type = 'listing_draft_generation'
    and provider = 'google'
    and model_name = 'gemini-3.5-flash';

  update public.ai_model_task_routes
  set route_order = 2
  where task_type = 'listing_draft_generation'
    and provider = 'google'
    and model_name = 'gemini-3-flash-preview';

  update public.ai_model_task_routes
  set route_order = 3
  where task_type = 'listing_draft_generation'
    and provider = 'google'
    and model_name = 'gemini-3.1-flash-lite';
end
$$;

update public.app_settings
set gemini_daily_limit = 540
where id = 'default'
  and gemini_daily_limit = 500;

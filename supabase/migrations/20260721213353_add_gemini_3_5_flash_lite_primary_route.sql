insert into public.ai_model_catalog (
  provider,
  model_name,
  display_name,
  free_tier_daily_request_limit,
  free_tier_status,
  is_enabled,
  is_free_tier_eligible,
  notes,
  supports_images,
  supports_json_output,
  supports_structured_output,
  supports_text
)
values (
  'google',
  'gemini-3.5-flash-lite',
  'Gemini 3.5 Flash Lite',
  500,
  'confirmed',
  true,
  true,
  'Stable multimodal structured-output primary route. Free-tier daily request limit: 500 RPD.',
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
  is_enabled = excluded.is_enabled,
  is_free_tier_eligible = excluded.is_free_tier_eligible,
  notes = excluded.notes,
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
      'gemini-3.5-flash-lite',
      101,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      'Primary high-volume route for listing draft generation.'
    ),
    (
      'listing_draft_generation',
      'google',
      'gemini-3.1-flash-lite',
      102,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      'First fallback route for listing draft generation.'
    ),
    (
      'listing_draft_generation',
      'google',
      'gemini-3.5-flash',
      103,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      'Second fallback route for listing draft generation.'
    ),
    (
      'listing_draft_generation',
      'google',
      'gemini-3-flash-preview',
      104,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      'Final fallback route for listing draft generation.'
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
    and model_name = 'gemini-3.5-flash-lite';

  update public.ai_model_task_routes
  set route_order = 2
  where task_type = 'listing_draft_generation'
    and provider = 'google'
    and model_name = 'gemini-3.1-flash-lite';

  update public.ai_model_task_routes
  set route_order = 3
  where task_type = 'listing_draft_generation'
    and provider = 'google'
    and model_name = 'gemini-3.5-flash';

  update public.ai_model_task_routes
  set route_order = 4
  where task_type = 'listing_draft_generation'
    and provider = 'google'
    and model_name = 'gemini-3-flash-preview';
end
$$;

update public.app_settings
set gemini_daily_limit = 1040
where id = 'default'
  and gemini_daily_limit = 540;

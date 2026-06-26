do $$
begin
  update public.ai_model_task_routes
  set route_order = route_order + 1000
  where task_type = 'listing_draft_generation'
    and provider = 'google';

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
      'gemini-3-flash-preview',
      101,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      'Primary preview-first route for listing draft generation after approved latency optimization 9M.2.'
    ),
    (
      'listing_draft_generation',
      'google',
      'gemini-3.5-flash',
      102,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      'Second-choice fallback route for listing draft generation when preview-first attempt is unavailable.'
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
      'High-volume tertiary fallback route for listing draft generation.'
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
    and model_name = 'gemini-3-flash-preview';

  update public.ai_model_task_routes
  set route_order = 2
  where task_type = 'listing_draft_generation'
    and provider = 'google'
    and model_name = 'gemini-3.5-flash';

  update public.ai_model_task_routes
  set route_order = 3
  where task_type = 'listing_draft_generation'
    and provider = 'google'
    and model_name = 'gemini-3.1-flash-lite';
end
$$;

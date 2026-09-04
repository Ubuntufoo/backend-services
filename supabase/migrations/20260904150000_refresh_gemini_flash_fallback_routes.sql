-- Refresh the shared free-tier Gemini listing-generation cascade.
-- High-RPD Lite models stay first; stable Flash models follow as fallbacks.
begin;

insert into public.ai_model_catalog (
  provider, model_name, display_name, free_tier_daily_request_limit,
  free_tier_status, is_enabled, is_free_tier_eligible, notes,
  supports_images, supports_json_output, supports_structured_output, supports_text
)
values
  ('google','gemini-3.8-flash','Gemini 3.8 Flash',20,'confirmed',true,true,'Stable multimodal structured-output fallback. Verify project quota in AI Studio.',true,true,true,true),
  ('google','gemini-3.7-flash','Gemini 3.7 Flash',20,'confirmed',true,true,'Stable multimodal structured-output fallback. Verify project quota in AI Studio.',true,true,true,true),
  ('google','gemini-3.6-flash','Gemini 3.6 Flash',20,'confirmed',true,true,'Stable multimodal structured-output fallback replacing Gemini 3 Flash Preview. Free-tier daily request limit: 20 RPD.',true,true,true,true)
on conflict (provider, model_name) do update
set display_name=excluded.display_name,
    free_tier_daily_request_limit=excluded.free_tier_daily_request_limit,
    free_tier_status=excluded.free_tier_status,
    is_enabled=excluded.is_enabled,
    is_free_tier_eligible=excluded.is_free_tier_eligible,
    notes=excluded.notes,
    supports_images=excluded.supports_images,
    supports_json_output=excluded.supports_json_output,
    supports_structured_output=excluded.supports_structured_output,
    supports_text=excluded.supports_text;

do $$
declare
  max_route_order integer;
  route_order_offset integer;
begin
  -- route_order is unique per task, regardless of provider. Refuse to
  -- overwrite a non-Google route that already occupies a canonical slot.
  if exists (
    select 1
    from public.ai_model_task_routes
    where task_type='listing_draft_generation'
      and provider <> 'google'
      and route_order between 1 and 6
  ) then
    raise exception 'non-Google listing_draft_generation route occupies canonical order 1-6';
  end if;

  -- Evacuate canonical Google rows (and anything occupying slots 1-6) above
  -- every route for this task. A fixed +1000 can collide with an unrelated
  -- provider at (for example) route 1001.
  select coalesce(max(route_order), 0)
  into max_route_order
  from public.ai_model_task_routes
  where task_type='listing_draft_generation';

  -- Keep the temporary relocation inside the integer route_order domain.
  if max_route_order > 1073741323 then
    raise exception 'listing_draft_generation route_order space exhausted';
  end if;
  route_order_offset := max_route_order + 1000;

  update public.ai_model_task_routes
  set route_order = route_order + route_order_offset
  where task_type='listing_draft_generation'
    and provider='google'
    and (
      model_name in (
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
        'gemini-3.8-flash',
        'gemini-3.7-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash'
      )
      or route_order between 1 and 6
    );

  -- The canonical set is authoritative for this task; retire stale Google
  -- routes (including the preview route) while preserving their catalog rows.
  update public.ai_model_task_routes
  set is_enabled=false
  where task_type='listing_draft_generation'
    and provider='google'
    and model_name not in (
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash'
    );

  insert into public.ai_model_task_routes (
    task_type, provider, model_name, route_order, is_enabled,
    require_images, require_json_output, require_structured_output,
    fallback_on_rate_limit, fallback_on_quota_exceeded, fallback_on_unavailable, notes
  ) values
    ('listing_draft_generation','google','gemini-3.5-flash-lite',1,true,true,true,true,true,true,true,'Primary high-RPD route.'),
    ('listing_draft_generation','google','gemini-3.1-flash-lite',2,true,true,true,true,true,true,true,'Second high-RPD route.'),
    ('listing_draft_generation','google','gemini-3.8-flash',3,true,true,true,true,true,true,true,'Newest stable Flash fallback.'),
    ('listing_draft_generation','google','gemini-3.7-flash',4,true,true,true,true,true,true,true,'Stable Flash fallback.'),
    ('listing_draft_generation','google','gemini-3.6-flash',5,true,true,true,true,true,true,true,'Stable Flash fallback replacing preview.'),
    ('listing_draft_generation','google','gemini-3.5-flash',6,true,true,true,true,true,true,true,'Final stable Flash fallback.')
  on conflict (task_type, provider, model_name) do update
  set route_order=excluded.route_order,
      is_enabled=excluded.is_enabled,
      require_images=excluded.require_images,
      require_json_output=excluded.require_json_output,
      require_structured_output=excluded.require_structured_output,
      fallback_on_rate_limit=excluded.fallback_on_rate_limit,
      fallback_on_quota_exceeded=excluded.fallback_on_quota_exceeded,
      fallback_on_unavailable=excluded.fallback_on_unavailable,
      notes=excluded.notes;

end
$$;

-- Known route capacity is 500 + 500 + 20 + 20 + 20 + 20 = 1080 RPD:
-- the old 20-RPD preview is disabled; Gemini 3.8, 3.7, and 3.6 are each 20 RPD,
-- and the existing Gemini 3.5 Flash fallback remains 20 RPD.
update public.app_settings
set gemini_daily_limit=1080
where id='default' and gemini_daily_limit=1040;

commit;

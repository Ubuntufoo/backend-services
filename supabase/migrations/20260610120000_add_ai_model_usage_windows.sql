create table if not exists public.ai_model_usage_windows (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model_name text not null,
  task_type text not null,
  window_type text not null,
  window_start timestamptz not null,
  requests_used integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_model_usage_windows_provider_check check (char_length(btrim(provider)) > 0),
  constraint ai_model_usage_windows_model_name_check check (char_length(btrim(model_name)) > 0),
  constraint ai_model_usage_windows_task_type_check check (char_length(btrim(task_type)) > 0),
  constraint ai_model_usage_windows_window_type_check check (window_type in ('minute', 'day')),
  constraint ai_model_usage_windows_requests_used_check check (requests_used >= 0),
  constraint ai_model_usage_windows_key unique (
    provider,
    model_name,
    task_type,
    window_type,
    window_start
  )
);

alter table public.ai_model_usage_windows enable row level security;

create index if not exists ai_model_usage_windows_lookup_idx
  on public.ai_model_usage_windows (
    provider,
    model_name,
    task_type,
    window_type,
    window_start desc
  );

drop trigger if exists set_ai_model_usage_windows_updated_at on public.ai_model_usage_windows;

create trigger set_ai_model_usage_windows_updated_at
before update on public.ai_model_usage_windows
for each row
execute function public.set_row_updated_at();

create or replace function public.reserve_ai_model_usage_window(
  p_provider text,
  p_model_name text,
  p_task_type text,
  p_window_type text,
  p_window_start timestamptz,
  p_limit integer,
  p_amount integer default 1
)
returns table (
  allowed boolean,
  requests_used integer,
  request_limit integer,
  remaining integer,
  window_start timestamptz,
  window_type text
)
language plpgsql
as $$
declare
  v_row public.ai_model_usage_windows%rowtype;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'reserve_ai_model_usage_window amount must be positive';
  end if;

  if p_limit is null or p_limit <= 0 then
    return query
    select
      true,
      0,
      coalesce(p_limit, 0),
      0,
      p_window_start,
      p_window_type;
    return;
  end if;

  insert into public.ai_model_usage_windows (
    provider,
    model_name,
    task_type,
    window_type,
    window_start,
    requests_used
  )
  values (
    p_provider,
    p_model_name,
    p_task_type,
    p_window_type,
    p_window_start,
    p_amount
  )
  on conflict (
    provider,
    model_name,
    task_type,
    window_type,
    window_start
  )
  do update
  set
    requests_used = public.ai_model_usage_windows.requests_used + p_amount,
    updated_at = now()
  where public.ai_model_usage_windows.requests_used + p_amount <= p_limit
  returning * into v_row;

  if found then
    return query
    select
      true,
      v_row.requests_used,
      p_limit,
      greatest(p_limit - v_row.requests_used, 0),
      v_row.window_start,
      v_row.window_type;
    return;
  end if;

  select *
  into v_row
  from public.ai_model_usage_windows
  where provider = p_provider
    and model_name = p_model_name
    and task_type = p_task_type
    and window_type = p_window_type
    and window_start = p_window_start;

  return query
  select
    false,
    coalesce(v_row.requests_used, 0),
    p_limit,
    greatest(p_limit - coalesce(v_row.requests_used, 0), 0),
    p_window_start,
    p_window_type;
end;
$$;

create or replace function public.reserve_ai_model_usage(
  p_provider text,
  p_model_name text,
  p_task_type text,
  p_now timestamptz,
  p_requests_per_minute integer default null,
  p_requests_per_day integer default null,
  p_amount integer default 1
)
returns table (
  allowed boolean,
  denied_reason text,
  minute_requests_used integer,
  minute_request_limit integer,
  minute_remaining integer,
  minute_window_start timestamptz,
  day_requests_used integer,
  day_request_limit integer,
  day_remaining integer,
  day_window_start timestamptz
)
language plpgsql
as $$
declare
  v_minute_result record;
  v_day_result record;
  v_minute_window_start timestamptz;
  v_day_window_start timestamptz;
  v_minute_used_after_rollback integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'reserve_ai_model_usage amount must be positive';
  end if;

  v_minute_window_start := date_trunc('minute', timezone('utc', p_now)) at time zone 'utc';
  v_day_window_start := date_trunc('day', timezone('utc', p_now)) at time zone 'utc';

  if coalesce(p_requests_per_minute, 0) > 0 then
    select *
    into v_minute_result
    from public.reserve_ai_model_usage_window(
      p_provider,
      p_model_name,
      p_task_type,
      'minute',
      v_minute_window_start,
      p_requests_per_minute,
      p_amount
    );

    if not coalesce(v_minute_result.allowed, false) then
      return query
      select
        false,
        'minute_limit_reached',
        v_minute_result.requests_used,
        v_minute_result.request_limit,
        v_minute_result.remaining,
        v_minute_result.window_start,
        null::integer,
        null::integer,
        null::integer,
        null::timestamptz;
      return;
    end if;
  end if;

  if coalesce(p_requests_per_day, 0) > 0 then
    select *
    into v_day_result
    from public.reserve_ai_model_usage_window(
      p_provider,
      p_model_name,
      p_task_type,
      'day',
      v_day_window_start,
      p_requests_per_day,
      p_amount
    );

    if not coalesce(v_day_result.allowed, false) then
      if coalesce(p_requests_per_minute, 0) > 0 then
        update public.ai_model_usage_windows
        set
          requests_used = public.ai_model_usage_windows.requests_used - p_amount,
          updated_at = now()
        where provider = p_provider
          and model_name = p_model_name
          and task_type = p_task_type
          and window_type = 'minute'
          and window_start = v_minute_window_start
          and public.ai_model_usage_windows.requests_used >= p_amount
        returning public.ai_model_usage_windows.requests_used
        into v_minute_used_after_rollback;
      end if;

      return query
      select
        false,
        'day_limit_reached',
        case
          when coalesce(p_requests_per_minute, 0) > 0 then coalesce(v_minute_used_after_rollback, 0)
          else null::integer
        end,
        case
          when coalesce(p_requests_per_minute, 0) > 0 then p_requests_per_minute
          else null::integer
        end,
        case
          when coalesce(p_requests_per_minute, 0) > 0
            then greatest(p_requests_per_minute - coalesce(v_minute_used_after_rollback, 0), 0)
          else null::integer
        end,
        case
          when coalesce(p_requests_per_minute, 0) > 0 then v_minute_window_start
          else null::timestamptz
        end,
        v_day_result.requests_used,
        v_day_result.request_limit,
        v_day_result.remaining,
        v_day_result.window_start;
      return;
    end if;
  end if;

  return query
  select
    true,
    null::text,
    case
      when coalesce(p_requests_per_minute, 0) > 0 then v_minute_result.requests_used
      else null::integer
    end,
    case
      when coalesce(p_requests_per_minute, 0) > 0 then v_minute_result.request_limit
      else null::integer
    end,
    case
      when coalesce(p_requests_per_minute, 0) > 0 then v_minute_result.remaining
      else null::integer
    end,
    case
      when coalesce(p_requests_per_minute, 0) > 0 then v_minute_result.window_start
      else null::timestamptz
    end,
    case
      when coalesce(p_requests_per_day, 0) > 0 then v_day_result.requests_used
      else null::integer
    end,
    case
      when coalesce(p_requests_per_day, 0) > 0 then v_day_result.request_limit
      else null::integer
    end,
    case
      when coalesce(p_requests_per_day, 0) > 0 then v_day_result.remaining
      else null::integer
    end,
    case
      when coalesce(p_requests_per_day, 0) > 0 then v_day_result.window_start
      else null::timestamptz
    end;
end;
$$;

revoke all privileges on table public.ai_model_usage_windows from anon, authenticated;
grant all privileges on table public.ai_model_usage_windows to service_role;

revoke execute on function public.reserve_ai_model_usage_window(
  text,
  text,
  text,
  text,
  timestamptz,
  integer,
  integer
) from public, anon, authenticated;
grant execute on function public.reserve_ai_model_usage_window(
  text,
  text,
  text,
  text,
  timestamptz,
  integer,
  integer
) to service_role;

revoke execute on function public.reserve_ai_model_usage(
  text,
  text,
  text,
  timestamptz,
  integer,
  integer,
  integer
) from public, anon, authenticated;
grant execute on function public.reserve_ai_model_usage(
  text,
  text,
  text,
  timestamptz,
  integer,
  integer,
  integer
) to service_role;

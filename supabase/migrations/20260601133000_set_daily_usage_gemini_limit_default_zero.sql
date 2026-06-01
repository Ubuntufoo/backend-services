alter table public.daily_usage
  alter column gemini_daily_limit set default 0;

update public.daily_usage
set gemini_daily_limit = 0
where gemini_daily_limit = 500;

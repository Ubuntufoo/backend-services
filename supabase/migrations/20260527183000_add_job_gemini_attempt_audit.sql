alter table public.jobs
  add column if not exists gemini_attempts jsonb,
  add column if not exists gemini_selected_model text,
  add column if not exists gemini_attempt_count integer;

update public.jobs
set gemini_attempts = '[]'::jsonb
where gemini_attempts is null;

update public.jobs
set gemini_attempt_count = 0
where gemini_attempt_count is null;

alter table public.jobs
  alter column gemini_attempts set default '[]'::jsonb,
  alter column gemini_attempts set not null,
  alter column gemini_attempt_count set default 0,
  alter column gemini_attempt_count set not null;

alter table public.jobs
  add column if not exists attempts integer not null default 0,
  add column if not exists max_attempts integer;

update public.jobs
set max_attempts = case
  when job_type = 'process_images' then 2
  else 3
end
where max_attempts is null;

alter table public.jobs
  alter column max_attempts set not null,
  alter column max_attempts set default 3;

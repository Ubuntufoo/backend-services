with ranked_active_publish_jobs as (
  select
    id,
    row_number() over (
      partition by listing_id
      order by
        case when status = 'running' then 0 else 1 end,
        created_at asc,
        id asc
    ) as rn
  from public.jobs
  where listing_id is not null
    and job_type = 'publish'
    and status in ('queued', 'running')
),
deactivated_duplicate_active_publish_jobs as (
  update public.jobs jobs
  set
    status = 'failed',
    last_error = 'Deactivated by migration: duplicate active publish job existed for this listing.',
    last_error_code = 'publish_duplicate_active_job',
    last_error_at = now()
  from ranked_active_publish_jobs ranked
  where jobs.id = ranked.id
    and ranked.rn > 1
  returning jobs.id
)
update public.jobs
set max_attempts = 3
where job_type = 'publish'
  and max_attempts <= 0;

create unique index if not exists jobs_publish_active_listing_idx
on public.jobs (listing_id, job_type)
where listing_id is not null
  and job_type = 'publish'
  and status in ('queued', 'running');

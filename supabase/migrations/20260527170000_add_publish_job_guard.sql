update public.jobs
set max_attempts = 3
where job_type = 'publish'
  and max_attempts <= 0;

create unique index if not exists jobs_publish_active_listing_idx
on public.jobs (listing_id, job_type)
where listing_id is not null
  and job_type = 'publish'
  and status in ('queued', 'running');

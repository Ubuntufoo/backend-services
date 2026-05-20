create unique index if not exists jobs_generate_ai_active_listing_idx
on public.jobs (listing_id, job_type)
where listing_id is not null
  and job_type = 'generate_ai'
  and status in ('queued', 'running');

create unique index if not exists jobs_process_images_active_batch_idx
on public.jobs (job_type)
where
  job_type = 'process_images'
  and listing_id is null
  and status in ('queued', 'running');

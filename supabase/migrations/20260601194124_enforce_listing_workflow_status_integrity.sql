update public.listings
set
  status = coalesce(status, 'record_created'),
  sub_status = coalesce(sub_status, 'idle')
where status is null or sub_status is null;

alter table public.listings
  alter column status set not null,
  alter column sub_status set not null;

alter table public.listings
  drop constraint if exists listings_status_check,
  drop constraint if exists listings_sub_status_check,
  drop constraint if exists listings_workflow_state_check;

alter table public.listings
  add constraint listings_status_check
    check (
      status in (
        'record_created',
        'image_processing_queued',
        'images_processed',
        'assets_ready',
        'generating',
        'needs_review',
        'approved_for_export',
        'listed',
        'sold'
      )
    ),
  add constraint listings_sub_status_check
    check (
      sub_status in (
        'grouping_images',
        'preparing_files',
        'waiting_for_image_worker',
        'processing_images',
        'waiting_for_r2_upload',
        'waiting_for_seller_hints',
        'ready_to_generate',
        'ai_call_in_progress',
        'review_pending',
        'publish_queued',
        'publishing_to_ebay',
        'active_live',
        'awaiting_packaging',
        'shipped',
        'idle'
      )
    ),
  add constraint listings_workflow_state_check
    check (
      (status = 'record_created' and sub_status in ('grouping_images', 'preparing_files', 'idle'))
      or (
        status = 'image_processing_queued'
        and sub_status in ('waiting_for_image_worker', 'processing_images', 'idle')
      )
      or (status = 'images_processed' and sub_status in ('waiting_for_r2_upload', 'idle'))
      or (
        status = 'assets_ready'
        and sub_status in ('waiting_for_seller_hints', 'ready_to_generate', 'idle')
      )
      or (status = 'generating' and sub_status in ('ai_call_in_progress', 'idle'))
      or (status = 'needs_review' and sub_status in ('review_pending', 'idle'))
      or (
        status = 'approved_for_export'
        and sub_status in ('publish_queued', 'publishing_to_ebay', 'idle')
      )
      or (status = 'listed' and sub_status in ('active_live', 'idle'))
      or (status = 'sold' and sub_status in ('awaiting_packaging', 'shipped', 'idle'))
    );

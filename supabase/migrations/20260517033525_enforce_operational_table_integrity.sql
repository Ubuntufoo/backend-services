alter table public.orders
  add constraint orders_listing_id_fkey
  foreign key (listing_id)
  references public.listings (listing_id)
  on update cascade
  on delete set null;

alter table public.jobs
  add constraint jobs_listing_id_fkey
  foreign key (listing_id)
  references public.listings (listing_id)
  on update cascade
  on delete set null;

alter table public.app_settings
  add constraint app_settings_singleton_id_check
  check (id = 'default');

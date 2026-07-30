begin;

alter table public.jobs
  drop constraint if exists jobs_listing_id_fkey,
  add constraint jobs_listing_id_fkey
    foreign key (listing_id)
    references public.listings (listing_id)
    on update cascade
    on delete cascade;

alter table public.listing_price_research
  drop constraint if exists listing_price_research_listing_id_fkey,
  add constraint listing_price_research_listing_id_fkey
    foreign key (listing_id)
    references public.listings (listing_id)
    on update cascade
    on delete cascade;

commit;

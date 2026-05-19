create or replace function public.jsonb_text_array(input jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(value order by ordinality), '{}'::text[])
  from jsonb_array_elements_text(input) with ordinality as items(value, ordinality)
$$;

alter table public.listings
  alter column image_urls drop default,
  alter column r2_object_keys drop default;

alter table public.listings
  alter column image_urls type text[]
    using public.jsonb_text_array(coalesce(image_urls, '[]'::jsonb)),
  alter column r2_object_keys type text[]
    using public.jsonb_text_array(coalesce(r2_object_keys, '[]'::jsonb));

alter table public.listings
  alter column image_urls set default '{}'::text[],
  alter column r2_object_keys set default '{}'::text[];

alter table public.listings
  alter column image_urls type text[]
    using coalesce(array(select jsonb_array_elements_text(coalesce(image_urls, '[]'::jsonb))), '{}'::text[]),
  alter column r2_object_keys type text[]
    using coalesce(array(select jsonb_array_elements_text(coalesce(r2_object_keys, '[]'::jsonb))), '{}'::text[]);

alter table public.listings
  alter column image_urls set default '{}'::text[],
  alter column r2_object_keys set default '{}'::text[];
